import Foundation
import Network
import Security

struct TchurchStudioLANService: Equatable {
    let id: String
    let name: String
}

enum TchurchStudioLANConnectionPhase: String, Equatable {
    case idle
    case discovering
    case connecting
    case authenticating
    case connected
    case reconnecting
    case failed
    case suspended
}

final class TchurchStudioLANAssetRequestWatchdog: @unchecked Sendable {
    private let queue: DispatchQueue
    private var workItem: DispatchWorkItem?

    init(queue: DispatchQueue) {
        self.queue = queue
    }

    func arm(after timeout: TimeInterval, handler: @escaping @Sendable () -> Void) {
        cancel()
        guard timeout > 0 else {
            queue.async(execute: handler)
            return
        }
        let workItem = DispatchWorkItem(block: handler)
        self.workItem = workItem
        queue.asyncAfter(deadline: .now() + timeout, execute: workItem)
    }

    func cancel() {
        workItem?.cancel()
        workItem = nil
    }
}

struct TchurchStudioLANClientStatus: Equatable {
    let phase: TchurchStudioLANConnectionPhase
    let services: [TchurchStudioLANService]
    let selectedServiceID: String?
    let channel: TchurchStudioLANChannel?
    let paired: Bool
    let message: String?
}

protocol TchurchStudioLANSecretStoring {
    func read(serviceID: String) throws -> Data?
    func write(_ secret: Data, serviceID: String) throws
    func delete(serviceID: String) throws
    func deleteAll() throws
}

final class TchurchStudioLANKeychainSecretStore: TchurchStudioLANSecretStoring {
    private let service = "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch.studio-lan"

    func read(serviceID: String) throws -> Data? {
        var query = baseQuery(serviceID: serviceID)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw TchurchStudioLANError.invalidConfiguration
        }
        return data
    }

    func write(_ secret: Data, serviceID: String) throws {
        guard (TchurchStudioLANPairingSecret.minimumByteCount ... TchurchStudioLANPairingSecret.maximumByteCount)
            .contains(secret.count) else {
            throw TchurchStudioLANError.invalidPairingCode
        }
        let query = baseQuery(serviceID: serviceID)
        let attributes: [String: Any] = [
            kSecValueData as String: secret,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecItemNotFound {
            var inserted = query
            attributes.forEach { inserted[$0.key] = $0.value }
            guard SecItemAdd(inserted as CFDictionary, nil) == errSecSuccess else {
                throw TchurchStudioLANError.invalidConfiguration
            }
        } else if update != errSecSuccess {
            throw TchurchStudioLANError.invalidConfiguration
        }
    }

    func delete(serviceID: String) throws {
        let status = SecItemDelete(baseQuery(serviceID: serviceID) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw TchurchStudioLANError.invalidConfiguration
        }
    }

    func deleteAll() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw TchurchStudioLANError.invalidConfiguration
        }
    }

    private func baseQuery(serviceID: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serviceID,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

enum TchurchStudioLANNetworkParameters {
    static func makeClient(pairingSecret: TchurchStudioLANPairingSecret) -> NWParameters {
        make(pairingSecret: pairingSecret, requiresPeerCertificate: true)
    }

    static func makeListener(pairingSecret: TchurchStudioLANPairingSecret) -> NWParameters {
        make(pairingSecret: pairingSecret, requiresPeerCertificate: false)
    }

    private static func make(
        pairingSecret: TchurchStudioLANPairingSecret,
        requiresPeerCertificate: Bool
    ) -> NWParameters {
        let tls = NWProtocolTLS.Options()
        let securityOptions = tls.securityProtocolOptions
        sec_protocol_options_set_min_tls_protocol_version(securityOptions, .TLSv12)
        sec_protocol_options_set_max_tls_protocol_version(securityOptions, .TLSv12)
        sec_protocol_options_set_peer_authentication_required(securityOptions, requiresPeerCertificate)

        let key = dispatchData(pairingSecret.transportKeyMaterial)
        let identity = dispatchData(Data("tchurch-show:\(pairingSecret.keyID)".utf8))
        sec_protocol_options_add_pre_shared_key(
            securityOptions,
            key as dispatch_data_t,
            identity as dispatch_data_t
        )
        sec_protocol_options_set_tls_pre_shared_key_identity_hint(
            securityOptions,
            identity as dispatch_data_t
        )
        sec_protocol_options_append_tls_ciphersuite(
            securityOptions,
            tls_ciphersuite_t(rawValue: UInt16(TLS_PSK_WITH_AES_128_GCM_SHA256))!
        )

        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.enableKeepalive = true
        tcp.keepaliveIdle = 15
        tcp.keepaliveInterval = 5
        tcp.keepaliveCount = 3

        let parameters = NWParameters(tls: tls, tcp: tcp)
        parameters.includePeerToPeer = true
        parameters.prohibitedInterfaceTypes = [.cellular]
        return parameters
    }

    private static func dispatchData(_ data: Data) -> DispatchData {
        data.withUnsafeBytes { DispatchData(bytes: $0) }
    }
}

final class TchurchStudioLANClient: @unchecked Sendable {
    static let bonjourServiceType = "_tchurch-show._tcp"
    static let assetRequestTimeoutSeconds: TimeInterval = 15
    private static let clientIDDefaultsKey = "tchurch.studio-lan.client-id"

    var statusHandler: ((TchurchStudioLANClientStatus) -> Void)?
    var envelopeHandler: ((TchurchStudioLANSignedEnvelope) -> Void)?
    var imageAssetHandler: ((TchurchStudioLANImageAssetStatus) -> Void)?

    private struct DesiredConnection {
        let serviceID: String
        let channel: TchurchStudioLANChannel
    }

    private enum SecretSource {
        case entered
        case saved
    }

    private struct ImageAssetIntent: Equatable {
        let authority: TchurchStudioLANAuthority
        let cueID: String
        let descriptor: TchurchStudioLANImageAssetDescriptor
        let isCurrent: Bool
        let generation: UInt64
    }

    private struct InFlightAssetRequest: Equatable {
        let request: TchurchStudioLANAssetRequest
        let intent: ImageAssetIntent
    }

    private let queue = DispatchQueue(label: "app.tchurch.studio-lan.client")
    private let assetIOQueue = DispatchQueue(label: "app.tchurch.studio-lan.assets", qos: .utility)
    private lazy var assetRequestWatchdog = TchurchStudioLANAssetRequestWatchdog(queue: queue)
    private let limits: TchurchStudioLANLimits
    private let secretStore: TchurchStudioLANSecretStoring
    private let defaults: UserDefaults
    private let assetCache: TchurchStudioLANAssetCache

    private var browser: NWBrowser?
    private var discoveredEndpoints: [String: NWEndpoint] = [:]
    private var discoveredServices: [String: TchurchStudioLANService] = [:]
    private var connection: NWConnection?
    private var decoder: TchurchStudioLANLengthPrefixedFrameDecoder
    private var desired: DesiredConnection?
    private var pendingSecret: TchurchStudioLANPairingSecret?
    private var activeSecret: TchurchStudioLANPairingSecret?
    private var activeSecretSource: SecretSource?
    private var challenge: TchurchStudioLANServerChallenge?
    private var request: TchurchStudioLANSubscriptionRequest?
    private var verifier: TchurchStudioLANEnvelopeVerifier?
    private var payloadNegotiation = TchurchStudioLANPayloadNegotiation()
    private var replayGuards: [String: TchurchStudioLANReplayGuard] = [:]
    private var reconnectAttempt = 0
    private var reconnectWork: DispatchWorkItem?
    private var discoveryTimeoutWork: DispatchWorkItem?
    private var connectionTimeoutWork: DispatchWorkItem?
    private var intentionalDisconnect = true
    private var suspended = false
    private var didAuthenticate = false
    private var currentPhase: TchurchStudioLANConnectionPhase = .idle
    private var currentMessage: String?
    private var assetGeneration: UInt64 = 0
    private var imageAssetIntents: [ImageAssetIntent] = []
    private var inFlightAssetRequest: InFlightAssetRequest?
    private var assetRetryCount = 0

    init(
        limits: TchurchStudioLANLimits = .production,
        secretStore: TchurchStudioLANSecretStoring = TchurchStudioLANKeychainSecretStore(),
        defaults: UserDefaults = .standard,
        assetCache: TchurchStudioLANAssetCache = TchurchStudioLANAssetCache()
    ) throws {
        guard limits.isValid else { throw TchurchStudioLANError.invalidConfiguration }
        self.limits = limits
        self.secretStore = secretStore
        self.defaults = defaults
        self.assetCache = assetCache
        decoder = try TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: limits.maximumFrameBytes,
            maximumBufferedBytes: limits.maximumBufferedInputBytes
        )
    }

    func startDiscovery() {
        queue.async { [weak self] in self?.startDiscoveryOnQueue() }
    }

    func stopDiscovery() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.discoveryTimeoutWork?.cancel()
            self.discoveryTimeoutWork = nil
            self.browser?.cancel()
            self.browser = nil
            if self.connection == nil { self.setPhase(.idle, message: nil) }
        }
    }

    func connect(serviceID: String, channel: TchurchStudioLANChannel, pairingCode: String?) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard channel.isReadOnlyOutput, self.discoveredEndpoints[serviceID] != nil else {
                self.setPhase(.failed, message: "Selecciona un Tchurch Studio disponible.")
                return
            }
            do {
                let secret: TchurchStudioLANPairingSecret
                if let pairingCode = pairingCode, !pairingCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    secret = try TchurchStudioLANPairingSecret(pairingCode: pairingCode)
                    self.pendingSecret = secret
                    self.activeSecretSource = .entered
                } else if let saved = try self.secretStore.read(serviceID: serviceID) {
                    secret = try TchurchStudioLANPairingSecret(rawRepresentation: saved)
                    self.pendingSecret = nil
                    self.activeSecretSource = .saved
                } else {
                    self.setPhase(.failed, message: "Ingresa el código de emparejamiento de Tchurch Studio.")
                    return
                }
                self.desired = DesiredConnection(serviceID: serviceID, channel: channel)
                self.activeSecret = secret
                self.payloadNegotiation = TchurchStudioLANPayloadNegotiation()
                self.intentionalDisconnect = false
                self.suspended = false
                self.reconnectAttempt = 0
                self.beginConnection(reconnecting: false)
            } catch {
                self.pendingSecret = nil
                self.activeSecret = nil
                self.activeSecretSource = nil
                self.setPhase(.failed, message: "El código de emparejamiento no es válido.")
            }
        }
    }

    func disconnect(clearDesired: Bool = true) {
        queue.async { [weak self] in self?.disconnectOnQueue(clearDesired: clearDesired) }
    }

    func suspend() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.suspended = true
            self.reconnectWork?.cancel()
            self.reconnectWork = nil
            self.connectionTimeoutWork?.cancel()
            self.connectionTimeoutWork = nil
            self.intentionalDisconnect = true
            self.connection?.stateUpdateHandler = nil
            self.connection?.cancel()
            self.connection = nil
            self.resetAssetTransfer()
            self.setPhase(.suspended, message: "En espera: abre Tchurch para volver a conectar.")
        }
    }

    func resume() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.suspended = false
            self.intentionalDisconnect = false
            self.startDiscoveryOnQueue()
            if self.desired != nil { self.beginConnection(reconnecting: true) }
        }
    }

    func forgetPairing(serviceID: String) {
        queue.async { [weak self] in
            guard let self = self else { return }
            do {
                try self.secretStore.delete(serviceID: serviceID)
                if self.desired?.serviceID == serviceID { self.disconnectOnQueue(clearDesired: true) }
                self.resetAssetTransfer()
                self.assetIOQueue.async { [weak self] in try? self?.assetCache.purgeAll() }
                self.emitStatus()
            } catch {
                if self.desired?.serviceID == serviceID { self.disconnectOnQueue(clearDesired: true) }
                self.resetAssetTransfer()
                self.assetIOQueue.async { [weak self] in try? self?.assetCache.purgeAll() }
                self.setPhase(.failed, message: "No se pudo borrar el emparejamiento guardado.")
            }
        }
    }

    func purgePrivateState(_ completion: @escaping (Result<Void, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self else { return completion(.failure(TchurchStudioLANError.invalidConfiguration)) }
            self.disconnectOnQueue(clearDesired: true)
            self.resetAssetTransfer()
            self.replayGuards.removeAll(keepingCapacity: false)
            self.defaults.removeObject(forKey: Self.clientIDDefaultsKey)
            var deletedSecrets = true
            do {
                try self.secretStore.deleteAll()
            } catch {
                deletedSecrets = false
            }
            self.assetIOQueue.async { [weak self] in
                guard let self else { return completion(.failure(TchurchStudioLANError.invalidConfiguration)) }
                var purgedCache = true
                do {
                    try self.assetCache.purgeAll()
                } catch {
                    purgedCache = false
                }
                completion(deletedSecrets && purgedCache
                    ? .success(())
                    : .failure(TchurchStudioLANError.assetCacheUnavailable))
            }
        }
    }

    func currentStatus(_ completion: @escaping (TchurchStudioLANClientStatus) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }
            completion(self.makeStatus())
        }
    }

    private func startDiscoveryOnQueue() {
        guard browser == nil else {
            if connection == nil, discoveredServices.isEmpty {
                setPhase(.discovering, message: nil)
                scheduleDiscoveryTimeout()
            } else {
                emitStatus()
            }
            return
        }
        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        parameters.prohibitedInterfaceTypes = [.cellular]
        let browser = NWBrowser(
            for: .bonjour(type: Self.bonjourServiceType, domain: "local."),
            using: parameters
        )
        self.browser = browser
        browser.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                if self.connection == nil { self.setPhase(.discovering, message: nil) }
            case .failed:
                self.discoveryTimeoutWork?.cancel()
                self.discoveryTimeoutWork = nil
                self.browser?.cancel()
                self.browser = nil
                if self.connection == nil {
                    self.setPhase(.failed, message: "No se pudo buscar Tchurch Studio en esta red.")
                }
            case .cancelled:
                if self.browser === browser { self.browser = nil }
            default:
                break
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.replaceResults(results)
        }
        browser.start(queue: queue)
        if connection == nil {
            setPhase(.discovering, message: nil)
            scheduleDiscoveryTimeout()
        }
    }

    private func replaceResults(_ results: Set<NWBrowser.Result>) {
        var endpoints: [String: NWEndpoint] = [:]
        var services: [String: TchurchStudioLANService] = [:]
        for result in results {
            guard case .service(let name, let type, let domain, _) = result.endpoint,
                  type == Self.bonjourServiceType else { continue }
            let identity = "\(name)|\(type)|\(domain)".lowercased()
            let id = String(TchurchStudioLANCrypto.sha256Hex(Data(identity.utf8)).prefix(32))
            endpoints[id] = result.endpoint
            services[id] = TchurchStudioLANService(id: id, name: String(name.prefix(120)))
        }
        discoveredEndpoints = endpoints
        discoveredServices = services
        if connection == nil, desired == nil {
            if services.isEmpty {
                setPhase(.discovering, message: nil)
                scheduleDiscoveryTimeout()
            } else {
                discoveryTimeoutWork?.cancel()
                discoveryTimeoutWork = nil
                setPhase(.idle, message: nil)
            }
        } else {
            emitStatus()
        }
        if connection == nil,
           !suspended,
           let desired = desired,
           endpoints[desired.serviceID] != nil,
           currentPhase == .reconnecting {
            beginConnection(reconnecting: true)
        }
    }

    private func scheduleDiscoveryTimeout() {
        discoveryTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self,
                  self.connection == nil,
                  self.discoveredServices.isEmpty,
                  self.currentPhase == .discovering else { return }
            self.setPhase(
                .idle,
                message: "No se encontró Tchurch Studio. Verifica que la Mac esté abierta y en esta red."
            )
        }
        discoveryTimeoutWork = work
        queue.asyncAfter(deadline: .now() + .seconds(6), execute: work)
    }

    private func beginConnection(reconnecting: Bool) {
        guard !suspended,
              let desired = desired,
              let endpoint = discoveredEndpoints[desired.serviceID] else {
            if desired != nil { scheduleReconnect(message: "Esperando que Tchurch Studio vuelva a aparecer.") }
            return
        }
        let secret: TchurchStudioLANPairingSecret
        do {
            if let activeSecret = activeSecret {
                secret = activeSecret
            } else if let saved = try secretStore.read(serviceID: desired.serviceID) {
                secret = try TchurchStudioLANPairingSecret(rawRepresentation: saved)
                activeSecret = secret
                activeSecretSource = .saved
            } else {
                setPhase(.failed, message: "Vuelve a ingresar el código de emparejamiento.")
                return
            }
        } catch {
            setPhase(.failed, message: "Vuelve a ingresar el código de emparejamiento.")
            return
        }

        reconnectWork?.cancel()
        reconnectWork = nil
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        resetAssetTransfer()
        challenge = nil
        request = nil
        verifier = nil
        didAuthenticate = false
        decoder = try! TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: limits.maximumFrameBytes,
            maximumBufferedBytes: limits.maximumBufferedInputBytes
        )
        intentionalDisconnect = false

        let connection = NWConnection(
            to: endpoint,
            using: TchurchStudioLANNetworkParameters.makeClient(pairingSecret: secret)
        )
        self.connection = connection
        setPhase(reconnecting ? .reconnecting : .connecting, message: reconnecting ? "Reconectando con Tchurch Studio…" : nil)
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self = self, let connection = connection, self.connection === connection else { return }
            switch state {
            case .ready:
                self.setPhase(.authenticating, message: nil)
                self.receiveNext(connection)
            case .failed, .cancelled:
                self.handleConnectionEnded(connection)
            default:
                break
            }
        }
        connection.start(queue: queue)
        let timeout = DispatchWorkItem { [weak self, weak connection] in
            guard let self = self,
                  let connection = connection,
                  self.connection === connection,
                  !self.didAuthenticate else { return }
            connection.cancel()
            self.handleConnectionEnded(connection)
        }
        connectionTimeoutWork = timeout
        queue.asyncAfter(deadline: .now() + .seconds(10), execute: timeout)
    }

    private func receiveNext(_ connection: NWConnection) {
        guard self.connection === connection else { return }
        connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: min(64 * 1_024, limits.maximumBufferedInputBytes)
        ) { [weak self, weak connection] content, _, isComplete, error in
            guard let self = self, let connection = connection, self.connection === connection else { return }
            if error != nil || isComplete {
                self.handleConnectionEnded(connection)
                return
            }
            guard let content = content, !content.isEmpty else {
                self.receiveNext(connection)
                return
            }
            do {
                let frames = try self.decoder.append(content)
                for frame in frames {
                    do {
                        try self.process(frame, connection: connection)
                        guard self.connection === connection else { return }
                    } catch TchurchStudioLANError.replayedEnvelope {
                        // A reconnect may receive the exact latest state again.
                        // Skip only that authenticated frame so a newer frame
                        // coalesced in the same TCP read is still processed.
                        continue
                    }
                }
                self.receiveNext(connection)
            } catch {
                self.failProtocol(connection)
            }
        }
    }

    private func process(_ frame: Data, connection: NWConnection) throws {
        let message = try TchurchStudioLANWireCodec.decode(frame)
        if verifier == nil {
            if challenge == nil {
                guard case .challenge(let challenge) = message else {
                    throw TchurchStudioLANError.protocolViolation
                }
                guard challenge.expiresAtMilliseconds >= TchurchStudioLANTime.nowMilliseconds(),
                      let desired = desired,
                      let secret = activeSecret else {
                    throw TchurchStudioLANError.expiredChallenge
                }
                let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
                    challenge: challenge,
                    clientID: clientID(),
                    clientName: "Tchurch iOS",
                    channel: desired.channel,
                    secret: secret,
                    schemaVersion: payloadNegotiation.requestSchemaVersion
                )
                self.challenge = challenge
                self.request = request
                try send(.subscribe(request), connection: connection)
                return
            }

            if case .error(let code) = message,
               code == .authenticationFailed || code == .protocolViolation,
               beginLegacyFallbackIfEligible(connection) {
                return
            }

            guard case .grant(let grant) = message,
                  let challenge = challenge,
                  let request = request,
                  let secret = activeSecret,
                  let desired = desired else {
                throw TchurchStudioLANError.protocolViolation
            }
            let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
                grant,
                request: request,
                challenge: challenge,
                secret: secret,
                nowMilliseconds: TchurchStudioLANTime.nowMilliseconds()
            )
            try payloadNegotiation.recordAuthenticatedGrant(subscription)
            var replayGuard = replayGuards[replayKey(serviceID: desired.serviceID, channel: desired.channel)]
                ?? TchurchStudioLANReplayGuard()
            try replayGuard.begin(subscription)
            replayGuards[replayKey(serviceID: desired.serviceID, channel: desired.channel)] = replayGuard
            verifier = try TchurchStudioLANEnvelopeVerifier(subscription: subscription, limits: limits)
            didAuthenticate = true
            connectionTimeoutWork?.cancel()
            connectionTimeoutWork = nil
            reconnectAttempt = 0
            if pendingSecret != nil {
                try secretStore.write(secret.transportKeyMaterial, serviceID: desired.serviceID)
                pendingSecret = nil
            }
            activeSecretSource = .saved
            setPhase(.connected, message: nil)
            return
        }

        switch message {
        case .envelope(let encodedEnvelope):
            guard let verifier = verifier, let desired = desired else {
                throw TchurchStudioLANError.protocolViolation
            }
            let envelope = try verifier.verify(encodedEnvelope)
            let key = replayKey(serviceID: desired.serviceID, channel: desired.channel)
            var replayGuard = replayGuards[key] ?? TchurchStudioLANReplayGuard()
            try replayGuard.accept(envelope)
            replayGuards[key] = replayGuard
            envelopeHandler?(envelope)
            registerImageAssets(from: envelope, connection: connection)
        case .assetChunk(let chunk):
            try handleAssetChunk(chunk, connection: connection)
        case .assetUnavailable(let unavailable):
            try handleAssetUnavailable(unavailable, connection: connection)
        case .ping(let nonce) where !nonce.isEmpty && nonce.utf8.count <= 128:
            try send(.pong(nonce), connection: connection)
        case .error:
            throw TchurchStudioLANError.protocolViolation
        default:
            throw TchurchStudioLANError.protocolViolation
        }
    }

    private func registerImageAssets(
        from envelope: TchurchStudioLANSignedEnvelope,
        connection: NWConnection
    ) {
        guard self.connection === connection else { return }
        assetGeneration &+= 1
        let generation = assetGeneration
        var candidates: [(cue: TchurchStudioLANPublicCue, isCurrent: Bool)] = []
        if let cue = envelope.payload.audience.cue, cue.imageAsset != nil {
            candidates.append((cue, true))
        }
        if let cue = envelope.payload.stage?.nextCue, cue.imageAsset != nil {
            candidates.append((cue, false))
        }
        var seen = Set<String>()
        imageAssetIntents = candidates.compactMap { candidate in
            guard envelope.schemaVersion == 3,
                  let descriptor = candidate.cue.imageAsset,
                  seen.insert(descriptor.objectID).inserted else { return nil }
            return ImageAssetIntent(
                authority: envelope.authority,
                cueID: candidate.cue.cueID,
                descriptor: descriptor,
                isCurrent: candidate.isCurrent,
                generation: generation
            )
        }
        assetRetryCount = 0
        for intent in imageAssetIntents where intent.isCurrent {
            publishImageAsset(
                intent,
                phase: .loading,
                receivedBytes: 0,
                fileURL: nil,
                message: "Preparando imagen offline…"
            )
        }
        beginNextImageAssetIfNeeded(connection: connection)
    }

    private func beginNextImageAssetIfNeeded(connection: NWConnection) {
        guard self.connection === connection,
              verifier != nil,
              inFlightAssetRequest == nil,
              let intent = imageAssetIntents.first else { return }
        let protectedObjectIDs = Set(imageAssetIntents.map { $0.descriptor.objectID })
        assetIOQueue.async { [weak self, weak connection] in
            guard let self, let connection else { return }
            do {
                let preparation = try self.assetCache.prepare(
                    descriptor: intent.descriptor,
                    authority: intent.authority,
                    cueID: intent.cueID,
                    protectedObjectIDs: protectedObjectIDs
                )
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.isAuthorized(intent) else { return }
                    switch preparation {
                    case .ready(let url):
                        self.removeIntent(intent)
                        self.publishImageAsset(
                            intent,
                            phase: .ready,
                            receivedBytes: intent.descriptor.byteSize,
                            fileURL: url,
                            message: nil
                        )
                        self.beginNextImageAssetIfNeeded(connection: connection)
                    case .resume(let offset):
                        self.sendAssetRequest(intent: intent, offset: offset, connection: connection)
                    }
                }
            } catch {
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.isAuthorized(intent) else { return }
                    self.removeIntent(intent)
                    self.publishImageAsset(
                        intent,
                        phase: .unavailable,
                        receivedBytes: 0,
                        fileURL: nil,
                        message: self.assetFailureMessage(error)
                    )
                    self.beginNextImageAssetIfNeeded(connection: connection)
                }
            }
        }
    }

    private func sendAssetRequest(
        intent: ImageAssetIntent,
        offset: Int64,
        connection: NWConnection
    ) {
        guard self.connection === connection,
              inFlightAssetRequest == nil,
              isAuthorized(intent),
              offset >= 0,
              offset < intent.descriptor.byteSize else { return }
        let request = TchurchStudioLANAssetRequest(
            schemaVersion: TchurchStudioLANAssetRequest.schemaVersion,
            requestID: UUID(),
            objectID: intent.descriptor.objectID,
            offset: offset,
            maximumBytes: TchurchStudioLANAssetChunk.byteCount
        )
        inFlightAssetRequest = .init(request: request, intent: intent)
        do {
            try send(.assetRequest(request), connection: connection)
            let requestID = request.requestID
            assetRequestWatchdog.arm(after: Self.assetRequestTimeoutSeconds) { [weak self, weak connection] in
                guard let self, let connection,
                      self.connection === connection,
                      self.inFlightAssetRequest?.request.requestID == requestID else { return }
                self.assetRequestWatchdog.cancel()
                connection.stateUpdateHandler = nil
                connection.cancel()
                self.handleConnectionEnded(connection)
            }
        } catch {
            assetRequestWatchdog.cancel()
            inFlightAssetRequest = nil
            handleConnectionEnded(connection)
        }
    }

    private func handleAssetChunk(
        _ chunk: TchurchStudioLANAssetChunk,
        connection: NWConnection
    ) throws {
        guard let inFlight = inFlightAssetRequest,
              chunk.schemaVersion == TchurchStudioLANAssetChunk.schemaVersion,
              chunk.requestID == inFlight.request.requestID,
              chunk.objectID == inFlight.request.objectID,
              chunk.offset == inFlight.request.offset,
              chunk.totalByteSize == inFlight.intent.descriptor.byteSize,
              !chunk.data.isEmpty,
              chunk.data.count <= inFlight.request.maximumBytes,
              chunk.dataSha256 == "sha256:\(TchurchStudioLANCrypto.sha256Hex(chunk.data))",
              chunk.offset + Int64(chunk.data.count) <= chunk.totalByteSize,
              chunk.isFinal == (chunk.offset + Int64(chunk.data.count) == chunk.totalByteSize) else {
            throw TchurchStudioLANError.invalidAssetChunk
        }
        assetRequestWatchdog.cancel()
        assetIOQueue.async { [weak self, weak connection] in
            guard let self, let connection else { return }
            do {
                let result = try self.assetCache.append(chunk, descriptor: inFlight.intent.descriptor)
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.inFlightAssetRequest == inFlight else { return }
                    self.inFlightAssetRequest = nil
                    self.assetRetryCount = 0
                    switch result {
                    case .partial(let nextOffset):
                        if self.isAuthorized(inFlight.intent) {
                            self.publishImageAsset(
                                inFlight.intent,
                                phase: .loading,
                                receivedBytes: nextOffset,
                                fileURL: nil,
                                message: "Descargando imagen offline…"
                            )
                            self.sendAssetRequest(
                                intent: inFlight.intent,
                                offset: nextOffset,
                                connection: connection
                            )
                        } else {
                            self.beginNextImageAssetIfNeeded(connection: connection)
                        }
                    case .ready(let url):
                        self.removeIntent(inFlight.intent)
                        if self.isCurrentOrStillAuthorized(inFlight.intent) {
                            self.publishImageAsset(
                                inFlight.intent,
                                phase: .ready,
                                receivedBytes: inFlight.intent.descriptor.byteSize,
                                fileURL: url,
                                message: nil
                            )
                        }
                        self.beginNextImageAssetIfNeeded(connection: connection)
                    }
                }
            } catch {
                try? self.assetCache.discardPartial(objectID: inFlight.intent.descriptor.objectID)
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.inFlightAssetRequest == inFlight else { return }
                    self.inFlightAssetRequest = nil
                    self.removeIntent(inFlight.intent)
                    if self.isCurrentOrStillAuthorized(inFlight.intent) {
                        self.publishImageAsset(
                            inFlight.intent,
                            phase: .unavailable,
                            receivedBytes: 0,
                            fileURL: nil,
                            message: self.assetFailureMessage(error)
                        )
                    }
                    self.beginNextImageAssetIfNeeded(connection: connection)
                }
            }
        }
    }

    private func handleAssetUnavailable(
        _ unavailable: TchurchStudioLANAssetUnavailable,
        connection: NWConnection
    ) throws {
        guard unavailable.schemaVersion == TchurchStudioLANAssetUnavailable.schemaVersion,
              let inFlight = inFlightAssetRequest,
              unavailable.requestID == inFlight.request.requestID,
              unavailable.objectID == inFlight.request.objectID else {
            throw TchurchStudioLANError.invalidAssetChunk
        }
        assetRequestWatchdog.cancel()
        inFlightAssetRequest = nil
        switch unavailable.code {
        case .overloaded where assetRetryCount < 3:
            assetRetryCount += 1
            let delay = min(4, 1 << (assetRetryCount - 1))
            queue.asyncAfter(deadline: .now() + .seconds(delay)) { [weak self, weak connection] in
                guard let self, let connection,
                      self.connection === connection,
                      self.isAuthorized(inFlight.intent) else { return }
                self.sendAssetRequest(
                    intent: inFlight.intent,
                    offset: inFlight.request.offset,
                    connection: connection
                )
            }
        case .invalidRange where assetRetryCount == 0:
            assetRetryCount = 1
            assetIOQueue.async { [weak self, weak connection] in
                guard let self, let connection else { return }
                try? self.assetCache.discardPartial(objectID: inFlight.intent.descriptor.objectID)
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.isAuthorized(inFlight.intent) else { return }
                    self.sendAssetRequest(intent: inFlight.intent, offset: 0, connection: connection)
                }
            }
        default:
            removeIntent(inFlight.intent)
            if isCurrentOrStillAuthorized(inFlight.intent) {
                publishImageAsset(
                    inFlight.intent,
                    phase: .unavailable,
                    receivedBytes: inFlight.request.offset,
                    fileURL: nil,
                    message: "Studio no pudo entregar esta imagen offline."
                )
            }
            beginNextImageAssetIfNeeded(connection: connection)
        }
    }

    private func isAuthorized(_ intent: ImageAssetIntent) -> Bool {
        intent.generation == assetGeneration && imageAssetIntents.contains(intent)
    }

    private func isCurrentOrStillAuthorized(_ intent: ImageAssetIntent) -> Bool {
        intent.generation == assetGeneration &&
            (intent.isCurrent || imageAssetIntents.contains(where: {
                $0.cueID == intent.cueID && $0.descriptor.objectID == intent.descriptor.objectID
            }))
    }

    private func removeIntent(_ intent: ImageAssetIntent) {
        imageAssetIntents.removeAll {
            $0.generation == intent.generation &&
                $0.cueID == intent.cueID &&
                $0.descriptor.objectID == intent.descriptor.objectID
        }
    }

    private func publishImageAsset(
        _ intent: ImageAssetIntent,
        phase: TchurchStudioLANImageAssetStatus.Phase,
        receivedBytes: Int64,
        fileURL: URL?,
        message: String?
    ) {
        imageAssetHandler?(.init(
            cueID: intent.cueID,
            objectID: intent.descriptor.objectID,
            phase: phase,
            receivedBytes: receivedBytes,
            totalBytes: intent.descriptor.byteSize,
            imageFit: intent.descriptor.imageFit,
            fileURL: fileURL,
            message: message
        ))
    }

    private func assetFailureMessage(_ error: Error) -> String {
        switch error as? TchurchStudioLANError {
        case .insufficientDiskSpace:
            return "No hay espacio suficiente para guardar esta imagen offline."
        case .assetCacheLimitExceeded:
            return "La imagen excede el límite seguro para este dispositivo."
        default:
            return "La imagen no pudo verificarse y no se mostrará."
        }
    }

    private func resetAssetTransfer() {
        assetRequestWatchdog.cancel()
        assetGeneration &+= 1
        imageAssetIntents = []
        inFlightAssetRequest = nil
        assetRetryCount = 0
    }

    private func send(_ message: TchurchStudioLANWireMessage, connection: NWConnection) throws {
        let frame = try TchurchStudioLANWireCodec.encode(message, maximumFrameBytes: limits.maximumFrameBytes)
        connection.send(content: frame, completion: .contentProcessed { [weak self, weak connection] error in
            guard error != nil, let self = self, let connection = connection else { return }
            self.queue.async { self.handleConnectionEnded(connection) }
        })
    }

    private func failProtocol(_ connection: NWConnection) {
        guard self.connection === connection else { return }
        let compromisedServiceID = desired?.serviceID
        intentionalDisconnect = true
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        self.connection = nil
        pendingSecret = nil
        activeSecret = nil
        activeSecretSource = nil
        desired = nil
        resetAssetTransfer()
        if let compromisedServiceID { try? secretStore.delete(serviceID: compromisedServiceID) }
        assetIOQueue.async { [weak self] in try? self?.assetCache.purgeAll() }
        payloadNegotiation = TchurchStudioLANPayloadNegotiation()
        setPhase(.failed, message: "Studio envió datos que no pudieron verificarse. La pantalla quedó cerrada por seguridad.")
    }

    private func handleConnectionEnded(_ connection: NWConnection) {
        guard self.connection === connection else { return }
        connection.stateUpdateHandler = nil
        self.connection = nil
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        verifier = nil
        challenge = nil
        request = nil
        resetAssetTransfer()
        if intentionalDisconnect || suspended { return }

        if !didAuthenticate {
            if let serviceID = desired?.serviceID { try? secretStore.delete(serviceID: serviceID) }
            assetIOQueue.async { [weak self] in try? self?.assetCache.purgeAll() }
            switch activeSecretSource {
            case .entered:
                pendingSecret = nil
                activeSecret = nil
                activeSecretSource = nil
                desired = nil
                setPhase(.failed, message: "No se pudo autenticar. Revisa el código de emparejamiento.")
                return
            case .saved:
                pendingSecret = nil
                activeSecret = nil
                activeSecretSource = nil
                setPhase(.failed, message: "El emparejamiento cambió. Escanea el QR actual de Tchurch Studio.")
                return
            case .none:
                break
            }
        }
        scheduleReconnect(message: "Se perdió la conexión LAN. Reintentando…")
    }

    @discardableResult
    private func beginLegacyFallbackIfEligible(_ connection: NWConnection) -> Bool {
        guard self.connection === connection,
              verifier == nil,
              challenge != nil,
              payloadNegotiation.attemptLegacyFallback(
                afterSentRequest: request,
                signal: .authenticatedLegacyError
              ) else {
            return false
        }

        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        self.connection = nil
        challenge = nil
        request = nil
        verifier = nil
        didAuthenticate = false
        decoder = try! TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: limits.maximumFrameBytes,
            maximumBufferedBytes: limits.maximumBufferedInputBytes
        )
        setPhase(.reconnecting, message: "Studio usa el protocolo LAN anterior. Verificando compatibilidad segura…")
        queue.async { [weak self] in self?.beginConnection(reconnecting: true) }
        return true
    }

    private func scheduleReconnect(message: String) {
        guard desired != nil, !suspended else { return }
        reconnectWork?.cancel()
        reconnectAttempt = min(reconnectAttempt + 1, 8)
        let seconds = min(16, 1 << min(reconnectAttempt - 1, 4))
        setPhase(.reconnecting, message: message)
        let work = DispatchWorkItem { [weak self] in self?.beginConnection(reconnecting: true) }
        reconnectWork = work
        queue.asyncAfter(deadline: .now() + .seconds(seconds), execute: work)
    }

    private func disconnectOnQueue(clearDesired: Bool) {
        reconnectWork?.cancel()
        reconnectWork = nil
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        intentionalDisconnect = true
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        verifier = nil
        challenge = nil
        request = nil
        pendingSecret = nil
        activeSecret = nil
        activeSecretSource = nil
        didAuthenticate = false
        resetAssetTransfer()
        if clearDesired {
            desired = nil
            payloadNegotiation = TchurchStudioLANPayloadNegotiation()
        }
        if browser == nil {
            setPhase(.idle, message: nil)
        } else if discoveredServices.isEmpty {
            setPhase(.discovering, message: nil)
            scheduleDiscoveryTimeout()
        } else {
            setPhase(.idle, message: nil)
        }
    }

    private func replayKey(serviceID: String, channel: TchurchStudioLANChannel) -> String {
        "\(serviceID):\(channel.rawValue)"
    }

    private func clientID() -> UUID {
        let key = Self.clientIDDefaultsKey
        if let value = defaults.string(forKey: key), let id = UUID(uuidString: value) { return id }
        let id = UUID()
        defaults.set(id.uuidString.lowercased(), forKey: key)
        return id
    }

    private func setPhase(_ phase: TchurchStudioLANConnectionPhase, message: String?) {
        currentPhase = phase
        currentMessage = message
        emitStatus()
    }

    private func emitStatus() {
        statusHandler?(makeStatus())
    }

    private func makeStatus() -> TchurchStudioLANClientStatus {
        let services = discoveredServices.values.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        let selectedServiceID = desired?.serviceID
        let paired = selectedServiceID.flatMap { try? secretStore.read(serviceID: $0) } != nil
        return TchurchStudioLANClientStatus(
            phase: currentPhase,
            services: services,
            selectedServiceID: selectedServiceID,
            channel: desired?.channel,
            paired: paired,
            message: currentMessage
        )
    }
}
