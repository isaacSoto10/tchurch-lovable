import CryptoKit
import Foundation
import Security

enum StudioLANDeviceTrustContract {
    static let schemaVersion = 4
    static let protocolFloor = 4
    static let possessionDomain = "tchurch-studio-lan-device-possession-v4"
    static let maximumGrantLifetimeMilliseconds: Int64 = 12 * 60 * 60 * 1_000
    static let maximumFutureClockSkewMilliseconds: Int64 = 5_000
}

enum StudioLANDeviceRole: String, Codable, CaseIterable, Hashable, Sendable {
    case audience
    case worshipLeader
    case musicians
    case preacher
    case production
}

enum StudioLANDevicePermission: String, Codable, CaseIterable, Hashable, Sendable {
    case observe
    case controlProgram
    case controlLocalOBS
}

enum StudioLANDeviceTrustStatus: String, Codable, CaseIterable, Hashable, Sendable {
    case pending
    case approved
    case revoked
}

enum StudioLANDeviceEnrollmentState: String, Codable, Equatable {
    case unenrolled
    case pending
    case approved
    case revoked
}

enum StudioLANPublicKeyAlgorithm: String, Codable, CaseIterable, Hashable, Sendable {
    case p256Signing
}

enum StudioLANDeviceTrustError: Error, Equatable {
    case identityUnavailable
    case invalidIdentity
    case invalidGrant
    case invalidSignature
    case expiredGrant
    case studioMismatch
    case staleRevision
    case revoked
    case persistenceUnavailable
    case legacyDowngradeDenied
}

struct StudioLANDeviceIdentity: Equatable {
    let deviceID: UUID
    let keyAlgorithm: StudioLANPublicKeyAlgorithm
    let publicKey: String
    let fingerprint: String
    let secureEnclaveBacked: Bool
}

protocol StudioLANDeviceIdentityProviding {
    func loadOrCreate() throws -> StudioLANDeviceIdentity
    func deleteIdentity() throws
    func rotateAfterRevocation() throws -> StudioLANDeviceIdentity
    func signPossessionProof(_ canonicalPayload: Data) throws -> String
}

/// A permanent P-256 signing identity. The private key is referenced by
/// Keychain/Secure Enclave and is never returned as bytes by this API.
final class StudioLANKeychainDeviceIdentityStore: StudioLANDeviceIdentityProviding {
    private struct Metadata: Codable {
        static let schemaVersion = 1

        let schemaVersion: Int
        let deviceID: UUID
    }

    private let keyTag: Data
    private let metadataService: String
    private let metadataAccount = "device-identity-v4"

    init(
        keyTag: String = "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch.studio-lan.device-v4",
        metadataService: String = "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch.studio-lan-device"
    ) {
        self.keyTag = Data(keyTag.utf8)
        self.metadataService = metadataService
    }

    func loadOrCreate() throws -> StudioLANDeviceIdentity {
        let metadata = try loadOrCreateMetadata()
        let privateKey: SecKey
        let secureEnclaveBacked: Bool
        if let existing = try readPrivateKey() {
            privateKey = existing
            secureEnclaveBacked = isSecureEnclaveKey(existing)
        } else {
            let generated = try generatePrivateKey()
            privateKey = generated.key
            secureEnclaveBacked = generated.secureEnclaveBacked
        }
        return try identity(
            deviceID: metadata.deviceID,
            privateKey: privateKey,
            secureEnclaveBacked: secureEnclaveBacked
        )
    }

    /// Permanently retires both parts of the revoked identity. A reapproval
    /// must never reuse either its device UUID or its P-256 private key.
    func deleteIdentity() throws {
        let keyStatus = SecItemDelete(privateKeyQuery as CFDictionary)
        guard keyStatus == errSecSuccess || keyStatus == errSecItemNotFound else {
            throw StudioLANDeviceTrustError.identityUnavailable
        }
        let metadataStatus = SecItemDelete(metadataQuery as CFDictionary)
        guard metadataStatus == errSecSuccess || metadataStatus == errSecItemNotFound else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
    }

    func rotateAfterRevocation() throws -> StudioLANDeviceIdentity {
        try deleteIdentity()
        return try loadOrCreate()
    }

    func signPossessionProof(_ canonicalPayload: Data) throws -> String {
        guard !canonicalPayload.isEmpty,
              canonicalPayload.count <= 64 * 1_024,
              let privateKey = try readPrivateKey(),
              SecKeyIsAlgorithmSupported(
                privateKey,
                .sign,
                .ecdsaSignatureMessageX962SHA256
              ) else {
            throw StudioLANDeviceTrustError.identityUnavailable
        }
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            canonicalPayload as CFData,
            &error
        ) as Data? else {
            throw StudioLANDeviceTrustError.identityUnavailable
        }
        // SecKey's X9.62 ECDSA output is ASN.1 DER, as required by LAN v4.
        return signature.base64EncodedString()
    }

    private func identity(
        deviceID: UUID,
        privateKey: SecKey,
        secureEnclaveBacked: Bool
    ) throws -> StudioLANDeviceIdentity {
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw StudioLANDeviceTrustError.invalidIdentity
        }
        var error: Unmanaged<CFError>?
        guard let external = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
              external.count == 65,
              external.first == 0x04 else {
            throw StudioLANDeviceTrustError.invalidIdentity
        }
        return StudioLANDeviceIdentity(
            deviceID: deviceID,
            keyAlgorithm: .p256Signing,
            publicKey: external.base64EncodedString(),
            fingerprint: StudioLANDeviceGrant.fingerprint(forPublicKeyData: external),
            secureEnclaveBacked: secureEnclaveBacked
        )
    }

    private func readPrivateKey() throws -> SecKey? {
        var query = privateKeyQuery
        query.merge([
            kSecReturnRef as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]) { _, new in new }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let key = result else {
            throw StudioLANDeviceTrustError.identityUnavailable
        }
        return (key as! SecKey)
    }

    private func generatePrivateKey() throws -> (key: SecKey, secureEnclaveBacked: Bool) {
#if !targetEnvironment(simulator)
        if let key = try generateSecureEnclaveKey() {
            return (key, true)
        }
#endif
        var error: Unmanaged<CFError>?
        let privateAttributes: [String: Any] = [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: keyTag,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrIsSensitive as String: true,
            kSecAttrIsExtractable as String: false,
        ]
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: privateAttributes,
        ]
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            // Another process/attempt may have persisted the same tag between
            // our read and generation. Resolve that race without rotating it.
            if let existing = try readPrivateKey() { return (existing, isSecureEnclaveKey(existing)) }
            throw StudioLANDeviceTrustError.identityUnavailable
        }
        return (key, false)
    }

#if !targetEnvironment(simulator)
    private func generateSecureEnclaveKey() throws -> SecKey? {
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            .privateKeyUsage,
            &accessError
        ) else { return nil }
        var error: Unmanaged<CFError>?
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: keyTag,
                kSecAttrAccessControl as String: access,
            ],
        ]
        return SecKeyCreateRandomKey(attributes as CFDictionary, &error)
    }
#endif

    private func isSecureEnclaveKey(_ key: SecKey) -> Bool {
        guard let attributes = SecKeyCopyAttributes(key) as? [String: Any] else { return false }
        return (attributes[kSecAttrTokenID as String] as? String) == (kSecAttrTokenIDSecureEnclave as String)
    }

    private func loadOrCreateMetadata() throws -> Metadata {
        var query = metadataQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess,
           let data = result as? Data,
           data.count <= 1_024,
           let metadata = try? TchurchStudioLANCoding.decoder().decode(Metadata.self, from: data),
           metadata.schemaVersion == Metadata.schemaVersion {
            return metadata
        }
        guard status == errSecItemNotFound else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        let metadata = Metadata(schemaVersion: Metadata.schemaVersion, deviceID: UUID())
        let data = try TchurchStudioLANCoding.encoder().encode(metadata)
        var inserted = metadataQuery
        inserted[kSecValueData as String] = data
        inserted[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let insertion = SecItemAdd(inserted as CFDictionary, nil)
        if insertion == errSecDuplicateItem { return try loadOrCreateMetadata() }
        guard insertion == errSecSuccess else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        return metadata
    }

    private var metadataQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: metadataService,
            kSecAttrAccount as String: metadataAccount,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    private var privateKeyQuery: [String: Any] {
        [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: keyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
    }
}

struct StudioLANDeviceGrant: Codable, Equatable {
    static let schemaVersion = StudioLANDeviceTrustContract.schemaVersion

    let schemaVersion: Int
    let protocolFloor: Int
    let grantID: UUID
    let deviceID: UUID
    let deviceName: String
    let role: StudioLANDeviceRole
    let permissions: [StudioLANDevicePermission]
    let keyAlgorithm: StudioLANPublicKeyAlgorithm
    let devicePublicKey: String
    let devicePublicKeyFingerprint: String
    let studioID: UUID
    let studioSigningKeyID: String
    let studioSigningPublicKey: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let signature: String

    fileprivate struct SigningPayload: Codable {
        let schemaVersion: Int
        let protocolFloor: Int
        let grantID: UUID
        let deviceID: UUID
        let deviceName: String
        let role: StudioLANDeviceRole
        let permissions: [StudioLANDevicePermission]
        let keyAlgorithm: StudioLANPublicKeyAlgorithm
        let devicePublicKey: String
        let devicePublicKeyFingerprint: String
        let studioID: UUID
        let studioSigningKeyID: String
        let studioSigningPublicKey: String
        let permissionRevision: UInt64
        let revocationGeneration: UInt64
        let issuedAtMilliseconds: Int64
        let expiresAtMilliseconds: Int64
    }

    func canonicalSigningData() throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(SigningPayload(
            schemaVersion: schemaVersion,
            protocolFloor: protocolFloor,
            grantID: grantID,
            deviceID: deviceID,
            deviceName: deviceName,
            role: role,
            permissions: permissions,
            keyAlgorithm: keyAlgorithm,
            devicePublicKey: devicePublicKey,
            devicePublicKeyFingerprint: devicePublicKeyFingerprint,
            studioID: studioID,
            studioSigningKeyID: studioSigningKeyID,
            studioSigningPublicKey: studioSigningPublicKey,
            permissionRevision: permissionRevision,
            revocationGeneration: revocationGeneration,
            issuedAtMilliseconds: issuedAtMilliseconds,
            expiresAtMilliseconds: expiresAtMilliseconds
        ))
    }

    static func fingerprint(forPublicKeyData data: Data) -> String {
        "sha256:\(TchurchStudioLANCrypto.sha256Hex(data))"
    }

    func verify(
        identity: StudioLANDeviceIdentity,
        nowMilliseconds: Int64,
        pinnedStudioID: UUID? = nil,
        pinnedStudioSigningPublicKey: String? = nil
    ) throws {
        let normalizedPermissions = StudioLANDevicePermission.allCases.filter(permissions.contains)
        let futureIssuedAtOffset = issuedAtMilliseconds.subtractingReportingOverflow(
            nowMilliseconds
        )
        let issuedAtIsCurrent = issuedAtMilliseconds <= nowMilliseconds ||
            (!futureIssuedAtOffset.overflow &&
                futureIssuedAtOffset.partialValue <=
                    StudioLANDeviceTrustContract.maximumFutureClockSkewMilliseconds)
        guard schemaVersion == Self.schemaVersion,
              protocolFloor == StudioLANDeviceTrustContract.protocolFloor,
              deviceID == identity.deviceID,
              keyAlgorithm == .p256Signing,
              deviceName.utf8.count > 0,
              deviceName.utf8.count <= 128,
              deviceName == deviceName.trimmingCharacters(in: .whitespacesAndNewlines),
              !deviceName.unicodeScalars.contains(where: {
                  $0.properties.generalCategory == .control
              }),
              permissions == normalizedPermissions,
              Set(permissions.map(\.rawValue)).count == permissions.count,
              permissions.contains(.observe),
              devicePublicKey == identity.publicKey,
              devicePublicKeyFingerprint == identity.fingerprint,
              Self.validFingerprint(devicePublicKeyFingerprint),
              let deviceKeyData = Data(base64Encoded: devicePublicKey),
              deviceKeyData.count == 65,
              deviceKeyData.first == 0x04,
              deviceKeyData.base64EncodedString() == devicePublicKey,
              (try? P256.Signing.PublicKey(x963Representation: deviceKeyData)) != nil,
              Self.fingerprint(forPublicKeyData: deviceKeyData) == devicePublicKeyFingerprint,
              permissionRevision > 0,
              issuedAtMilliseconds > 0,
              expiresAtMilliseconds > issuedAtMilliseconds,
              expiresAtMilliseconds - issuedAtMilliseconds <= StudioLANDeviceTrustContract.maximumGrantLifetimeMilliseconds,
              issuedAtIsCurrent,
              nowMilliseconds < expiresAtMilliseconds,
              !studioSigningKeyID.isEmpty,
              studioSigningKeyID.utf8.count <= 160,
              pinnedStudioID.map({ $0 == studioID }) ?? true,
              pinnedStudioSigningPublicKey.map({ $0 == studioSigningPublicKey }) ?? true,
              let publicKeyData = Data(base64Encoded: studioSigningPublicKey),
              publicKeyData.count == 32,
              publicKeyData.base64EncodedString() == studioSigningPublicKey,
              String(TchurchStudioLANCrypto.sha256Hex(publicKeyData).prefix(24)) == studioSigningKeyID,
              let signatureData = Data(base64Encoded: signature),
              signatureData.count == 64,
              signatureData.base64EncodedString() == signature,
              let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData) else {
            throw expiresAtMilliseconds <= nowMilliseconds
                ? StudioLANDeviceTrustError.expiredGrant
                : StudioLANDeviceTrustError.invalidGrant
        }
        let canonical = try canonicalSigningData()
        guard publicKey.isValidSignature(signatureData, for: canonical) else {
            throw StudioLANDeviceTrustError.invalidSignature
        }
    }

    private static func validFingerprint(_ value: String) -> Bool {
        guard value.hasPrefix("sha256:") else { return false }
        let digest = value.dropFirst("sha256:".count)
        return digest.utf8.count == 64 && digest.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }
}

struct StudioLANDeviceAttestation: Codable, Equatable {
    static let schemaVersion = StudioLANDeviceTrustContract.schemaVersion

    let schemaVersion: Int
    let deviceID: UUID
    let requestedRole: StudioLANDeviceRole
    let keyAlgorithm: StudioLANPublicKeyAlgorithm
    let devicePublicKey: String
    let devicePublicKeyFingerprint: String
    let presentedGrant: StudioLANDeviceGrant?
    /// ASN.1 DER encoded P-256 ECDSA signature, represented as Base64.
    let proof: String
}

struct StudioLANDevicePossessionProof: Codable, Equatable {
    static let schemaVersion = StudioLANDeviceTrustContract.schemaVersion

    let schemaVersion: Int
    let domain: String
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let supportedPayloadVersions: [Int]
    let deviceID: UUID
    let requestedRole: StudioLANDeviceRole
    let keyAlgorithm: StudioLANPublicKeyAlgorithm
    let devicePublicKey: String
    let devicePublicKeyFingerprint: String
    let presentedGrantChecksum: String?
}

struct StudioLANDeviceTrustRecord: Codable, Equatable {
    static let schemaVersion = StudioLANDeviceTrustContract.schemaVersion
    static let protocolFloor = StudioLANDeviceTrustContract.protocolFloor

    let schemaVersion: Int
    let protocolFloor: Int
    let status: StudioLANDeviceTrustStatus
    let deviceID: UUID
    let devicePublicKeyFingerprint: String
    let studioID: UUID?
    let grant: StudioLANDeviceGrant?
    let permissionRevision: UInt64
    let revocationGeneration: UInt64

    var isStructurallyValid: Bool {
        schemaVersion == Self.schemaVersion &&
            protocolFloor == Self.protocolFloor &&
            devicePublicKeyFingerprint.hasPrefix("sha256:") &&
            devicePublicKeyFingerprint.utf8.count == 71 &&
            (status != .approved || grant != nil) &&
            (grant == nil || grant?.deviceID == deviceID) &&
            (grant == nil || grant?.devicePublicKeyFingerprint == devicePublicKeyFingerprint) &&
            (grant == nil || studioID == grant?.studioID) &&
            (grant == nil || permissionRevision == grant?.permissionRevision) &&
            (grant == nil || revocationGeneration >= grant?.revocationGeneration ?? 0)
    }
}

struct StudioLANDeviceTrustProtocolFloorState: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let protocolFloor: Int

    var isStructurallyValid: Bool {
        schemaVersion == Self.schemaVersion && (1 ... StudioLANDeviceTrustContract.protocolFloor).contains(protocolFloor)
    }
}

enum StudioLANDeviceTrustRecoveryIntent: String, Codable, Equatable {
    case purgePrivateState
    case reapproveRevokedIdentity
}

/// A grant-free write-ahead marker. It makes destructive identity changes
/// restartable without ever persisting authority that could be resurrected.
struct StudioLANDeviceTrustRecoveryMarker: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let intent: StudioLANDeviceTrustRecoveryIntent
    let protocolFloor: Int
    let revokedDeviceID: UUID?
    let revokedPublicKeyFingerprint: String?
    let studioID: UUID?

    var isStructurallyValid: Bool {
        guard schemaVersion == Self.schemaVersion,
              (1 ... StudioLANDeviceTrustContract.protocolFloor).contains(protocolFloor) else {
            return false
        }
        switch intent {
        case .purgePrivateState:
            return revokedDeviceID == nil && revokedPublicKeyFingerprint == nil && studioID == nil
        case .reapproveRevokedIdentity:
            guard protocolFloor == StudioLANDeviceTrustContract.protocolFloor,
                  revokedDeviceID != nil,
                  let fingerprint = revokedPublicKeyFingerprint,
                  studioID != nil else {
                return false
            }
            return fingerprint.hasPrefix("sha256:") && fingerprint.utf8.count == 71
        }
    }
}

protocol StudioLANDeviceTrustStateStoring {
    func read() throws -> StudioLANDeviceTrustRecord?
    func write(_ state: StudioLANDeviceTrustRecord) throws
    func delete() throws
    func readProtocolFloor() throws -> Int?
    func writeProtocolFloor(_ protocolFloor: Int) throws
    func readRecoveryMarker() throws -> StudioLANDeviceTrustRecoveryMarker?
    func writeRecoveryMarker(_ marker: StudioLANDeviceTrustRecoveryMarker) throws
    func deleteRecoveryMarker() throws
}

final class StudioLANKeychainDeviceTrustStateStore: StudioLANDeviceTrustStateStoring {
    private let service: String
    private let recordAccount = "device-trust-v4"
    private let protocolFloorAccount = "protocol-floor-v1"
    private let recoveryMarkerAccount = "identity-recovery-v1"

    init(
        service: String = "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch.studio-lan-device"
    ) {
        self.service = service
    }

    func read() throws -> StudioLANDeviceTrustRecord? {
        guard let data = try readData(account: recordAccount) else { return nil }
        guard
              let state = try? TchurchStudioLANCoding.decoder().decode(
                StudioLANDeviceTrustRecord.self,
                from: data
              ),
              state.isStructurallyValid else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        return state
    }

    func write(_ state: StudioLANDeviceTrustRecord) throws {
        guard state.isStructurallyValid else { throw StudioLANDeviceTrustError.persistenceUnavailable }
        let data = try TchurchStudioLANCoding.encoder().encode(state)
        try writeData(data, account: recordAccount)
    }

    func delete() throws {
        try deleteData(account: recordAccount)
    }

    func readProtocolFloor() throws -> Int? {
        guard let data = try readData(account: protocolFloorAccount) else { return nil }
        guard let state = try? TchurchStudioLANCoding.decoder().decode(
                StudioLANDeviceTrustProtocolFloorState.self,
                from: data
              ),
              state.isStructurallyValid else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        return state.protocolFloor
    }

    func writeProtocolFloor(_ protocolFloor: Int) throws {
        let state = StudioLANDeviceTrustProtocolFloorState(
            schemaVersion: StudioLANDeviceTrustProtocolFloorState.schemaVersion,
            protocolFloor: protocolFloor
        )
        guard state.isStructurallyValid,
              protocolFloor >= (try readProtocolFloor() ?? 1) else {
            throw StudioLANDeviceTrustError.legacyDowngradeDenied
        }
        try writeData(
            TchurchStudioLANCoding.encoder().encode(state),
            account: protocolFloorAccount
        )
    }

    func readRecoveryMarker() throws -> StudioLANDeviceTrustRecoveryMarker? {
        guard let data = try readData(account: recoveryMarkerAccount) else { return nil }
        guard let marker = try? TchurchStudioLANCoding.decoder().decode(
            StudioLANDeviceTrustRecoveryMarker.self,
            from: data
        ), marker.isStructurallyValid else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        return marker
    }

    func writeRecoveryMarker(_ marker: StudioLANDeviceTrustRecoveryMarker) throws {
        guard marker.isStructurallyValid else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        try writeData(
            TchurchStudioLANCoding.encoder().encode(marker),
            account: recoveryMarkerAccount
        )
    }

    func deleteRecoveryMarker() throws {
        try deleteData(account: recoveryMarkerAccount)
    }

    private func readData(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = result as? Data,
              data.count <= 32 * 1_024 else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        return data
    }

    private func writeData(_ data: Data, account: String) throws {
        guard data.count <= 32 * 1_024 else { throw StudioLANDeviceTrustError.persistenceUnavailable }
        let query = baseQuery(account: account)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecItemNotFound {
            var inserted = query
            inserted[kSecValueData as String] = data
            inserted[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(inserted as CFDictionary, nil) == errSecSuccess else {
                throw StudioLANDeviceTrustError.persistenceUnavailable
            }
        } else if update != errSecSuccess {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
    }

    private func deleteData(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }
}

struct StudioLANDeviceTrustSnapshot: Equatable {
    let enrollmentState: StudioLANDeviceEnrollmentState
    let protocolFloor: Int
    let deviceID: UUID?
    let devicePublicKeyFingerprint: String?
    let studioID: UUID?
    let role: StudioLANDeviceRole?
    let permissions: [StudioLANDevicePermission]
    let permissionRevision: UInt64
    let revocationGeneration: UInt64

    static let unenrolled = StudioLANDeviceTrustSnapshot(
        enrollmentState: .unenrolled,
        protocolFloor: 1,
        deviceID: nil,
        devicePublicKeyFingerprint: nil,
        studioID: nil,
        role: nil,
        permissions: [],
        permissionRevision: 0,
        revocationGeneration: 0
    )
}

/// Owns the sticky v4 boundary. Once a record exists, no code path may write a
/// lower floor or authorize a v1-v3 fallback, including after app restarts.
final class StudioLANDeviceTrustController {
    private let identityProvider: StudioLANDeviceIdentityProviding
    private let stateStore: StudioLANDeviceTrustStateStoring
    private(set) var record: StudioLANDeviceTrustRecord?
    private(set) var protocolFloor: Int

    init(
        identityProvider: StudioLANDeviceIdentityProviding = StudioLANKeychainDeviceIdentityStore(),
        stateStore: StudioLANDeviceTrustStateStoring = StudioLANKeychainDeviceTrustStateStore()
    ) throws {
        self.identityProvider = identityProvider
        self.stateStore = stateStore
        record = try stateStore.read()
        protocolFloor = try stateStore.readProtocolFloor() ?? 1
        if let record, protocolFloor < record.protocolFloor {
            try stateStore.writeProtocolFloor(record.protocolFloor)
            protocolFloor = record.protocolFloor
        }
        if let marker = try stateStore.readRecoveryMarker() {
            protocolFloor = max(protocolFloor, marker.protocolFloor)
            _ = try completeRecovery(marker)
        } else if let record {
            let identity = try identityProvider.loadOrCreate()
            guard record.deviceID == identity.deviceID,
                  record.devicePublicKeyFingerprint == identity.fingerprint else {
                throw StudioLANDeviceTrustError.invalidIdentity
            }
        }
    }

    var snapshot: StudioLANDeviceTrustSnapshot {
        guard let record else {
            return StudioLANDeviceTrustSnapshot(
                enrollmentState: .unenrolled,
                protocolFloor: protocolFloor,
                deviceID: nil,
                devicePublicKeyFingerprint: nil,
                studioID: nil,
                role: nil,
                permissions: [],
                permissionRevision: 0,
                revocationGeneration: 0
            )
        }
        let state: StudioLANDeviceEnrollmentState
        switch record.status {
        case .pending: state = .pending
        case .approved: state = .approved
        case .revoked: state = .revoked
        }
        return StudioLANDeviceTrustSnapshot(
            enrollmentState: state,
            protocolFloor: record.protocolFloor,
            deviceID: record.deviceID,
            devicePublicKeyFingerprint: record.devicePublicKeyFingerprint,
            studioID: record.studioID,
            role: record.grant?.role,
            permissions: record.grant?.permissions ?? [],
            permissionRevision: record.permissionRevision,
            revocationGeneration: record.revocationGeneration
        )
    }

    var permitsLegacyFallback: Bool { record == nil && protocolFloor < StudioLANDeviceTrustContract.protocolFloor }

    var presentedGrant: StudioLANDeviceGrant? {
        guard record?.status == .approved else { return nil }
        return record?.grant
    }

    @discardableResult
    func beginEnrollment(studioID: UUID? = nil) throws -> StudioLANDeviceIdentity {
        if record?.status == .revoked { throw StudioLANDeviceTrustError.revoked }
        try raiseProtocolFloor(to: StudioLANDeviceTrustContract.protocolFloor)
        let identity = try identityProvider.loadOrCreate()
        if let current = record {
            guard current.deviceID == identity.deviceID,
                  current.devicePublicKeyFingerprint == identity.fingerprint,
                  current.studioID.map({ studioID == nil || $0 == studioID }) ?? true else {
                throw StudioLANDeviceTrustError.studioMismatch
            }
            if current.studioID == nil, let studioID {
                let bound = StudioLANDeviceTrustRecord(
                    schemaVersion: current.schemaVersion,
                    protocolFloor: current.protocolFloor,
                    status: current.status,
                    deviceID: current.deviceID,
                    devicePublicKeyFingerprint: current.devicePublicKeyFingerprint,
                    studioID: studioID,
                    grant: current.grant,
                    permissionRevision: current.permissionRevision,
                    revocationGeneration: current.revocationGeneration
                )
                try stateStore.write(bound)
                record = bound
            }
            return identity
        }
        let next = StudioLANDeviceTrustRecord(
            schemaVersion: StudioLANDeviceTrustRecord.schemaVersion,
            protocolFloor: StudioLANDeviceTrustRecord.protocolFloor,
            status: .pending,
            deviceID: identity.deviceID,
            devicePublicKeyFingerprint: identity.fingerprint,
            studioID: studioID,
            grant: nil,
            permissionRevision: 0,
            revocationGeneration: 0
        )
        try stateStore.write(next)
        record = next
        return identity
    }

    func signPossessionProof(_ canonicalPayload: Data) throws -> String {
        guard record != nil else { throw StudioLANDeviceTrustError.invalidIdentity }
        return try identityProvider.signPossessionProof(canonicalPayload)
    }

    func makeAttestation(
        challenge: TchurchStudioLANServerChallenge,
        requestID: UUID,
        clientName: String,
        channel: TchurchStudioLANChannel,
        clientNonce: String,
        supportedPayloadVersions: [Int],
        requestedRole: StudioLANDeviceRole
    ) throws -> StudioLANDeviceAttestation {
        guard challenge.deviceTrustVersion == StudioLANDeviceTrustContract.schemaVersion,
              challenge.minimumPayloadVersion == StudioLANDeviceTrustContract.protocolFloor,
              let studioID = challenge.studioID,
              supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions ||
                supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions ||
                supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions ||
                supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions,
              requestedRole.channel == channel else {
            throw StudioLANDeviceTrustError.invalidGrant
        }
        let identity = try beginEnrollment(studioID: studioID)
        let grant = presentedGrant
        if let grant {
            try grant.verify(
                identity: identity,
                nowMilliseconds: TchurchStudioLANTime.nowMilliseconds(),
                pinnedStudioID: studioID,
                pinnedStudioSigningPublicKey: record?.grant?.studioSigningPublicKey
            )
        }
        let grantChecksum = try grant.map {
            "sha256:\(TchurchStudioLANCrypto.sha256Hex(try TchurchStudioLANCoding.encoder().encode($0)))"
        }
        let material = StudioLANDevicePossessionProof(
            schemaVersion: StudioLANDevicePossessionProof.schemaVersion,
            domain: StudioLANDeviceTrustContract.possessionDomain,
            challenge: challenge,
            requestID: requestID,
            clientID: identity.deviceID,
            clientName: clientName,
            channel: channel,
            clientNonce: clientNonce,
            supportedPayloadVersions: supportedPayloadVersions,
            deviceID: identity.deviceID,
            requestedRole: requestedRole,
            keyAlgorithm: identity.keyAlgorithm,
            devicePublicKey: identity.publicKey,
            devicePublicKeyFingerprint: identity.fingerprint,
            presentedGrantChecksum: grantChecksum
        )
        let proof = try signPossessionProof(
            TchurchStudioLANCoding.encoder().encode(material)
        )
        return StudioLANDeviceAttestation(
            schemaVersion: StudioLANDeviceAttestation.schemaVersion,
            deviceID: identity.deviceID,
            requestedRole: requestedRole,
            keyAlgorithm: identity.keyAlgorithm,
            devicePublicKey: identity.publicKey,
            devicePublicKeyFingerprint: identity.fingerprint,
            presentedGrant: grant,
            proof: proof
        )
    }

    func accept(_ grant: StudioLANDeviceGrant, nowMilliseconds: Int64) throws {
        if record?.status == .revoked { throw StudioLANDeviceTrustError.revoked }
        let identity = try beginEnrollment(studioID: grant.studioID)
        let previous = record
        try grant.verify(
            identity: identity,
            nowMilliseconds: nowMilliseconds,
            pinnedStudioID: previous?.studioID,
            pinnedStudioSigningPublicKey: previous?.grant?.studioSigningPublicKey
        )
        guard grant.permissionRevision >= previous?.permissionRevision ?? 0,
              grant.revocationGeneration >= previous?.revocationGeneration ?? 0 else {
            throw StudioLANDeviceTrustError.staleRevision
        }
        let next = StudioLANDeviceTrustRecord(
            schemaVersion: StudioLANDeviceTrustRecord.schemaVersion,
            protocolFloor: StudioLANDeviceTrustRecord.protocolFloor,
            status: .approved,
            deviceID: identity.deviceID,
            devicePublicKeyFingerprint: identity.fingerprint,
            studioID: grant.studioID,
            grant: grant,
            permissionRevision: grant.permissionRevision,
            revocationGeneration: grant.revocationGeneration
        )
        try stateStore.write(next)
        record = next
    }

    func markPendingForApproval(studioID: UUID) throws {
        guard let current = record,
              current.status != .revoked,
              current.studioID == nil || current.studioID == studioID else {
            throw StudioLANDeviceTrustError.studioMismatch
        }
        let next = StudioLANDeviceTrustRecord(
            schemaVersion: StudioLANDeviceTrustRecord.schemaVersion,
            protocolFloor: StudioLANDeviceTrustRecord.protocolFloor,
            status: .pending,
            deviceID: current.deviceID,
            devicePublicKeyFingerprint: current.devicePublicKeyFingerprint,
            studioID: studioID,
            grant: current.grant,
            permissionRevision: current.permissionRevision,
            revocationGeneration: current.revocationGeneration
        )
        try stateStore.write(next)
        record = next
    }

    /// A revoked identity remains terminal. Explicit reapproval therefore
    /// rotates the hardware-backed signing key and device UUID, then creates a
    /// fresh pending record while retaining the non-downgrade protocol floor.
    @discardableResult
    func rotateRevokedIdentityForReapproval() throws -> StudioLANDeviceIdentity {
        guard let current = record,
              current.status == .revoked,
              let studioID = current.studioID else {
            throw StudioLANDeviceTrustError.revoked
        }
        try raiseProtocolFloor(to: StudioLANDeviceTrustContract.protocolFloor)
        let marker = StudioLANDeviceTrustRecoveryMarker(
            schemaVersion: StudioLANDeviceTrustRecoveryMarker.schemaVersion,
            intent: .reapproveRevokedIdentity,
            protocolFloor: protocolFloor,
            revokedDeviceID: current.deviceID,
            revokedPublicKeyFingerprint: current.devicePublicKeyFingerprint,
            studioID: studioID
        )
        try stateStore.writeRecoveryMarker(marker)
        guard let identity = try completeRecovery(marker) else {
            throw StudioLANDeviceTrustError.identityUnavailable
        }
        return identity
    }

    /// Removes every account/church-owned trust artifact. The protocol floor is
    /// intentionally the only durable survivor, so another principal can never
    /// inherit a grant, device UUID, or P-256 key.
    func purgePrivateTrustPreservingProtocolFloor() throws {
        try refreshProtocolFloor()
        let retainedFloor = max(protocolFloor, record?.protocolFloor ?? 1)
        try raiseProtocolFloor(to: retainedFloor)
        let marker = StudioLANDeviceTrustRecoveryMarker(
            schemaVersion: StudioLANDeviceTrustRecoveryMarker.schemaVersion,
            intent: .purgePrivateState,
            protocolFloor: retainedFloor,
            revokedDeviceID: nil,
            revokedPublicKeyFingerprint: nil,
            studioID: nil
        )
        // A privacy purge supersedes an interrupted reapproval for the previous
        // principal. Replacing the grant-free marker remains fail-closed.
        try stateStore.writeRecoveryMarker(marker)
        _ = try completeRecovery(marker)
    }

    /// Revocation is terminal for this persisted device identity. A later
    /// grant cannot silently resurrect it or lower the generation counter.
    @discardableResult
    func revoke(studioID: UUID, revocationGeneration: UInt64) throws -> Bool {
        guard let current = record,
              current.studioID == nil || current.studioID == studioID else {
            throw StudioLANDeviceTrustError.studioMismatch
        }
        if current.status == .revoked {
            guard revocationGeneration >= current.revocationGeneration else {
                throw StudioLANDeviceTrustError.staleRevision
            }
            return false
        }
        guard revocationGeneration >= current.revocationGeneration else {
            throw StudioLANDeviceTrustError.staleRevision
        }
        let next = StudioLANDeviceTrustRecord(
            schemaVersion: StudioLANDeviceTrustRecord.schemaVersion,
            protocolFloor: StudioLANDeviceTrustRecord.protocolFloor,
            status: .revoked,
            deviceID: current.deviceID,
            devicePublicKeyFingerprint: current.devicePublicKeyFingerprint,
            studioID: studioID,
            grant: current.grant,
            permissionRevision: current.permissionRevision,
            revocationGeneration: revocationGeneration
        )
        try stateStore.write(next)
        record = next
        return true
    }

    func requireLegacyFallbackAllowed() throws {
        guard permitsLegacyFallback else { throw StudioLANDeviceTrustError.legacyDowngradeDenied }
    }

    private func raiseProtocolFloor(to nextFloor: Int) throws {
        try refreshProtocolFloor()
        guard nextFloor >= protocolFloor,
              (1 ... StudioLANDeviceTrustContract.protocolFloor).contains(nextFloor) else {
            throw StudioLANDeviceTrustError.legacyDowngradeDenied
        }
        guard nextFloor != protocolFloor else { return }
        try stateStore.writeProtocolFloor(nextFloor)
        protocolFloor = nextFloor
    }

    private func refreshProtocolFloor() throws {
        protocolFloor = max(protocolFloor, try stateStore.readProtocolFloor() ?? 1)
    }

    @discardableResult
    private func completeRecovery(
        _ marker: StudioLANDeviceTrustRecoveryMarker
    ) throws -> StudioLANDeviceIdentity? {
        guard marker.isStructurallyValid else {
            throw StudioLANDeviceTrustError.persistenceUnavailable
        }
        try refreshProtocolFloor()
        try raiseProtocolFloor(to: max(protocolFloor, marker.protocolFloor))
        switch marker.intent {
        case .purgePrivateState:
            try stateStore.delete()
            record = nil
            try identityProvider.deleteIdentity()
            try stateStore.deleteRecoveryMarker()
            return nil

        case .reapproveRevokedIdentity:
            guard let revokedDeviceID = marker.revokedDeviceID,
                  let revokedFingerprint = marker.revokedPublicKeyFingerprint,
                  let studioID = marker.studioID else {
                throw StudioLANDeviceTrustError.persistenceUnavailable
            }
            var identity = try identityProvider.loadOrCreate()
            // A crash can split deletion of Keychain metadata from deletion of
            // the P-256 item. Matching either old component forces another full
            // retirement before a pending record may be written.
            if identity.deviceID == revokedDeviceID || identity.fingerprint == revokedFingerprint {
                identity = try identityProvider.rotateAfterRevocation()
            }
            guard identity.deviceID != revokedDeviceID,
                  identity.fingerprint != revokedFingerprint else {
                throw StudioLANDeviceTrustError.invalidIdentity
            }
            let pending = StudioLANDeviceTrustRecord(
                schemaVersion: StudioLANDeviceTrustRecord.schemaVersion,
                protocolFloor: StudioLANDeviceTrustRecord.protocolFloor,
                status: .pending,
                deviceID: identity.deviceID,
                devicePublicKeyFingerprint: identity.fingerprint,
                studioID: studioID,
                grant: nil,
                permissionRevision: 0,
                revocationGeneration: 0
            )
            try stateStore.write(pending)
            record = pending
            try stateStore.deleteRecoveryMarker()
            return identity
        }
    }
}

extension StudioLANDeviceRole {
    var channel: TchurchStudioLANChannel {
        switch self {
        case .audience: return .audience
        case .worshipLeader, .musicians, .preacher: return .stage
        case .production: return .control
        }
    }
}
