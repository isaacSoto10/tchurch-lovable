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

    var statusHandler: ((TchurchStudioLANClientStatus) -> Void)?
    var envelopeHandler: ((TchurchStudioLANSignedEnvelope) -> Void)?

    private struct DesiredConnection {
        let serviceID: String
        let channel: TchurchStudioLANChannel
    }

    private let queue = DispatchQueue(label: "app.tchurch.studio-lan.client")
    private let limits: TchurchStudioLANLimits
    private let secretStore: TchurchStudioLANSecretStoring
    private let defaults: UserDefaults

    private var browser: NWBrowser?
    private var discoveredEndpoints: [String: NWEndpoint] = [:]
    private var discoveredServices: [String: TchurchStudioLANService] = [:]
    private var connection: NWConnection?
    private var decoder: TchurchStudioLANLengthPrefixedFrameDecoder
    private var desired: DesiredConnection?
    private var pendingSecret: TchurchStudioLANPairingSecret?
    private var activeSecret: TchurchStudioLANPairingSecret?
    private var challenge: TchurchStudioLANServerChallenge?
    private var request: TchurchStudioLANSubscriptionRequest?
    private var verifier: TchurchStudioLANEnvelopeVerifier?
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

    init(
        limits: TchurchStudioLANLimits = .production,
        secretStore: TchurchStudioLANSecretStoring = TchurchStudioLANKeychainSecretStore(),
        defaults: UserDefaults = .standard
    ) throws {
        guard limits.isValid else { throw TchurchStudioLANError.invalidConfiguration }
        self.limits = limits
        self.secretStore = secretStore
        self.defaults = defaults
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
                } else if let saved = try self.secretStore.read(serviceID: serviceID) {
                    secret = try TchurchStudioLANPairingSecret(rawRepresentation: saved)
                    self.pendingSecret = nil
                } else {
                    self.setPhase(.failed, message: "Ingresa el código de emparejamiento de Tchurch Studio.")
                    return
                }
                self.desired = DesiredConnection(serviceID: serviceID, channel: channel)
                self.activeSecret = secret
                self.intentionalDisconnect = false
                self.suspended = false
                self.reconnectAttempt = 0
                self.beginConnection(reconnecting: false)
            } catch {
                self.pendingSecret = nil
                self.activeSecret = nil
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
                self.emitStatus()
            } catch {
                self.setPhase(.failed, message: "No se pudo borrar el emparejamiento guardado.")
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
                    secret: secret
                )
                self.challenge = challenge
                self.request = request
                try send(.subscribe(request), connection: connection)
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
        case .ping(let nonce) where !nonce.isEmpty && nonce.utf8.count <= 128:
            try send(.pong(nonce), connection: connection)
        case .error:
            throw TchurchStudioLANError.protocolViolation
        default:
            throw TchurchStudioLANError.protocolViolation
        }
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
        intentionalDisconnect = true
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        self.connection = nil
        pendingSecret = nil
        activeSecret = nil
        desired = nil
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
        if intentionalDisconnect || suspended { return }

        if !didAuthenticate, pendingSecret != nil {
            pendingSecret = nil
            activeSecret = nil
            desired = nil
            setPhase(.failed, message: "No se pudo autenticar. Revisa el código de emparejamiento.")
            return
        }
        scheduleReconnect(message: "Se perdió la conexión LAN. Reintentando…")
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
        didAuthenticate = false
        if clearDesired { desired = nil }
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
        let key = "tchurch.studio-lan.client-id"
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
