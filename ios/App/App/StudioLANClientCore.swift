import CryptoKit
import Foundation
import Security

enum TchurchStudioLANError: Error, Equatable {
    case invalidConfiguration
    case invalidPairingCode
    case entropyUnavailable
    case invalidChallenge
    case expiredChallenge
    case invalidAuthenticationProof
    case invalidSubscription
    case unsupportedChannel
    case authorityMismatch
    case staleAuthorityEpoch
    case staleRevision
    case replayedEnvelope
    case invalidEnvelope
    case invalidChecksum
    case invalidSignature
    case wrongChannel
    case invalidPayload
    case invalidFrameLength(Int)
    case inputBufferLimitExceeded
    case protocolViolation
}

enum TchurchStudioLANChannel: String, Codable, Equatable {
    case audience
    case stage
    case control

    var isReadOnlyOutput: Bool { self == .audience || self == .stage }
}

struct TchurchStudioLANAuthority: Codable, Equatable {
    let runID: UUID
    let authorityEpoch: UInt64
    let packageID: String
    let serviceVersion: String
}

struct TchurchStudioLANTimer: Codable, Equatable {
    enum Mode: String, Codable {
        case countUp
        case countDown
    }

    let id: String
    let label: String
    let mode: Mode
    let anchorDate: Date
    let anchorValueMilliseconds: Int64
    let durationMilliseconds: Int64?
    let isRunning: Bool
}

struct TchurchStudioLANCountdown: Codable, Equatable {
    let id: String
    let label: String
    let targetDate: Date
}

struct TchurchStudioLANAudienceSnapshot: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let runID: UUID
    let authorityEpoch: UInt64
    let packageID: String
    let serviceVersion: String
    let revision: UInt64
    let currentCueID: String?
    let currentCueIndex: Int?
    let cueCount: Int
    let isBlackout: Bool
    let countdown: TchurchStudioLANCountdown?
}

struct TchurchStudioLANPublicCue: Codable, Equatable {
    let cueID: String
    let title: String?
    let lines: [String]
    let mediaAssetID: String?
}

struct TchurchStudioLANAudiencePayload: Codable, Equatable {
    let snapshot: TchurchStudioLANAudienceSnapshot
    let cue: TchurchStudioLANPublicCue?
}

struct TchurchStudioLANStageSupplement: Codable, Equatable {
    let nextCue: TchurchStudioLANPublicCue?
    let chordLines: [String]
    let timers: [TchurchStudioLANTimer]
    let message: String?
}

struct TchurchStudioLANStagePayload: Codable, Equatable {
    let audience: TchurchStudioLANAudiencePayload
    let stage: TchurchStudioLANStageSupplement
}

enum TchurchStudioLANChannelPayload: Codable, Equatable {
    case audience(TchurchStudioLANAudiencePayload)
    case stage(TchurchStudioLANStagePayload)

    var channel: TchurchStudioLANChannel {
        switch self {
        case .audience: return .audience
        case .stage: return .stage
        }
    }

    var audience: TchurchStudioLANAudiencePayload {
        switch self {
        case .audience(let payload): return payload
        case .stage(let payload): return payload.audience
        }
    }

    var stage: TchurchStudioLANStageSupplement? {
        guard case .stage(let payload) = self else { return nil }
        return payload.stage
    }

    private enum CodingKeys: String, CodingKey {
        case channel
        case audience
        case stage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(TchurchStudioLANChannel.self, forKey: .channel) {
        case .audience:
            self = .audience(try container.decode(TchurchStudioLANAudiencePayload.self, forKey: .audience))
        case .stage:
            self = .stage(try container.decode(TchurchStudioLANStagePayload.self, forKey: .stage))
        case .control:
            throw TchurchStudioLANError.unsupportedChannel
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(channel, forKey: .channel)
        switch self {
        case .audience(let payload):
            try container.encode(payload, forKey: .audience)
        case .stage(let payload):
            try container.encode(payload, forKey: .stage)
        }
    }
}

struct TchurchStudioLANServerChallenge: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let challengeID: UUID
    let serverNonce: String
    let authority: TchurchStudioLANAuthority
    let signingKeyID: String
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
}

struct TchurchStudioLANSubscriptionRequest: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let requestID: UUID
    let challengeID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let authenticationProof: String
}

struct TchurchStudioLANSubscriptionGrant: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let sessionID: UUID
    let requestID: UUID
    let channel: TchurchStudioLANChannel
    let authority: TchurchStudioLANAuthority
    let signingKeyID: String
    let signingPublicKey: String
    let minimumSequence: UInt64
    let expiresAtMilliseconds: Int64
    let serverProof: String
}

struct TchurchStudioLANSignedEnvelope: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let authority: TchurchStudioLANAuthority
    let channel: TchurchStudioLANChannel
    let sequence: UInt64
    let revision: UInt64
    let issuedAtMilliseconds: Int64
    let payload: TchurchStudioLANChannelPayload
    let payloadChecksum: String
    let signingKeyID: String
    let signature: String
}

struct TchurchStudioLANLimits: Equatable {
    static let production = TchurchStudioLANLimits()

    let maximumFrameBytes: Int
    let maximumBufferedInputBytes: Int
    let maximumClientNameBytes: Int
    let maximumIdentifierBytes: Int
    let maximumTextBytes: Int
    let maximumCueLines: Int
    let maximumChordLines: Int
    let maximumTimers: Int

    init(
        maximumFrameBytes: Int = 256 * 1_024,
        maximumBufferedInputBytes: Int = 512 * 1_024,
        maximumClientNameBytes: Int = 128,
        maximumIdentifierBytes: Int = 160,
        maximumTextBytes: Int = 16 * 1_024,
        maximumCueLines: Int = 128,
        maximumChordLines: Int = 128,
        maximumTimers: Int = 64
    ) {
        self.maximumFrameBytes = maximumFrameBytes
        self.maximumBufferedInputBytes = maximumBufferedInputBytes
        self.maximumClientNameBytes = maximumClientNameBytes
        self.maximumIdentifierBytes = maximumIdentifierBytes
        self.maximumTextBytes = maximumTextBytes
        self.maximumCueLines = maximumCueLines
        self.maximumChordLines = maximumChordLines
        self.maximumTimers = maximumTimers
    }

    var isValid: Bool {
        maximumFrameBytes >= 1_024 &&
            maximumBufferedInputBytes >= maximumFrameBytes + 4 &&
            maximumClientNameBytes > 0 &&
            maximumIdentifierBytes > 0 &&
            maximumTextBytes > 0 &&
            maximumCueLines > 0 &&
            maximumChordLines > 0 &&
            maximumTimers > 0
    }
}

struct TchurchStudioLANPairingSecret: Equatable, CustomStringConvertible {
    static let minimumByteCount = 32
    static let maximumByteCount = 64

    let transportKeyMaterial: Data

    init(rawRepresentation: Data) throws {
        guard (Self.minimumByteCount ... Self.maximumByteCount).contains(rawRepresentation.count) else {
            throw TchurchStudioLANError.invalidPairingCode
        }
        transportKeyMaterial = rawRepresentation
    }

    /// The Studio pairing UI should present the generated bytes as Base64 or
    /// unpadded Base64URL. Whitespace and an optional `tchurch-studio:` prefix
    /// are accepted so a QR payload can be pasted without changing the PSK.
    init(pairingCode: String) throws {
        var encoded = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
        if encoded.lowercased().hasPrefix("tchurch-studio:") {
            encoded.removeFirst("tchurch-studio:".count)
        }
        encoded = encoded.filter { !$0.isWhitespace }
        encoded = encoded.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = encoded.count % 4
        if remainder != 0 { encoded += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: encoded, options: []),
              (Self.minimumByteCount ... Self.maximumByteCount).contains(data.count) else {
            throw TchurchStudioLANError.invalidPairingCode
        }
        transportKeyMaterial = data
    }

    var keyID: String {
        String(TchurchStudioLANCrypto.sha256Hex(transportKeyMaterial).prefix(24))
    }

    var description: String { "TchurchStudioLANPairingSecret(<redacted>)" }
}

enum TchurchStudioLANCoding {
    static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }

    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return decoder
    }
}

enum TchurchStudioLANCrypto {
    static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func randomBytes(count: Int) throws -> Data {
        guard count > 0, count <= 64 else { throw TchurchStudioLANError.invalidConfiguration }
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw TchurchStudioLANError.entropyUnavailable
        }
        return Data(bytes)
    }

    static func authenticationCode<Value: Encodable>(
        for value: Value,
        secret: TchurchStudioLANPairingSecret
    ) throws -> String {
        let body = try TchurchStudioLANCoding.encoder().encode(value)
        let code = HMAC<SHA256>.authenticationCode(
            for: body,
            using: SymmetricKey(data: secret.transportKeyMaterial)
        )
        return Data(code).base64EncodedString()
    }

    static func validatesAuthenticationCode<Value: Encodable>(
        _ encodedCode: String,
        for value: Value,
        secret: TchurchStudioLANPairingSecret
    ) -> Bool {
        guard let received = Data(base64Encoded: encodedCode),
              received.count == SHA256.byteCount,
              let body = try? TchurchStudioLANCoding.encoder().encode(value) else {
            return false
        }
        return HMAC<SHA256>.isValidAuthenticationCode(
            received,
            authenticating: body,
            using: SymmetricKey(data: secret.transportKeyMaterial)
        )
    }
}

private struct TchurchStudioLANSubscriptionRequestProof: Codable {
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
}

private struct TchurchStudioLANSubscriptionGrantProof: Codable {
    let challengeID: UUID
    let sessionID: UUID
    let requestID: UUID
    let channel: TchurchStudioLANChannel
    let authority: TchurchStudioLANAuthority
    let signingKeyID: String
    let signingPublicKey: String
    let minimumSequence: UInt64
    let expiresAtMilliseconds: Int64
    let clientNonce: String
}

private struct TchurchStudioLANEnvelopeSigningMaterial: Codable {
    let schemaVersion: Int
    let authority: TchurchStudioLANAuthority
    let channel: TchurchStudioLANChannel
    let sequence: UInt64
    let revision: UInt64
    let issuedAtMilliseconds: Int64
    let payload: TchurchStudioLANChannelPayload
    let payloadChecksum: String
    let signingKeyID: String
}

struct TchurchStudioLANVerifiedSubscription {
    fileprivate let grant: TchurchStudioLANSubscriptionGrant
    fileprivate let publicKey: Curve25519.Signing.PublicKey

    var authority: TchurchStudioLANAuthority { grant.authority }
    var channel: TchurchStudioLANChannel { grant.channel }
    var signingKeyID: String { grant.signingKeyID }
    var minimumSequence: UInt64 { grant.minimumSequence }
}

enum TchurchStudioLANSubscriptionAuthenticator {
    static func makeRequest(
        challenge: TchurchStudioLANServerChallenge,
        clientID: UUID,
        clientName: String,
        channel: TchurchStudioLANChannel,
        secret: TchurchStudioLANPairingSecret,
        requestID: UUID = UUID(),
        clientNonce: Data? = nil
    ) throws -> TchurchStudioLANSubscriptionRequest {
        guard challenge.schemaVersion == TchurchStudioLANServerChallenge.schemaVersion,
              challenge.authority.authorityEpoch > 0,
              !challenge.authority.packageID.isEmpty,
              !challenge.authority.serviceVersion.isEmpty,
              !challenge.signingKeyID.isEmpty,
              channel.isReadOnlyOutput,
              !clientName.isEmpty,
              clientName.utf8.count <= TchurchStudioLANLimits.production.maximumClientNameBytes else {
            throw TchurchStudioLANError.invalidChallenge
        }
        let nonce = try clientNonce ?? TchurchStudioLANCrypto.randomBytes(count: 24)
        guard (16 ... 64).contains(nonce.count) else {
            throw TchurchStudioLANError.invalidAuthenticationProof
        }
        let encodedNonce = nonce.base64EncodedString()
        let proof = TchurchStudioLANSubscriptionRequestProof(
            challenge: challenge,
            requestID: requestID,
            clientID: clientID,
            clientName: clientName,
            channel: channel,
            clientNonce: encodedNonce
        )
        return TchurchStudioLANSubscriptionRequest(
            schemaVersion: TchurchStudioLANSubscriptionRequest.schemaVersion,
            requestID: requestID,
            challengeID: challenge.challengeID,
            clientID: clientID,
            clientName: clientName,
            channel: channel,
            clientNonce: encodedNonce,
            authenticationProof: try TchurchStudioLANCrypto.authenticationCode(for: proof, secret: secret)
        )
    }

    static func verifyGrant(
        _ grant: TchurchStudioLANSubscriptionGrant,
        request: TchurchStudioLANSubscriptionRequest,
        challenge: TchurchStudioLANServerChallenge,
        secret: TchurchStudioLANPairingSecret,
        nowMilliseconds: Int64
    ) throws -> TchurchStudioLANVerifiedSubscription {
        guard challenge.schemaVersion == TchurchStudioLANServerChallenge.schemaVersion,
              challenge.expiresAtMilliseconds >= nowMilliseconds,
              request.schemaVersion == TchurchStudioLANSubscriptionRequest.schemaVersion,
              request.challengeID == challenge.challengeID,
              request.channel.isReadOnlyOutput,
              grant.schemaVersion == TchurchStudioLANSubscriptionGrant.schemaVersion,
              grant.requestID == request.requestID,
              grant.channel == request.channel,
              grant.authority == challenge.authority,
              grant.signingKeyID == challenge.signingKeyID,
              grant.expiresAtMilliseconds >= nowMilliseconds,
              grant.minimumSequence > 0,
              let publicKeyData = Data(base64Encoded: grant.signingPublicKey),
              publicKeyData.count == 32,
              String(TchurchStudioLANCrypto.sha256Hex(publicKeyData).prefix(24)) == grant.signingKeyID,
              let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData) else {
            throw TchurchStudioLANError.invalidSubscription
        }
        let proof = TchurchStudioLANSubscriptionGrantProof(
            challengeID: challenge.challengeID,
            sessionID: grant.sessionID,
            requestID: grant.requestID,
            channel: grant.channel,
            authority: grant.authority,
            signingKeyID: grant.signingKeyID,
            signingPublicKey: grant.signingPublicKey,
            minimumSequence: grant.minimumSequence,
            expiresAtMilliseconds: grant.expiresAtMilliseconds,
            clientNonce: request.clientNonce
        )
        guard TchurchStudioLANCrypto.validatesAuthenticationCode(
            grant.serverProof,
            for: proof,
            secret: secret
        ) else {
            throw TchurchStudioLANError.invalidAuthenticationProof
        }
        return TchurchStudioLANVerifiedSubscription(grant: grant, publicKey: publicKey)
    }
}

struct TchurchStudioLANReplayGuard: Equatable {
    private(set) var authority: TchurchStudioLANAuthority?
    private(set) var signingKeyID: String?
    private(set) var lastSequence: UInt64?
    private(set) var lastRevision: UInt64?

    mutating func begin(_ subscription: TchurchStudioLANVerifiedSubscription) throws {
        if let current = authority, current.runID == subscription.authority.runID {
            guard subscription.authority.authorityEpoch >= current.authorityEpoch else {
                throw TchurchStudioLANError.staleAuthorityEpoch
            }
            if subscription.authority.authorityEpoch == current.authorityEpoch {
                guard subscription.authority == current else {
                    throw TchurchStudioLANError.authorityMismatch
                }
                if signingKeyID != subscription.signingKeyID {
                    // Studio's signing identity and sequence are process-local.
                    // `subscription` can only reach this point after its fresh
                    // challenge/request/grant was authenticated with the PSK,
                    // so a new key under the exact authority is an explicit
                    // server restart, not an unauthenticated rollback.
                    lastSequence = nil
                    lastRevision = nil
                }
            } else {
                lastSequence = nil
                lastRevision = nil
            }
        } else if authority != nil {
            // A PSK-authenticated new run is a deliberate authority reset.
            lastSequence = nil
            lastRevision = nil
        }
        authority = subscription.authority
        signingKeyID = subscription.signingKeyID
    }

    mutating func accept(_ envelope: TchurchStudioLANSignedEnvelope) throws {
        guard envelope.authority == authority, envelope.signingKeyID == signingKeyID else {
            throw TchurchStudioLANError.authorityMismatch
        }
        guard lastSequence.map({ envelope.sequence > $0 }) ?? true else {
            throw TchurchStudioLANError.replayedEnvelope
        }
        guard lastRevision.map({ envelope.revision >= $0 }) ?? true else {
            throw TchurchStudioLANError.staleRevision
        }
        lastSequence = envelope.sequence
        lastRevision = envelope.revision
    }
}

struct TchurchStudioLANEnvelopeVerifier {
    private let subscription: TchurchStudioLANVerifiedSubscription
    private let limits: TchurchStudioLANLimits

    init(
        subscription: TchurchStudioLANVerifiedSubscription,
        limits: TchurchStudioLANLimits = .production
    ) throws {
        guard limits.isValid else { throw TchurchStudioLANError.invalidConfiguration }
        self.subscription = subscription
        self.limits = limits
    }

    func verify(_ encodedEnvelope: Data) throws -> TchurchStudioLANSignedEnvelope {
        guard !encodedEnvelope.isEmpty,
              encodedEnvelope.count <= limits.maximumFrameBytes,
              let envelope = try? TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANSignedEnvelope.self,
                from: encodedEnvelope
              ),
              envelope.schemaVersion == TchurchStudioLANSignedEnvelope.schemaVersion else {
            throw TchurchStudioLANError.invalidEnvelope
        }
        guard envelope.authority == subscription.authority else {
            throw TchurchStudioLANError.authorityMismatch
        }
        guard envelope.channel == subscription.channel,
              envelope.payload.channel == subscription.channel else {
            throw TchurchStudioLANError.wrongChannel
        }
        guard envelope.sequence >= subscription.minimumSequence else {
            throw TchurchStudioLANError.replayedEnvelope
        }
        guard envelope.signingKeyID == subscription.signingKeyID,
              let signature = Data(base64Encoded: envelope.signature),
              signature.count == 64 else {
            throw TchurchStudioLANError.invalidSignature
        }

        let encodedPayload = try TchurchStudioLANCoding.encoder().encode(envelope.payload)
        guard TchurchStudioLANCrypto.sha256Hex(encodedPayload) == envelope.payloadChecksum else {
            throw TchurchStudioLANError.invalidChecksum
        }
        let material = TchurchStudioLANEnvelopeSigningMaterial(
            schemaVersion: envelope.schemaVersion,
            authority: envelope.authority,
            channel: envelope.channel,
            sequence: envelope.sequence,
            revision: envelope.revision,
            issuedAtMilliseconds: envelope.issuedAtMilliseconds,
            payload: envelope.payload,
            payloadChecksum: envelope.payloadChecksum,
            signingKeyID: envelope.signingKeyID
        )
        let signedData = try TchurchStudioLANCoding.encoder().encode(material)
        guard subscription.publicKey.isValidSignature(signature, for: signedData) else {
            throw TchurchStudioLANError.invalidSignature
        }
        try validate(envelope)
        return envelope
    }

    private func validate(_ envelope: TchurchStudioLANSignedEnvelope) throws {
        let audience = envelope.payload.audience
        let snapshot = audience.snapshot
        guard snapshot.schemaVersion == TchurchStudioLANAudienceSnapshot.schemaVersion,
              snapshot.runID == envelope.authority.runID,
              snapshot.authorityEpoch == envelope.authority.authorityEpoch,
              snapshot.packageID == envelope.authority.packageID,
              snapshot.serviceVersion == envelope.authority.serviceVersion,
              snapshot.revision == envelope.revision,
              snapshot.cueCount >= 0,
              snapshot.currentCueIndex.map({ $0 >= 0 && $0 < snapshot.cueCount }) ?? true,
              validOptionalText(snapshot.currentCueID, maximumBytes: limits.maximumIdentifierBytes),
              validOptionalText(snapshot.countdown?.id, maximumBytes: limits.maximumIdentifierBytes),
              validOptionalText(snapshot.countdown?.label, maximumBytes: limits.maximumTextBytes),
              snapshot.countdown.map({ validDateMilliseconds($0.targetDate) }) ?? true,
              validCue(audience.cue) else {
            throw TchurchStudioLANError.invalidPayload
        }
        if let stage = envelope.payload.stage {
            guard stage.chordLines.count <= limits.maximumChordLines,
                  stage.timers.count <= limits.maximumTimers,
                  validCue(stage.nextCue),
                  stage.chordLines.allSatisfy({ validText($0, maximumBytes: limits.maximumTextBytes) }),
                  validOptionalText(stage.message, maximumBytes: limits.maximumTextBytes),
                  stage.timers.allSatisfy({ timer in
                    validText(timer.id, maximumBytes: limits.maximumIdentifierBytes) &&
                        validText(timer.label, maximumBytes: limits.maximumTextBytes) &&
                        validDateMilliseconds(timer.anchorDate)
                  }) else {
                throw TchurchStudioLANError.invalidPayload
            }
        }
    }

    private func validCue(_ cue: TchurchStudioLANPublicCue?) -> Bool {
        guard let cue = cue else { return true }
        return validText(cue.cueID, maximumBytes: limits.maximumIdentifierBytes) &&
            validOptionalText(cue.title, maximumBytes: limits.maximumTextBytes) &&
            cue.lines.count <= limits.maximumCueLines &&
            cue.lines.allSatisfy({ validText($0, maximumBytes: limits.maximumTextBytes) }) &&
            validAssetID(cue.mediaAssetID)
    }

    private func validAssetID(_ value: String?) -> Bool {
        guard let value = value else { return true }
        guard value.hasPrefix("sha256:") else { return false }
        let digest = value.dropFirst("sha256:".count)
        return digest.utf8.count == 64 && digest.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }

    private func validOptionalText(_ value: String?, maximumBytes: Int) -> Bool {
        value.map({ validText($0, maximumBytes: maximumBytes) }) ?? true
    }

    private func validText(_ value: String, maximumBytes: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= maximumBytes &&
            !value.unicodeScalars.contains(where: { $0.properties.generalCategory == .control })
    }

    private func validDateMilliseconds(_ value: Date) -> Bool {
        let milliseconds = value.timeIntervalSince1970 * 1_000
        return milliseconds.isFinite &&
            milliseconds >= Double(Int64.min) &&
            milliseconds < Double(Int64.max)
    }
}

struct TchurchStudioLANLengthPrefixedFrameDecoder {
    private let maximumFrameBytes: Int
    private let maximumBufferedBytes: Int
    private var buffer = Data()

    init(maximumFrameBytes: Int, maximumBufferedBytes: Int) throws {
        guard maximumFrameBytes > 0, maximumBufferedBytes >= maximumFrameBytes + 4 else {
            throw TchurchStudioLANError.invalidConfiguration
        }
        self.maximumFrameBytes = maximumFrameBytes
        self.maximumBufferedBytes = maximumBufferedBytes
    }

    mutating func append(_ chunk: Data) throws -> [Data] {
        guard chunk.count <= maximumBufferedBytes - buffer.count else {
            throw TchurchStudioLANError.inputBufferLimitExceeded
        }
        buffer.append(chunk)
        var frames: [Data] = []
        while buffer.count >= 4 {
            let length = buffer.prefix(4).reduce(0) { ($0 << 8) | Int($1) }
            guard length > 0, length <= maximumFrameBytes else {
                throw TchurchStudioLANError.invalidFrameLength(length)
            }
            guard buffer.count >= 4 + length else { break }
            frames.append(buffer.subdata(in: 4 ..< 4 + length))
            buffer.removeSubrange(0 ..< 4 + length)
        }
        return frames
    }

    static func encode(_ payload: Data, maximumFrameBytes: Int) throws -> Data {
        guard !payload.isEmpty, payload.count <= maximumFrameBytes, payload.count <= Int(UInt32.max) else {
            throw TchurchStudioLANError.invalidFrameLength(payload.count)
        }
        let length = UInt32(payload.count)
        var frame = Data(capacity: payload.count + 4)
        frame.append(UInt8((length >> 24) & 0xFF))
        frame.append(UInt8((length >> 16) & 0xFF))
        frame.append(UInt8((length >> 8) & 0xFF))
        frame.append(UInt8(length & 0xFF))
        frame.append(payload)
        return frame
    }
}

enum TchurchStudioLANWireErrorCode: String, Codable, Equatable {
    case authenticationFailed
    case rateLimited
    case protocolViolation
    case overloaded
    case serverUnavailable
}

enum TchurchStudioLANWireMessage: Codable, Equatable {
    case challenge(TchurchStudioLANServerChallenge)
    case subscribe(TchurchStudioLANSubscriptionRequest)
    case grant(TchurchStudioLANSubscriptionGrant)
    case envelope(Data)
    case ping(String)
    case pong(String)
    case error(TchurchStudioLANWireErrorCode)

    private enum Kind: String, Codable { case challenge, subscribe, grant, envelope, ping, pong, error }
    private enum CodingKeys: String, CodingKey { case kind, challenge, request, grant, envelope, nonce, error }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .kind) {
        case .challenge: self = .challenge(try container.decode(TchurchStudioLANServerChallenge.self, forKey: .challenge))
        case .subscribe: self = .subscribe(try container.decode(TchurchStudioLANSubscriptionRequest.self, forKey: .request))
        case .grant: self = .grant(try container.decode(TchurchStudioLANSubscriptionGrant.self, forKey: .grant))
        case .envelope: self = .envelope(try container.decode(Data.self, forKey: .envelope))
        case .ping: self = .ping(try container.decode(String.self, forKey: .nonce))
        case .pong: self = .pong(try container.decode(String.self, forKey: .nonce))
        case .error: self = .error(try container.decode(TchurchStudioLANWireErrorCode.self, forKey: .error))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .challenge(let value):
            try container.encode(Kind.challenge, forKey: .kind)
            try container.encode(value, forKey: .challenge)
        case .subscribe(let value):
            try container.encode(Kind.subscribe, forKey: .kind)
            try container.encode(value, forKey: .request)
        case .grant(let value):
            try container.encode(Kind.grant, forKey: .kind)
            try container.encode(value, forKey: .grant)
        case .envelope(let value):
            try container.encode(Kind.envelope, forKey: .kind)
            try container.encode(value, forKey: .envelope)
        case .ping(let nonce):
            try container.encode(Kind.ping, forKey: .kind)
            try container.encode(nonce, forKey: .nonce)
        case .pong(let nonce):
            try container.encode(Kind.pong, forKey: .kind)
            try container.encode(nonce, forKey: .nonce)
        case .error(let value):
            try container.encode(Kind.error, forKey: .kind)
            try container.encode(value, forKey: .error)
        }
    }
}

enum TchurchStudioLANWireCodec {
    static func encode(_ message: TchurchStudioLANWireMessage, maximumFrameBytes: Int) throws -> Data {
        let body = try TchurchStudioLANCoding.encoder().encode(message)
        return try TchurchStudioLANLengthPrefixedFrameDecoder.encode(body, maximumFrameBytes: maximumFrameBytes)
    }

    static func decode(_ body: Data) throws -> TchurchStudioLANWireMessage {
        do {
            return try TchurchStudioLANCoding.decoder().decode(TchurchStudioLANWireMessage.self, from: body)
        } catch let error as TchurchStudioLANError {
            throw error
        } catch {
            throw TchurchStudioLANError.protocolViolation
        }
    }
}

enum TchurchStudioLANTime {
    static func nowMilliseconds(_ date: Date = Date()) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }
}
