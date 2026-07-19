import Foundation
import Network
import Security

struct TchurchStudioLANService: Equatable {
    let id: String
    let name: String
    let protocolFloor: Int
    /// Bonjour is unauthenticated, so this is only a capability hint. The
    /// authenticated subscription request still binds the exact offer into
    /// both the device attestation and the transport proof.
    let advertisedPayloadVersions: [Int]?

    init(
        id: String,
        name: String,
        protocolFloor: Int = 1,
        advertisedPayloadVersions: [Int]? = nil
    ) {
        self.id = id
        self.name = name
        self.protocolFloor = protocolFloor
        self.advertisedPayloadVersions = advertisedPayloadVersions
    }

    static func parseAdvertisedPayloadVersions(_ value: String?) -> [Int]? {
        guard let value,
              !value.isEmpty,
              value.utf8.count <= 32 else { return nil }
        let components = value.split(separator: ",", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.count <= TchurchStudioLANSubscriptionRequest
                .deviceTrustSupportedPayloadVersions.count else { return nil }
        let versions = components.compactMap { component -> Int? in
            guard let version = Int(component),
                  String(version) == component,
                  (1 ... TchurchStudioLANOperatorTimerContract.payloadVersion).contains(version) else {
                return nil
            }
            return version
        }
        guard versions.count == components.count,
              let maximum = versions.first,
              versions == Array(stride(from: maximum, through: 1, by: -1)),
              versions == TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions ||
                versions == TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions ||
                versions == TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions else {
            return nil
        }
        return versions
    }
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

enum TchurchStudioLANPrivacyAccess: String, Equatable {
    case unknown
    case principal
    case authorized
    case signedOut
    case revoked
}

struct TchurchStudioLANNetworkFailure: Equatable {
    enum Domain: String, Equatable {
        case posix
        case dns
        case tls
        case wifiAware
        case unknown
    }

    let domain: Domain
    let code: Int32

    init(domain: Domain, code: Int32) {
        self.domain = domain
        self.code = code
    }

    init(_ error: NWError) {
        switch error {
        case .posix(let code):
            self.init(domain: .posix, code: code.rawValue)
        case .dns(let code):
            self.init(domain: .dns, code: code)
        case .tls(let code):
            self.init(domain: .tls, code: code)
#if compiler(>=6.2)
        // `NWError.wifiAware` is only present in the SDK paired with Swift 6.2+.
        // Keep the client buildable on Xcode 16 while preserving the richer
        // diagnosis when compiled with newer Apple SDKs.
        case .wifiAware(let code):
            self.init(domain: .wifiAware, code: code)
#endif
        @unknown default:
            self.init(domain: .unknown, code: 0)
        }
    }

    /// Purge only when Network.framework preserves the explicit TLS alert.
    /// Generic handshake failures are not deterministic: they may also mean a
    /// transient or version-incompatible peer and therefore keep the pairing.
    var isDeterministicPSKRejection: Bool {
        guard domain == .tls else { return false }
        return code == Int32(errSSLUnknownPSKIdentity)
    }
}

enum TchurchStudioLANConnectionEndCause: Equatable {
    case serviceUnavailable
    case eof
    case cancelled
    case heartbeatTimeout
    case heartbeatProtocolViolation
    case timeout(lastNetworkFailure: TchurchStudioLANNetworkFailure?)
    case network(TchurchStudioLANNetworkFailure)

    var isDeterministicPSKRejection: Bool {
        switch self {
        case .network(let failure):
            return failure.isDeterministicPSKRejection
        case .timeout(let failure):
            return failure?.isDeterministicPSKRejection == true
        case .serviceUnavailable, .eof, .cancelled, .heartbeatTimeout, .heartbeatProtocolViolation:
            return false
        }
    }

    var networkFailure: TchurchStudioLANNetworkFailure? {
        switch self {
        case .network(let failure):
            return failure
        case .timeout(let failure):
            return failure
        case .serviceUnavailable, .eof, .cancelled, .heartbeatTimeout, .heartbeatProtocolViolation:
            return nil
        }
    }
}

enum TchurchStudioLANConnectionEndDisposition: Equatable {
    case reconnect(afterSeconds: Int)
    case purgePairing
}

private enum TchurchStudioLANClientProcessingError: Error {
    case localStateUnavailable
    case heartbeatProtocolViolation
}

/// Keeps ordinary transport recovery separate from credential compromise.
/// Authentication evidence survives any number of pre-grant reconnects for
/// the same desired connection; only a new user choice or a security purge
/// resets it.
struct TchurchStudioLANReconnectPolicy: Equatable {
    private(set) var authenticatedSessionEstablished = false
    private(set) var consecutiveFailures = 0

    mutating func resetForNewDesiredConnection() {
        authenticatedSessionEstablished = false
        consecutiveFailures = 0
    }

    mutating func recordAuthenticatedSession() {
        authenticatedSessionEstablished = true
        consecutiveFailures = 0
    }

    mutating func record(_ cause: TchurchStudioLANConnectionEndCause) -> TchurchStudioLANConnectionEndDisposition {
        if cause.isDeterministicPSKRejection {
            return .purgePairing
        }
        consecutiveFailures = min(consecutiveFailures + 1, 8)
        let delay = min(16, 1 << min(consecutiveFailures - 1, 4))
        return .reconnect(afterSeconds: delay)
    }
}

/// Keeps the one narrow replay exception needed to resume an interrupted
/// immutable asset transfer. The envelope itself remains rejected as a state
/// update: only byte-identical evidence that was already accepted under the
/// same authenticated authority and signing identity can rebuild asset intents
/// once per authenticated automatic connection while an exact asset remains
/// unresolved. Only the envelope digest and byte count are retained; the
/// potentially large Stage payload is not copied into recovery state.
struct TchurchStudioLANExactReplayAssetRehydrationGate: Equatable {
    private struct AcceptedEnvelope: Equatable {
        let replayKey: String
        let authority: TchurchStudioLANAuthority
        let signingKeyID: String
        let sequence: UInt64
        let revision: UInt64
        let payloadChecksum: String
        let encodedEnvelopeByteCount: Int
        let encodedEnvelopeSha256: String
        var pendingAssetObjectIDs: Set<String>

        func exactlyMatches(
            replayKey: String,
            envelope: TchurchStudioLANSignedEnvelope,
            encodedEnvelope: Data,
            replayGuard: TchurchStudioLANReplayGuard
        ) -> Bool {
            self.replayKey == replayKey &&
                authority == envelope.authority &&
                signingKeyID == envelope.signingKeyID &&
                sequence == envelope.sequence &&
                revision == envelope.revision &&
                payloadChecksum == envelope.payloadChecksum &&
                encodedEnvelopeByteCount == encodedEnvelope.count &&
                encodedEnvelopeSha256 == TchurchStudioLANCrypto.sha256Hex(encodedEnvelope) &&
                replayGuard.authority == authority &&
                replayGuard.signingKeyID == signingKeyID &&
                replayGuard.lastSequence == sequence &&
                replayGuard.lastRevision == revision &&
                replayGuard.lastPayloadChecksum == payloadChecksum
        }
    }

    private var lastAcceptedEnvelope: AcceptedEnvelope?
    private var eligibleReplayKey: String?

    mutating func beginAuthenticatedConnection(
        replayKey: String,
        subscription: TchurchStudioLANVerifiedSubscription,
        replayGuard: TchurchStudioLANReplayGuard,
        isAutomaticReconnect: Bool
    ) {
        eligibleReplayKey = nil
        guard isAutomaticReconnect,
              let accepted = lastAcceptedEnvelope,
              !accepted.pendingAssetObjectIDs.isEmpty,
              accepted.replayKey == replayKey,
              accepted.authority == subscription.authority,
              accepted.signingKeyID == subscription.signingKeyID,
              replayGuard.authority == accepted.authority,
              replayGuard.signingKeyID == accepted.signingKeyID,
              replayGuard.lastSequence == accepted.sequence,
              replayGuard.lastRevision == accepted.revision,
              replayGuard.lastPayloadChecksum == accepted.payloadChecksum else {
            return
        }
        eligibleReplayKey = replayKey
    }

    mutating func recordAccepted(
        replayKey: String,
        envelope: TchurchStudioLANSignedEnvelope,
        encodedEnvelope: Data,
        pendingAssetObjectIDs: Set<String>
    ) {
        lastAcceptedEnvelope = AcceptedEnvelope(
            replayKey: replayKey,
            authority: envelope.authority,
            signingKeyID: envelope.signingKeyID,
            sequence: envelope.sequence,
            revision: envelope.revision,
            payloadChecksum: envelope.payloadChecksum,
            encodedEnvelopeByteCount: encodedEnvelope.count,
            encodedEnvelopeSha256: TchurchStudioLANCrypto.sha256Hex(encodedEnvelope),
            pendingAssetObjectIDs: pendingAssetObjectIDs
        )
        eligibleReplayKey = nil
    }

    mutating func consumeIfExactLatestReplay(
        replayKey: String,
        envelope: TchurchStudioLANSignedEnvelope,
        encodedEnvelope: Data,
        replayGuard: TchurchStudioLANReplayGuard
    ) -> Set<String>? {
        guard eligibleReplayKey == replayKey,
              let accepted = lastAcceptedEnvelope,
              !accepted.pendingAssetObjectIDs.isEmpty,
              accepted.exactlyMatches(
                replayKey: replayKey,
                envelope: envelope,
                encodedEnvelope: encodedEnvelope,
                replayGuard: replayGuard
              ) else {
            return nil
        }
        eligibleReplayKey = nil
        return accepted.pendingAssetObjectIDs
    }

    mutating func resolveAsset(
        replayKey: String,
        authority: TchurchStudioLANAuthority,
        signingKeyID: String,
        sequence: UInt64,
        revision: UInt64,
        payloadChecksum: String,
        objectID: String
    ) {
        guard var accepted = lastAcceptedEnvelope,
              accepted.replayKey == replayKey,
              accepted.authority == authority,
              accepted.signingKeyID == signingKeyID,
              accepted.sequence == sequence,
              accepted.revision == revision,
              accepted.payloadChecksum == payloadChecksum else { return }
        accepted.pendingAssetObjectIDs.remove(objectID)
        lastAcceptedEnvelope = accepted
        if accepted.pendingAssetObjectIDs.isEmpty { eligibleReplayKey = nil }
    }

    mutating func clearConnectionEligibility() {
        eligibleReplayKey = nil
    }

    mutating func clearAll() {
        lastAcceptedEnvelope = nil
        eligibleReplayKey = nil
    }
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

struct TchurchStudioLANHeartbeatTimings: Equatable {
    static let production = TchurchStudioLANHeartbeatTimings(
        idleInterval: 10,
        pongTimeout: 25
    )

    let idleInterval: TimeInterval
    let pongTimeout: TimeInterval

    var isValid: Bool {
        idleInterval.isFinite && pongTimeout.isFinite &&
            idleInterval > 0 && pongTimeout > 0
    }
}

struct TchurchStudioLANClientStatus: Equatable {
    let phase: TchurchStudioLANConnectionPhase
    let services: [TchurchStudioLANService]
    let selectedServiceID: String?
    let channel: TchurchStudioLANChannel?
    let paired: Bool
    let message: String?
    let enrollmentState: StudioLANDeviceEnrollmentState
    let protocolFloor: Int
    let role: StudioLANDeviceRole?
    let permissions: [StudioLANDevicePermission]
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let studioID: UUID?
    let remoteControlAvailable: Bool
    let remoteCommandInFlight: Bool
    let operatorTimerControlAvailable: Bool
    let operatorTimerCommandInFlight: Bool
    let localBroadcastLowerThirdControlAvailable: Bool
    let localBroadcastLowerThirdCommandInFlight: Bool
    let localOBSSceneControlAvailable: Bool
    let localOBSSceneCommandInFlight: Bool

    init(
        phase: TchurchStudioLANConnectionPhase,
        services: [TchurchStudioLANService],
        selectedServiceID: String?,
        channel: TchurchStudioLANChannel?,
        paired: Bool,
        message: String?,
        enrollmentState: StudioLANDeviceEnrollmentState = .unenrolled,
        protocolFloor: Int = 1,
        role: StudioLANDeviceRole? = nil,
        permissions: [StudioLANDevicePermission] = [],
        permissionRevision: UInt64 = 0,
        revocationGeneration: UInt64 = 0,
        studioID: UUID? = nil,
        remoteControlAvailable: Bool = false,
        remoteCommandInFlight: Bool = false,
        operatorTimerControlAvailable: Bool = false,
        operatorTimerCommandInFlight: Bool = false,
        localBroadcastLowerThirdControlAvailable: Bool = false,
        localBroadcastLowerThirdCommandInFlight: Bool = false,
        localOBSSceneControlAvailable: Bool = false,
        localOBSSceneCommandInFlight: Bool = false
    ) {
        self.phase = phase
        self.services = services
        self.selectedServiceID = selectedServiceID
        self.channel = channel
        self.paired = paired
        self.message = message
        self.enrollmentState = enrollmentState
        self.protocolFloor = protocolFloor
        self.role = role
        self.permissions = permissions
        self.permissionRevision = permissionRevision
        self.revocationGeneration = revocationGeneration
        self.studioID = studioID
        self.remoteControlAvailable = remoteControlAvailable
        self.remoteCommandInFlight = remoteCommandInFlight
        self.operatorTimerControlAvailable = operatorTimerControlAvailable
        self.operatorTimerCommandInFlight = operatorTimerCommandInFlight
        self.localBroadcastLowerThirdControlAvailable =
            localBroadcastLowerThirdControlAvailable
        self.localBroadcastLowerThirdCommandInFlight =
            localBroadcastLowerThirdCommandInFlight
        self.localOBSSceneControlAvailable = localOBSSceneControlAvailable
        self.localOBSSceneCommandInFlight = localOBSSceneCommandInFlight
    }
}

enum TchurchStudioLANCueCatalogPhase: String, Equatable {
    case loading
    case ready
    case unavailable
}

struct TchurchStudioLANCueCatalogStatus: Equatable {
    let phase: TchurchStudioLANCueCatalogPhase
    let catalogID: String?
    let routeEpoch: UInt64?
    let totalCount: Int
    let receivedCount: Int
    /// Non-nil only after the complete binary digest matches the signed
    /// manifest. Loading and failure events never carry partial cue data.
    let cues: [TchurchStudioLANRemoteCueDescriptor]?
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

struct TchurchStudioLANPrivacyState: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    var scopeInitialized: Bool
    var principalFingerprint: String?
    var scopeFingerprint: String?
    var purgeRequired: Bool
    var purgeTargetPrincipalFingerprint: String?
    var purgeTargetScopeFingerprint: String?
    var clientIdentityInitialized: Bool
    var clientID: String?

    static let empty = TchurchStudioLANPrivacyState(
        schemaVersion: schemaVersion,
        scopeInitialized: false,
        principalFingerprint: nil,
        scopeFingerprint: nil,
        purgeRequired: false,
        purgeTargetPrincipalFingerprint: nil,
        purgeTargetScopeFingerprint: nil,
        clientIdentityInitialized: false,
        clientID: nil
    )

    static let failClosed = TchurchStudioLANPrivacyState(
        schemaVersion: schemaVersion,
        scopeInitialized: false,
        principalFingerprint: nil,
        scopeFingerprint: nil,
        purgeRequired: true,
        purgeTargetPrincipalFingerprint: nil,
        purgeTargetScopeFingerprint: nil,
        clientIdentityInitialized: true,
        clientID: nil
    )

    var isValid: Bool {
        let clientIDIsValid = clientID.map { UUID(uuidString: $0) != nil } ?? true
        return schemaVersion == Self.schemaVersion &&
            Self.validFingerprint(principalFingerprint) &&
            Self.validFingerprint(scopeFingerprint) &&
            Self.validFingerprint(purgeTargetPrincipalFingerprint) &&
            Self.validFingerprint(purgeTargetScopeFingerprint) &&
            (purgeRequired || (purgeTargetPrincipalFingerprint == nil && purgeTargetScopeFingerprint == nil)) &&
            (scopeFingerprint == nil || principalFingerprint != nil) &&
            (purgeTargetScopeFingerprint == nil || purgeTargetPrincipalFingerprint != nil) &&
            (clientIdentityInitialized || clientID == nil) &&
            clientIDIsValid
    }

    private static func validFingerprint(_ value: String?) -> Bool {
        guard let value else { return true }
        guard value.hasPrefix("sha256:") else { return false }
        let digest = value.dropFirst("sha256:".count)
        return digest.utf8.count == 64 && digest.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }
}

protocol TchurchStudioLANPrivacyStateStoring {
    func read() throws -> TchurchStudioLANPrivacyState
    func write(_ state: TchurchStudioLANPrivacyState) throws
}

/// Separate Keychain record used as the crash boundary for privacy deletion.
/// SecItem update/add is atomic and returns a checked status before any secret
/// or cache deletion can begin.
final class TchurchStudioLANKeychainPrivacyStateStore: TchurchStudioLANPrivacyStateStoring {
    private let service: String
    private let account = "state-v1"

    init(
        service: String = "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch.studio-lan-privacy"
    ) {
        self.service = service
    }

    func read() throws -> TchurchStudioLANPrivacyState {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return .empty }
        guard status == errSecSuccess,
              let data = result as? Data,
              data.count <= 8 * 1_024,
              let state = try? TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANPrivacyState.self,
                from: data
              ),
              state.isValid else {
            throw TchurchStudioLANError.invalidConfiguration
        }
        return state
    }

    func write(_ state: TchurchStudioLANPrivacyState) throws {
        guard state.isValid else { throw TchurchStudioLANError.invalidConfiguration }
        let data: Data
        do { data = try TchurchStudioLANCoding.encoder().encode(state) }
        catch { throw TchurchStudioLANError.invalidConfiguration }
        guard data.count <= 8 * 1_024 else { throw TchurchStudioLANError.invalidConfiguration }

        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var inserted = baseQuery
            inserted[kSecValueData as String] = data
            inserted[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(inserted as CFDictionary, nil) == errSecSuccess else {
                throw TchurchStudioLANError.invalidConfiguration
            }
        } else if status != errSecSuccess {
            throw TchurchStudioLANError.invalidConfiguration
        }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw TchurchStudioLANError.invalidConfiguration
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
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

enum TchurchStudioLANBoundedRequestOperation: Equatable {
    case asset(UUID)
    case catalog(UUID)
    case remoteCommand(UUID)
    case operatorTimerCommand(UUID)
    case localBroadcastLowerThirdCommand(UUID)
    case localOBSSceneCommand(UUID)
}

enum TchurchStudioLANBoundedRequestKind: Equatable {
    case remoteCommand
    case catalog
    case asset
}

enum TchurchStudioLANBoundedRequestPriority {
    static func remoteCommandBlocksCatalogRequest(
        isAwaitingReceipt: Bool,
        isAwaitingAuthenticatedContext: Bool
    ) -> Bool {
        isAwaitingReceipt || !isAwaitingAuthenticatedContext
    }

    static func next(
        remoteCommandQueued: Bool,
        catalogReady: Bool,
        catalogHasPriority: Bool,
        assetReady: Bool
    ) -> TchurchStudioLANBoundedRequestKind? {
        if remoteCommandQueued { return .remoteCommand }
        if catalogReady && catalogHasPriority { return .catalog }
        if assetReady { return .asset }
        if catalogReady { return .catalog }
        return nil
    }
}

/// Studio processes asset, catalog, Program, operator timer, local lower-third, and OBS-scene pairs
/// on one bounded lane. The client must never write a second operation until
/// the authenticated response for the active operation has released the lane.
struct TchurchStudioLANBoundedRequestLane: Equatable {
    private(set) var active: TchurchStudioLANBoundedRequestOperation?

    var isIdle: Bool { active == nil }

    mutating func begin(_ operation: TchurchStudioLANBoundedRequestOperation) -> Bool {
        guard active == nil else { return false }
        active = operation
        return true
    }

    mutating func finish(_ operation: TchurchStudioLANBoundedRequestOperation) -> Bool {
        guard active == operation else { return false }
        active = nil
        return true
    }

    mutating func cancel(_ operation: TchurchStudioLANBoundedRequestOperation) {
        if active == operation { active = nil }
    }

    mutating func reset() {
        active = nil
    }
}

struct TchurchStudioLANDiscardedRequestIDs: Equatable {
    static let capacity = 64
    private(set) var values: [UUID] = []

    mutating func remember(_ requestID: UUID) {
        values.removeAll { $0 == requestID }
        values.append(requestID)
        if values.count > Self.capacity {
            values.removeFirst(values.count - Self.capacity)
        }
    }

    mutating func consume(_ requestID: UUID) -> Bool {
        guard let index = values.firstIndex(of: requestID) else { return false }
        values.remove(at: index)
        return true
    }

    mutating func reset() {
        values.removeAll(keepingCapacity: false)
    }
}

enum TchurchStudioLANCatalogResponseStrictness {
    @discardableResult
    static func validateCurrentUnavailableRequest(
        responseRequestID: UUID,
        inFlightRequestID: UUID?
    ) throws -> UUID {
        guard let inFlightRequestID,
              responseRequestID == inFlightRequestID else {
            throw TchurchStudioLANError.protocolViolation
        }
        return inFlightRequestID
    }
}

final class TchurchStudioLANClient: @unchecked Sendable {
    static let bonjourServiceType = "_tchurch-show._tcp"
    static let assetRequestTimeoutSeconds: TimeInterval = 15
    static let catalogRequestTimeoutSeconds: TimeInterval = 15
    static let catalogInterPageDelaySeconds: TimeInterval = 0.050
    static let maximumCatalogOverloadRetries = 3
    static let clientIDDefaultsKey = "tchurch.studio-lan.client-id"

    static func catalogOverloadRetryDelaySeconds(_ retryCount: Int) -> TimeInterval? {
        guard (1 ... maximumCatalogOverloadRetries).contains(retryCount) else { return nil }
        return TimeInterval(min(4, 1 << (retryCount - 1)))
    }

    var statusHandler: ((TchurchStudioLANClientStatus) -> Void)?
    var envelopeHandler: ((TchurchStudioLANSignedEnvelope) -> Void)?
    var imageAssetHandler: ((TchurchStudioLANImageAssetStatus) -> Void)?
    var remoteFeedbackHandler: ((TchurchStudioLANRemoteFeedback) -> Void)?
    var operatorTimerFeedbackHandler: ((TchurchStudioLANOperatorTimerFeedback) -> Void)?
    var localBroadcastLowerThirdFeedbackHandler:
        ((TchurchStudioLANLocalBroadcastLowerThirdFeedback) -> Void)?
    var localOBSSceneFeedbackHandler: ((TchurchStudioLANLocalOBSSceneFeedback) -> Void)?
    var cueCatalogHandler: ((TchurchStudioLANCueCatalogStatus) -> Void)?

    private struct DesiredConnection {
        let serviceID: String
        let channel: TchurchStudioLANChannel
        let requestedRole: StudioLANDeviceRole
    }

    private enum SecretSource {
        case entered
        case saved
    }

    private enum ImageAssetRegistrationMode {
        case acceptedEnvelope
        case exactReplay(pendingObjectIDs: Set<String>)

        var isReplayRecovery: Bool {
            if case .exactReplay = self { return true }
            return false
        }

        func includes(objectID: String) -> Bool {
            switch self {
            case .acceptedEnvelope:
                return true
            case .exactReplay(let pendingObjectIDs):
                return pendingObjectIDs.contains(objectID)
            }
        }
    }

    private struct ImageAssetCandidate {
        let cue: TchurchStudioLANPublicCue
        let isCurrent: Bool
    }

    private struct ImageAssetIntent: Equatable {
        let authority: TchurchStudioLANAuthority
        let cueID: String
        let descriptor: TchurchStudioLANImageAssetDescriptor
        let isCurrent: Bool
        let generation: UInt64
        let presentationGeneration: UInt64
        let replayKey: String
        let envelopeSigningKeyID: String
        let envelopeSequence: UInt64
        let envelopeRevision: UInt64
        let envelopePayloadChecksum: String
        let isReplayRecovery: Bool
    }

    private struct PublishedImageAssetKey: Hashable {
        let objectID: String
        let generation: UInt64
    }

    private struct InFlightAssetRequest: Equatable {
        let request: TchurchStudioLANAssetRequest
        let intent: ImageAssetIntent
    }

    private struct PendingAssetContinuation: Equatable {
        let intent: ImageAssetIntent
        let offset: Int64
    }

    private struct InFlightRemoteCommand: Equatable {
        var command: TchurchStudioLANRemoteCommand
        var recovery: TchurchStudioLANRemoteCommandRecoveryState
        var isAwaitingReceipt: Bool
    }

    private struct InFlightOperatorTimerCommand: Equatable {
        var command: TchurchStudioLANOperatorTimerCommand
        var recovery: TchurchStudioLANOperatorTimerCommandRecoveryState
        var isAwaitingReceipt: Bool
    }

    private struct InFlightLocalBroadcastLowerThirdCommand: Equatable {
        var command: TchurchStudioLANLocalBroadcastLowerThirdCommand
        var recovery: TchurchStudioLANLocalBroadcastLowerThirdCommandRecoveryState
        var isAwaitingReceipt: Bool
    }

    private struct InFlightLocalOBSSceneCommand: Equatable {
        var command: TchurchStudioLANLocalOBSSceneCommand
        var isAwaitingReceipt: Bool
    }

    private struct CueCatalogKey: Equatable {
        let authority: TchurchStudioLANAuthority
        let routeEpoch: UInt64
        let catalogID: String
        let deviceGrantChecksum: String
        let routing: TchurchStudioLANRoutingProjection
    }

    private struct VerifiedCueCatalog: Equatable {
        let key: CueCatalogKey
        let cues: [TchurchStudioLANRemoteCueDescriptor]
    }

    private let queue = DispatchQueue(label: "app.tchurch.studio-lan.client")
    private let assetIOQueue = DispatchQueue(label: "app.tchurch.studio-lan.assets", qos: .utility)
    private lazy var assetRequestWatchdog = TchurchStudioLANAssetRequestWatchdog(queue: queue)
    private lazy var catalogRequestWatchdog = TchurchStudioLANAssetRequestWatchdog(queue: queue)
    private let limits: TchurchStudioLANLimits
    private let heartbeatTimings: TchurchStudioLANHeartbeatTimings
    private let secretStore: TchurchStudioLANSecretStoring
    private let defaults: UserDefaults
    private let assetCache: TchurchStudioLANAssetCache
    private let assetCachePurge: () throws -> Void
    private let privacyStateStore: TchurchStudioLANPrivacyStateStoring
    private let deviceTrust: StudioLANDeviceTrustController

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
    private var activeSubscription: TchurchStudioLANVerifiedSubscription?
    private var latestControlEnvelope: TchurchStudioLANSignedEnvelope?
    private var minimumControlEnvelopeRevision: UInt64?
    private var minimumOperatorTimerRevision: UInt64?
    private var minimumLowerThirdRevision: UInt64?
    private var minimumOBSRevision: UInt64?
    private var minimumOBSEnvelopeSequence: UInt64?
    private var cueCatalogKey: CueCatalogKey?
    private var cueCatalogAccumulator: TchurchStudioLANCueCatalogAccumulator?
    private var inFlightCatalogRequest: TchurchStudioLANCatalogRequest?
    private var verifiedCueCatalog: VerifiedCueCatalog?
    private var unavailableCueCatalogKey: CueCatalogKey?
    private var catalogRetryCount = 0
    private var catalogPumpWork: DispatchWorkItem?
    private var catalogBackoffUntil: DispatchTime?
    private var catalogGeneration: UInt64 = 0
    private var discardedCatalogRequestIDs = TchurchStudioLANDiscardedRequestIDs()
    private var inFlightRemoteCommand: InFlightRemoteCommand?
    private var inFlightOperatorTimerCommand: InFlightOperatorTimerCommand?
    private var inFlightLocalBroadcastLowerThirdCommand:
        InFlightLocalBroadcastLowerThirdCommand?
    private var inFlightLocalOBSSceneCommand: InFlightLocalOBSSceneCommand?
    private var boundedRequestLane = TchurchStudioLANBoundedRequestLane()
    private var remoteCommandTimeoutWork: DispatchWorkItem?
    private var remoteCommandRecoveryDeadlineWork: DispatchWorkItem?
    private var operatorTimerCommandTimeoutWork: DispatchWorkItem?
    private var operatorTimerCommandRecoveryDeadlineWork: DispatchWorkItem?
    private var localBroadcastLowerThirdCommandTimeoutWork: DispatchWorkItem?
    private var localBroadcastLowerThirdCommandRecoveryDeadlineWork: DispatchWorkItem?
    private var localOBSSceneCommandTimeoutWork: DispatchWorkItem?
    private var payloadNegotiation = TchurchStudioLANPayloadNegotiation()
    private var replayGuards: [String: TchurchStudioLANReplayGuard] = [:]
    private var exactReplayAssetRehydration = TchurchStudioLANExactReplayAssetRehydrationGate()
    private var reconnectPolicy = TchurchStudioLANReconnectPolicy()
    private var reconnectWork: DispatchWorkItem?
    private var discoveryTimeoutWork: DispatchWorkItem?
    private var connectionTimeoutWork: DispatchWorkItem?
    private var heartbeatIdleWork: DispatchWorkItem?
    private var heartbeatTimeoutWork: DispatchWorkItem?
    private var pendingHeartbeatNonce: String?
    private var lastWaitingNetworkFailure: TchurchStudioLANNetworkFailure?
    private var currentConnectionIsAutomaticReconnect = false
    private var intentionalDisconnect = true
    private var suspended = false
    private var didAuthenticate = false
    private var currentPhase: TchurchStudioLANConnectionPhase = .idle
    private var currentMessage: String?
    private var assetGeneration: UInt64 = 0
    private var assetPresentationGeneration: UInt64 = 0
    private var imageAssetIntents: [ImageAssetIntent] = []
    private var inFlightAssetRequest: InFlightAssetRequest?
    private var assetPreparationIntent: ImageAssetIntent?
    private var pendingAssetContinuation: PendingAssetContinuation?
    private var assetRetryCount = 0
    private var assetRetryWork: DispatchWorkItem?
    private var publishedImageAssetStatuses: [PublishedImageAssetKey: TchurchStudioLANImageAssetStatus] = [:]
    private var privacyPurgeInFlight = false
    private var privacyPurgeTargetPersistenceFailed = false
    private var privacyContextConfirmed = false
    private var privacyContextConfirmationPending = false
    private var privacyPurgeCompletions: [(Result<Void, Error>) -> Void] = []
    private var privacyState: TchurchStudioLANPrivacyState
    private var privacyStateReadFailed: Bool

    init(
        limits: TchurchStudioLANLimits = .production,
        heartbeatTimings: TchurchStudioLANHeartbeatTimings = .production,
        secretStore: TchurchStudioLANSecretStoring = TchurchStudioLANKeychainSecretStore(),
        defaults: UserDefaults = .standard,
        assetCache: TchurchStudioLANAssetCache = TchurchStudioLANAssetCache(),
        assetCachePurge: (() throws -> Void)? = nil,
        privacyStateStore: TchurchStudioLANPrivacyStateStoring = TchurchStudioLANKeychainPrivacyStateStore(),
        deviceTrust: StudioLANDeviceTrustController? = nil
    ) throws {
        guard limits.isValid, heartbeatTimings.isValid else {
            throw TchurchStudioLANError.invalidConfiguration
        }
        self.limits = limits
        self.heartbeatTimings = heartbeatTimings
        self.secretStore = secretStore
        self.defaults = defaults
        self.assetCache = assetCache
        self.assetCachePurge = assetCachePurge ?? { try assetCache.purgeAll() }
        self.privacyStateStore = privacyStateStore
        self.deviceTrust = try deviceTrust ?? StudioLANDeviceTrustController()
        payloadNegotiation = TchurchStudioLANPayloadNegotiation(
            protocolFloor: self.deviceTrust.snapshot.protocolFloor
        )
        do {
            privacyState = try privacyStateStore.read()
            privacyStateReadFailed = false
        } catch {
            privacyState = .failClosed
            privacyStateReadFailed = true
        }
        decoder = try TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: limits.maximumFrameBytes,
            maximumBufferedBytes: limits.maximumBufferedInputBytes
        )
    }

    func startDiscovery() {
        queue.async { [weak self] in
            guard let self else { return }
            guard self.privacyAccessBlocked else {
                self.startDiscoveryOnQueue()
                return
            }
            guard self.hasPendingPrivacyPurge else {
                self.setPhase(.failed, message: "Verificando el acceso local de Studio antes de continuar…")
                return
            }
            self.resumePendingPrivacyPurgeOnQueue { [weak self] result in
                guard case .success = result else { return }
                self?.startDiscoveryOnQueue()
            }
        }
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

    func connect(
        serviceID: String,
        channel: TchurchStudioLANChannel,
        pairingCode: String?,
        requestedRole: StudioLANDeviceRole? = nil
    ) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard !self.privacyAccessBlocked else {
                if self.hasPendingPrivacyPurge { self.resumePendingPrivacyPurgeOnQueue() }
                self.setPhase(
                    .failed,
                    message: self.hasPendingPrivacyPurge
                        ? "Borrando datos privados de Studio antes de continuar…"
                        : "Verificando el acceso local de Studio antes de continuar…"
                )
                return
            }
            guard channel.isSupportedSubscription,
                  self.discoveredEndpoints[serviceID] != nil,
                  let service = self.discoveredServices[serviceID] else {
                self.setPhase(.failed, message: "Selecciona un Tchurch Studio disponible.")
                return
            }
            let role = requestedRole ?? (channel == .audience ? .audience : .musicians)
            guard role.channel == channel,
                  channel != .control || (
                    role == .production &&
                    service.protocolFloor >= StudioLANDeviceTrustContract.protocolFloor
                  ) else {
                self.setPhase(.failed, message: "El rol solicitado no corresponde a esta salida local.")
                return
            }
            if self.deviceTrust.snapshot.enrollmentState == .revoked {
                self.closeForDeviceRevocation()
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
                let requiresV4 = service.protocolFloor >= StudioLANDeviceTrustRecord.protocolFloor ||
                    self.deviceTrust.snapshot.protocolFloor >= StudioLANDeviceTrustRecord.protocolFloor
                if requiresV4 {
                    _ = try self.deviceTrust.beginEnrollment()
                }
                self.desired = DesiredConnection(
                    serviceID: serviceID,
                    channel: channel,
                    requestedRole: role
                )
                self.activeSecret = secret
                self.payloadNegotiation = TchurchStudioLANPayloadNegotiation(
                    protocolFloor: requiresV4 ? StudioLANDeviceTrustRecord.protocolFloor : 1
                )
                self.intentionalDisconnect = false
                self.suspended = false
                self.reconnectPolicy.resetForNewDesiredConnection()
                self.beginConnection(reconnecting: false)
            } catch StudioLANDeviceTrustError.revoked {
                self.closeForDeviceRevocation()
            } catch {
                self.pendingSecret = nil
                self.activeSecret = nil
                self.activeSecretSource = nil
                self.setPhase(
                    .failed,
                    message: self.deviceTrust.snapshot.protocolFloor >= StudioLANDeviceTrustRecord.protocolFloor
                        ? "No se pudo proteger la identidad local de este dispositivo."
                        : "El código de emparejamiento no es válido."
                )
            }
        }
    }

    func disconnect(clearDesired: Bool = true) {
        queue.async { [weak self] in
            guard let self else { return }
            if !clearDesired { self.clearManualReplayRecoveryState() }
            self.disconnectOnQueue(clearDesired: clearDesired)
        }
    }

    func sendRemoteCommand(
        action: TchurchStudioLANRemoteAction,
        completion: @escaping (Result<UUID, Error>) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else {
                completion(.failure(TchurchStudioLANRemoteControlError.unavailable))
                return
            }
            do {
                let command = try self.makeRemoteCommand(action: action)
                guard let connection = self.connection else {
                    throw TchurchStudioLANRemoteControlError.unavailable
                }
                self.inFlightRemoteCommand = InFlightRemoteCommand(
                    command: command,
                    recovery: TchurchStudioLANRemoteCommandRecoveryState(command: command),
                    isAwaitingReceipt: false
                )
                do {
                    _ = try self.deliverQueuedRemoteCommandIfPossible(connection: connection)
                } catch {
                    self.cancelRemoteCommand(
                        state: .interrupted,
                        expectedCommandID: command.commandID
                    )
                    throw error
                }
                self.remoteFeedbackHandler?(TchurchStudioLANRemoteFeedback(
                    commandID: command.commandID,
                    action: command.action,
                    state: .queued,
                    rejection: nil,
                    revision: nil,
                    wasIdempotentReplay: false
                ))
                self.emitStatus()
                completion(.success(command.commandID))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func sendOperatorTimerCommand(
        action: TchurchStudioLANOperatorTimerAction,
        completion: @escaping (Result<UUID, Error>) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else {
                completion(.failure(TchurchStudioLANRemoteControlError.unavailable))
                return
            }
            do {
                let command = try self.makeOperatorTimerCommand(action: action)
                guard let connection = self.connection else {
                    throw TchurchStudioLANRemoteControlError.unavailable
                }
                self.inFlightOperatorTimerCommand = InFlightOperatorTimerCommand(
                    command: command,
                    recovery: TchurchStudioLANOperatorTimerCommandRecoveryState(command: command),
                    isAwaitingReceipt: false
                )
                do {
                    _ = try self.deliverQueuedOperatorTimerCommandIfPossible(
                        connection: connection
                    )
                } catch {
                    self.cancelOperatorTimerCommand(
                        state: .interrupted,
                        expectedCommandID: command.commandID
                    )
                    throw error
                }
                self.operatorTimerFeedbackHandler?(TchurchStudioLANOperatorTimerFeedback(
                    commandID: command.commandID,
                    action: command.action,
                    state: .queued,
                    rejection: nil,
                    timerRevision: nil,
                    wasIdempotentReplay: false
                ))
                self.emitStatus()
                completion(.success(command.commandID))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func sendLocalBroadcastLowerThirdCommand(
        action: TchurchStudioLANLocalBroadcastLowerThirdAction,
        completion: @escaping (Result<UUID, Error>) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else {
                completion(.failure(TchurchStudioLANRemoteControlError.unavailable))
                return
            }
            do {
                let command = try self.makeLocalBroadcastLowerThirdCommand(action: action)
                guard let connection = self.connection else {
                    throw TchurchStudioLANRemoteControlError.unavailable
                }
                self.inFlightLocalBroadcastLowerThirdCommand =
                    InFlightLocalBroadcastLowerThirdCommand(
                        command: command,
                        recovery:
                            TchurchStudioLANLocalBroadcastLowerThirdCommandRecoveryState(
                                command: command
                            ),
                        isAwaitingReceipt: false
                    )
                do {
                    _ = try self.deliverQueuedLocalBroadcastLowerThirdCommandIfPossible(
                        connection: connection
                    )
                } catch {
                    self.cancelLocalBroadcastLowerThirdCommand(
                        state: .interrupted,
                        expectedCommandID: command.commandID
                    )
                    throw error
                }
                self.localBroadcastLowerThirdFeedbackHandler?(
                    TchurchStudioLANLocalBroadcastLowerThirdFeedback(
                        commandID: command.commandID,
                        action: command.action,
                        state: .queued,
                        rejection: nil,
                        lowerThirdRevision: nil,
                        wasIdempotentReplay: false
                    )
                )
                self.emitStatus()
                completion(.success(command.commandID))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func sendLocalOBSSceneCommand(
        action: TchurchStudioLANLocalOBSSceneAction,
        completion: @escaping (Result<UUID, Error>) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else {
                completion(.failure(TchurchStudioLANRemoteControlError.unavailable))
                return
            }
            do {
                let command = try self.makeLocalOBSSceneCommand(action: action)
                guard let connection = self.connection else {
                    throw TchurchStudioLANRemoteControlError.unavailable
                }
                self.inFlightLocalOBSSceneCommand = InFlightLocalOBSSceneCommand(
                    command: command,
                    isAwaitingReceipt: false
                )
                do {
                    _ = try self.deliverQueuedLocalOBSSceneCommandIfPossible(
                        connection: connection
                    )
                } catch {
                    self.cancelLocalOBSSceneCommand(
                        state: .interrupted,
                        expectedCommandID: command.commandID
                    )
                    throw error
                }
                self.localOBSSceneFeedbackHandler?(TchurchStudioLANLocalOBSSceneFeedback(
                    commandID: command.commandID,
                    action: command.action,
                    state: .queued,
                    rejection: nil,
                    uncertaintyReason: nil,
                    obsRevision: nil
                ))
                self.emitStatus()
                completion(.success(command.commandID))
            } catch {
                completion(.failure(error))
            }
        }
    }

    func requestDeviceReapproval(
        completion: @escaping (Result<UUID, Error>) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else {
                completion(.failure(StudioLANDeviceTrustError.identityUnavailable))
                return
            }
            guard self.deviceTrust.snapshot.enrollmentState == .revoked,
                  !self.privacyAccessBlocked else {
                completion(.failure(StudioLANDeviceTrustError.revoked))
                return
            }
            do {
                // Rotate the durable transport client identifier separately
                // from the v4 device identity. Neither revoked identifier is
                // ever offered again, even to a legacy discovery peer.
                var nextPrivacy = self.privacyState
                nextPrivacy.clientIdentityInitialized = true
                nextPrivacy.clientID = UUID().uuidString.lowercased()
                try self.privacyStateStore.write(nextPrivacy)
                self.privacyState = nextPrivacy
                self.privacyStateReadFailed = false
                self.defaults.removeObject(forKey: Self.clientIDDefaultsKey)

                let identity = try self.deviceTrust.rotateRevokedIdentityForReapproval()
                self.intentionalDisconnect = false
                self.payloadNegotiation = TchurchStudioLANPayloadNegotiation(
                    protocolFloor: StudioLANDeviceTrustContract.protocolFloor
                )
                self.reconnectPolicy.resetForNewDesiredConnection()
                self.startDiscoveryOnQueue()
                if self.desired != nil { self.beginConnection(reconnecting: true) }
                self.emitStatus()
                completion(.success(identity.deviceID))
            } catch {
                self.emitStatus()
                completion(.failure(error))
            }
        }
    }

    func suspend() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.suspended = true
            self.reconnectWork?.cancel()
            self.reconnectWork = nil
            self.connectionTimeoutWork?.cancel()
            self.connectionTimeoutWork = nil
            self.cancelHeartbeat()
            self.intentionalDisconnect = true
            self.connection?.stateUpdateHandler = nil
            self.connection?.cancel()
            self.connection = nil
            self.verifier = nil
            self.clearRemoteControlSession(interruptCommand: true)
            self.didAuthenticate = false
            self.resetAssetTransfer()
            self.exactReplayAssetRehydration.clearConnectionEligibility()
            self.currentConnectionIsAutomaticReconnect = false
            self.setPhase(.suspended, message: "En espera: abre Tchurch para volver a conectar.")
        }
    }

    func resume() {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.suspended = false
            self.intentionalDisconnect = false
            guard !self.privacyAccessBlocked else {
                guard self.hasPendingPrivacyPurge else {
                    self.setPhase(.failed, message: "Verificando el acceso local de Studio antes de continuar…")
                    return
                }
                self.resumePendingPrivacyPurgeOnQueue { [weak self] result in
                    guard case .success = result, let self else { return }
                    self.startDiscoveryOnQueue()
                    if self.desired != nil { self.beginConnection(reconnecting: true) }
                }
                return
            }
            self.startDiscoveryOnQueue()
            if self.desired != nil { self.beginConnection(reconnecting: true) }
        }
    }

    func forgetPairing(serviceID: String) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard !serviceID.isEmpty else { return }
            self.requestPrivateStatePurge(
                targetPrincipalFingerprint: self.privacyState.principalFingerprint,
                targetScopeFingerprint: self.currentPrivacyScopeFingerprint,
                progressMessage: "Borrando datos privados de Studio antes de continuar…",
                failureMessage: "No se pudo borrar el emparejamiento guardado."
            )
        }
    }

    func purgePrivateState(_ completion: @escaping (Result<Void, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self else { return completion(.failure(TchurchStudioLANError.invalidConfiguration)) }
            self.requestPrivateStatePurge(
                targetPrincipalFingerprint: nil,
                targetScopeFingerprint: nil,
                progressMessage: "Borrando datos privados de Studio antes de continuar…",
                failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo.",
                confirmPrivacyContextOnSuccess: true,
                completion: completion
            )
        }
    }

    func resumePendingPrivacyPurge() {
        queue.async { [weak self] in self?.resumePendingPrivacyPurgeOnQueue() }
    }

    func synchronizePrivacyContext(
        access: TchurchStudioLANPrivacyAccess,
        principalID: String?,
        churchID: String?,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        queue.async { [weak self] in
            guard let self else { return completion(.failure(TchurchStudioLANError.invalidConfiguration)) }
            switch access {
            case .unknown:
                // Token refresh, Internet reachability, and server availability
                // are not authoritative revocation signals.
                completion(.success(()))
            case .principal:
                guard let principalID,
                      let principalFingerprint = self.privacyPrincipalFingerprint(
                        principalID: principalID
                      ) else {
                    completion(.failure(TchurchStudioLANError.invalidConfiguration))
                    return
                }
                if self.privacyScopeInitialized,
                   self.privacyState.principalFingerprint == principalFingerprint,
                   !self.hasPendingPrivacyPurge,
                   !self.privacyPurgeInFlight {
                    self.privacyContextConfirmed = true
                    self.emitStatus()
                    completion(.success(()))
                    return
                }
                self.requestPrivateStatePurge(
                    targetPrincipalFingerprint: principalFingerprint,
                    targetScopeFingerprint: nil,
                    progressMessage: "Borrando datos privados de Studio antes de continuar…",
                    failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo.",
                    confirmPrivacyContextOnSuccess: true,
                    completion: completion
                )
            case .authorized:
                guard let principalID,
                      let churchID,
                      let principalFingerprint = self.privacyPrincipalFingerprint(
                        principalID: principalID
                      ),
                      let fingerprint = self.privacyScopeFingerprint(
                        principalID: principalID,
                        churchID: churchID
                      ) else {
                    completion(.failure(TchurchStudioLANError.invalidConfiguration))
                    return
                }
                if self.privacyScopeInitialized,
                   self.privacyState.principalFingerprint == principalFingerprint,
                   self.currentPrivacyScopeFingerprint == fingerprint,
                   !self.hasPendingPrivacyPurge,
                   !self.privacyPurgeInFlight {
                    self.privacyContextConfirmed = true
                    self.emitStatus()
                    completion(.success(()))
                    return
                }
                self.requestPrivateStatePurge(
                    targetPrincipalFingerprint: principalFingerprint,
                    targetScopeFingerprint: fingerprint,
                    progressMessage: "Borrando datos privados de Studio antes de continuar…",
                    failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo.",
                    confirmPrivacyContextOnSuccess: true,
                    completion: completion
                )
            case .signedOut, .revoked:
                if self.privacyScopeInitialized,
                   self.privacyState.principalFingerprint == nil,
                   self.currentPrivacyScopeFingerprint == nil,
                   !self.hasPendingPrivacyPurge,
                   !self.privacyPurgeInFlight {
                    self.privacyContextConfirmed = true
                    self.emitStatus()
                    completion(.success(()))
                    return
                }
                self.requestPrivateStatePurge(
                    targetPrincipalFingerprint: nil,
                    targetScopeFingerprint: nil,
                    progressMessage: "Borrando datos privados de Studio antes de continuar…",
                    failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo.",
                    confirmPrivacyContextOnSuccess: true,
                    completion: completion
                )
            }
        }
    }

    func currentStatus(_ completion: @escaping (TchurchStudioLANClientStatus) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }
            completion(self.makeStatus())
        }
    }

    private var hasPendingPrivacyPurge: Bool {
        privacyStateReadFailed || privacyState.purgeRequired
    }

    private var privacyAccessBlocked: Bool {
        hasPendingPrivacyPurge || privacyPurgeInFlight ||
            !privacyState.scopeInitialized || !privacyContextConfirmed ||
            privacyState.principalFingerprint == nil
    }

    private var privacyScopeInitialized: Bool {
        !privacyStateReadFailed && privacyState.scopeInitialized
    }

    private var currentPrivacyScopeFingerprint: String? {
        privacyStateReadFailed ? nil : privacyState.scopeFingerprint
    }

    private func validPrivacyIdentifier(_ value: String) -> Bool {
        let bytes = value.utf8.count
        return (1 ... 256).contains(bytes) && !value.unicodeScalars.contains {
            CharacterSet.controlCharacters.contains($0)
        }
    }

    private func privacyPrincipalFingerprint(principalID: String) -> String? {
        guard validPrivacyIdentifier(principalID) else { return nil }
        let material = "tchurch-studio-lan-principal-v1\u{001F}\(principalID)"
        return "sha256:\(TchurchStudioLANCrypto.sha256Hex(Data(material.utf8)))"
    }

    private func privacyScopeFingerprint(principalID: String, churchID: String) -> String? {
        guard validPrivacyIdentifier(principalID), validPrivacyIdentifier(churchID) else { return nil }
        let material = "tchurch-studio-lan-privacy-v1\u{001F}\(principalID)\u{001F}\(churchID)"
        return "sha256:\(TchurchStudioLANCrypto.sha256Hex(Data(material.utf8)))"
    }

    private func resumePendingPrivacyPurgeOnQueue(
        completion: ((Result<Void, Error>) -> Void)? = nil
    ) {
        guard hasPendingPrivacyPurge else {
            completion?(.success(()))
            return
        }
        requestPrivateStatePurge(
            targetPrincipalFingerprint: privacyState.purgeTargetPrincipalFingerprint,
            targetScopeFingerprint: privacyState.purgeTargetScopeFingerprint,
            progressMessage: "Borrando datos privados de Studio antes de continuar…",
            failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo.",
            completion: completion
        )
    }

    private func requestPrivateStatePurge(
        targetPrincipalFingerprint: String?,
        targetScopeFingerprint: String?,
        progressMessage: String,
        failureMessage: String,
        confirmPrivacyContextOnSuccess: Bool = false,
        completion: ((Result<Void, Error>) -> Void)? = nil
    ) {
        // Persist the crash-recovery marker atomically before deleting any
        // pairing, asset, or client identity. A failed Keychain write blocks
        // this process in memory and performs no persistent deletion.
        var tombstoneState = privacyStateReadFailed ? .empty : privacyState
        tombstoneState.purgeRequired = true
        tombstoneState.purgeTargetPrincipalFingerprint = targetPrincipalFingerprint
        tombstoneState.purgeTargetScopeFingerprint = targetScopeFingerprint
        do {
            try privacyStateStore.write(tombstoneState)
            privacyState = tombstoneState
            privacyStateReadFailed = false
            privacyPurgeTargetPersistenceFailed = false
            if confirmPrivacyContextOnSuccess { privacyContextConfirmationPending = true }
        } catch {
            if privacyPurgeInFlight { privacyPurgeTargetPersistenceFailed = true }
            disconnectOnQueue(clearDesired: true)
            privacyState = .failClosed
            privacyStateReadFailed = true
            setPhase(.failed, message: failureMessage)
            completion?(.failure(TchurchStudioLANError.invalidConfiguration))
            return
        }
        if let completion { privacyPurgeCompletions.append(completion) }

        disconnectOnQueue(clearDesired: true)
        replayGuards.removeAll(keepingCapacity: false)
        exactReplayAssetRehydration.clearAll()
        // This key is legacy-only. Once the checked Keychain state exists,
        // clientID() never consults it again, so a failed best-effort removal
        // cannot resurrect an identity after purge completion.
        defaults.removeObject(forKey: Self.clientIDDefaultsKey)
        setPhase(.failed, message: progressMessage)

        guard !privacyPurgeInFlight else { return }
        privacyPurgeInFlight = true
        let secretsDeleted: Bool
        do {
            try secretStore.deleteAll()
            secretsDeleted = true
        } catch {
            secretsDeleted = false
        }
        let trustDeleted: Bool
        do {
            try deviceTrust.purgePrivateTrustPreservingProtocolFloor()
            payloadNegotiation = TchurchStudioLANPayloadNegotiation(
                protocolFloor: deviceTrust.snapshot.protocolFloor
            )
            trustDeleted = true
        } catch {
            trustDeleted = false
        }

        assetIOQueue.async { [weak self] in
            guard let self else { return }
            let cacheDeleted: Bool
            do {
                try self.assetCachePurge()
                cacheDeleted = true
            } catch {
                cacheDeleted = false
            }
            self.queue.async { [weak self] in
                guard let self else { return }
                self.privacyPurgeInFlight = false
                let completions = self.privacyPurgeCompletions
                self.privacyPurgeCompletions.removeAll(keepingCapacity: false)
                guard secretsDeleted && trustDeleted && cacheDeleted else {
                    self.setPhase(.failed, message: failureMessage)
                    completions.forEach { $0(.failure(TchurchStudioLANError.assetCacheUnavailable)) }
                    return
                }

                guard !self.privacyPurgeTargetPersistenceFailed else {
                    if let retained = try? self.privacyStateStore.read(), retained.purgeRequired {
                        self.privacyState = retained
                        self.privacyStateReadFailed = false
                    } else {
                        self.privacyState = .failClosed
                        self.privacyStateReadFailed = true
                    }
                    self.setPhase(.failed, message: failureMessage)
                    completions.forEach { $0(.failure(TchurchStudioLANError.invalidConfiguration)) }
                    return
                }

                do {
                    let latest = try self.privacyStateStore.read()
                    guard latest.purgeRequired else {
                        throw TchurchStudioLANError.invalidConfiguration
                    }
                    var completed = latest
                    completed.scopeInitialized = true
                    completed.principalFingerprint = latest.purgeTargetPrincipalFingerprint
                    completed.scopeFingerprint = latest.purgeTargetScopeFingerprint
                    completed.purgeRequired = false
                    completed.purgeTargetPrincipalFingerprint = nil
                    completed.purgeTargetScopeFingerprint = nil
                    completed.clientIdentityInitialized = true
                    completed.clientID = nil
                    try self.privacyStateStore.write(completed)
                    self.privacyState = completed
                    self.privacyStateReadFailed = false
                } catch {
                    // The prior atomic record still contains the tombstone.
                    // Keep the client blocked and retry deletion after restart.
                    if let retained = try? self.privacyStateStore.read(), retained.purgeRequired {
                        self.privacyState = retained
                        self.privacyStateReadFailed = false
                    } else {
                        self.privacyState = .failClosed
                        self.privacyStateReadFailed = true
                    }
                    self.setPhase(.failed, message: failureMessage)
                    completions.forEach { $0(.failure(TchurchStudioLANError.invalidConfiguration)) }
                    return
                }
                if self.privacyContextConfirmationPending {
                    self.privacyContextConfirmed = true
                    self.privacyContextConfirmationPending = false
                }
                self.setPhase(.idle, message: nil)
                completions.forEach { $0(.success(())) }
            }
        }
    }

    private func startDiscoveryOnQueue() {
        guard !privacyAccessBlocked else {
            setPhase(
                .failed,
                message: hasPendingPrivacyPurge
                    ? "Borrando datos privados de Studio antes de continuar…"
                    : "Verificando el acceso local de Studio antes de continuar…"
            )
            return
        }
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
            let advertisedProtocolFloor: Int
            let advertisedPayloadVersions: [Int]?
            if case .bonjour(let txtRecord) = result.metadata {
                advertisedProtocolFloor = txtRecord["trust"] ==
                    String(StudioLANDeviceTrustContract.protocolFloor)
                    ? StudioLANDeviceTrustContract.protocolFloor
                    : 1
                advertisedPayloadVersions = TchurchStudioLANService
                    .parseAdvertisedPayloadVersions(txtRecord["payloads"])
            } else {
                advertisedProtocolFloor = 1
                advertisedPayloadVersions = nil
            }
            endpoints[id] = result.endpoint
            services[id] = TchurchStudioLANService(
                id: id,
                name: String(name.prefix(120)),
                protocolFloor: advertisedProtocolFloor,
                advertisedPayloadVersions: advertisedPayloadVersions
            )
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
            if desired != nil {
                scheduleReconnect(
                    message: "Esperando que Tchurch Studio vuelva a aparecer.",
                    cause: .serviceUnavailable
                )
            }
            return
        }
        guard !privacyAccessBlocked else {
            setPhase(
                .failed,
                message: hasPendingPrivacyPurge
                    ? "Borrando datos privados de Studio antes de continuar…"
                    : "Verificando el acceso local de Studio antes de continuar…"
            )
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

        if !reconnecting { clearManualReplayRecoveryState() }
        reconnectWork?.cancel()
        reconnectWork = nil
        exactReplayAssetRehydration.clearConnectionEligibility()
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        cancelHeartbeat()
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        resetAssetTransfer()
        challenge = nil
        request = nil
        verifier = nil
        if let localOBSCommand = inFlightLocalOBSSceneCommand {
            cancelLocalOBSSceneCommand(
                state: localOBSCommand.isAwaitingReceipt ? .unconfirmed : .interrupted,
                expectedCommandID: localOBSCommand.command.commandID
            )
        }
        let preserveAmbiguousCommand = reconnecting &&
            (inFlightRemoteCommand?.recovery.isAwaitingAuthenticatedContext == true ||
             inFlightOperatorTimerCommand?.recovery.isAwaitingAuthenticatedContext == true ||
             inFlightLocalBroadcastLowerThirdCommand?.recovery
                .isAwaitingAuthenticatedContext == true)
        clearRemoteControlSession(
            interruptCommand: !preserveAmbiguousCommand,
            preserveAmbiguousCommand: preserveAmbiguousCommand
        )
        didAuthenticate = false
        lastWaitingNetworkFailure = nil
        decoder = try! TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: limits.maximumFrameBytes,
            maximumBufferedBytes: limits.maximumBufferedInputBytes
        )
        intentionalDisconnect = false
        currentConnectionIsAutomaticReconnect = reconnecting

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
                self.lastWaitingNetworkFailure = nil
                self.setPhase(.authenticating, message: nil)
                self.receiveNext(connection)
            case .waiting(let error):
                let failure = TchurchStudioLANNetworkFailure(error)
                self.lastWaitingNetworkFailure = failure
                if failure.isDeterministicPSKRejection {
                    self.handleConnectionEnded(connection, cause: .network(failure))
                }
            case .failed(let error):
                self.handleConnectionEnded(
                    connection,
                    cause: .network(TchurchStudioLANNetworkFailure(error))
                )
            case .cancelled:
                self.handleConnectionEnded(connection, cause: .cancelled)
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
            let cause = TchurchStudioLANConnectionEndCause.timeout(
                lastNetworkFailure: self.lastWaitingNetworkFailure
            )
            connection.stateUpdateHandler = nil
            connection.cancel()
            self.handleConnectionEnded(connection, cause: cause)
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
            if let error {
                self.handleConnectionEnded(
                    connection,
                    cause: .network(TchurchStudioLANNetworkFailure(error))
                )
                return
            }
            if isComplete {
                self.handleConnectionEnded(connection, cause: .eof)
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
                    } catch TchurchStudioLANClientProcessingError.localStateUnavailable {
                        self.handleConnectionEnded(
                            connection,
                            cause: .cancelled,
                            recoveryMessage: "No se pudo usar el almacenamiento seguro. Conservamos los datos existentes y reintentaremos."
                        )
                        return
                    } catch TchurchStudioLANClientProcessingError.heartbeatProtocolViolation {
                        self.handleConnectionEnded(
                            connection,
                            cause: .heartbeatProtocolViolation,
                            recoveryMessage: "Studio respondió a una verificación LAN inválida. Cerramos ese transporte y reconectaremos."
                        )
                        return
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
                guard case .challenge(
                    let challenge,
                    let challengeSupportedPayloadVersions,
                    let challengeControlSupportedPayloadVersions,
                    let challengeLocalOBSControlPayloadVersions
                ) = message else {
                    throw TchurchStudioLANError.protocolViolation
                }
                guard challenge.expiresAtMilliseconds >= TchurchStudioLANTime.nowMilliseconds(),
                      let desired = desired,
                      let secret = activeSecret else {
                    throw TchurchStudioLANError.expiredChallenge
                }
                let request: TchurchStudioLANSubscriptionRequest
                do {
                    let challengeRequiresV4 = challenge.deviceTrustVersion == StudioLANDeviceTrustContract.schemaVersion &&
                        challenge.minimumPayloadVersion == StudioLANDeviceTrustContract.protocolFloor &&
                        challenge.studioID != nil
                    let localRequiresV4 = payloadNegotiation.protocolFloor >= StudioLANDeviceTrustContract.protocolFloor ||
                        deviceTrust.snapshot.protocolFloor >= StudioLANDeviceTrustContract.protocolFloor
                    guard !localRequiresV4 || challengeRequiresV4 else {
                        throw StudioLANDeviceTrustError.legacyDowngradeDenied
                    }
                    if challengeRequiresV4 && payloadNegotiation.protocolFloor < StudioLANDeviceTrustContract.protocolFloor {
                        payloadNegotiation = TchurchStudioLANPayloadNegotiation(
                            protocolFloor: StudioLANDeviceTrustContract.protocolFloor
                        )
                    }
                    let requestID = UUID()
                    let requestNonce = try TchurchStudioLANCrypto.randomBytes(count: 24)
                    let offeredPayloadVersions = payloadNegotiation.supportedPayloadVersions(
                        for: desired.channel,
                        controlAdvertisedPayloadVersions:
                            challengeControlSupportedPayloadVersions,
                        localOBSControlPayloadVersions:
                            challengeLocalOBSControlPayloadVersions,
                        advertisedPayloadVersions: challengeSupportedPayloadVersions ??
                            discoveredServices[desired.serviceID]?.advertisedPayloadVersions
                    )
                    let stableClientID: UUID
                    let attestation: StudioLANDeviceAttestation?
                    if challengeRequiresV4 {
                        let identity = try deviceTrust.beginEnrollment(studioID: challenge.studioID)
                        stableClientID = identity.deviceID
                        let requestedRole = deviceTrust.snapshot.role ?? desired.requestedRole
                        attestation = try deviceTrust.makeAttestation(
                            challenge: challenge,
                            requestID: requestID,
                            clientName: "Tchurch iOS",
                            channel: desired.channel,
                            clientNonce: requestNonce.base64EncodedString(),
                            supportedPayloadVersions: offeredPayloadVersions,
                            requestedRole: requestedRole
                        )
                    } else {
                        stableClientID = try clientID()
                        attestation = nil
                    }
                    request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
                        challenge: challenge,
                        clientID: stableClientID,
                        clientName: "Tchurch iOS",
                        channel: desired.channel,
                        secret: secret,
                        requestID: requestID,
                        clientNonce: requestNonce,
                        schemaVersion: payloadNegotiation.requestSchemaVersion,
                        offeredPayloadVersions: offeredPayloadVersions,
                        deviceAttestation: attestation
                    )
                } catch TchurchStudioLANError.entropyUnavailable {
                    throw TchurchStudioLANClientProcessingError.localStateUnavailable
                } catch is StudioLANDeviceTrustError {
                    throw TchurchStudioLANClientProcessingError.localStateUnavailable
                }
                self.challenge = challenge
                self.request = request
                try send(.subscribe(request), connection: connection)
                return
            }

            if case .error(let code) = message {
                switch code {
                case .approvalPending:
                    waitForDeviceApproval(connection)
                    return
                case .deviceExpired:
                    if let studioID = challenge?.studioID {
                        try? deviceTrust.markPendingForApproval(studioID: studioID)
                    }
                    waitForDeviceApproval(connection)
                    return
                case .deviceRevoked:
                    markDeviceRevokedAndClose()
                    return
                case .protocolUpgradeRequired:
                    throw TchurchStudioLANError.unsupportedPayloadVersion
                case .authenticationFailed, .protocolViolation:
                    if beginLegacyFallbackIfEligible(connection) { return }
                case .rateLimited, .overloaded, .serverUnavailable:
                    break
                }
            }

            guard case .grant(let grant) = message,
                  let challenge = challenge,
                  let request = request,
                  let secret = activeSecret,
                  let desired = desired else {
                throw TchurchStudioLANError.protocolViolation
            }
            let nowMilliseconds = TchurchStudioLANTime.nowMilliseconds()
            let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
                grant,
                request: request,
                challenge: challenge,
                secret: secret,
                nowMilliseconds: nowMilliseconds
            )
            try payloadNegotiation.recordAuthenticatedGrant(subscription)
            if payloadNegotiation.protocolFloor >= StudioLANDeviceTrustContract.protocolFloor {
                guard let deviceGrant = subscription.deviceGrant else {
                    throw TchurchStudioLANError.invalidSubscription
                }
                do {
                    try deviceTrust.accept(deviceGrant, nowMilliseconds: nowMilliseconds)
                } catch {
                    throw TchurchStudioLANError.invalidSubscription
                }
            }
            let key = replayKey(serviceID: desired.serviceID, channel: desired.channel)
            var replayGuard = replayGuards[key]
                ?? TchurchStudioLANReplayGuard()
            try replayGuard.begin(subscription)
            replayGuards[key] = replayGuard
            exactReplayAssetRehydration.beginAuthenticatedConnection(
                replayKey: key,
                subscription: subscription,
                replayGuard: replayGuard,
                isAutomaticReconnect: currentConnectionIsAutomaticReconnect
            )
            verifier = try TchurchStudioLANEnvelopeVerifier(subscription: subscription, limits: limits)
            activeSubscription = subscription
            latestControlEnvelope = nil
            minimumControlEnvelopeRevision = nil
            minimumOperatorTimerRevision = nil
            minimumLowerThirdRevision = nil
            minimumOBSRevision = nil
            minimumOBSEnvelopeSequence = nil
            resetCueCatalog(publishUnavailable: false)
            didAuthenticate = true
            reconnectPolicy.recordAuthenticatedSession()
            connectionTimeoutWork?.cancel()
            connectionTimeoutWork = nil
            armHeartbeatIdle(connection)
            if pendingSecret != nil {
                do {
                    try secretStore.write(secret.transportKeyMaterial, serviceID: desired.serviceID)
                    pendingSecret = nil
                } catch {
                    // The active TLS-PSK session remains authenticated. Keep
                    // the entered secret only in memory and never translate a
                    // local persistence failure into a credential purge.
                    activeSecretSource = .entered
                    setPhase(
                        .connected,
                        message: "Conectado de forma segura, pero el emparejamiento no pudo guardarse. Si cierras la app, vuelve a escanear el QR."
                    )
                    return
                }
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
            do {
                try replayGuard.accept(envelope)
            } catch TchurchStudioLANError.replayedEnvelope {
                guard let pendingObjectIDs = exactReplayAssetRehydration.consumeIfExactLatestReplay(
                    replayKey: key,
                    envelope: envelope,
                    encodedEnvelope: encodedEnvelope,
                    replayGuard: replayGuard
                ) else {
                    throw TchurchStudioLANError.replayedEnvelope
                }
                // The UI already owns this exact authenticated state. Rebuild
                // only immutable asset intents so a verified .part checkpoint
                // can issue the remaining Range request on the new transport.
                registerImageAssets(
                    from: envelope,
                    connection: connection,
                    mode: .exactReplay(pendingObjectIDs: pendingObjectIDs)
                )
                recordVerifiedControlEnvelope(envelope)
                try updateCueCatalog(from: envelope, connection: connection)
                recordAuthenticatedInboundActivity(connection)
                return
            }
            replayGuards[key] = replayGuard
            beginNewImageAssetPresentation()
            exactReplayAssetRehydration.recordAccepted(
                replayKey: key,
                envelope: envelope,
                encodedEnvelope: encodedEnvelope,
                pendingAssetObjectIDs: imageAssetObjectIDs(from: envelope)
            )
            envelopeHandler?(envelope)
            recordVerifiedControlEnvelope(envelope)
            try updateCueCatalog(from: envelope, connection: connection)
            registerImageAssets(from: envelope, connection: connection, mode: .acceptedEnvelope)
            recordAuthenticatedInboundActivity(connection)
        case .assetChunk(let chunk):
            try handleAssetChunk(chunk, connection: connection)
            recordAuthenticatedInboundActivity(connection)
        case .assetUnavailable(let unavailable):
            try handleAssetUnavailable(unavailable, connection: connection)
            recordAuthenticatedInboundActivity(connection)
        case .ping(let nonce) where !nonce.isEmpty && nonce.utf8.count <= 128:
            try send(.pong(nonce), connection: connection)
            recordAuthenticatedInboundActivity(connection)
        case .pong(let nonce):
            try acceptHeartbeatPong(nonce, connection: connection)
        case .remoteReceipt(let receipt):
            try handleRemoteReceipt(receipt)
            recordAuthenticatedInboundActivity(connection)
        case .operatorTimerReceipt(let receipt):
            try handleOperatorTimerReceipt(receipt)
            recordAuthenticatedInboundActivity(connection)
        case .localBroadcastLowerThirdReceipt(let receipt):
            try handleLocalBroadcastLowerThirdReceipt(receipt)
            recordAuthenticatedInboundActivity(connection)
        case .localOBSSceneReceipt(let receipt):
            try handleLocalOBSSceneReceipt(receipt)
            recordAuthenticatedInboundActivity(connection)
        case .catalogPage(let page):
            try handleCatalogPage(page, connection: connection)
            recordAuthenticatedInboundActivity(connection)
        case .catalogUnavailable(let unavailable):
            try handleCatalogUnavailable(unavailable, connection: connection)
            recordAuthenticatedInboundActivity(connection)
        case .error(.deviceRevoked):
            markDeviceRevokedAndClose()
        case .error(.deviceExpired), .error(.approvalPending):
            if let studioID = deviceTrust.snapshot.studioID {
                try? deviceTrust.markPendingForApproval(studioID: studioID)
            }
            waitForDeviceApproval(connection)
        case .error:
            throw TchurchStudioLANError.protocolViolation
        default:
            throw TchurchStudioLANError.protocolViolation
        }
    }

    private func registerImageAssets(
        from envelope: TchurchStudioLANSignedEnvelope,
        connection: NWConnection,
        mode: ImageAssetRegistrationMode
    ) {
        guard self.connection === connection, let desired else { return }
        assetGeneration &+= 1
        let generation = assetGeneration
        assetPreparationIntent = nil
        pendingAssetContinuation = nil
        let key = replayKey(serviceID: desired.serviceID, channel: envelope.channel)
        imageAssetIntents = imageAssetCandidates(from: envelope).compactMap { candidate in
            guard envelope.schemaVersion == 3 || envelope.schemaVersion == 4 ||
                    envelope.schemaVersion == 5 || envelope.schemaVersion == 6 ||
                    envelope.schemaVersion == 7 || envelope.schemaVersion == 8,
                  let descriptor = candidate.cue.imageAsset,
                  mode.includes(objectID: descriptor.objectID) else { return nil }
            return ImageAssetIntent(
                authority: envelope.authority,
                cueID: candidate.cue.cueID,
                descriptor: descriptor,
                isCurrent: candidate.isCurrent,
                generation: generation,
                presentationGeneration: assetPresentationGeneration,
                replayKey: key,
                envelopeSigningKeyID: envelope.signingKeyID,
                envelopeSequence: envelope.sequence,
                envelopeRevision: envelope.revision,
                envelopePayloadChecksum: envelope.payloadChecksum,
                isReplayRecovery: mode.isReplayRecovery
            )
        }
        assetRetryCount = 0
        for intent in imageAssetIntents where intent.isCurrent && !intent.isReplayRecovery {
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

    private func imageAssetCandidates(
        from envelope: TchurchStudioLANSignedEnvelope
    ) -> [ImageAssetCandidate] {
        guard envelope.schemaVersion == 3 || envelope.schemaVersion == 4 ||
                envelope.schemaVersion == 5 || envelope.schemaVersion == 6 ||
                envelope.schemaVersion == 7 || envelope.schemaVersion == 8 else { return [] }
        var candidates: [ImageAssetCandidate] = []
        if let cue = envelope.payload.audience.cue, cue.imageAsset != nil {
            candidates.append(.init(cue: cue, isCurrent: true))
        }
        if let cue = envelope.payload.stage?.nextCue, cue.imageAsset != nil {
            candidates.append(.init(cue: cue, isCurrent: false))
        }
        var seen = Set<String>()
        return candidates.filter { candidate in
            guard let objectID = candidate.cue.imageAsset?.objectID else { return false }
            return seen.insert(objectID).inserted
        }
    }

    private func imageAssetObjectIDs(
        from envelope: TchurchStudioLANSignedEnvelope
    ) -> Set<String> {
        Set(imageAssetCandidates(from: envelope).compactMap { $0.cue.imageAsset?.objectID })
    }

    private func beginNextImageAssetIfNeeded(connection: NWConnection) {
        guard self.connection === connection,
              verifier != nil,
              inFlightAssetRequest == nil,
              inFlightCatalogRequest == nil,
              inFlightRemoteCommand == nil,
              inFlightOperatorTimerCommand == nil,
              inFlightLocalBroadcastLowerThirdCommand == nil,
              boundedRequestLane.isIdle,
              assetRetryWork == nil,
              assetPreparationIntent == nil else { return }
        if let continuation = pendingAssetContinuation {
            guard isAuthorized(continuation.intent) else {
                pendingAssetContinuation = nil
                resumeBoundedRequestLane(connection: connection, catalogPriority: true)
                return
            }
            if sendAssetRequest(
                intent: continuation.intent,
                offset: continuation.offset,
                connection: connection
            ) {
                pendingAssetContinuation = nil
            }
            return
        }
        guard let intent = imageAssetIntents.first else { return }
        assetPreparationIntent = intent
        let protectedObjectIDs = Set(imageAssetIntents.map { $0.descriptor.objectID })
        assetIOQueue.async { [weak self, weak connection] in
            guard let self, let connection else { return }
            do {
                let preparation = try self.assetCache.prepare(
                    descriptor: intent.descriptor,
                    authority: intent.authority,
                    cueID: intent.cueID,
                    protectedObjectIDs: protectedObjectIDs,
                    recordsAuthorization: !intent.isReplayRecovery
                )
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.assetPreparationIntent == intent,
                          self.isAuthorized(intent) else { return }
                    self.assetPreparationIntent = nil
                    switch preparation {
                    case .ready(let url):
                        self.resolveIntent(intent)
                        self.publishImageAsset(
                            intent,
                            phase: .ready,
                            receivedBytes: intent.descriptor.byteSize,
                            fileURL: url,
                            message: nil
                        )
                        self.resumeBoundedRequestLane(
                            connection: connection,
                            catalogPriority: true
                        )
                    case .resume(let offset):
                        self.sendAssetRequest(intent: intent, offset: offset, connection: connection)
                    }
                }
            } catch {
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.assetPreparationIntent == intent,
                          self.isAuthorized(intent) else { return }
                    self.assetPreparationIntent = nil
                    self.resolveIntent(intent)
                    self.publishImageAsset(
                        intent,
                        phase: .unavailable,
                        receivedBytes: 0,
                        fileURL: nil,
                        message: self.assetFailureMessage(error)
                    )
                    self.resumeBoundedRequestLane(
                        connection: connection,
                        catalogPriority: true
                    )
                }
            }
        }
    }

    @discardableResult
    private func sendAssetRequest(
        intent: ImageAssetIntent,
        offset: Int64,
        connection: NWConnection
    ) -> Bool {
        guard self.connection === connection,
              inFlightAssetRequest == nil,
              inFlightCatalogRequest == nil,
              inFlightRemoteCommand == nil,
              inFlightOperatorTimerCommand == nil,
              inFlightLocalBroadcastLowerThirdCommand == nil,
              boundedRequestLane.isIdle,
              isAuthorized(intent),
              offset >= 0,
              offset < intent.descriptor.byteSize else { return false }
        let request = TchurchStudioLANAssetRequest(
            schemaVersion: TchurchStudioLANAssetRequest.schemaVersion,
            requestID: UUID(),
            objectID: intent.descriptor.objectID,
            offset: offset,
            maximumBytes: TchurchStudioLANAssetChunk.byteCount
        )
        let operation = TchurchStudioLANBoundedRequestOperation.asset(request.requestID)
        guard boundedRequestLane.begin(operation) else { return false }
        inFlightAssetRequest = .init(request: request, intent: intent)
        do {
            try send(.assetRequest(request), connection: connection)
            let requestID = request.requestID
            assetRequestWatchdog.arm(after: Self.assetRequestTimeoutSeconds) { [weak self, weak connection] in
                guard let self, let connection,
                      self.connection === connection,
                      self.inFlightAssetRequest?.request.requestID == requestID else { return }
                self.assetRequestWatchdog.cancel()
                self.boundedRequestLane.cancel(.asset(requestID))
                connection.stateUpdateHandler = nil
                connection.cancel()
                self.handleConnectionEnded(
                    connection,
                    cause: .timeout(lastNetworkFailure: self.lastWaitingNetworkFailure)
                )
            }
        } catch {
            assetRequestWatchdog.cancel()
            inFlightAssetRequest = nil
            boundedRequestLane.cancel(operation)
            handleConnectionEnded(connection, cause: .eof)
            return false
        }
        return true
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
        guard boundedRequestLane.finish(.asset(inFlight.request.requestID)) else {
            throw TchurchStudioLANError.invalidAssetChunk
        }
        _ = deliverQueuedRemoteCommandOrCancel(connection: connection)
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
                            self.pendingAssetContinuation = PendingAssetContinuation(
                                intent: inFlight.intent,
                                offset: nextOffset
                            )
                            self.resumeBoundedRequestLane(
                                connection: connection,
                                catalogPriority: true
                            )
                        } else {
                            self.resumeBoundedRequestLane(
                                connection: connection,
                                catalogPriority: true
                            )
                        }
                    case .ready(let url):
                        self.resolveIntent(inFlight.intent)
                        if self.isCurrentOrStillAuthorized(inFlight.intent) {
                            self.publishImageAsset(
                                inFlight.intent,
                                phase: .ready,
                                receivedBytes: inFlight.intent.descriptor.byteSize,
                                fileURL: url,
                                message: nil
                            )
                        }
                        self.resumeBoundedRequestLane(
                            connection: connection,
                            catalogPriority: true
                        )
                    }
                }
            } catch {
                try? self.assetCache.discardPartial(objectID: inFlight.intent.descriptor.objectID)
                self.queue.async { [weak self, weak connection] in
                    guard let self, let connection,
                          self.connection === connection,
                          self.inFlightAssetRequest == inFlight else { return }
                    self.inFlightAssetRequest = nil
                    self.resolveIntent(inFlight.intent)
                    if self.isCurrentOrStillAuthorized(inFlight.intent) {
                        self.publishImageAsset(
                            inFlight.intent,
                            phase: .unavailable,
                            receivedBytes: 0,
                            fileURL: nil,
                            message: self.assetFailureMessage(error)
                        )
                    }
                    self.resumeBoundedRequestLane(
                        connection: connection,
                        catalogPriority: true
                    )
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
        guard boundedRequestLane.finish(.asset(inFlight.request.requestID)) else {
            throw TchurchStudioLANError.invalidAssetChunk
        }
        inFlightAssetRequest = nil
        switch unavailable.code {
        case .overloaded where assetRetryCount < 3:
            assetRetryCount += 1
            let delay = min(4, 1 << (assetRetryCount - 1))
            assetRetryWork?.cancel()
            let work = DispatchWorkItem { [weak self, weak connection] in
                guard let self else { return }
                self.assetRetryWork = nil
                guard let connection,
                      self.connection === connection,
                      self.isAuthorized(inFlight.intent) else { return }
                self.sendAssetRequest(
                    intent: inFlight.intent,
                    offset: inFlight.request.offset,
                    connection: connection
                )
            }
            assetRetryWork = work
            queue.asyncAfter(deadline: .now() + .seconds(delay), execute: work)
            _ = deliverQueuedRemoteCommandOrCancel(connection: connection)
            if cueCatalogAccumulator != nil {
                scheduleCatalogPump(after: 0, connection: connection)
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
            _ = deliverQueuedRemoteCommandOrCancel(connection: connection)
        default:
            resolveIntent(inFlight.intent)
            if isCurrentOrStillAuthorized(inFlight.intent) {
                publishImageAsset(
                    inFlight.intent,
                    phase: .unavailable,
                    receivedBytes: inFlight.request.offset,
                    fileURL: nil,
                    message: "Studio no pudo entregar esta imagen offline."
                )
            }
            _ = deliverQueuedRemoteCommandOrCancel(connection: connection)
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
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

    private func resolveIntent(_ intent: ImageAssetIntent) {
        removeIntent(intent)
        exactReplayAssetRehydration.resolveAsset(
            replayKey: intent.replayKey,
            authority: intent.authority,
            signingKeyID: intent.envelopeSigningKeyID,
            sequence: intent.envelopeSequence,
            revision: intent.envelopeRevision,
            payloadChecksum: intent.envelopePayloadChecksum,
            objectID: intent.descriptor.objectID
        )
    }

    private func publishImageAsset(
        _ intent: ImageAssetIntent,
        phase: TchurchStudioLANImageAssetStatus.Phase,
        receivedBytes: Int64,
        fileURL: URL?,
        message: String?
    ) {
        guard intent.presentationGeneration == assetPresentationGeneration else { return }
        let status = TchurchStudioLANImageAssetStatus(
            cueID: intent.cueID,
            objectID: intent.descriptor.objectID,
            phase: phase,
            receivedBytes: receivedBytes,
            totalBytes: intent.descriptor.byteSize,
            imageFit: intent.descriptor.imageFit,
            fileURL: fileURL,
            message: message
        )
        let key = PublishedImageAssetKey(
            objectID: intent.descriptor.objectID,
            generation: intent.presentationGeneration
        )
        if let previous = publishedImageAssetStatuses[key] {
            switch previous.phase {
            case .loading:
                if status.phase == .loading, status.receivedBytes <= previous.receivedBytes { return }
            case .ready, .unavailable:
                return
            }
        }
        publishedImageAssetStatuses[key] = status
        imageAssetHandler?(status)
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
        assetRetryWork?.cancel()
        assetRetryWork = nil
        if let inFlightAssetRequest {
            boundedRequestLane.cancel(.asset(inFlightAssetRequest.request.requestID))
        }
        assetGeneration &+= 1
        imageAssetIntents = []
        inFlightAssetRequest = nil
        assetPreparationIntent = nil
        pendingAssetContinuation = nil
        assetRetryCount = 0
    }

    private func beginNewImageAssetPresentation() {
        assetPresentationGeneration &+= 1
        publishedImageAssetStatuses.removeAll(keepingCapacity: false)
    }

    private func updateCueCatalog(
        from envelope: TchurchStudioLANSignedEnvelope,
        connection: NWConnection
    ) throws {
        guard self.connection === connection,
              envelope.channel == .control else { return }
        guard envelope.schemaVersion == 5 || envelope.schemaVersion == 6 ||
                envelope.schemaVersion == 7 || envelope.schemaVersion == 8 else {
            if cueCatalogKey != nil || verifiedCueCatalog != nil || cueCatalogAccumulator != nil {
                resetCueCatalog(
                    publishUnavailable: true,
                    message: "Studio usa el catálogo compatible del protocolo v4."
                )
                resumeBoundedRequestLane(connection: connection, catalogPriority: false)
            }
            return
        }
        let trust = deviceTrust.snapshot
        guard let subscription = activeSubscription,
              subscription.channel == .control,
              subscription.payloadVersion == envelope.schemaVersion,
              subscription.payloadVersion == 5 || subscription.payloadVersion == 6 ||
                subscription.payloadVersion == 7 || subscription.payloadVersion == 8,
              subscription.authority == envelope.authority,
              subscription.deviceGrant?.role == .production,
              subscription.deviceGrant?.permissions.contains(.observe) == true,
              subscription.deviceGrant?.permissions.contains(.controlProgram) == true,
              trust.enrollmentState == .approved,
              trust.role == .production,
              trust.permissions.contains(.observe),
              trust.permissions.contains(.controlProgram),
              let grantChecksum = subscription.deviceGrantChecksum,
              let control = envelope.payload.control,
              let routeEpoch = control.routeEpoch,
              let routing = control.routing,
              routing.lanRemoteControl,
              !routing.tchurchCloudProgram,
              let manifest = control.cueCatalogManifest else {
            throw TchurchStudioLANError.protocolViolation
        }
        if let previous = cueCatalogKey,
           previous.authority == envelope.authority {
            guard routeEpoch >= previous.routeEpoch else {
                throw TchurchStudioLANError.protocolViolation
            }
            if routeEpoch == previous.routeEpoch,
               previous.routing != routing {
                throw TchurchStudioLANError.protocolViolation
            }
        }
        let key = CueCatalogKey(
            authority: envelope.authority,
            routeEpoch: routeEpoch,
            catalogID: manifest.catalogID,
            deviceGrantChecksum: grantChecksum,
            routing: routing
        )
        if cueCatalogKey == key {
            if verifiedCueCatalog?.key == key || unavailableCueCatalogKey == key ||
                cueCatalogAccumulator != nil || inFlightCatalogRequest != nil {
                return
            }
        } else {
            resetCueCatalog(publishUnavailable: false)
        }

        let accumulator = try TchurchStudioLANCueCatalogAccumulator(
            manifest: manifest,
            routeEpoch: routeEpoch
        )
        cueCatalogKey = key
        unavailableCueCatalogKey = nil
        catalogRetryCount = 0
        if accumulator.isEmptyAndComplete {
            let cues = try accumulator.verifiedEmptyCatalog()
            verifiedCueCatalog = VerifiedCueCatalog(key: key, cues: cues)
            cueCatalogAccumulator = nil
            publishCueCatalog(
                phase: .ready,
                key: key,
                totalCount: manifest.totalCount,
                receivedCount: cues.count,
                cues: cues,
                message: nil
            )
            replayAmbiguousRemoteCommandIfReady()
            resumeBoundedRequestLane(connection: connection, catalogPriority: false)
            return
        }
        cueCatalogAccumulator = accumulator
        publishCueCatalog(
            phase: .loading,
            key: key,
            totalCount: manifest.totalCount,
            receivedCount: 0,
            cues: nil,
            message: "Cargando el catálogo local firmado…"
        )
        scheduleCatalogPump(
            after: Self.catalogInterPageDelaySeconds,
            connection: connection
        )
        resumeBoundedRequestLane(connection: connection, catalogPriority: false)
    }

    private func requestNextCatalogPage(connection: NWConnection) throws {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              inFlightAssetRequest == nil,
              inFlightCatalogRequest == nil,
              let key = cueCatalogKey,
              let accumulator = cueCatalogAccumulator,
              accumulator.nextOffset < accumulator.totalCount else { return }
        if let inFlightRemoteCommand,
           TchurchStudioLANBoundedRequestPriority.remoteCommandBlocksCatalogRequest(
                isAwaitingReceipt: inFlightRemoteCommand.isAwaitingReceipt,
                isAwaitingAuthenticatedContext:
                    inFlightRemoteCommand.recovery.isAwaitingAuthenticatedContext
           ) {
            return
        }
        if let inFlightOperatorTimerCommand,
           TchurchStudioLANBoundedRequestPriority.remoteCommandBlocksCatalogRequest(
                isAwaitingReceipt: inFlightOperatorTimerCommand.isAwaitingReceipt,
                isAwaitingAuthenticatedContext:
                    inFlightOperatorTimerCommand.recovery.isAwaitingAuthenticatedContext
           ) {
            return
        }
        if let inFlightLocalBroadcastLowerThirdCommand,
           TchurchStudioLANBoundedRequestPriority.remoteCommandBlocksCatalogRequest(
                isAwaitingReceipt:
                    inFlightLocalBroadcastLowerThirdCommand.isAwaitingReceipt,
                isAwaitingAuthenticatedContext:
                    inFlightLocalBroadcastLowerThirdCommand.recovery
                        .isAwaitingAuthenticatedContext
           ) {
            return
        }
        if inFlightLocalOBSSceneCommand != nil { return }
        if let backoffUntil = catalogBackoffUntil {
            let now = DispatchTime.now()
            if now < backoffUntil {
                let remaining = TimeInterval(backoffUntil.uptimeNanoseconds - now.uptimeNanoseconds) / 1_000_000_000
                scheduleCatalogPump(after: remaining, connection: connection)
                return
            }
            catalogBackoffUntil = nil
        }
        let request = TchurchStudioLANCatalogRequest(
            schemaVersion: TchurchStudioLANCatalogRequest.schemaVersion,
            requestID: UUID(),
            catalogID: key.catalogID,
            routeEpoch: key.routeEpoch,
            offset: accumulator.nextOffset,
            maximumEntries: min(accumulator.pageSize, accumulator.totalCount - accumulator.nextOffset)
        )
        let operation = TchurchStudioLANBoundedRequestOperation.catalog(request.requestID)
        guard boundedRequestLane.begin(operation) else { return }
        inFlightCatalogRequest = request
        do {
            try send(.catalogRequest(request), connection: connection)
        } catch {
            inFlightCatalogRequest = nil
            boundedRequestLane.cancel(operation)
            throw error
        }
        catalogRequestWatchdog.arm(after: Self.catalogRequestTimeoutSeconds) { [weak self, weak connection] in
            guard let self, let connection else { return }
            guard self.connection === connection,
                  self.inFlightCatalogRequest?.requestID == request.requestID else { return }
            self.finishCatalogUnavailable(
                message: "Studio no respondió al catálogo local. Los controles directos siguen disponibles."
            )
            self.boundedRequestLane.cancel(.catalog(request.requestID))
            self.resumeBoundedRequestLane(connection: connection, catalogPriority: false)
        }
    }

    private func scheduleCatalogPump(
        after delay: TimeInterval,
        connection: NWConnection
    ) {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              let key = cueCatalogKey,
              let accumulator = cueCatalogAccumulator,
              accumulator.nextOffset < accumulator.totalCount else { return }
        let generation = catalogGeneration
        let effectiveDelay: TimeInterval
        let now = DispatchTime.now()
        if let backoffUntil = catalogBackoffUntil,
           now < backoffUntil {
            let remaining = TimeInterval(
                backoffUntil.uptimeNanoseconds - now.uptimeNanoseconds
            ) / 1_000_000_000
            effectiveDelay = max(delay, remaining)
        } else {
            effectiveDelay = delay
        }
        catalogPumpWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self, let connection,
                  self.connection === connection,
                  self.catalogGeneration == generation,
                  self.cueCatalogKey == key else { return }
            self.catalogPumpWork = nil
            do {
                try self.requestNextCatalogPage(connection: connection)
            } catch {
                self.handleConnectionEnded(connection, cause: .heartbeatProtocolViolation)
            }
        }
        catalogPumpWork = work
        queue.asyncAfter(deadline: .now() + max(0, effectiveDelay), execute: work)
    }

    /// Resume the shared lane after a bounded response. Program always wins;
    /// catalog may then take priority after yielding to an asset response.
    private func resumeBoundedRequestLane(
        connection: NWConnection,
        catalogPriority: Bool
    ) {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle else { return }
        let catalogNeedsPage = cueCatalogAccumulator.map {
            $0.nextOffset < $0.totalCount
        } ?? false
        let catalogBackingOff = catalogBackoffUntil.map { DispatchTime.now() < $0 } ?? false
        let programCommandQueued = inFlightRemoteCommand.map {
            !$0.isAwaitingReceipt && !$0.recovery.isAwaitingAuthenticatedContext
        } ?? false
        let operatorTimerCommandQueued = inFlightOperatorTimerCommand.map {
            !$0.isAwaitingReceipt && !$0.recovery.isAwaitingAuthenticatedContext
        } ?? false
        let lowerThirdCommandQueued = inFlightLocalBroadcastLowerThirdCommand.map {
            !$0.isAwaitingReceipt && !$0.recovery.isAwaitingAuthenticatedContext
        } ?? false
        let localOBSSceneCommandQueued = inFlightLocalOBSSceneCommand.map {
            !$0.isAwaitingReceipt
        } ?? false
        let assetReady = assetPreparationIntent == nil && assetRetryWork == nil &&
            (pendingAssetContinuation != nil || !imageAssetIntents.isEmpty)
        let next = TchurchStudioLANBoundedRequestPriority.next(
            remoteCommandQueued: programCommandQueued || operatorTimerCommandQueued ||
                lowerThirdCommandQueued || localOBSSceneCommandQueued,
            catalogReady: catalogNeedsPage && !catalogBackingOff,
            catalogHasPriority: catalogPriority,
            assetReady: assetReady
        )
        if catalogNeedsPage && next != .catalog {
            scheduleCatalogPump(
                after: Self.catalogInterPageDelaySeconds,
                connection: connection
            )
        }
        switch next {
        case .remoteCommand:
            _ = deliverQueuedRemoteCommandOrCancel(connection: connection)
        case .catalog:
            scheduleCatalogPump(
                after: catalogPriority ? 0 : Self.catalogInterPageDelaySeconds,
                connection: connection
            )
        case .asset:
            beginNextImageAssetIfNeeded(connection: connection)
        case nil:
            if catalogNeedsPage {
                scheduleCatalogPump(
                    after: Self.catalogInterPageDelaySeconds,
                    connection: connection
                )
            }
        }
    }

    private func rememberDiscardedCatalogRequest(_ requestID: UUID) {
        discardedCatalogRequestIDs.remember(requestID)
    }

    private func consumeDiscardedCatalogRequest(_ requestID: UUID) -> Bool {
        discardedCatalogRequestIDs.consume(requestID)
    }

    private func handleCatalogPage(
        _ page: TchurchStudioLANCatalogPage,
        connection: NWConnection
    ) throws {
        guard self.connection === connection else { return }
        if consumeDiscardedCatalogRequest(page.requestID) { return }
        guard let key = cueCatalogKey else { return }
        guard let request = inFlightCatalogRequest else {
            if page.catalogID != key.catalogID || page.routeEpoch != key.routeEpoch { return }
            throw TchurchStudioLANError.protocolViolation
        }
        guard page.catalogID == key.catalogID,
              page.routeEpoch == key.routeEpoch else {
            // A route/catalog replacement invalidates old pages in flight.
            return
        }
        guard page.requestID == request.requestID,
              page.cues.count <= request.maximumEntries,
              var accumulator = cueCatalogAccumulator else {
            throw TchurchStudioLANError.protocolViolation
        }
        catalogRequestWatchdog.cancel()
        let completed = try accumulator.append(page, expectedRequestID: request.requestID)
        guard boundedRequestLane.finish(.catalog(request.requestID)) else {
            throw TchurchStudioLANError.protocolViolation
        }
        inFlightCatalogRequest = nil
        catalogRetryCount = 0
        catalogBackoffUntil = nil
        if let completed {
            cueCatalogAccumulator = nil
            verifiedCueCatalog = VerifiedCueCatalog(key: key, cues: completed)
            publishCueCatalog(
                phase: .ready,
                key: key,
                totalCount: completed.count,
                receivedCount: completed.count,
                cues: completed,
                message: nil
            )
            replayAmbiguousRemoteCommandIfReady()
            resumeBoundedRequestLane(connection: connection, catalogPriority: false)
        } else {
            cueCatalogAccumulator = accumulator
            publishCueCatalog(
                phase: .loading,
                key: key,
                totalCount: accumulator.totalCount,
                receivedCount: accumulator.nextOffset,
                cues: nil,
                message: "Cargando el catálogo local firmado…"
            )
            resumeBoundedRequestLane(connection: connection, catalogPriority: false)
        }
    }

    private func handleCatalogUnavailable(
        _ unavailable: TchurchStudioLANCatalogUnavailable,
        connection: NWConnection
    ) throws {
        guard self.connection === connection else { return }
        if consumeDiscardedCatalogRequest(unavailable.requestID) { return }
        guard unavailable.schemaVersion == TchurchStudioLANCatalogUnavailable.schemaVersion,
              let key = cueCatalogKey else {
            throw TchurchStudioLANError.protocolViolation
        }
        guard unavailable.catalogID == key.catalogID else {
            // Never retry a response belonging to a replaced manifest.
            return
        }
        let currentRequestID = try TchurchStudioLANCatalogResponseStrictness
            .validateCurrentUnavailableRequest(
                responseRequestID: unavailable.requestID,
                inFlightRequestID: inFlightCatalogRequest?.requestID
            )
        guard let request = inFlightCatalogRequest,
              request.requestID == currentRequestID else {
            throw TchurchStudioLANError.protocolViolation
        }
        catalogRequestWatchdog.cancel()
        guard boundedRequestLane.finish(.catalog(request.requestID)) else {
            throw TchurchStudioLANError.protocolViolation
        }
        inFlightCatalogRequest = nil
        switch unavailable.code {
        case .overloaded where catalogRetryCount < Self.maximumCatalogOverloadRetries:
            catalogRetryCount += 1
            guard let delay = Self.catalogOverloadRetryDelaySeconds(catalogRetryCount) else {
                throw TchurchStudioLANError.protocolViolation
            }
            catalogBackoffUntil = .now() + delay
            scheduleCatalogPump(after: delay, connection: connection)
            _ = deliverQueuedRemoteCommandOrCancel(connection: connection)
            beginNextImageAssetIfNeeded(connection: connection)
        case .overloaded:
            finishCatalogUnavailable(
                message: "Studio está ocupado. Los controles directos siguen disponibles."
            )
            resumeBoundedRequestLane(connection: connection, catalogPriority: false)
        case .staleCatalog:
            finishCatalogUnavailable(
                message: "El catálogo cambió en Studio. Esperando el manifiesto nuevo…"
            )
            resumeBoundedRequestLane(connection: connection, catalogPriority: false)
        case .invalidRange:
            finishCatalogUnavailable(
                message: "Studio rechazó esta página del catálogo local."
            )
            resumeBoundedRequestLane(connection: connection, catalogPriority: false)
        }
    }

    private func publishCueCatalog(
        phase: TchurchStudioLANCueCatalogPhase,
        key: CueCatalogKey,
        totalCount: Int,
        receivedCount: Int,
        cues: [TchurchStudioLANRemoteCueDescriptor]?,
        message: String?
    ) {
        cueCatalogHandler?(TchurchStudioLANCueCatalogStatus(
            phase: phase,
            catalogID: key.catalogID,
            routeEpoch: key.routeEpoch,
            totalCount: totalCount,
            receivedCount: receivedCount,
            cues: phase == .ready ? cues : nil,
            message: message
        ))
    }

    private func finishCatalogUnavailable(message: String) {
        catalogRequestWatchdog.cancel()
        catalogPumpWork?.cancel()
        catalogPumpWork = nil
        catalogBackoffUntil = nil
        catalogGeneration &+= 1
        if let request = inFlightCatalogRequest {
            rememberDiscardedCatalogRequest(request.requestID)
            boundedRequestLane.cancel(.catalog(request.requestID))
        }
        inFlightCatalogRequest = nil
        cueCatalogAccumulator = nil
        verifiedCueCatalog = nil
        if let key = cueCatalogKey {
            unavailableCueCatalogKey = key
            publishCueCatalog(
                phase: .unavailable,
                key: key,
                totalCount: 0,
                receivedCount: 0,
                cues: nil,
                message: message
            )
        }
    }

    private func resetCueCatalog(
        publishUnavailable: Bool,
        message: String = "El catálogo local se cerró con la conexión."
    ) {
        let oldKey = cueCatalogKey
        catalogRequestWatchdog.cancel()
        catalogPumpWork?.cancel()
        catalogPumpWork = nil
        catalogBackoffUntil = nil
        catalogGeneration &+= 1
        if let request = inFlightCatalogRequest {
            rememberDiscardedCatalogRequest(request.requestID)
            boundedRequestLane.cancel(.catalog(request.requestID))
        }
        inFlightCatalogRequest = nil
        cueCatalogAccumulator = nil
        verifiedCueCatalog = nil
        unavailableCueCatalogKey = nil
        cueCatalogKey = nil
        catalogRetryCount = 0
        if publishUnavailable, let oldKey {
            publishCueCatalog(
                phase: .unavailable,
                key: oldKey,
                totalCount: 0,
                receivedCount: 0,
                cues: nil,
                message: message
            )
        }
    }

    private func clearManualReplayRecoveryState() {
        exactReplayAssetRehydration.clearAll()
        beginNewImageAssetPresentation()
    }

    private func makeRemoteCommand(
        action: TchurchStudioLANRemoteAction,
        preserving recovery: TchurchStudioLANRemoteCommandRecoveryState? = nil
    ) throws -> TchurchStudioLANRemoteCommand {
        guard action.isValid else {
            throw TchurchStudioLANRemoteControlError.invalidAction
        }
        guard recovery.map({ $0.action == action }) ?? true else {
            throw TchurchStudioLANRemoteControlError.invalidAction
        }
        guard recovery != nil ||
                (inFlightRemoteCommand == nil &&
                    inFlightOperatorTimerCommand == nil &&
                    inFlightLocalBroadcastLowerThirdCommand == nil &&
                    inFlightLocalOBSSceneCommand == nil) else {
            throw TchurchStudioLANRemoteControlError.commandInFlight
        }
        let trust = deviceTrust.snapshot
        guard didAuthenticate,
              currentPhase == .connected,
              desired?.channel == .control,
              trust.enrollmentState == .approved,
              trust.role == .production,
              trust.permissions.contains(.observe),
              trust.permissions.contains(.controlProgram),
              let subscription = activeSubscription,
              subscription.channel == .control,
              subscription.payloadVersion == 4 || subscription.payloadVersion == 5 ||
                subscription.payloadVersion == 6 || subscription.payloadVersion == 7 ||
                subscription.payloadVersion == 8,
              let deviceGrant = subscription.deviceGrant,
              deviceGrant.role == .production,
              deviceGrant.permissions.contains(.observe),
              deviceGrant.permissions.contains(.controlProgram),
              let deviceGrantChecksum = subscription.deviceGrantChecksum,
              let envelope = latestControlEnvelope,
              envelope.authority == subscription.authority,
              envelope.channel == .control,
              envelope.schemaVersion == subscription.payloadVersion,
              let control = envelope.payload.control,
              let routeEpoch = control.routeEpoch,
              routeEpoch > 0,
              minimumControlEnvelopeRevision.map({ envelope.revision >= $0 }) ?? true else {
            throw TchurchStudioLANRemoteControlError.unauthorized
        }
        if action.kind == .jump {
            guard let cueID = action.cueID else {
                throw TchurchStudioLANRemoteControlError.invalidAction
            }
            if subscription.payloadVersion == 4 {
                guard control.cueCatalog?.contains(where: { $0.cueID == cueID }) == true else {
                    throw TchurchStudioLANRemoteControlError.invalidAction
                }
            } else {
                guard let key = cueCatalogKey,
                      key.authority == envelope.authority,
                      key.routeEpoch == routeEpoch,
                      key.catalogID == control.cueCatalogManifest?.catalogID,
                      verifiedCueCatalog?.key == key,
                      verifiedCueCatalog?.cues.contains(where: { $0.cueID == cueID }) == true else {
                    throw TchurchStudioLANRemoteControlError.invalidAction
                }
            }
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        let expiresAt = now + TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds
        let unsigned = TchurchStudioLANRemoteCommand(
            schemaVersion: TchurchStudioLANRemoteCommand.schemaVersion,
            commandID: recovery?.commandID ?? UUID(),
            sessionID: subscription.sessionID,
            deviceID: deviceGrant.deviceID,
            grantID: deviceGrant.grantID,
            deviceGrantChecksum: deviceGrantChecksum,
            permissionRevision: deviceGrant.permissionRevision,
            revocationGeneration: deviceGrant.revocationGeneration,
            authority: subscription.authority,
            routeEpoch: routeEpoch,
            expectedRevision: recovery?.expectedRevision ?? envelope.payload.audience.snapshot.revision,
            issuedAtMilliseconds: now,
            expiresAtMilliseconds: expiresAt,
            action: action,
            signature: ""
        )
        let signature = try deviceTrust.signPossessionProof(
            TchurchStudioLANRemoteCommandCrypto.signingData(for: unsigned)
        )
        let command = TchurchStudioLANRemoteCommand(
            schemaVersion: unsigned.schemaVersion,
            commandID: unsigned.commandID,
            sessionID: unsigned.sessionID,
            deviceID: unsigned.deviceID,
            grantID: unsigned.grantID,
            deviceGrantChecksum: unsigned.deviceGrantChecksum,
            permissionRevision: unsigned.permissionRevision,
            revocationGeneration: unsigned.revocationGeneration,
            authority: unsigned.authority,
            routeEpoch: unsigned.routeEpoch,
            expectedRevision: unsigned.expectedRevision,
            issuedAtMilliseconds: unsigned.issuedAtMilliseconds,
            expiresAtMilliseconds: unsigned.expiresAtMilliseconds,
            action: unsigned.action,
            signature: signature
        )
        try TchurchStudioLANRemoteCommandCrypto.verify(command, deviceGrant: deviceGrant)
        return command
    }

    private func makeOperatorTimerCommand(
        action: TchurchStudioLANOperatorTimerAction,
        preserving recovery: TchurchStudioLANOperatorTimerCommandRecoveryState? = nil
    ) throws -> TchurchStudioLANOperatorTimerCommand {
        guard action.isValid else {
            throw TchurchStudioLANRemoteControlError.invalidAction
        }
        guard recovery.map({ $0.action == action }) ?? true else {
            throw TchurchStudioLANRemoteControlError.invalidAction
        }
        guard recovery != nil ||
                (inFlightRemoteCommand == nil &&
                    inFlightOperatorTimerCommand == nil &&
                    inFlightLocalBroadcastLowerThirdCommand == nil &&
                    inFlightLocalOBSSceneCommand == nil) else {
            throw TchurchStudioLANRemoteControlError.commandInFlight
        }
        let trust = deviceTrust.snapshot
        guard didAuthenticate,
              currentPhase == .connected,
              desired?.channel == .control,
              trust.enrollmentState == .approved,
              trust.role == .production,
              trust.permissions.contains(.observe),
              trust.permissions.contains(.controlProgram),
              let subscription = activeSubscription,
              subscription.channel == .control,
              subscription.payloadVersion == TchurchStudioLANOperatorTimerContract.payloadVersion ||
                subscription.payloadVersion ==
                    TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                subscription.payloadVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              let deviceGrant = subscription.deviceGrant,
              deviceGrant.role == .production,
              deviceGrant.permissions.contains(.observe),
              deviceGrant.permissions.contains(.controlProgram),
              let deviceGrantChecksum = subscription.deviceGrantChecksum,
              let envelope = latestControlEnvelope,
              envelope.authority == subscription.authority,
              envelope.channel == .control,
              envelope.schemaVersion == subscription.payloadVersion,
              let control = envelope.payload.control,
              let routeEpoch = control.routeEpoch,
              routeEpoch > 0,
              control.routing?.lanRemoteControl == true,
              control.routing?.tchurchCloudProgram == false,
              let operatorTimers = control.operatorTimers,
              operatorTimers.isCanonical,
              minimumOperatorTimerRevision.map({ operatorTimers.revision >= $0 }) ?? true else {
            throw TchurchStudioLANRemoteControlError.unauthorized
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        let expiresAt = now +
            TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds
        let unsigned = TchurchStudioLANOperatorTimerCommand(
            schemaVersion: TchurchStudioLANOperatorTimerCommand.schemaVersion,
            payloadVersion: TchurchStudioLANOperatorTimerCommand.payloadVersion,
            commandID: recovery?.commandID ?? UUID(),
            sessionID: subscription.sessionID,
            deviceID: deviceGrant.deviceID,
            grantID: deviceGrant.grantID,
            deviceGrantChecksum: deviceGrantChecksum,
            permissionRevision: deviceGrant.permissionRevision,
            revocationGeneration: deviceGrant.revocationGeneration,
            authority: subscription.authority,
            routeEpoch: routeEpoch,
            expectedTimerRevision: recovery?.expectedTimerRevision ?? operatorTimers.revision,
            issuedAtMilliseconds: now,
            expiresAtMilliseconds: expiresAt,
            action: action,
            signature: ""
        )
        let signature = try deviceTrust.signPossessionProof(
            TchurchStudioLANOperatorTimerCommandCrypto.signingData(for: unsigned)
        )
        let command = TchurchStudioLANOperatorTimerCommand(
            schemaVersion: unsigned.schemaVersion,
            payloadVersion: unsigned.payloadVersion,
            commandID: unsigned.commandID,
            sessionID: unsigned.sessionID,
            deviceID: unsigned.deviceID,
            grantID: unsigned.grantID,
            deviceGrantChecksum: unsigned.deviceGrantChecksum,
            permissionRevision: unsigned.permissionRevision,
            revocationGeneration: unsigned.revocationGeneration,
            authority: unsigned.authority,
            routeEpoch: unsigned.routeEpoch,
            expectedTimerRevision: unsigned.expectedTimerRevision,
            issuedAtMilliseconds: unsigned.issuedAtMilliseconds,
            expiresAtMilliseconds: unsigned.expiresAtMilliseconds,
            action: unsigned.action,
            signature: signature
        )
        try TchurchStudioLANOperatorTimerCommandCrypto.verify(
            command,
            deviceGrant: deviceGrant
        )
        return command
    }

    private func makeLocalBroadcastLowerThirdCommand(
        action: TchurchStudioLANLocalBroadcastLowerThirdAction,
        preserving recovery:
            TchurchStudioLANLocalBroadcastLowerThirdCommandRecoveryState? = nil
    ) throws -> TchurchStudioLANLocalBroadcastLowerThirdCommand {
        guard action.isValid else {
            throw TchurchStudioLANRemoteControlError.invalidAction
        }
        guard recovery.map({ $0.action == action }) ?? true else {
            throw TchurchStudioLANRemoteControlError.invalidAction
        }
        guard recovery != nil ||
                (inFlightRemoteCommand == nil &&
                    inFlightOperatorTimerCommand == nil &&
                    inFlightLocalBroadcastLowerThirdCommand == nil &&
                    inFlightLocalOBSSceneCommand == nil) else {
            throw TchurchStudioLANRemoteControlError.commandInFlight
        }
        let trust = deviceTrust.snapshot
        guard didAuthenticate,
              currentPhase == .connected,
              desired?.channel == .control,
              trust.enrollmentState == .approved,
              trust.role == .production,
              trust.permissions.contains(.observe),
              trust.permissions.contains(.controlProgram),
              let subscription = activeSubscription,
              subscription.channel == .control,
              subscription.payloadVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                subscription.payloadVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              let deviceGrant = subscription.deviceGrant,
              deviceGrant.role == .production,
              deviceGrant.permissions.contains(.observe),
              deviceGrant.permissions.contains(.controlProgram),
              let deviceGrantChecksum = subscription.deviceGrantChecksum,
              let envelope = latestControlEnvelope,
              envelope.authority == subscription.authority,
              envelope.channel == .control,
              envelope.schemaVersion == subscription.payloadVersion,
              let control = envelope.payload.control,
              let routeEpoch = control.routeEpoch,
              routeEpoch > 0,
              control.routing?.lanRemoteControl == true,
              control.routing?.localBroadcast == true,
              control.routing?.tchurchCloudProgram == false,
              let lowerThird = control.localBroadcastLowerThird,
              lowerThird.isCanonical,
              minimumLowerThirdRevision.map({ lowerThird.revision >= $0 }) ?? true else {
            throw TchurchStudioLANRemoteControlError.unauthorized
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        let expiresAt = now +
            TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds
        let unsigned = TchurchStudioLANLocalBroadcastLowerThirdCommand(
            schemaVersion: TchurchStudioLANLocalBroadcastLowerThirdCommand.schemaVersion,
            payloadVersion: TchurchStudioLANLocalBroadcastLowerThirdCommand.payloadVersion,
            commandID: recovery?.commandID ?? UUID(),
            sessionID: subscription.sessionID,
            deviceID: deviceGrant.deviceID,
            grantID: deviceGrant.grantID,
            deviceGrantChecksum: deviceGrantChecksum,
            permissionRevision: deviceGrant.permissionRevision,
            revocationGeneration: deviceGrant.revocationGeneration,
            authority: subscription.authority,
            routeEpoch: routeEpoch,
            expectedLowerThirdRevision: recovery?.expectedLowerThirdRevision ??
                lowerThird.revision,
            issuedAtMilliseconds: now,
            expiresAtMilliseconds: expiresAt,
            action: action,
            signature: ""
        )
        let signature = try deviceTrust.signPossessionProof(
            TchurchStudioLANLocalBroadcastLowerThirdCommandCrypto.signingData(for: unsigned)
        )
        let command = TchurchStudioLANLocalBroadcastLowerThirdCommand(
            schemaVersion: unsigned.schemaVersion,
            payloadVersion: unsigned.payloadVersion,
            commandID: unsigned.commandID,
            sessionID: unsigned.sessionID,
            deviceID: unsigned.deviceID,
            grantID: unsigned.grantID,
            deviceGrantChecksum: unsigned.deviceGrantChecksum,
            permissionRevision: unsigned.permissionRevision,
            revocationGeneration: unsigned.revocationGeneration,
            authority: unsigned.authority,
            routeEpoch: unsigned.routeEpoch,
            expectedLowerThirdRevision: unsigned.expectedLowerThirdRevision,
            issuedAtMilliseconds: unsigned.issuedAtMilliseconds,
            expiresAtMilliseconds: unsigned.expiresAtMilliseconds,
            action: unsigned.action,
            signature: signature
        )
        try TchurchStudioLANLocalBroadcastLowerThirdCommandCrypto.verify(
            command,
            deviceGrant: deviceGrant
        )
        return command
    }

    private func makeLocalOBSSceneCommand(
        action: TchurchStudioLANLocalOBSSceneAction
    ) throws -> TchurchStudioLANLocalOBSSceneCommand {
        guard action.isValid,
              inFlightRemoteCommand == nil,
              inFlightOperatorTimerCommand == nil,
              inFlightLocalBroadcastLowerThirdCommand == nil,
              inFlightLocalOBSSceneCommand == nil else {
            throw action.isValid
                ? TchurchStudioLANRemoteControlError.commandInFlight
                : TchurchStudioLANRemoteControlError.invalidAction
        }
        let trust = deviceTrust.snapshot
        guard didAuthenticate,
              currentPhase == .connected,
              desired?.channel == .control,
              trust.enrollmentState == .approved,
              trust.role == .production,
              trust.permissions.contains(.observe),
              trust.permissions.contains(.controlLocalOBS),
              let subscription = activeSubscription,
              subscription.channel == .control,
              subscription.payloadVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              let deviceGrant = subscription.deviceGrant,
              deviceGrant.role == .production,
              deviceGrant.permissions.contains(.observe),
              deviceGrant.permissions.contains(.controlLocalOBS),
              let deviceGrantChecksum = subscription.deviceGrantChecksum,
              let envelope = latestControlEnvelope,
              envelope.authority == subscription.authority,
              envelope.channel == .control,
              envelope.schemaVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              let control = envelope.payload.control,
              let routeEpoch = control.routeEpoch,
              routeEpoch > 0,
              control.routing?.lanRemoteControl == true,
              control.routing?.localBroadcast == true,
              control.routing?.tchurchCloudProgram == false,
              let localOBS = control.localOBS,
              localOBS.isCanonical,
              localOBS.availability == .ready,
              localOBS.scenes.contains(where: { $0.sceneID == action.sceneID }),
              minimumOBSRevision.map({ localOBS.revision >= $0 }) ?? true,
              minimumOBSEnvelopeSequence.map({ envelope.sequence >= $0 }) ?? true else {
            throw TchurchStudioLANRemoteControlError.unauthorized
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        let expiresAt = now +
            TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds
        let unsigned = TchurchStudioLANLocalOBSSceneCommand(
            schemaVersion: TchurchStudioLANLocalOBSSceneCommand.schemaVersion,
            payloadVersion: TchurchStudioLANLocalOBSSceneCommand.payloadVersion,
            commandID: UUID(),
            sessionID: subscription.sessionID,
            deviceID: deviceGrant.deviceID,
            grantID: deviceGrant.grantID,
            deviceGrantChecksum: deviceGrantChecksum,
            permissionRevision: deviceGrant.permissionRevision,
            revocationGeneration: deviceGrant.revocationGeneration,
            authority: subscription.authority,
            routeEpoch: routeEpoch,
            connectionID: localOBS.connectionID,
            expectedOBSRevision: localOBS.revision,
            issuedAtMilliseconds: now,
            expiresAtMilliseconds: expiresAt,
            action: action,
            signature: ""
        )
        let signature = try deviceTrust.signPossessionProof(
            TchurchStudioLANLocalOBSSceneCommandCrypto.signingData(for: unsigned)
        )
        let command = TchurchStudioLANLocalOBSSceneCommand(
            schemaVersion: unsigned.schemaVersion,
            payloadVersion: unsigned.payloadVersion,
            commandID: unsigned.commandID,
            sessionID: unsigned.sessionID,
            deviceID: unsigned.deviceID,
            grantID: unsigned.grantID,
            deviceGrantChecksum: unsigned.deviceGrantChecksum,
            permissionRevision: unsigned.permissionRevision,
            revocationGeneration: unsigned.revocationGeneration,
            authority: unsigned.authority,
            routeEpoch: unsigned.routeEpoch,
            connectionID: unsigned.connectionID,
            expectedOBSRevision: unsigned.expectedOBSRevision,
            issuedAtMilliseconds: unsigned.issuedAtMilliseconds,
            expiresAtMilliseconds: unsigned.expiresAtMilliseconds,
            action: unsigned.action,
            signature: signature
        )
        try TchurchStudioLANLocalOBSSceneCommandCrypto.verify(
            command,
            deviceGrant: deviceGrant
        )
        return command
    }

    /// Program control always wins the next free bounded request slot. A
    /// command may be accepted by the UI while an authenticated asset/catalog
    /// response is still outstanding, but it is not written until that one
    /// request releases the lane.
    @discardableResult
    private func deliverQueuedRemoteCommandIfPossible(
        connection: NWConnection
    ) throws -> Bool {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              var inFlight = inFlightRemoteCommand,
              !inFlight.isAwaitingReceipt,
              !inFlight.recovery.isAwaitingAuthenticatedContext else { return false }
        let command = try makeRemoteCommand(
            action: inFlight.recovery.action,
            preserving: inFlight.recovery
        )
        let operation = TchurchStudioLANBoundedRequestOperation.remoteCommand(command.commandID)
        guard boundedRequestLane.begin(operation) else { return false }
        inFlight.command = command
        inFlight.isAwaitingReceipt = true
        inFlightRemoteCommand = inFlight
        do {
            try send(.remoteCommand(command), connection: connection)
            armRemoteCommandTimeout(commandID: command.commandID, connection: connection)
            return true
        } catch {
            boundedRequestLane.cancel(operation)
            if var retained = inFlightRemoteCommand,
               retained.command.commandID == command.commandID {
                retained.isAwaitingReceipt = false
                inFlightRemoteCommand = retained
            }
            throw error
        }
    }

    @discardableResult
    private func deliverQueuedOperatorTimerCommandIfPossible(
        connection: NWConnection
    ) throws -> Bool {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              var inFlight = inFlightOperatorTimerCommand,
              !inFlight.isAwaitingReceipt,
              !inFlight.recovery.isAwaitingAuthenticatedContext else { return false }
        let command = try makeOperatorTimerCommand(
            action: inFlight.recovery.action,
            preserving: inFlight.recovery
        )
        let operation = TchurchStudioLANBoundedRequestOperation.operatorTimerCommand(
            command.commandID
        )
        guard boundedRequestLane.begin(operation) else { return false }
        inFlight.command = command
        inFlight.isAwaitingReceipt = true
        inFlightOperatorTimerCommand = inFlight
        do {
            try send(.operatorTimerCommand(command), connection: connection)
            armOperatorTimerCommandTimeout(
                commandID: command.commandID,
                connection: connection
            )
            return true
        } catch {
            boundedRequestLane.cancel(operation)
            if var retained = inFlightOperatorTimerCommand,
               retained.command.commandID == command.commandID {
                retained.isAwaitingReceipt = false
                inFlightOperatorTimerCommand = retained
            }
            throw error
        }
    }

    @discardableResult
    private func deliverQueuedLocalBroadcastLowerThirdCommandIfPossible(
        connection: NWConnection
    ) throws -> Bool {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              var inFlight = inFlightLocalBroadcastLowerThirdCommand,
              !inFlight.isAwaitingReceipt,
              !inFlight.recovery.isAwaitingAuthenticatedContext else { return false }
        let command = try makeLocalBroadcastLowerThirdCommand(
            action: inFlight.recovery.action,
            preserving: inFlight.recovery
        )
        let operation =
            TchurchStudioLANBoundedRequestOperation.localBroadcastLowerThirdCommand(
                command.commandID
            )
        guard boundedRequestLane.begin(operation) else { return false }
        inFlight.command = command
        inFlight.isAwaitingReceipt = true
        inFlightLocalBroadcastLowerThirdCommand = inFlight
        do {
            try send(.localBroadcastLowerThirdCommand(command), connection: connection)
            armLocalBroadcastLowerThirdCommandTimeout(
                commandID: command.commandID,
                connection: connection
            )
            return true
        } catch {
            boundedRequestLane.cancel(operation)
            if var retained = inFlightLocalBroadcastLowerThirdCommand,
               retained.command.commandID == command.commandID {
                retained.isAwaitingReceipt = false
                inFlightLocalBroadcastLowerThirdCommand = retained
            }
            throw error
        }
    }

    @discardableResult
    private func deliverQueuedLocalOBSSceneCommandIfPossible(
        connection: NWConnection
    ) throws -> Bool {
        guard self.connection === connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              var inFlight = inFlightLocalOBSSceneCommand,
              !inFlight.isAwaitingReceipt,
              let subscription = activeSubscription,
              subscription.payloadVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              subscription.deviceGrant?.permissions.contains(.observe) == true,
              subscription.deviceGrant?.permissions.contains(.controlLocalOBS) == true,
              let envelope = latestControlEnvelope,
              envelope.schemaVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              envelope.authority == inFlight.command.authority,
              envelope.payload.control?.routeEpoch == inFlight.command.routeEpoch,
              envelope.payload.control?.routing?.lanRemoteControl == true,
              envelope.payload.control?.routing?.localBroadcast == true,
              envelope.payload.control?.routing?.tchurchCloudProgram == false,
              let localOBS = envelope.payload.control?.localOBS,
              localOBS.isCanonical,
              localOBS.availability == .ready,
              localOBS.connectionID == inFlight.command.connectionID,
              localOBS.revision == inFlight.command.expectedOBSRevision,
              localOBS.scenes.contains(where: {
                $0.sceneID == inFlight.command.action.sceneID
              }),
              TchurchStudioLANTime.nowMilliseconds() <
                inFlight.command.expiresAtMilliseconds else {
            throw TchurchStudioLANRemoteControlError.unauthorized
        }
        let operation = TchurchStudioLANBoundedRequestOperation.localOBSSceneCommand(
            inFlight.command.commandID
        )
        guard boundedRequestLane.begin(operation) else { return false }
        inFlight.isAwaitingReceipt = true
        inFlightLocalOBSSceneCommand = inFlight
        do {
            try send(.localOBSSceneCommand(inFlight.command), connection: connection)
            armLocalOBSSceneCommandTimeout(
                commandID: inFlight.command.commandID,
                connection: connection
            )
            return true
        } catch {
            boundedRequestLane.cancel(operation)
            throw error
        }
    }

    @discardableResult
    private func deliverQueuedRemoteCommandOrCancel(
        connection: NWConnection
    ) -> Bool {
        do {
            if inFlightRemoteCommand != nil {
                return try deliverQueuedRemoteCommandIfPossible(connection: connection)
            }
            if inFlightOperatorTimerCommand != nil {
                return try deliverQueuedOperatorTimerCommandIfPossible(connection: connection)
            }
            if inFlightLocalBroadcastLowerThirdCommand != nil {
                return try deliverQueuedLocalBroadcastLowerThirdCommandIfPossible(
                    connection: connection
                )
            }
            if inFlightLocalOBSSceneCommand != nil {
                return try deliverQueuedLocalOBSSceneCommandIfPossible(connection: connection)
            }
            return false
        } catch {
            if inFlightRemoteCommand != nil {
                cancelRemoteCommand(state: .interrupted)
            } else if inFlightOperatorTimerCommand != nil {
                cancelOperatorTimerCommand(state: .interrupted)
            } else if inFlightLocalBroadcastLowerThirdCommand != nil {
                cancelLocalBroadcastLowerThirdCommand(state: .interrupted)
            } else {
                cancelLocalOBSSceneCommand(state: .interrupted)
            }
            return false
        }
    }

    private func handleRemoteReceipt(
        _ receipt: TchurchStudioLANRemoteCommandReceipt
    ) throws {
        guard let inFlight = inFlightRemoteCommand,
              inFlight.isAwaitingReceipt,
              let subscription = activeSubscription else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        let command = inFlight.command
        guard receipt.commandID == command.commandID,
              receipt.deviceID == command.deviceID,
              receipt.authority == command.authority,
              receipt.routeEpoch == command.routeEpoch,
              receipt.permissionRevision == command.permissionRevision,
              receipt.issuedAtMilliseconds >= command.issuedAtMilliseconds -
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds,
              receipt.issuedAtMilliseconds <= TchurchStudioLANTime.nowMilliseconds() +
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        try TchurchStudioLANRemoteReceiptCrypto.verify(
            receipt,
            studioSigningPublicKey: subscription.signingPublicKey
        )
        guard boundedRequestLane.finish(.remoteCommand(command.commandID)) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        remoteCommandTimeoutWork?.cancel()
        remoteCommandTimeoutWork = nil
        remoteCommandRecoveryDeadlineWork?.cancel()
        remoteCommandRecoveryDeadlineWork = nil
        inFlightRemoteCommand = nil
        if receipt.status == .accepted {
            if latestControlEnvelope.map({ $0.revision < receipt.revision }) ?? true {
                minimumControlEnvelopeRevision = receipt.revision
            } else {
                minimumControlEnvelopeRevision = nil
            }
        } else if receipt.rejection == .staleRoute ||
                    receipt.rejection == .routeDisabled ||
                    receipt.rejection == .authorityMismatch {
            latestControlEnvelope = nil
            resetCueCatalog(
                publishUnavailable: true,
                message: "La ruta local cambió en Studio. Esperando el estado firmado nuevo…"
            )
        } else if latestControlEnvelope.map({ $0.revision < receipt.revision }) ?? true {
            minimumControlEnvelopeRevision = receipt.revision
        }
        remoteFeedbackHandler?(TchurchStudioLANRemoteFeedback(
            commandID: command.commandID,
            action: command.action,
            state: receipt.status == .accepted ? .accepted : .rejected,
            rejection: receipt.rejection,
            revision: receipt.revision,
            wasIdempotentReplay: receipt.wasIdempotentReplay
        ))
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func handleOperatorTimerReceipt(
        _ receipt: TchurchStudioLANOperatorTimerReceipt
    ) throws {
        guard let inFlight = inFlightOperatorTimerCommand,
              inFlight.isAwaitingReceipt,
              let subscription = activeSubscription,
              subscription.payloadVersion ==
                TchurchStudioLANOperatorTimerContract.payloadVersion ||
                subscription.payloadVersion ==
                    TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                subscription.payloadVersion ==
                    TchurchStudioLANLocalOBSSceneContract.payloadVersion else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        let command = inFlight.command
        guard receipt.commandID == command.commandID,
              receipt.deviceID == command.deviceID,
              receipt.authority == command.authority,
              receipt.routeEpoch == command.routeEpoch,
              receipt.permissionRevision == command.permissionRevision,
              receipt.issuedAtMilliseconds >= command.issuedAtMilliseconds -
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds,
              receipt.issuedAtMilliseconds <= TchurchStudioLANTime.nowMilliseconds() +
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        try TchurchStudioLANOperatorTimerReceiptCrypto.verify(
            receipt,
            studioSigningPublicKey: subscription.signingPublicKey
        )
        guard boundedRequestLane.finish(.operatorTimerCommand(command.commandID)) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        operatorTimerCommandTimeoutWork?.cancel()
        operatorTimerCommandTimeoutWork = nil
        operatorTimerCommandRecoveryDeadlineWork?.cancel()
        operatorTimerCommandRecoveryDeadlineWork = nil
        inFlightOperatorTimerCommand = nil
        let signedTimerRevision = latestControlEnvelope?.payload.control?
            .operatorTimers?.revision
        if receipt.status == .accepted {
            if let signedTimerRevision, signedTimerRevision >= receipt.timerRevision {
                minimumOperatorTimerRevision = nil
            } else {
                minimumOperatorTimerRevision = receipt.timerRevision
            }
        } else if receipt.rejection == .staleRoute ||
                    receipt.rejection == .routeDisabled ||
                    receipt.rejection == .authorityMismatch {
            latestControlEnvelope = nil
            minimumOperatorTimerRevision = nil
            resetCueCatalog(
                publishUnavailable: true,
                message: "La ruta local cambió en Studio. Esperando el estado firmado nuevo…"
            )
        } else if signedTimerRevision.map({ $0 < receipt.timerRevision }) ?? true {
            minimumOperatorTimerRevision = receipt.timerRevision
        }
        operatorTimerFeedbackHandler?(TchurchStudioLANOperatorTimerFeedback(
            commandID: command.commandID,
            action: command.action,
            state: receipt.status == .accepted ? .accepted : .rejected,
            rejection: receipt.rejection,
            timerRevision: receipt.timerRevision,
            wasIdempotentReplay: receipt.wasIdempotentReplay
        ))
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func handleLocalBroadcastLowerThirdReceipt(
        _ receipt: TchurchStudioLANLocalBroadcastLowerThirdReceipt
    ) throws {
        guard let inFlight = inFlightLocalBroadcastLowerThirdCommand,
              inFlight.isAwaitingReceipt,
              let subscription = activeSubscription,
              subscription.payloadVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                subscription.payloadVersion ==
                    TchurchStudioLANLocalOBSSceneContract.payloadVersion else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        let command = inFlight.command
        guard receipt.commandID == command.commandID,
              receipt.deviceID == command.deviceID,
              receipt.authority == command.authority,
              receipt.routeEpoch == command.routeEpoch,
              receipt.permissionRevision == command.permissionRevision,
              receipt.issuedAtMilliseconds >= command.issuedAtMilliseconds -
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds,
              receipt.issuedAtMilliseconds <= TchurchStudioLANTime.nowMilliseconds() +
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        try TchurchStudioLANLocalBroadcastLowerThirdReceiptCrypto.verify(
            receipt,
            studioSigningPublicKey: subscription.signingPublicKey
        )
        guard boundedRequestLane.finish(
            .localBroadcastLowerThirdCommand(command.commandID)
        ) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        localBroadcastLowerThirdCommandTimeoutWork?.cancel()
        localBroadcastLowerThirdCommandTimeoutWork = nil
        localBroadcastLowerThirdCommandRecoveryDeadlineWork?.cancel()
        localBroadcastLowerThirdCommandRecoveryDeadlineWork = nil
        inFlightLocalBroadcastLowerThirdCommand = nil
        let signedLowerThirdRevision = latestControlEnvelope?.payload.control?
            .localBroadcastLowerThird?.revision
        if receipt.status == .accepted {
            if let signedLowerThirdRevision,
               signedLowerThirdRevision >= receipt.lowerThirdRevision {
                minimumLowerThirdRevision = nil
            } else {
                minimumLowerThirdRevision = receipt.lowerThirdRevision
            }
        } else if receipt.rejection == .staleRoute ||
                    receipt.rejection == .routeDisabled ||
                    receipt.rejection == .authorityMismatch {
            latestControlEnvelope = nil
            minimumLowerThirdRevision = nil
            resetCueCatalog(
                publishUnavailable: true,
                message: "La ruta local cambió en Studio. Esperando el estado firmado nuevo…"
            )
        } else if signedLowerThirdRevision.map({ $0 < receipt.lowerThirdRevision }) ?? true {
            minimumLowerThirdRevision = receipt.lowerThirdRevision
        }
        localBroadcastLowerThirdFeedbackHandler?(
            TchurchStudioLANLocalBroadcastLowerThirdFeedback(
                commandID: command.commandID,
                action: command.action,
                state: receipt.status == .accepted ? .accepted : .rejected,
                rejection: receipt.rejection,
                lowerThirdRevision: receipt.lowerThirdRevision,
                wasIdempotentReplay: receipt.wasIdempotentReplay
            )
        )
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func handleLocalOBSSceneReceipt(
        _ receipt: TchurchStudioLANLocalOBSSceneReceipt
    ) throws {
        guard let inFlight = inFlightLocalOBSSceneCommand,
              inFlight.isAwaitingReceipt,
              let subscription = activeSubscription,
              subscription.payloadVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              subscription.deviceGrant?.permissions.contains(.observe) == true,
              subscription.deviceGrant?.permissions.contains(.controlLocalOBS) == true else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        let command = inFlight.command
        guard receipt.commandID == command.commandID,
              receipt.deviceID == command.deviceID,
              receipt.authority == command.authority,
              receipt.routeEpoch == command.routeEpoch,
              receipt.permissionRevision == command.permissionRevision,
              receipt.connectionID == command.connectionID,
              receipt.requestedSceneID == command.action.sceneID,
              receipt.obsRevision >= command.expectedOBSRevision,
              receipt.issuedAtMilliseconds >= command.issuedAtMilliseconds -
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds,
              receipt.issuedAtMilliseconds <= TchurchStudioLANTime.nowMilliseconds() +
                TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds,
              let signedEnvelope = latestControlEnvelope,
              signedEnvelope.schemaVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              let signedLocalOBS = signedEnvelope.payload.control?.localOBS,
              signedLocalOBS.connectionID == command.connectionID,
              signedLocalOBS.revision >= command.expectedOBSRevision else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        try TchurchStudioLANLocalOBSSceneReceiptCrypto.verify(
            receipt,
            studioSigningPublicKey: subscription.signingPublicKey
        )
        guard boundedRequestLane.finish(.localOBSSceneCommand(command.commandID)) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
        localOBSSceneCommandTimeoutWork?.cancel()
        localOBSSceneCommandTimeoutWork = nil
        inFlightLocalOBSSceneCommand = nil

        switch receipt.status {
        case .accepted:
            minimumOBSEnvelopeSequence = nil
            minimumOBSRevision = signedLocalOBS.revision >= receipt.obsRevision
                ? nil : receipt.obsRevision
        case .rejected:
            if receipt.rejection == .staleRoute || receipt.rejection == .routeDisabled ||
                receipt.rejection == .authorityMismatch {
                minimumOBSRevision = nil
                minimumOBSEnvelopeSequence = nil
                latestControlEnvelope = nil
                resetCueCatalog(
                    publishUnavailable: true,
                    message: "La ruta local cambió en Studio. Esperando el estado firmado nuevo…"
                )
            } else if signedLocalOBS.revision < receipt.obsRevision {
                minimumOBSRevision = receipt.obsRevision
            }
        case .unconfirmed:
            minimumOBSRevision = nil
            let next = signedEnvelope.sequence.addingReportingOverflow(1)
            minimumOBSEnvelopeSequence = next.overflow ? UInt64.max : next.partialValue
        }

        let feedbackState: TchurchStudioLANLocalOBSSceneFeedbackState
        switch receipt.status {
        case .accepted: feedbackState = .accepted
        case .rejected: feedbackState = .rejected
        case .unconfirmed: feedbackState = .unconfirmed
        }
        localOBSSceneFeedbackHandler?(TchurchStudioLANLocalOBSSceneFeedback(
            commandID: command.commandID,
            action: command.action,
            state: feedbackState,
            rejection: receipt.rejection,
            uncertaintyReason: receipt.uncertaintyReason,
            obsRevision: receipt.obsRevision
        ))
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func recordVerifiedControlEnvelope(
        _ envelope: TchurchStudioLANSignedEnvelope
    ) {
        guard envelope.channel == .control,
              envelope.schemaVersion == 4 || envelope.schemaVersion == 5 ||
                envelope.schemaVersion == 6 || envelope.schemaVersion == 7 ||
                envelope.schemaVersion == 8,
              envelope.payload.control?.routeEpoch != nil else { return }
        if envelope.schemaVersion == 4 {
            guard envelope.payload.control?.cueCatalog != nil else { return }
        } else {
            guard envelope.payload.control?.routing?.lanRemoteControl == true,
                  envelope.payload.control?.cueCatalogManifest != nil else { return }
            if envelope.schemaVersion >= 6 {
                guard envelope.payload.control?.operatorTimers?.isCanonical ?? true else {
                    return
                }
            } else {
                guard envelope.payload.control?.operatorTimers == nil else { return }
            }
            if envelope.schemaVersion >= 7 {
                guard envelope.payload.control?.localBroadcastLowerThird?.isCanonical ?? true,
                      envelope.payload.control?.localBroadcastLowerThird == nil ||
                        envelope.payload.control?.routing?.localBroadcast == true else {
                    return
                }
            } else {
                guard envelope.payload.control?.localBroadcastLowerThird == nil else { return }
            }
            if envelope.schemaVersion == 8 {
                guard envelope.payload.control?.localOBS?.isCanonical ?? true,
                      envelope.payload.control?.localOBS == nil ||
                        envelope.payload.control?.routing?.localBroadcast == true else {
                    return
                }
            } else {
                guard envelope.payload.control?.localOBS == nil else { return }
            }
        }
        latestControlEnvelope = envelope
        if let minimum = minimumControlEnvelopeRevision,
           envelope.revision >= minimum {
            minimumControlEnvelopeRevision = nil
        }
        if let minimum = minimumOperatorTimerRevision,
           let revision = envelope.payload.control?.operatorTimers?.revision,
           revision >= minimum {
            minimumOperatorTimerRevision = nil
        }
        if let minimum = minimumLowerThirdRevision,
           let revision = envelope.payload.control?.localBroadcastLowerThird?.revision,
           revision >= minimum {
            minimumLowerThirdRevision = nil
        }
        if let minimum = minimumOBSRevision,
           let revision = envelope.payload.control?.localOBS?.revision,
           revision >= minimum {
            minimumOBSRevision = nil
        }
        if let minimum = minimumOBSEnvelopeSequence,
           envelope.sequence >= minimum {
            minimumOBSEnvelopeSequence = nil
        }
        replayAmbiguousRemoteCommandIfReady()
        replayAmbiguousOperatorTimerCommandIfReady()
        replayAmbiguousLocalBroadcastLowerThirdCommandIfReady()
        emitStatus()
    }

    private func replayAmbiguousRemoteCommandIfReady() {
        guard var inFlight = inFlightRemoteCommand,
              inFlight.recovery.isAwaitingAuthenticatedContext,
              let connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle else { return }
        if inFlight.recovery.action.kind == .jump,
           (activeSubscription?.payloadVersion == 5 ||
            activeSubscription?.payloadVersion == 6 ||
            activeSubscription?.payloadVersion == 7 ||
            activeSubscription?.payloadVersion == 8) {
            guard let envelope = latestControlEnvelope,
                  let control = envelope.payload.control,
                  let routeEpoch = control.routeEpoch,
                  let key = cueCatalogKey,
                  key.authority == envelope.authority,
                  key.routeEpoch == routeEpoch,
                  key.catalogID == control.cueCatalogManifest?.catalogID,
                  let catalog = verifiedCueCatalog,
                  catalog.key == key else { return }
            guard let cueID = inFlight.recovery.action.cueID,
                  catalog.cues.contains(where: { $0.cueID == cueID }) else {
                cancelRemoteCommand(state: .interrupted)
                return
            }
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        do {
            let command = try makeRemoteCommand(
                action: inFlight.recovery.action,
                preserving: inFlight.recovery
            )
            try inFlight.recovery.recordResignedAttempt(
                command,
                nowMilliseconds: now
            )
            inFlight.command = command
            inFlight.isAwaitingReceipt = true
            let operation = TchurchStudioLANBoundedRequestOperation.remoteCommand(command.commandID)
            guard boundedRequestLane.begin(operation) else { return }
            inFlightRemoteCommand = inFlight
            armRemoteCommandTimeout(commandID: command.commandID, connection: connection)
            do {
                try send(.remoteCommand(command), connection: connection)
            } catch {
                boundedRequestLane.cancel(operation)
                _ = prepareAmbiguousRemoteCommandRecovery()
                handleConnectionEnded(
                    connection,
                    cause: .heartbeatProtocolViolation,
                    recoveryMessage: "Studio no confirmó el control local. Reconectando…"
                )
                return
            }
            remoteFeedbackHandler?(TchurchStudioLANRemoteFeedback(
                commandID: command.commandID,
                action: command.action,
                state: .queued,
                rejection: nil,
                revision: nil,
                wasIdempotentReplay: false
            ))
        } catch {
            cancelRemoteCommand(state: .timedOut)
        }
    }

    private func replayAmbiguousOperatorTimerCommandIfReady() {
        guard var inFlight = inFlightOperatorTimerCommand,
              inFlight.recovery.isAwaitingAuthenticatedContext,
              let connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              activeSubscription?.payloadVersion ==
                TchurchStudioLANOperatorTimerContract.payloadVersion ||
                activeSubscription?.payloadVersion ==
                    TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                activeSubscription?.payloadVersion ==
                    TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              latestControlEnvelope?.payload.control?.operatorTimers?.isCanonical == true else {
            return
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        do {
            let command = try makeOperatorTimerCommand(
                action: inFlight.recovery.action,
                preserving: inFlight.recovery
            )
            try inFlight.recovery.recordResignedAttempt(
                command,
                nowMilliseconds: now
            )
            inFlight.command = command
            inFlight.isAwaitingReceipt = true
            let operation = TchurchStudioLANBoundedRequestOperation.operatorTimerCommand(
                command.commandID
            )
            guard boundedRequestLane.begin(operation) else { return }
            inFlightOperatorTimerCommand = inFlight
            armOperatorTimerCommandTimeout(
                commandID: command.commandID,
                connection: connection
            )
            do {
                try send(.operatorTimerCommand(command), connection: connection)
            } catch {
                boundedRequestLane.cancel(operation)
                _ = prepareAmbiguousOperatorTimerCommandRecovery()
                handleConnectionEnded(
                    connection,
                    cause: .heartbeatProtocolViolation,
                    recoveryMessage: "Studio no confirmó el timer local. Reconectando…"
                )
                return
            }
            operatorTimerFeedbackHandler?(TchurchStudioLANOperatorTimerFeedback(
                commandID: command.commandID,
                action: command.action,
                state: .queued,
                rejection: nil,
                timerRevision: nil,
                wasIdempotentReplay: false
            ))
        } catch {
            cancelOperatorTimerCommand(state: .timedOut)
        }
    }

    private func replayAmbiguousLocalBroadcastLowerThirdCommandIfReady() {
        guard var inFlight = inFlightLocalBroadcastLowerThirdCommand,
              inFlight.recovery.isAwaitingAuthenticatedContext,
              let connection,
              didAuthenticate,
              currentPhase == .connected,
              boundedRequestLane.isIdle,
              activeSubscription?.payloadVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                activeSubscription?.payloadVersion ==
                    TchurchStudioLANLocalOBSSceneContract.payloadVersion,
              latestControlEnvelope?.payload.control?
                .localBroadcastLowerThird?.isCanonical == true else {
            return
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        do {
            let command = try makeLocalBroadcastLowerThirdCommand(
                action: inFlight.recovery.action,
                preserving: inFlight.recovery
            )
            try inFlight.recovery.recordResignedAttempt(
                command,
                nowMilliseconds: now
            )
            inFlight.command = command
            inFlight.isAwaitingReceipt = true
            let operation =
                TchurchStudioLANBoundedRequestOperation.localBroadcastLowerThirdCommand(
                    command.commandID
                )
            guard boundedRequestLane.begin(operation) else { return }
            inFlightLocalBroadcastLowerThirdCommand = inFlight
            armLocalBroadcastLowerThirdCommandTimeout(
                commandID: command.commandID,
                connection: connection
            )
            do {
                try send(.localBroadcastLowerThirdCommand(command), connection: connection)
            } catch {
                boundedRequestLane.cancel(operation)
                _ = prepareAmbiguousLocalBroadcastLowerThirdCommandRecovery()
                handleConnectionEnded(
                    connection,
                    cause: .heartbeatProtocolViolation,
                    recoveryMessage:
                        "Studio no confirmó el lower third local. Reconectando…"
                )
                return
            }
            localBroadcastLowerThirdFeedbackHandler?(
                TchurchStudioLANLocalBroadcastLowerThirdFeedback(
                    commandID: command.commandID,
                    action: command.action,
                    state: .queued,
                    rejection: nil,
                    lowerThirdRevision: nil,
                    wasIdempotentReplay: false
                )
            )
        } catch {
            cancelLocalBroadcastLowerThirdCommand(state: .timedOut)
        }
    }

    @discardableResult
    private func prepareAmbiguousRemoteCommandRecovery() -> Bool {
        guard var inFlight = inFlightRemoteCommand else { return false }
        remoteCommandTimeoutWork?.cancel()
        remoteCommandTimeoutWork = nil
        boundedRequestLane.cancel(.remoteCommand(inFlight.command.commandID))
        inFlight.isAwaitingReceipt = false
        if inFlight.recovery.isAwaitingAuthenticatedContext {
            inFlightRemoteCommand = inFlight
            return true
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        guard inFlight.recovery.markAmbiguous(nowMilliseconds: now) else {
            cancelRemoteCommand(state: .timedOut)
            return false
        }
        inFlightRemoteCommand = inFlight
        armRemoteCommandRecoveryDeadline(
            commandID: inFlight.command.commandID,
            deadlineMilliseconds: inFlight.recovery.recoverUntilMilliseconds
        )
        emitStatus()
        return true
    }

    @discardableResult
    private func prepareAmbiguousOperatorTimerCommandRecovery() -> Bool {
        guard var inFlight = inFlightOperatorTimerCommand else { return false }
        operatorTimerCommandTimeoutWork?.cancel()
        operatorTimerCommandTimeoutWork = nil
        boundedRequestLane.cancel(.operatorTimerCommand(inFlight.command.commandID))
        inFlight.isAwaitingReceipt = false
        if inFlight.recovery.isAwaitingAuthenticatedContext {
            inFlightOperatorTimerCommand = inFlight
            return true
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        guard inFlight.recovery.markAmbiguous(nowMilliseconds: now) else {
            cancelOperatorTimerCommand(state: .timedOut)
            return false
        }
        inFlightOperatorTimerCommand = inFlight
        armOperatorTimerCommandRecoveryDeadline(
            commandID: inFlight.command.commandID,
            deadlineMilliseconds: inFlight.recovery.recoverUntilMilliseconds
        )
        emitStatus()
        return true
    }

    @discardableResult
    private func prepareAmbiguousLocalBroadcastLowerThirdCommandRecovery() -> Bool {
        guard var inFlight = inFlightLocalBroadcastLowerThirdCommand else { return false }
        localBroadcastLowerThirdCommandTimeoutWork?.cancel()
        localBroadcastLowerThirdCommandTimeoutWork = nil
        boundedRequestLane.cancel(
            .localBroadcastLowerThirdCommand(inFlight.command.commandID)
        )
        inFlight.isAwaitingReceipt = false
        if inFlight.recovery.isAwaitingAuthenticatedContext {
            inFlightLocalBroadcastLowerThirdCommand = inFlight
            return true
        }
        let now = TchurchStudioLANTime.nowMilliseconds()
        guard inFlight.recovery.markAmbiguous(nowMilliseconds: now) else {
            cancelLocalBroadcastLowerThirdCommand(state: .timedOut)
            return false
        }
        inFlightLocalBroadcastLowerThirdCommand = inFlight
        armLocalBroadcastLowerThirdCommandRecoveryDeadline(
            commandID: inFlight.command.commandID,
            deadlineMilliseconds: inFlight.recovery.recoverUntilMilliseconds
        )
        emitStatus()
        return true
    }

    private func armRemoteCommandRecoveryDeadline(
        commandID: UUID,
        deadlineMilliseconds: Int64
    ) {
        remoteCommandRecoveryDeadlineWork?.cancel()
        let now = TchurchStudioLANTime.nowMilliseconds()
        let delay = max(0, deadlineMilliseconds - now)
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.inFlightRemoteCommand?.command.commandID == commandID else { return }
            self.remoteCommandRecoveryDeadlineWork = nil
            self.cancelRemoteCommand(state: .timedOut, expectedCommandID: commandID)
            if let connection = self.connection {
                self.handleConnectionEnded(
                    connection,
                    cause: .heartbeatTimeout,
                    recoveryMessage: "Studio no confirmó el control local. Reconectando…"
                )
            }
        }
        remoteCommandRecoveryDeadlineWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(Int(min(delay, Int64(Int.max)))),
            execute: work
        )
    }

    private func armOperatorTimerCommandRecoveryDeadline(
        commandID: UUID,
        deadlineMilliseconds: Int64
    ) {
        operatorTimerCommandRecoveryDeadlineWork?.cancel()
        let now = TchurchStudioLANTime.nowMilliseconds()
        let delay = max(0, deadlineMilliseconds - now)
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.inFlightOperatorTimerCommand?.command.commandID == commandID else {
                return
            }
            self.operatorTimerCommandRecoveryDeadlineWork = nil
            self.cancelOperatorTimerCommand(
                state: .timedOut,
                expectedCommandID: commandID
            )
            if let connection = self.connection {
                self.handleConnectionEnded(
                    connection,
                    cause: .heartbeatTimeout,
                    recoveryMessage: "Studio no confirmó el timer local. Reconectando…"
                )
            }
        }
        operatorTimerCommandRecoveryDeadlineWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(Int(min(delay, Int64(Int.max)))),
            execute: work
        )
    }

    private func armLocalBroadcastLowerThirdCommandRecoveryDeadline(
        commandID: UUID,
        deadlineMilliseconds: Int64
    ) {
        localBroadcastLowerThirdCommandRecoveryDeadlineWork?.cancel()
        let now = TchurchStudioLANTime.nowMilliseconds()
        let delay = max(0, deadlineMilliseconds - now)
        let work = DispatchWorkItem { [weak self] in
            guard let self,
                  self.inFlightLocalBroadcastLowerThirdCommand?
                    .command.commandID == commandID else {
                return
            }
            self.localBroadcastLowerThirdCommandRecoveryDeadlineWork = nil
            self.cancelLocalBroadcastLowerThirdCommand(
                state: .timedOut,
                expectedCommandID: commandID
            )
            if let connection = self.connection {
                self.handleConnectionEnded(
                    connection,
                    cause: .heartbeatTimeout,
                    recoveryMessage:
                        "Studio no confirmó el lower third local. Reconectando…"
                )
            }
        }
        localBroadcastLowerThirdCommandRecoveryDeadlineWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(Int(min(delay, Int64(Int.max)))),
            execute: work
        )
    }

    private func armRemoteCommandTimeout(commandID: UUID, connection: NWConnection) {
        remoteCommandTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self,
                  let connection,
                  self.connection === connection,
                  self.inFlightRemoteCommand?.command.commandID == commandID else { return }
            self.remoteCommandTimeoutWork = nil
            self.handleConnectionEnded(
                connection,
                cause: .heartbeatTimeout,
                recoveryMessage: "Studio no confirmó el control local. Reconectando…"
            )
        }
        remoteCommandTimeoutWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(
                Int(TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds + 3_000)
            ),
            execute: work
        )
    }

    private func armOperatorTimerCommandTimeout(
        commandID: UUID,
        connection: NWConnection
    ) {
        operatorTimerCommandTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self,
                  let connection,
                  self.connection === connection,
                  self.inFlightOperatorTimerCommand?.command.commandID == commandID else {
                return
            }
            self.operatorTimerCommandTimeoutWork = nil
            self.handleConnectionEnded(
                connection,
                cause: .heartbeatTimeout,
                recoveryMessage: "Studio no confirmó el timer local. Reconectando…"
            )
        }
        operatorTimerCommandTimeoutWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(
                Int(TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds + 3_000)
            ),
            execute: work
        )
    }

    private func armLocalBroadcastLowerThirdCommandTimeout(
        commandID: UUID,
        connection: NWConnection
    ) {
        localBroadcastLowerThirdCommandTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self,
                  let connection,
                  self.connection === connection,
                  self.inFlightLocalBroadcastLowerThirdCommand?
                    .command.commandID == commandID else {
                return
            }
            self.localBroadcastLowerThirdCommandTimeoutWork = nil
            self.handleConnectionEnded(
                connection,
                cause: .heartbeatTimeout,
                recoveryMessage: "Studio no confirmó el lower third local. Reconectando…"
            )
        }
        localBroadcastLowerThirdCommandTimeoutWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(
                Int(TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds +
                    3_000)
            ),
            execute: work
        )
    }

    private func armLocalOBSSceneCommandTimeout(
        commandID: UUID,
        connection: NWConnection
    ) {
        localOBSSceneCommandTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self,
                  let connection,
                  self.connection === connection,
                  self.inFlightLocalOBSSceneCommand?.command.commandID == commandID else {
                return
            }
            self.localOBSSceneCommandTimeoutWork = nil
            self.cancelLocalOBSSceneCommand(
                state: .unconfirmed,
                expectedCommandID: commandID
            )
            self.handleConnectionEnded(
                connection,
                cause: .heartbeatTimeout,
                recoveryMessage:
                    "Studio no confirmó la escena OBS. Esperando estado firmado nuevo…"
            )
        }
        localOBSSceneCommandTimeoutWork = work
        queue.asyncAfter(
            deadline: .now() + .milliseconds(
                Int(TchurchStudioLANRemoteControlContract.maximumCommandLifetimeMilliseconds +
                    3_000)
            ),
            execute: work
        )
    }

    private func cancelRemoteCommand(
        state: TchurchStudioLANRemoteFeedbackState,
        expectedCommandID: UUID? = nil
    ) {
        guard let inFlight = inFlightRemoteCommand,
              expectedCommandID.map({ $0 == inFlight.command.commandID }) ?? true else { return }
        remoteCommandTimeoutWork?.cancel()
        remoteCommandTimeoutWork = nil
        remoteCommandRecoveryDeadlineWork?.cancel()
        remoteCommandRecoveryDeadlineWork = nil
        inFlightRemoteCommand = nil
        boundedRequestLane.cancel(.remoteCommand(inFlight.command.commandID))
        remoteFeedbackHandler?(TchurchStudioLANRemoteFeedback(
            commandID: inFlight.command.commandID,
            action: inFlight.command.action,
            state: state,
            rejection: nil,
            revision: nil,
            wasIdempotentReplay: false
        ))
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func cancelOperatorTimerCommand(
        state: TchurchStudioLANRemoteFeedbackState,
        expectedCommandID: UUID? = nil
    ) {
        guard let inFlight = inFlightOperatorTimerCommand,
              expectedCommandID.map({ $0 == inFlight.command.commandID }) ?? true else {
            return
        }
        operatorTimerCommandTimeoutWork?.cancel()
        operatorTimerCommandTimeoutWork = nil
        operatorTimerCommandRecoveryDeadlineWork?.cancel()
        operatorTimerCommandRecoveryDeadlineWork = nil
        inFlightOperatorTimerCommand = nil
        boundedRequestLane.cancel(.operatorTimerCommand(inFlight.command.commandID))
        operatorTimerFeedbackHandler?(TchurchStudioLANOperatorTimerFeedback(
            commandID: inFlight.command.commandID,
            action: inFlight.command.action,
            state: state,
            rejection: nil,
            timerRevision: nil,
            wasIdempotentReplay: false
        ))
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func cancelLocalBroadcastLowerThirdCommand(
        state: TchurchStudioLANRemoteFeedbackState,
        expectedCommandID: UUID? = nil
    ) {
        guard let inFlight = inFlightLocalBroadcastLowerThirdCommand,
              expectedCommandID.map({ $0 == inFlight.command.commandID }) ?? true else {
            return
        }
        localBroadcastLowerThirdCommandTimeoutWork?.cancel()
        localBroadcastLowerThirdCommandTimeoutWork = nil
        localBroadcastLowerThirdCommandRecoveryDeadlineWork?.cancel()
        localBroadcastLowerThirdCommandRecoveryDeadlineWork = nil
        inFlightLocalBroadcastLowerThirdCommand = nil
        boundedRequestLane.cancel(
            .localBroadcastLowerThirdCommand(inFlight.command.commandID)
        )
        localBroadcastLowerThirdFeedbackHandler?(
            TchurchStudioLANLocalBroadcastLowerThirdFeedback(
                commandID: inFlight.command.commandID,
                action: inFlight.command.action,
                state: state,
                rejection: nil,
                lowerThirdRevision: nil,
                wasIdempotentReplay: false
            )
        )
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func cancelLocalOBSSceneCommand(
        state: TchurchStudioLANLocalOBSSceneFeedbackState,
        expectedCommandID: UUID? = nil
    ) {
        guard let inFlight = inFlightLocalOBSSceneCommand,
              expectedCommandID.map({ $0 == inFlight.command.commandID }) ?? true else {
            return
        }
        localOBSSceneCommandTimeoutWork?.cancel()
        localOBSSceneCommandTimeoutWork = nil
        inFlightLocalOBSSceneCommand = nil
        boundedRequestLane.cancel(.localOBSSceneCommand(inFlight.command.commandID))
        let uncertaintyReason: TchurchStudioLANLocalOBSSceneUncertaintyReason? =
            state == .unconfirmed ? .mutationMayHaveExecuted : nil
        if state == .unconfirmed {
            minimumOBSRevision = nil
            if let sequence = latestControlEnvelope?.sequence {
                let next = sequence.addingReportingOverflow(1)
                minimumOBSEnvelopeSequence = next.overflow ? UInt64.max : next.partialValue
            } else {
                minimumOBSEnvelopeSequence = nil
            }
        }
        localOBSSceneFeedbackHandler?(TchurchStudioLANLocalOBSSceneFeedback(
            commandID: inFlight.command.commandID,
            action: inFlight.command.action,
            state: state,
            rejection: nil,
            uncertaintyReason: uncertaintyReason,
            obsRevision: nil
        ))
        emitStatus()
        if let connection {
            resumeBoundedRequestLane(connection: connection, catalogPriority: true)
        }
    }

    private func send(_ message: TchurchStudioLANWireMessage, connection: NWConnection) throws {
        let frame = try TchurchStudioLANWireCodec.encode(message, maximumFrameBytes: limits.maximumFrameBytes)
        connection.send(content: frame, completion: .contentProcessed { [weak self, weak connection] error in
            guard let error, let self = self, let connection = connection else { return }
            let cause = TchurchStudioLANConnectionEndCause.network(
                TchurchStudioLANNetworkFailure(error)
            )
            self.queue.async { self.handleConnectionEnded(connection, cause: cause) }
        })
    }

    private func recordAuthenticatedInboundActivity(_ connection: NWConnection) {
        guard self.connection === connection,
              didAuthenticate,
              pendingHeartbeatNonce == nil else { return }
        armHeartbeatIdle(connection)
    }

    private func armHeartbeatIdle(_ connection: NWConnection) {
        heartbeatIdleWork?.cancel()
        heartbeatIdleWork = nil
        guard self.connection === connection,
              didAuthenticate,
              !suspended,
              pendingHeartbeatNonce == nil else { return }
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self, let connection,
                  self.connection === connection,
                  self.didAuthenticate,
                  !self.suspended,
                  self.pendingHeartbeatNonce == nil else { return }
            self.heartbeatIdleWork = nil
            let nonce = UUID().uuidString.lowercased()
            self.pendingHeartbeatNonce = nonce
            do {
                try self.send(.ping(nonce), connection: connection)
                self.armHeartbeatTimeout(nonce: nonce, connection: connection)
            } catch {
                self.handleConnectionEnded(
                    connection,
                    cause: .heartbeatProtocolViolation,
                    recoveryMessage: "No se pudo verificar la conexión LAN. Reconectando…"
                )
            }
        }
        heartbeatIdleWork = work
        queue.asyncAfter(deadline: .now() + heartbeatTimings.idleInterval, execute: work)
    }

    private func armHeartbeatTimeout(nonce: String, connection: NWConnection) {
        heartbeatTimeoutWork?.cancel()
        let work = DispatchWorkItem { [weak self, weak connection] in
            guard let self, let connection,
                  self.connection === connection,
                  self.didAuthenticate,
                  self.pendingHeartbeatNonce == nonce else { return }
            self.heartbeatTimeoutWork = nil
            self.handleConnectionEnded(
                connection,
                cause: .heartbeatTimeout,
                recoveryMessage: "Studio dejó de responder en la red local. Reconectando…"
            )
        }
        heartbeatTimeoutWork = work
        queue.asyncAfter(deadline: .now() + heartbeatTimings.pongTimeout, execute: work)
    }

    private func acceptHeartbeatPong(_ nonce: String, connection: NWConnection) throws {
        guard self.connection === connection,
              didAuthenticate,
              let expectedNonce = pendingHeartbeatNonce,
              nonce == expectedNonce else {
            throw TchurchStudioLANClientProcessingError.heartbeatProtocolViolation
        }
        heartbeatTimeoutWork?.cancel()
        heartbeatTimeoutWork = nil
        pendingHeartbeatNonce = nil
        armHeartbeatIdle(connection)
    }

    private func cancelHeartbeat() {
        heartbeatIdleWork?.cancel()
        heartbeatIdleWork = nil
        heartbeatTimeoutWork?.cancel()
        heartbeatTimeoutWork = nil
        pendingHeartbeatNonce = nil
    }

    private func clearRemoteControlSession(
        interruptCommand: Bool,
        preserveAmbiguousCommand: Bool = false
    ) {
        if preserveAmbiguousCommand {
            remoteCommandTimeoutWork?.cancel()
            remoteCommandTimeoutWork = nil
            operatorTimerCommandTimeoutWork?.cancel()
            operatorTimerCommandTimeoutWork = nil
            localBroadcastLowerThirdCommandTimeoutWork?.cancel()
            localBroadcastLowerThirdCommandTimeoutWork = nil
        } else if interruptCommand {
            cancelRemoteCommand(state: .interrupted)
            cancelOperatorTimerCommand(state: .interrupted)
            cancelLocalBroadcastLowerThirdCommand(state: .interrupted)
            if let inFlightLocalOBSSceneCommand {
                cancelLocalOBSSceneCommand(
                    state: inFlightLocalOBSSceneCommand.isAwaitingReceipt
                        ? .unconfirmed : .interrupted
                )
            }
        } else {
            remoteCommandTimeoutWork?.cancel()
            remoteCommandTimeoutWork = nil
            remoteCommandRecoveryDeadlineWork?.cancel()
            remoteCommandRecoveryDeadlineWork = nil
            if let inFlightRemoteCommand {
                boundedRequestLane.cancel(.remoteCommand(inFlightRemoteCommand.command.commandID))
            }
            inFlightRemoteCommand = nil
            operatorTimerCommandTimeoutWork?.cancel()
            operatorTimerCommandTimeoutWork = nil
            operatorTimerCommandRecoveryDeadlineWork?.cancel()
            operatorTimerCommandRecoveryDeadlineWork = nil
            if let inFlightOperatorTimerCommand {
                boundedRequestLane.cancel(
                    .operatorTimerCommand(inFlightOperatorTimerCommand.command.commandID)
                )
            }
            inFlightOperatorTimerCommand = nil
            localBroadcastLowerThirdCommandTimeoutWork?.cancel()
            localBroadcastLowerThirdCommandTimeoutWork = nil
            localBroadcastLowerThirdCommandRecoveryDeadlineWork?.cancel()
            localBroadcastLowerThirdCommandRecoveryDeadlineWork = nil
            if let inFlightLocalBroadcastLowerThirdCommand {
                boundedRequestLane.cancel(
                    .localBroadcastLowerThirdCommand(
                        inFlightLocalBroadcastLowerThirdCommand.command.commandID
                    )
                )
            }
            inFlightLocalBroadcastLowerThirdCommand = nil
            localOBSSceneCommandTimeoutWork?.cancel()
            localOBSSceneCommandTimeoutWork = nil
            if let inFlightLocalOBSSceneCommand {
                boundedRequestLane.cancel(
                    .localOBSSceneCommand(inFlightLocalOBSSceneCommand.command.commandID)
                )
            }
            inFlightLocalOBSSceneCommand = nil
        }
        activeSubscription = nil
        latestControlEnvelope = nil
        minimumControlEnvelopeRevision = nil
        minimumOperatorTimerRevision = nil
        minimumLowerThirdRevision = nil
        minimumOBSRevision = nil
        minimumOBSEnvelopeSequence = nil
        resetCueCatalog(publishUnavailable: true)
    }

    private func failProtocol(_ connection: NWConnection) {
        guard self.connection === connection else { return }
        requestPrivateStatePurge(
            targetPrincipalFingerprint: privacyState.principalFingerprint,
            targetScopeFingerprint: currentPrivacyScopeFingerprint,
            progressMessage: "Studio envió datos que no pudieron verificarse. La pantalla quedó cerrada por seguridad.",
            failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo."
        )
    }

    private func handleConnectionEnded(
        _ connection: NWConnection,
        cause: TchurchStudioLANConnectionEndCause,
        recoveryMessage: String = "Se perdió la conexión LAN. Reintentando…"
    ) {
        guard self.connection === connection else { return }
        connection.stateUpdateHandler = nil
        connection.cancel()
        self.connection = nil
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        cancelHeartbeat()
        verifier = nil
        if let inFlightLocalOBSSceneCommand {
            cancelLocalOBSSceneCommand(
                state: inFlightLocalOBSSceneCommand.isAwaitingReceipt
                    ? .unconfirmed : .interrupted,
                expectedCommandID: inFlightLocalOBSSceneCommand.command.commandID
            )
        }
        let preserveAmbiguousCommand = !intentionalDisconnect &&
            !suspended &&
            (prepareAmbiguousRemoteCommandRecovery() ||
             prepareAmbiguousOperatorTimerCommandRecovery() ||
             prepareAmbiguousLocalBroadcastLowerThirdCommandRecovery())
        clearRemoteControlSession(
            interruptCommand: !preserveAmbiguousCommand,
            preserveAmbiguousCommand: preserveAmbiguousCommand
        )
        challenge = nil
        request = nil
        resetAssetTransfer()
        boundedRequestLane.reset()
        discardedCatalogRequestIDs.reset()
        exactReplayAssetRehydration.clearConnectionEligibility()
        currentConnectionIsAutomaticReconnect = false
        if intentionalDisconnect || suspended { return }
        didAuthenticate = false
        lastWaitingNetworkFailure = cause.networkFailure
        scheduleReconnect(message: recoveryMessage, cause: cause)
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
        cancelHeartbeat()
        connection.stateUpdateHandler = nil
        connection.cancel()
        self.connection = nil
        challenge = nil
        request = nil
        verifier = nil
        clearRemoteControlSession(interruptCommand: true)
        exactReplayAssetRehydration.clearConnectionEligibility()
        currentConnectionIsAutomaticReconnect = false
        didAuthenticate = false
        decoder = try! TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: limits.maximumFrameBytes,
            maximumBufferedBytes: limits.maximumBufferedInputBytes
        )
        setPhase(.reconnecting, message: "Studio usa el protocolo LAN anterior. Verificando compatibilidad segura…")
        queue.async { [weak self] in self?.beginConnection(reconnecting: true) }
        return true
    }

    private func scheduleReconnect(
        message: String,
        cause: TchurchStudioLANConnectionEndCause
    ) {
        guard desired != nil, !suspended else { return }
        reconnectWork?.cancel()
        switch reconnectPolicy.record(cause) {
        case .purgePairing:
            let rejectionMessage = activeSecretSource == .entered
                ? "No se pudo autenticar. Revisa el código de emparejamiento."
                : "El emparejamiento cambió. Escanea el QR actual de Tchurch Studio."
            requestPrivateStatePurge(
                targetPrincipalFingerprint: privacyState.principalFingerprint,
                targetScopeFingerprint: currentPrivacyScopeFingerprint,
                progressMessage: rejectionMessage,
                failureMessage: "No se pudo completar el borrado privado de Studio. Intenta de nuevo."
            )
            return
        case .reconnect(let seconds):
            let statusMessage = reconnectPolicy.consecutiveFailures >= 8
                ? "Studio no aceptó la conexión. Conservamos el emparejamiento; usa Olvidar solo si cambió el QR."
                : message
            setPhase(.reconnecting, message: statusMessage)
            let work = DispatchWorkItem { [weak self] in self?.beginConnection(reconnecting: true) }
            reconnectWork = work
            queue.asyncAfter(deadline: .now() + .seconds(seconds), execute: work)
        }
    }

    private func disconnectOnQueue(clearDesired: Bool) {
        reconnectWork?.cancel()
        reconnectWork = nil
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        cancelHeartbeat()
        intentionalDisconnect = true
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        verifier = nil
        clearRemoteControlSession(interruptCommand: true)
        challenge = nil
        request = nil
        pendingSecret = nil
        activeSecret = nil
        activeSecretSource = nil
        didAuthenticate = false
        lastWaitingNetworkFailure = nil
        resetAssetTransfer()
        exactReplayAssetRehydration.clearConnectionEligibility()
        currentConnectionIsAutomaticReconnect = false
        if clearDesired {
            clearManualReplayRecoveryState()
            desired = nil
            payloadNegotiation = TchurchStudioLANPayloadNegotiation(
                protocolFloor: deviceTrust.snapshot.protocolFloor
            )
            reconnectPolicy.resetForNewDesiredConnection()
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

    private func closeForDeviceRevocation() {
        reconnectWork?.cancel()
        reconnectWork = nil
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        cancelHeartbeat()
        intentionalDisconnect = true
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        verifier = nil
        clearRemoteControlSession(interruptCommand: true)
        challenge = nil
        request = nil
        pendingSecret = nil
        activeSecret = nil
        activeSecretSource = nil
        didAuthenticate = false
        lastWaitingNetworkFailure = nil
        resetAssetTransfer()
        replayGuards.removeAll(keepingCapacity: false)
        exactReplayAssetRehydration.clearAll()
        clearManualReplayRecoveryState()
        do {
            try assetCachePurge()
        } catch {
            // The presentation is already closed in memory. Keep the client
            // revoked and retry disk cleanup on the next privacy purge/start.
        }
        setPhase(.failed, message: "Este dispositivo fue revocado en Tchurch Studio.")
    }

    private func markDeviceRevokedAndClose() {
        if let studioID = challenge?.studioID ?? deviceTrust.snapshot.studioID {
            let currentGeneration = deviceTrust.snapshot.revocationGeneration
            let nextGeneration = currentGeneration == UInt64.max
                ? currentGeneration
                : currentGeneration + 1
            _ = try? deviceTrust.revoke(
                studioID: studioID,
                revocationGeneration: nextGeneration
            )
        }
        closeForDeviceRevocation()
    }

    private func waitForDeviceApproval(_ connection: NWConnection) {
        guard self.connection === connection else { return }
        connectionTimeoutWork?.cancel()
        connectionTimeoutWork = nil
        cancelHeartbeat()
        connection.stateUpdateHandler = nil
        connection.cancel()
        self.connection = nil
        verifier = nil
        clearRemoteControlSession(interruptCommand: true)
        challenge = nil
        request = nil
        didAuthenticate = false
        resetAssetTransfer()
        exactReplayAssetRehydration.clearConnectionEligibility()
        currentConnectionIsAutomaticReconnect = false
        setPhase(.authenticating, message: nil)
        reconnectWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.beginConnection(reconnecting: true)
        }
        reconnectWork = work
        queue.asyncAfter(deadline: .now() + .seconds(2), execute: work)
    }

    private func clientID() throws -> UUID {
        guard !privacyAccessBlocked else {
            throw TchurchStudioLANError.invalidConfiguration
        }
        if privacyState.clientIdentityInitialized,
           let value = privacyState.clientID,
           let id = UUID(uuidString: value) {
            return id
        }

        let id: UUID
        if !privacyState.clientIdentityInitialized,
           let legacy = defaults.string(forKey: Self.clientIDDefaultsKey),
           let migrated = UUID(uuidString: legacy) {
            id = migrated
        } else {
            id = UUID()
        }
        var next = privacyState
        next.clientIdentityInitialized = true
        next.clientID = id.uuidString.lowercased()
        try privacyStateStore.write(next)
        privacyState = next
        privacyStateReadFailed = false
        defaults.removeObject(forKey: Self.clientIDDefaultsKey)
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
        let privateStateBlocked = privacyAccessBlocked
        let trust = deviceTrust.snapshot
        let revoked = trust.enrollmentState == .revoked
        let paired = !privateStateBlocked && !revoked &&
            selectedServiceID.flatMap { try? secretStore.read(serviceID: $0) } != nil
        let controlEnvelopeReady = latestControlEnvelope.map { envelope in
            envelope.channel == .control &&
                (envelope.schemaVersion == 4 || envelope.schemaVersion == 5 ||
                    envelope.schemaVersion == 6 || envelope.schemaVersion == 7 ||
                    envelope.schemaVersion == 8) &&
                envelope.payload.control?.routeEpoch != nil &&
                (envelope.schemaVersion == 4
                    ? envelope.payload.control?.cueCatalog != nil
                    : envelope.payload.control?.routing?.lanRemoteControl == true &&
                        envelope.payload.control?.cueCatalogManifest != nil) &&
                (minimumControlEnvelopeRevision.map({ envelope.revision >= $0 }) ?? true)
        } ?? false
        let remoteControlAvailable = !privateStateBlocked && !revoked &&
            currentPhase == .connected &&
            didAuthenticate &&
            desired?.channel == .control &&
            trust.enrollmentState == .approved &&
            trust.role == .production &&
            trust.permissions.contains(.observe) &&
            trust.permissions.contains(.controlProgram) &&
            activeSubscription?.channel == .control &&
            (activeSubscription?.payloadVersion == 4 ||
                activeSubscription?.payloadVersion == 5 ||
                activeSubscription?.payloadVersion == 6 ||
                activeSubscription?.payloadVersion == 7 ||
                activeSubscription?.payloadVersion == 8) &&
            controlEnvelopeReady &&
            inFlightRemoteCommand == nil &&
            inFlightOperatorTimerCommand == nil &&
            inFlightLocalBroadcastLowerThirdCommand == nil &&
            inFlightLocalOBSSceneCommand == nil
        let operatorTimerEnvelopeReady = latestControlEnvelope.map { envelope in
            envelope.channel == .control &&
                (envelope.schemaVersion ==
                    TchurchStudioLANOperatorTimerContract.payloadVersion ||
                    envelope.schemaVersion ==
                        TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                    envelope.schemaVersion ==
                        TchurchStudioLANLocalOBSSceneContract.payloadVersion) &&
                envelope.payload.control?.routeEpoch != nil &&
                envelope.payload.control?.routing?.lanRemoteControl == true &&
                envelope.payload.control?.routing?.tchurchCloudProgram == false &&
                envelope.payload.control?.operatorTimers?.isCanonical == true &&
                (minimumOperatorTimerRevision.map {
                    (envelope.payload.control?.operatorTimers?.revision ?? 0) >= $0
                } ?? true)
        } ?? false
        let operatorTimerControlAvailable = !privateStateBlocked && !revoked &&
            currentPhase == .connected &&
            didAuthenticate &&
            desired?.channel == .control &&
            trust.enrollmentState == .approved &&
            trust.role == .production &&
            trust.permissions.contains(.observe) &&
            trust.permissions.contains(.controlProgram) &&
            activeSubscription?.channel == .control &&
            (activeSubscription?.payloadVersion ==
                TchurchStudioLANOperatorTimerContract.payloadVersion ||
                activeSubscription?.payloadVersion ==
                    TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                activeSubscription?.payloadVersion ==
                    TchurchStudioLANLocalOBSSceneContract.payloadVersion) &&
            operatorTimerEnvelopeReady &&
            inFlightRemoteCommand == nil &&
            inFlightOperatorTimerCommand == nil &&
            inFlightLocalBroadcastLowerThirdCommand == nil &&
            inFlightLocalOBSSceneCommand == nil
        let lowerThirdEnvelopeReady = latestControlEnvelope.map { envelope in
            envelope.channel == .control &&
                (envelope.schemaVersion ==
                    TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                    envelope.schemaVersion ==
                        TchurchStudioLANLocalOBSSceneContract.payloadVersion) &&
                envelope.payload.control?.routeEpoch != nil &&
                envelope.payload.control?.routing?.lanRemoteControl == true &&
                envelope.payload.control?.routing?.localBroadcast == true &&
                envelope.payload.control?.routing?.tchurchCloudProgram == false &&
                envelope.payload.control?.localBroadcastLowerThird?.isCanonical == true &&
                (minimumLowerThirdRevision.map {
                    (envelope.payload.control?.localBroadcastLowerThird?.revision ?? 0) >= $0
                } ?? true)
        } ?? false
        let localBroadcastLowerThirdControlAvailable = !privateStateBlocked && !revoked &&
            currentPhase == .connected &&
            didAuthenticate &&
            desired?.channel == .control &&
            trust.enrollmentState == .approved &&
            trust.role == .production &&
            trust.permissions.contains(.observe) &&
            trust.permissions.contains(.controlProgram) &&
            activeSubscription?.channel == .control &&
            (activeSubscription?.payloadVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion ||
                activeSubscription?.payloadVersion ==
                    TchurchStudioLANLocalOBSSceneContract.payloadVersion) &&
            lowerThirdEnvelopeReady &&
            inFlightRemoteCommand == nil &&
            inFlightOperatorTimerCommand == nil &&
            inFlightLocalBroadcastLowerThirdCommand == nil &&
            inFlightLocalOBSSceneCommand == nil
        let localOBSEnvelopeReady = latestControlEnvelope.map { envelope in
            envelope.channel == .control &&
                envelope.schemaVersion == TchurchStudioLANLocalOBSSceneContract.payloadVersion &&
                envelope.payload.control?.routeEpoch != nil &&
                envelope.payload.control?.routing?.lanRemoteControl == true &&
                envelope.payload.control?.routing?.localBroadcast == true &&
                envelope.payload.control?.routing?.tchurchCloudProgram == false &&
                envelope.payload.control?.localOBS?.isCanonical == true &&
                envelope.payload.control?.localOBS?.availability == .ready &&
                (minimumOBSRevision.map {
                    (envelope.payload.control?.localOBS?.revision ?? 0) >= $0
                } ?? true) &&
                (minimumOBSEnvelopeSequence.map { envelope.sequence >= $0 } ?? true)
        } ?? false
        let localOBSSceneControlAvailable = !privateStateBlocked && !revoked &&
            currentPhase == .connected &&
            didAuthenticate &&
            desired?.channel == .control &&
            trust.enrollmentState == .approved &&
            trust.role == .production &&
            trust.permissions.contains(.observe) &&
            trust.permissions.contains(.controlLocalOBS) &&
            activeSubscription?.channel == .control &&
            activeSubscription?.payloadVersion ==
                TchurchStudioLANLocalOBSSceneContract.payloadVersion &&
            localOBSEnvelopeReady &&
            inFlightRemoteCommand == nil &&
            inFlightOperatorTimerCommand == nil &&
            inFlightLocalBroadcastLowerThirdCommand == nil &&
            inFlightLocalOBSSceneCommand == nil
        return TchurchStudioLANClientStatus(
            phase: privateStateBlocked || revoked ? .failed : currentPhase,
            services: services,
            selectedServiceID: privateStateBlocked || revoked ? nil : selectedServiceID,
            channel: privateStateBlocked || revoked ? nil : desired?.channel,
            paired: paired,
            message: revoked
                ? "Este dispositivo fue revocado en Tchurch Studio."
                : privateStateBlocked
                ? (currentMessage ?? (hasPendingPrivacyPurge
                    ? "Borrando datos privados de Studio antes de continuar…"
                    : "Verificando el acceso local de Studio antes de continuar…"))
                : currentMessage,
            enrollmentState: trust.enrollmentState,
            protocolFloor: trust.protocolFloor,
            role: trust.role,
            permissions: trust.permissions,
            permissionRevision: trust.permissionRevision,
            revocationGeneration: trust.revocationGeneration,
            studioID: trust.studioID,
            remoteControlAvailable: remoteControlAvailable,
            remoteCommandInFlight: inFlightRemoteCommand != nil,
            operatorTimerControlAvailable: operatorTimerControlAvailable,
            operatorTimerCommandInFlight: inFlightOperatorTimerCommand != nil,
            localBroadcastLowerThirdControlAvailable:
                localBroadcastLowerThirdControlAvailable,
            localBroadcastLowerThirdCommandInFlight:
                inFlightLocalBroadcastLowerThirdCommand != nil,
            localOBSSceneControlAvailable: localOBSSceneControlAvailable,
            localOBSSceneCommandInFlight: inFlightLocalOBSSceneCommand != nil
        )
    }
}
