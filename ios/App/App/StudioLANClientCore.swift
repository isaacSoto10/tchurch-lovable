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
    case unsupportedPayloadVersion
    case unsupportedChannel
    case authorityMismatch
    case staleAuthorityEpoch
    case staleRevision
    case equivocatedRevision
    case replayedEnvelope
    case invalidEnvelope
    case invalidChecksum
    case invalidSignature
    case wrongChannel
    case invalidPayload
    case invalidAssetRequest
    case invalidAssetChunk
    case assetUnavailable
    case assetCacheUnavailable
    case assetCacheCorrupted
    case assetCacheLimitExceeded
    case insufficientDiskSpace
    case invalidFrameLength(Int)
    case inputBufferLimitExceeded
    case protocolViolation
}

enum TchurchStudioLANChannel: String, Codable, Equatable {
    case audience
    case stage
    case control

    var isReadOnlyOutput: Bool { self == .audience || self == .stage }

    /// Control is subscription-only in device-trust v4. It is never accepted
    /// by either legacy shared-secret subscription schema.
    var isSupportedSubscription: Bool { true }
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
    /// Present only in a negotiated v3 envelope. No remote URL or local path
    /// crosses this contract; bytes are pulled by the immutable object digest.
    let imageAsset: TchurchStudioLANImageAssetDescriptor?

    init(
        cueID: String,
        title: String?,
        lines: [String],
        mediaAssetID: String?,
        imageAsset: TchurchStudioLANImageAssetDescriptor? = nil
    ) {
        self.cueID = cueID
        self.title = title
        self.lines = lines
        self.mediaAssetID = mediaAssetID
        self.imageAsset = imageAsset
    }
}

enum TchurchStudioLANImageAssetKind: String, Codable, Equatable {
    case image
}

enum TchurchStudioLANImageFit: String, Codable, Equatable {
    case contain
    case cover
}

struct TchurchStudioLANImageAssetDescriptor: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let referenceID: String
    let objectID: String
    let kind: TchurchStudioLANImageAssetKind
    let mimeType: String
    let byteSize: Int64
    let required: Bool
    let imageFit: TchurchStudioLANImageFit
}

struct TchurchStudioLANAssetRequest: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let requestID: UUID
    let objectID: String
    let offset: Int64
    let maximumBytes: Int
}

struct TchurchStudioLANAssetChunk: Codable, Equatable {
    static let schemaVersion = 1
    static let byteCount = 64 * 1_024

    let schemaVersion: Int
    let requestID: UUID
    let objectID: String
    let offset: Int64
    let totalByteSize: Int64
    let data: Data
    let dataSha256: String
    let isFinal: Bool
}

enum TchurchStudioLANAssetUnavailableCode: String, Codable, Equatable {
    case unavailable
    case invalidRange
    case overloaded
}

struct TchurchStudioLANAssetUnavailable: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let requestID: UUID
    let objectID: String
    let code: TchurchStudioLANAssetUnavailableCode
}

struct TchurchStudioLANChordToken: Codable, Equatable {
    let value: String
    let offsetUtf16: Int
}

struct TchurchStudioLANChordLine: Codable, Equatable {
    let text: String
    let chords: [TchurchStudioLANChordToken]
}

struct TchurchStudioLANChordSlide: Codable, Equatable {
    let cueID: String
    let key: String?
    let lines: [TchurchStudioLANChordLine]
}

struct TchurchStudioLANAudiencePayload: Codable, Equatable {
    let snapshot: TchurchStudioLANAudienceSnapshot
    let cue: TchurchStudioLANPublicCue?
}

struct TchurchStudioLANStageSupplement: Codable, Equatable {
    let nextCue: TchurchStudioLANPublicCue?
    let chordLines: [String]
    let currentChordSlide: TchurchStudioLANChordSlide?
    let timers: [TchurchStudioLANTimer]
    let message: String?

    init(
        nextCue: TchurchStudioLANPublicCue?,
        chordLines: [String],
        currentChordSlide: TchurchStudioLANChordSlide? = nil,
        timers: [TchurchStudioLANTimer],
        message: String?
    ) {
        self.nextCue = nextCue
        self.chordLines = chordLines
        self.currentChordSlide = currentChordSlide
        self.timers = timers
        self.message = message
    }
}

struct TchurchStudioLANStagePayload: Codable, Equatable {
    let audience: TchurchStudioLANAudiencePayload
    let stage: TchurchStudioLANStageSupplement
}

struct TchurchStudioLANRemoteCueDescriptor: Codable, Equatable {
    let cueID: String
    let title: String
}

struct TchurchStudioLANRoutingProjection: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let localAudience: Bool
    let localBroadcast: Bool
    let stageAndMusicians: Bool
    let lanRemoteControl: Bool
    let lightingAndMIDI: Bool
    let tchurchCloudProgram: Bool
}

enum TchurchStudioLANOperatorTimerScope: String, Codable, CaseIterable, Equatable {
    case service
    case item
}

struct TchurchStudioLANAnyCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

enum TchurchStudioLANExactObject {
    static func requireKeys(_ expected: Set<String>, from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: TchurchStudioLANAnyCodingKey.self)
        let actual = Set(container.allKeys.map(\.stringValue))
        guard actual == expected else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Object keys do not match the signed contract"
            ))
        }
    }
}

/// V6 exposes only the two operator clocks owned by local Production. This
/// signed control projection is intentionally separate from Stage timers.
struct TchurchStudioLANOperatorTimerState: Codable, Equatable {
    let scope: TchurchStudioLANOperatorTimerScope
    let anchorTimestampMilliseconds: Int64
    let anchorValueMilliseconds: Int64
    let isRunning: Bool
}

extension TchurchStudioLANOperatorTimerState {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case scope, anchorTimestampMilliseconds, anchorValueMilliseconds, isRunning
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        scope = try container.decode(TchurchStudioLANOperatorTimerScope.self, forKey: .scope)
        anchorTimestampMilliseconds = try container.decode(
            Int64.self,
            forKey: .anchorTimestampMilliseconds
        )
        anchorValueMilliseconds = try container.decode(
            Int64.self,
            forKey: .anchorValueMilliseconds
        )
        isRunning = try container.decode(Bool.self, forKey: .isRunning)
        guard anchorTimestampMilliseconds >= 0,
              anchorTimestampMilliseconds <=
                TchurchStudioLANOperatorTimersProjection.maximumAnchorTimestampMilliseconds,
              anchorValueMilliseconds >= 0,
              anchorValueMilliseconds <=
                TchurchStudioLANOperatorTimersProjection.maximumAnchorValueMilliseconds else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Invalid operator timer anchor"
            ))
        }
    }
}

struct TchurchStudioLANOperatorTimersProjection: Codable, Equatable {
    static let schemaVersion = 1
    static let maximumRevision: UInt64 = 9_007_199_254_740_991
    static let maximumAnchorTimestampMilliseconds: Int64 = 9_007_199_254_740_991
    static let maximumAnchorValueMilliseconds: Int64 = 604_800_000

    let schemaVersion: Int
    let revision: UInt64
    let timers: [TchurchStudioLANOperatorTimerState]

    var isCanonical: Bool {
        schemaVersion == Self.schemaVersion &&
            revision <= Self.maximumRevision &&
            timers.map(\.scope) == TchurchStudioLANOperatorTimerScope.allCases &&
            timers.allSatisfy {
                $0.anchorTimestampMilliseconds >= 0 &&
                    $0.anchorTimestampMilliseconds <=
                        Self.maximumAnchorTimestampMilliseconds &&
                    $0.anchorValueMilliseconds >= 0 &&
                    $0.anchorValueMilliseconds <= Self.maximumAnchorValueMilliseconds
            }
    }
}

extension TchurchStudioLANOperatorTimersProjection {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, revision, timers
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        revision = try container.decode(UInt64.self, forKey: .revision)
        timers = try container.decode([TchurchStudioLANOperatorTimerState].self, forKey: .timers)
        guard isCanonical else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Invalid operator timer state"
            ))
        }
    }
}

struct TchurchStudioLANCueCatalogManifest: Codable, Equatable {
    static let schemaVersion = 1
    static let pageSize = 128
    static let maximumTotalCount = 20_000

    let schemaVersion: Int
    let catalogID: String
    let totalCount: Int
    let pageSize: Int
}

struct TchurchStudioLANCatalogRequest: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let requestID: UUID
    let catalogID: String
    let routeEpoch: UInt64
    let offset: Int
    let maximumEntries: Int
}

struct TchurchStudioLANCatalogPage: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let requestID: UUID
    let catalogID: String
    let routeEpoch: UInt64
    let offset: Int
    let totalCount: Int
    let cues: [TchurchStudioLANRemoteCueDescriptor]
    let isFinal: Bool
}

enum TchurchStudioLANCatalogUnavailableCode: String, Codable, Equatable {
    case staleCatalog = "stale_catalog"
    case invalidRange = "invalid_range"
    case overloaded
}

struct TchurchStudioLANCatalogUnavailable: Codable, Equatable {
    static let schemaVersion = 1

    let schemaVersion: Int
    let requestID: UUID
    let catalogID: String
    let code: TchurchStudioLANCatalogUnavailableCode
}

enum TchurchStudioLANCueCatalogDigest {
    private static let domain = Data("tchurch-lan-cue-catalog-v1".utf8)

    static func catalogID(for cues: [TchurchStudioLANRemoteCueDescriptor]) throws -> String {
        guard cues.count <= TchurchStudioLANCueCatalogManifest.maximumTotalCount else {
            throw TchurchStudioLANError.invalidPayload
        }
        var bytes = Data()
        bytes.reserveCapacity(domain.count + 5 + cues.reduce(0) { $0 + 8 + $1.cueID.utf8.count + $1.title.utf8.count })
        bytes.append(domain)
        bytes.append(0)
        try appendUInt32(cues.count, to: &bytes)
        for cue in cues {
            let cueID = Data(cue.cueID.utf8)
            let title = Data(cue.title.utf8)
            try appendUInt32(cueID.count, to: &bytes)
            bytes.append(cueID)
            try appendUInt32(title.count, to: &bytes)
            bytes.append(title)
        }
        return "sha256:\(TchurchStudioLANCrypto.sha256Hex(bytes))"
    }

    private static func appendUInt32(_ value: Int, to data: inout Data) throws {
        guard value >= 0, value <= Int(UInt32.max) else {
            throw TchurchStudioLANError.invalidPayload
        }
        let encoded = UInt32(value)
        data.append(UInt8((encoded >> 24) & 0xff))
        data.append(UInt8((encoded >> 16) & 0xff))
        data.append(UInt8((encoded >> 8) & 0xff))
        data.append(UInt8(encoded & 0xff))
    }
}

/// A catalog is kept private until every page has arrived and the manifest
/// digest matches. This is deliberately sequential: a duplicate, gap, stale
/// page, or reordered page fails closed instead of exposing a partial list.
struct TchurchStudioLANCueCatalogAccumulator: Equatable {
    let catalogID: String
    let routeEpoch: UInt64
    let totalCount: Int
    let pageSize: Int
    private(set) var cues: [TchurchStudioLANRemoteCueDescriptor] = []

    init(manifest: TchurchStudioLANCueCatalogManifest, routeEpoch: UInt64) throws {
        guard manifest.schemaVersion == TchurchStudioLANCueCatalogManifest.schemaVersion,
              Self.validCatalogID(manifest.catalogID),
              (0 ... TchurchStudioLANCueCatalogManifest.maximumTotalCount).contains(manifest.totalCount),
              manifest.pageSize == TchurchStudioLANCueCatalogManifest.pageSize,
              routeEpoch > 0,
              routeEpoch != UInt64.max else {
            throw TchurchStudioLANError.invalidPayload
        }
        catalogID = manifest.catalogID
        self.routeEpoch = routeEpoch
        totalCount = manifest.totalCount
        pageSize = manifest.pageSize
        cues.reserveCapacity(manifest.totalCount)
    }

    var nextOffset: Int { cues.count }
    var isEmptyAndComplete: Bool { totalCount == 0 && cues.isEmpty }

    mutating func append(_ page: TchurchStudioLANCatalogPage, expectedRequestID: UUID) throws -> [TchurchStudioLANRemoteCueDescriptor]? {
        let remaining = totalCount - cues.count
        guard page.schemaVersion == TchurchStudioLANCatalogPage.schemaVersion,
              page.requestID == expectedRequestID,
              page.catalogID == catalogID,
              page.routeEpoch == routeEpoch,
              page.offset == cues.count,
              page.totalCount == totalCount,
              !page.cues.isEmpty,
              page.cues.count <= pageSize,
              page.cues.count <= remaining,
              page.isFinal == (page.cues.count == remaining),
              page.cues.allSatisfy(Self.validCue),
              Set(page.cues.map(\.cueID)).count == page.cues.count,
              Set(cues.map(\.cueID)).isDisjoint(with: page.cues.map(\.cueID)) else {
            throw TchurchStudioLANError.protocolViolation
        }
        cues.append(contentsOf: page.cues)
        guard page.isFinal else { return nil }
        guard cues.count == totalCount,
              try TchurchStudioLANCueCatalogDigest.catalogID(for: cues) == catalogID else {
            throw TchurchStudioLANError.invalidChecksum
        }
        return cues
    }

    func verifiedEmptyCatalog() throws -> [TchurchStudioLANRemoteCueDescriptor] {
        guard isEmptyAndComplete,
              try TchurchStudioLANCueCatalogDigest.catalogID(for: []) == catalogID else {
            throw TchurchStudioLANError.invalidChecksum
        }
        return []
    }

    private static func validCue(_ cue: TchurchStudioLANRemoteCueDescriptor) -> Bool {
        let cueIDBytes = cue.cueID.utf8.count
        let titleBytes = cue.title.utf8.count
        return (1 ... 160).contains(cueIDBytes) &&
            (1 ... 512).contains(titleBytes) &&
            !cue.cueID.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) &&
            !cue.title.unicodeScalars.contains(where: { $0.properties.generalCategory == .control })
    }

    static func validCatalogID(_ value: String) -> Bool {
        guard value.hasPrefix("sha256:") else { return false }
        let digest = value.dropFirst("sha256:".count)
        return digest.utf8.count == 64 && digest.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
        }
    }
}

struct TchurchStudioLANControlSupplement: Codable, Equatable {
    let chordsVisible: Bool
    let lightingArmed: Bool
    let healthyOutputCount: Int
    let expectedOutputCount: Int
    let routeEpoch: UInt64?
    let cueCatalog: [TchurchStudioLANRemoteCueDescriptor]?
    let routing: TchurchStudioLANRoutingProjection?
    let cueCatalogManifest: TchurchStudioLANCueCatalogManifest?
    let operatorTimers: TchurchStudioLANOperatorTimersProjection?

    init(
        chordsVisible: Bool,
        lightingArmed: Bool,
        healthyOutputCount: Int,
        expectedOutputCount: Int,
        routeEpoch: UInt64?,
        cueCatalog: [TchurchStudioLANRemoteCueDescriptor]?,
        routing: TchurchStudioLANRoutingProjection? = nil,
        cueCatalogManifest: TchurchStudioLANCueCatalogManifest? = nil,
        operatorTimers: TchurchStudioLANOperatorTimersProjection? = nil
    ) {
        self.chordsVisible = chordsVisible
        self.lightingArmed = lightingArmed
        self.healthyOutputCount = healthyOutputCount
        self.expectedOutputCount = expectedOutputCount
        self.routeEpoch = routeEpoch
        self.cueCatalog = cueCatalog
        self.routing = routing
        self.cueCatalogManifest = cueCatalogManifest
        self.operatorTimers = operatorTimers
    }
}

struct TchurchStudioLANControlPayload: Codable, Equatable {
    let audience: TchurchStudioLANAudiencePayload
    let stage: TchurchStudioLANStageSupplement
    let control: TchurchStudioLANControlSupplement
}

enum TchurchStudioLANChannelPayload: Codable, Equatable {
    case audience(TchurchStudioLANAudiencePayload)
    case stage(TchurchStudioLANStagePayload)
    case control(TchurchStudioLANControlPayload)

    var channel: TchurchStudioLANChannel {
        switch self {
        case .audience: return .audience
        case .stage: return .stage
        case .control: return .control
        }
    }

    var audience: TchurchStudioLANAudiencePayload {
        switch self {
        case .audience(let payload): return payload
        case .stage(let payload): return payload.audience
        case .control(let payload): return payload.audience
        }
    }

    var stage: TchurchStudioLANStageSupplement? {
        switch self {
        case .stage(let payload): return payload.stage
        case .control(let payload): return payload.stage
        case .audience: return nil
        }
    }

    var control: TchurchStudioLANControlSupplement? {
        guard case .control(let payload) = self else { return nil }
        return payload.control
    }

    private enum CodingKeys: String, CodingKey {
        case channel
        case audience
        case stage
        case control
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(TchurchStudioLANChannel.self, forKey: .channel) {
        case .audience:
            self = .audience(try container.decode(TchurchStudioLANAudiencePayload.self, forKey: .audience))
        case .stage:
            self = .stage(try container.decode(TchurchStudioLANStagePayload.self, forKey: .stage))
        case .control:
            self = .control(try container.decode(TchurchStudioLANControlPayload.self, forKey: .control))
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
        case .control(let payload):
            try container.encode(payload, forKey: .control)
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
    let deviceTrustVersion: Int?
    let minimumPayloadVersion: Int?
    let studioID: UUID?

    init(
        schemaVersion: Int,
        challengeID: UUID,
        serverNonce: String,
        authority: TchurchStudioLANAuthority,
        signingKeyID: String,
        issuedAtMilliseconds: Int64,
        expiresAtMilliseconds: Int64,
        deviceTrustVersion: Int? = nil,
        minimumPayloadVersion: Int? = nil,
        studioID: UUID? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.challengeID = challengeID
        self.serverNonce = serverNonce
        self.authority = authority
        self.signingKeyID = signingKeyID
        self.issuedAtMilliseconds = issuedAtMilliseconds
        self.expiresAtMilliseconds = expiresAtMilliseconds
        self.deviceTrustVersion = deviceTrustVersion
        self.minimumPayloadVersion = minimumPayloadVersion
        self.studioID = studioID
    }
}

struct TchurchStudioLANSubscriptionRequest: Codable, Equatable {
    static let legacySchemaVersion = 1
    static let currentSchemaVersion = 2
    static let deviceTrustSchemaVersion = 3
    static let supportedPayloadVersions = [3, 2, 1]
    static let v4SupportedPayloadVersions = [4, 3, 2, 1]
    static let v5SupportedPayloadVersions = [5, 4, 3, 2, 1]
    static let deviceTrustSupportedPayloadVersions = [6, 5, 4, 3, 2, 1]

    let schemaVersion: Int
    let requestID: UUID
    let challengeID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let supportedPayloadVersions: [Int]?
    let authenticationProof: String
    let deviceAttestation: StudioLANDeviceAttestation?

    init(
        schemaVersion: Int,
        requestID: UUID,
        challengeID: UUID,
        clientID: UUID,
        clientName: String,
        channel: TchurchStudioLANChannel,
        clientNonce: String,
        supportedPayloadVersions: [Int]? = nil,
        authenticationProof: String,
        deviceAttestation: StudioLANDeviceAttestation? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.requestID = requestID
        self.challengeID = challengeID
        self.clientID = clientID
        self.clientName = clientName
        self.channel = channel
        self.clientNonce = clientNonce
        self.supportedPayloadVersions = supportedPayloadVersions
        self.authenticationProof = authenticationProof
        self.deviceAttestation = deviceAttestation
    }
}

struct TchurchStudioLANSubscriptionGrant: Codable, Equatable {
    static let legacySchemaVersion = 1
    static let currentSchemaVersion = 2
    static let deviceTrustSchemaVersion = 3

    let schemaVersion: Int
    let sessionID: UUID
    let requestID: UUID
    let channel: TchurchStudioLANChannel
    let authority: TchurchStudioLANAuthority
    let signingKeyID: String
    let signingPublicKey: String
    let minimumSequence: UInt64
    let expiresAtMilliseconds: Int64
    let selectedPayloadVersion: Int?
    let deviceGrant: StudioLANDeviceGrant?
    let serverProof: String

    init(
        schemaVersion: Int,
        sessionID: UUID,
        requestID: UUID,
        channel: TchurchStudioLANChannel,
        authority: TchurchStudioLANAuthority,
        signingKeyID: String,
        signingPublicKey: String,
        minimumSequence: UInt64,
        expiresAtMilliseconds: Int64,
        selectedPayloadVersion: Int? = nil,
        deviceGrant: StudioLANDeviceGrant? = nil,
        serverProof: String
    ) {
        self.schemaVersion = schemaVersion
        self.sessionID = sessionID
        self.requestID = requestID
        self.channel = channel
        self.authority = authority
        self.signingKeyID = signingKeyID
        self.signingPublicKey = signingPublicKey
        self.minimumSequence = minimumSequence
        self.expiresAtMilliseconds = expiresAtMilliseconds
        self.selectedPayloadVersion = selectedPayloadVersion
        self.deviceGrant = deviceGrant
        self.serverProof = serverProof
    }
}

struct TchurchStudioLANSignedEnvelope: Codable, Equatable {
    static let supportedSchemaVersions = Set([1, 2, 3, 4, 5, 6])

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
    let maximumChordTokensPerLine: Int
    let maximumChordTokensTotal: Int
    let maximumTimers: Int

    init(
        maximumFrameBytes: Int = 256 * 1_024,
        maximumBufferedInputBytes: Int = 512 * 1_024,
        maximumClientNameBytes: Int = 128,
        maximumIdentifierBytes: Int = 160,
        maximumTextBytes: Int = 16 * 1_024,
        maximumCueLines: Int = 128,
        maximumChordLines: Int = 128,
        maximumChordTokensPerLine: Int = 12,
        maximumChordTokensTotal: Int = 48,
        maximumTimers: Int = 64
    ) {
        self.maximumFrameBytes = maximumFrameBytes
        self.maximumBufferedInputBytes = maximumBufferedInputBytes
        self.maximumClientNameBytes = maximumClientNameBytes
        self.maximumIdentifierBytes = maximumIdentifierBytes
        self.maximumTextBytes = maximumTextBytes
        self.maximumCueLines = maximumCueLines
        self.maximumChordLines = maximumChordLines
        self.maximumChordTokensPerLine = maximumChordTokensPerLine
        self.maximumChordTokensTotal = maximumChordTokensTotal
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
            maximumChordTokensPerLine > 0 &&
            maximumChordTokensTotal >= maximumChordTokensPerLine &&
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

private struct TchurchStudioLANSubscriptionRequestProofV2: Codable {
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let supportedPayloadVersions: [Int]
}

private struct TchurchStudioLANSubscriptionRequestProofV4: Codable {
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let supportedPayloadVersions: [Int]
    let deviceAttestation: StudioLANDeviceAttestation
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

private struct TchurchStudioLANSubscriptionGrantProofV2: Codable {
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
    let selectedPayloadVersion: Int
}

private struct TchurchStudioLANSubscriptionGrantProofV4: Codable {
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
    let selectedPayloadVersion: Int
    let deviceGrantChecksum: String
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
    var sessionID: UUID { grant.sessionID }
    var channel: TchurchStudioLANChannel { grant.channel }
    var signingKeyID: String { grant.signingKeyID }
    var signingPublicKey: String { grant.signingPublicKey }
    var minimumSequence: UInt64 { grant.minimumSequence }
    var payloadVersion: Int { grant.selectedPayloadVersion ?? 1 }
    var deviceGrant: StudioLANDeviceGrant? { grant.deviceGrant }
    var deviceGrantChecksum: String? {
        guard let deviceGrant,
              let encoded = try? TchurchStudioLANCoding.encoder().encode(deviceGrant) else { return nil }
        return "sha256:\(TchurchStudioLANCrypto.sha256Hex(encoded))"
    }
}

enum TchurchStudioLANFallbackSignal: Equatable {
    /// A legacy-compatible error decoded inside the authenticated TLS-PSK
    /// channel after Studio received the v2 subscription request.
    case authenticatedLegacyError
    /// An unauthenticated network interruption. This must never downgrade.
    case transportEnded
}

/// Tracks the one compatibility downgrade permitted by an explicit server
/// signal inside the TLS-PSK channel. A generic EOF/timeout cannot select v1,
/// and no fallback is possible after an authenticated grant selected a
/// payload version.
struct TchurchStudioLANPayloadNegotiation: Equatable {
    let protocolFloor: Int
    private(set) var didAttemptLegacyFallback = false
    private(set) var negotiatedPayloadVersion: Int?

    init(protocolFloor: Int = 1) {
        self.protocolFloor = max(1, protocolFloor)
    }

    var requestSchemaVersion: Int {
        // Subscription schema and selected payload schema are independent.
        // A modern v2 subscription can bind payload v1, v2, or v3; only the
        // explicit authenticated legacy-fallback path may emit a v1 request.
        if protocolFloor >= StudioLANDeviceTrustContract.protocolFloor {
            return TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion
        }
        return didAttemptLegacyFallback
            ? TchurchStudioLANSubscriptionRequest.legacySchemaVersion
            : TchurchStudioLANSubscriptionRequest.currentSchemaVersion
    }

    var supportedPayloadVersions: [Int] {
        protocolFloor >= StudioLANDeviceTrustContract.protocolFloor
            ? TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions
            : TchurchStudioLANSubscriptionRequest.supportedPayloadVersions
    }

    func supportedPayloadVersions(
        for channel: TchurchStudioLANChannel,
        advertisedPayloadVersions: [Int]? = nil
    ) -> [Int] {
        guard protocolFloor >= StudioLANDeviceTrustContract.protocolFloor else {
            return supportedPayloadVersions
        }
        switch advertisedPayloadVersions {
        case TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions:
            return channel == .control
                ? TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions
                : TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions
        case TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions:
            return TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions
        default:
            // A missing, malformed, legacy, or future Bonjour capability must
            // never silently opt this client into v5/v6. The authenticated
            // challenge can still complete against the common v4 floor.
            return TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions
        }
    }

    mutating func attemptLegacyFallback(
        afterSentRequest request: TchurchStudioLANSubscriptionRequest?,
        signal: TchurchStudioLANFallbackSignal
    ) -> Bool {
        guard signal == .authenticatedLegacyError,
              protocolFloor < StudioLANDeviceTrustRecord.protocolFloor,
              negotiatedPayloadVersion == nil,
              !didAttemptLegacyFallback,
              request?.schemaVersion == TchurchStudioLANSubscriptionRequest.currentSchemaVersion,
              request?.supportedPayloadVersions == supportedPayloadVersions else {
            return false
        }
        didAttemptLegacyFallback = true
        return true
    }

    mutating func recordAuthenticatedGrant(_ subscription: TchurchStudioLANVerifiedSubscription) throws {
        let selected = subscription.payloadVersion
        guard supportedPayloadVersions.contains(selected),
              (selected != 6 || subscription.channel == .control),
              selected >= protocolFloor,
              negotiatedPayloadVersion.map({ $0 == selected }) ?? true else {
            throw TchurchStudioLANError.unsupportedPayloadVersion
        }
        negotiatedPayloadVersion = selected
    }
}

enum TchurchStudioLANSubscriptionAuthenticator {
    static func makeRequest(
        challenge: TchurchStudioLANServerChallenge,
        clientID: UUID,
        clientName: String,
        channel: TchurchStudioLANChannel,
        secret: TchurchStudioLANPairingSecret,
        requestID: UUID = UUID(),
        clientNonce: Data? = nil,
        schemaVersion: Int = TchurchStudioLANSubscriptionRequest.currentSchemaVersion,
        offeredPayloadVersions: [Int]? = nil,
        deviceAttestation: StudioLANDeviceAttestation? = nil
    ) throws -> TchurchStudioLANSubscriptionRequest {
        guard challenge.schemaVersion == TchurchStudioLANServerChallenge.schemaVersion,
              challenge.authority.authorityEpoch > 0,
              !challenge.authority.packageID.isEmpty,
              !challenge.authority.serviceVersion.isEmpty,
              !challenge.signingKeyID.isEmpty,
              channel.isSupportedSubscription,
              (channel != .control ||
                schemaVersion == TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion),
              !clientName.isEmpty,
              clientName.utf8.count <= TchurchStudioLANLimits.production.maximumClientNameBytes,
              schemaVersion == TchurchStudioLANSubscriptionRequest.legacySchemaVersion ||
                schemaVersion == TchurchStudioLANSubscriptionRequest.currentSchemaVersion ||
                schemaVersion == TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion else {
            throw TchurchStudioLANError.invalidChallenge
        }
        let nonce = try clientNonce ?? TchurchStudioLANCrypto.randomBytes(count: 24)
        guard (16 ... 64).contains(nonce.count) else {
            throw TchurchStudioLANError.invalidAuthenticationProof
        }
        let encodedNonce = nonce.base64EncodedString()
        let supportedPayloadVersions: [Int]?
        switch schemaVersion {
        case TchurchStudioLANSubscriptionRequest.currentSchemaVersion:
            guard offeredPayloadVersions == nil ||
                    offeredPayloadVersions == TchurchStudioLANSubscriptionRequest.supportedPayloadVersions else {
                throw TchurchStudioLANError.unsupportedPayloadVersion
            }
            supportedPayloadVersions = TchurchStudioLANSubscriptionRequest.supportedPayloadVersions
        case TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion:
            supportedPayloadVersions = offeredPayloadVersions ?? TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions
        default:
            supportedPayloadVersions = nil
        }
        guard supportedPayloadVersions == nil ||
                supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.supportedPayloadVersions ||
                (schemaVersion == TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion &&
                    (supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions ||
                        supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions ||
                        supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions)) else {
            throw TchurchStudioLANError.unsupportedPayloadVersion
        }
        let authenticationProof: String
        if schemaVersion == TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion,
           let supportedPayloadVersions,
           let deviceAttestation {
            guard supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions ||
                    supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions ||
                    supportedPayloadVersions == TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions,
                  deviceAttestation.deviceID == clientID,
                  deviceAttestation.requestedRole.channel == channel else {
                throw TchurchStudioLANError.invalidAuthenticationProof
            }
            authenticationProof = try TchurchStudioLANCrypto.authenticationCode(
                for: TchurchStudioLANSubscriptionRequestProofV4(
                    challenge: challenge,
                    requestID: requestID,
                    clientID: clientID,
                    clientName: clientName,
                    channel: channel,
                    clientNonce: encodedNonce,
                    supportedPayloadVersions: supportedPayloadVersions,
                    deviceAttestation: deviceAttestation
                ),
                secret: secret
            )
        } else if let supportedPayloadVersions {
            guard deviceAttestation == nil else {
                throw TchurchStudioLANError.invalidAuthenticationProof
            }
            authenticationProof = try TchurchStudioLANCrypto.authenticationCode(
                for: TchurchStudioLANSubscriptionRequestProofV2(
                    challenge: challenge,
                    requestID: requestID,
                    clientID: clientID,
                    clientName: clientName,
                    channel: channel,
                    clientNonce: encodedNonce,
                    supportedPayloadVersions: supportedPayloadVersions
                ),
                secret: secret
            )
        } else {
            guard deviceAttestation == nil else {
                throw TchurchStudioLANError.invalidAuthenticationProof
            }
            authenticationProof = try TchurchStudioLANCrypto.authenticationCode(
                for: TchurchStudioLANSubscriptionRequestProof(
                    challenge: challenge,
                    requestID: requestID,
                    clientID: clientID,
                    clientName: clientName,
                    channel: channel,
                    clientNonce: encodedNonce
                ),
                secret: secret
            )
        }
        return TchurchStudioLANSubscriptionRequest(
            schemaVersion: schemaVersion,
            requestID: requestID,
            challengeID: challenge.challengeID,
            clientID: clientID,
            clientName: clientName,
            channel: channel,
            clientNonce: encodedNonce,
            supportedPayloadVersions: supportedPayloadVersions,
            authenticationProof: authenticationProof,
            deviceAttestation: deviceAttestation
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
              request.schemaVersion == TchurchStudioLANSubscriptionRequest.legacySchemaVersion ||
                request.schemaVersion == TchurchStudioLANSubscriptionRequest.currentSchemaVersion ||
                request.schemaVersion == TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion,
              request.challengeID == challenge.challengeID,
              request.channel.isSupportedSubscription,
              (request.channel != .control ||
                request.schemaVersion == TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion),
              grant.schemaVersion == request.schemaVersion,
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
        let proofIsValid: Bool
        switch request.schemaVersion {
        case TchurchStudioLANSubscriptionRequest.legacySchemaVersion:
            guard request.supportedPayloadVersions == nil,
                  request.deviceAttestation == nil,
                  grant.selectedPayloadVersion == nil,
                  grant.deviceGrant == nil else {
                throw TchurchStudioLANError.unsupportedPayloadVersion
            }
            proofIsValid = TchurchStudioLANCrypto.validatesAuthenticationCode(
                grant.serverProof,
                for: TchurchStudioLANSubscriptionGrantProof(
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
                ),
                secret: secret
            )
        case TchurchStudioLANSubscriptionRequest.currentSchemaVersion:
            let offeredPayloadVersions = request.supportedPayloadVersions
            guard offeredPayloadVersions == TchurchStudioLANSubscriptionRequest.supportedPayloadVersions,
                  request.deviceAttestation == nil,
                  grant.deviceGrant == nil,
                  let selectedPayloadVersion = grant.selectedPayloadVersion,
                  offeredPayloadVersions?.contains(selectedPayloadVersion) == true else {
                throw TchurchStudioLANError.unsupportedPayloadVersion
            }
            proofIsValid = TchurchStudioLANCrypto.validatesAuthenticationCode(
                grant.serverProof,
                for: TchurchStudioLANSubscriptionGrantProofV2(
                    challengeID: challenge.challengeID,
                    sessionID: grant.sessionID,
                    requestID: grant.requestID,
                    channel: grant.channel,
                    authority: grant.authority,
                    signingKeyID: grant.signingKeyID,
                    signingPublicKey: grant.signingPublicKey,
                    minimumSequence: grant.minimumSequence,
                    expiresAtMilliseconds: grant.expiresAtMilliseconds,
                    clientNonce: request.clientNonce,
                    selectedPayloadVersion: selectedPayloadVersion
                ),
                secret: secret
            )
        case TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion:
            guard challenge.deviceTrustVersion == StudioLANDeviceTrustContract.schemaVersion,
                  challenge.minimumPayloadVersion == StudioLANDeviceTrustContract.protocolFloor,
                  let studioID = challenge.studioID,
                  let offeredPayloadVersions = request.supportedPayloadVersions,
                  offeredPayloadVersions == TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions ||
                    offeredPayloadVersions == TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions ||
                    offeredPayloadVersions == TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions,
                  let attestation = request.deviceAttestation,
                  let selectedPayloadVersion = grant.selectedPayloadVersion,
                  selectedPayloadVersion == 4 || selectedPayloadVersion == 5 || selectedPayloadVersion == 6,
                  selectedPayloadVersion != 6 || request.channel == .control,
                  offeredPayloadVersions.contains(selectedPayloadVersion),
                  let deviceGrant = grant.deviceGrant,
                  deviceGrant.deviceID == request.clientID,
                  deviceGrant.deviceID == attestation.deviceID,
                  deviceGrant.role == attestation.requestedRole,
                  deviceGrant.devicePublicKey == attestation.devicePublicKey,
                  deviceGrant.devicePublicKeyFingerprint == attestation.devicePublicKeyFingerprint else {
                throw TchurchStudioLANError.invalidSubscription
            }
            let attestedIdentity = StudioLANDeviceIdentity(
                deviceID: attestation.deviceID,
                keyAlgorithm: attestation.keyAlgorithm,
                publicKey: attestation.devicePublicKey,
                fingerprint: attestation.devicePublicKeyFingerprint,
                secureEnclaveBacked: false
            )
            do {
                try deviceGrant.verify(
                    identity: attestedIdentity,
                    nowMilliseconds: nowMilliseconds,
                    pinnedStudioID: studioID,
                    pinnedStudioSigningPublicKey: grant.signingPublicKey
                )
            } catch {
                throw TchurchStudioLANError.invalidSubscription
            }
            let encodedDeviceGrant = try TchurchStudioLANCoding.encoder().encode(deviceGrant)
            let deviceGrantChecksum = "sha256:\(TchurchStudioLANCrypto.sha256Hex(encodedDeviceGrant))"
            proofIsValid = TchurchStudioLANCrypto.validatesAuthenticationCode(
                grant.serverProof,
                for: TchurchStudioLANSubscriptionGrantProofV4(
                    challengeID: challenge.challengeID,
                    sessionID: grant.sessionID,
                    requestID: grant.requestID,
                    channel: grant.channel,
                    authority: grant.authority,
                    signingKeyID: grant.signingKeyID,
                    signingPublicKey: grant.signingPublicKey,
                    minimumSequence: grant.minimumSequence,
                    expiresAtMilliseconds: grant.expiresAtMilliseconds,
                    clientNonce: request.clientNonce,
                    selectedPayloadVersion: selectedPayloadVersion,
                    deviceGrantChecksum: deviceGrantChecksum
                ),
                secret: secret
            )
        default:
            throw TchurchStudioLANError.unsupportedPayloadVersion
        }
        guard proofIsValid else {
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
    private(set) var lastPayloadChecksum: String?
    private(set) var lastOperatorTimerRevision: UInt64?
    private(set) var lastOperatorTimersChecksum: String?
    private(set) var lastV6ProgramPayloadChecksum: String?
    private(set) var lastV6OperatorTimersAvailable: Bool?
    private(set) var negotiatedPayloadVersion: Int?

    mutating func begin(_ subscription: TchurchStudioLANVerifiedSubscription) throws {
        var shouldResetReplayEpoch = negotiatedPayloadVersion.map {
            $0 != subscription.payloadVersion
        } ?? false
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
                    shouldResetReplayEpoch = true
                }
            } else {
                shouldResetReplayEpoch = true
            }
        } else if authority != nil {
            // A PSK-authenticated new run is a deliberate authority reset.
            shouldResetReplayEpoch = true
        }
        if shouldResetReplayEpoch {
            resetReplayEpoch()
        }
        authority = subscription.authority
        signingKeyID = subscription.signingKeyID
        negotiatedPayloadVersion = subscription.payloadVersion
    }

    private mutating func resetReplayEpoch() {
        lastSequence = nil
        lastRevision = nil
        lastPayloadChecksum = nil
        lastOperatorTimerRevision = nil
        lastOperatorTimersChecksum = nil
        lastV6ProgramPayloadChecksum = nil
        lastV6OperatorTimersAvailable = nil
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
        if envelope.schemaVersion == 6 {
            let operatorTimers = envelope.payload.control?.operatorTimers
            let timerRevision = operatorTimers?.revision
            let timersAvailable = timerRevision != nil
            let programChecksum = try Self.v6ProgramPayloadChecksum(envelope.payload)
            let operatorTimersChecksum = try operatorTimers.map {
                TchurchStudioLANCrypto.sha256Hex(
                    try TchurchStudioLANCoding.encoder().encode($0)
                )
            }
            if let timerRevision {
                if let previousTimerRevision = lastOperatorTimerRevision {
                    guard timerRevision >= previousTimerRevision else {
                        throw TchurchStudioLANError.staleRevision
                    }
                    if timerRevision == previousTimerRevision {
                        guard operatorTimersChecksum == lastOperatorTimersChecksum else {
                            throw TchurchStudioLANError.equivocatedRevision
                        }
                    }
                }
            }
            if envelope.revision == lastRevision {
                if envelope.payloadChecksum == lastPayloadChecksum {
                    guard timersAvailable == lastV6OperatorTimersAvailable,
                          timerRevision == (timersAvailable
                            ? lastOperatorTimerRevision
                            : nil) else {
                        throw TchurchStudioLANError.equivocatedRevision
                    }
                } else {
                    guard programChecksum == lastV6ProgramPayloadChecksum else {
                        throw TchurchStudioLANError.equivocatedRevision
                    }
                    switch (lastV6OperatorTimersAvailable, timerRevision) {
                    case (true, .some(let revision)):
                        guard let previous = lastOperatorTimerRevision,
                              revision > previous else {
                            throw TchurchStudioLANError.equivocatedRevision
                        }
                    case (false, .some(let revision)):
                        guard lastOperatorTimerRevision.map({ revision >= $0 }) ?? true else {
                            throw TchurchStudioLANError.staleRevision
                        }
                    case (true, .none):
                        break
                    default:
                        throw TchurchStudioLANError.equivocatedRevision
                    }
                }
            }
            if let timerRevision {
                if lastOperatorTimerRevision.map({ timerRevision > $0 }) ?? true {
                    lastOperatorTimerRevision = timerRevision
                    lastOperatorTimersChecksum = operatorTimersChecksum
                }
            }
            lastV6ProgramPayloadChecksum = programChecksum
            lastV6OperatorTimersAvailable = timersAvailable
        } else {
            if envelope.revision == lastRevision,
               envelope.payloadChecksum != lastPayloadChecksum {
                throw TchurchStudioLANError.equivocatedRevision
            }
            lastOperatorTimerRevision = nil
            lastOperatorTimersChecksum = nil
            lastV6ProgramPayloadChecksum = nil
            lastV6OperatorTimersAvailable = nil
        }
        lastSequence = envelope.sequence
        lastRevision = envelope.revision
        lastPayloadChecksum = envelope.payloadChecksum
    }

    private static func v6ProgramPayloadChecksum(
        _ payload: TchurchStudioLANChannelPayload
    ) throws -> String {
        guard case .control(let value) = payload else {
            throw TchurchStudioLANError.invalidPayload
        }
        let control = value.control
        let programOnly = TchurchStudioLANChannelPayload.control(
            TchurchStudioLANControlPayload(
                audience: value.audience,
                stage: value.stage,
                control: TchurchStudioLANControlSupplement(
                    chordsVisible: control.chordsVisible,
                    lightingArmed: control.lightingArmed,
                    healthyOutputCount: control.healthyOutputCount,
                    expectedOutputCount: control.expectedOutputCount,
                    routeEpoch: control.routeEpoch,
                    cueCatalog: control.cueCatalog,
                    routing: control.routing,
                    cueCatalogManifest: control.cueCatalogManifest,
                    operatorTimers: nil
                )
            )
        )
        return TchurchStudioLANCrypto.sha256Hex(
            try TchurchStudioLANCoding.encoder().encode(programOnly)
        )
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
              TchurchStudioLANSignedEnvelope.supportedSchemaVersions.contains(envelope.schemaVersion),
              envelope.schemaVersion == subscription.payloadVersion else {
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
              (snapshot.revision == envelope.revision ||
                (envelope.schemaVersion == 1 && snapshot.revision <= envelope.revision)),
              snapshot.cueCount >= 0,
              snapshot.currentCueIndex.map({ $0 >= 0 && $0 < snapshot.cueCount }) ?? true,
              validOptionalText(snapshot.currentCueID, maximumBytes: limits.maximumIdentifierBytes),
              validOptionalText(snapshot.countdown?.id, maximumBytes: limits.maximumIdentifierBytes),
              validOptionalText(snapshot.countdown?.label, maximumBytes: limits.maximumTextBytes),
              snapshot.countdown.map({ validDateMilliseconds($0.targetDate) }) ?? true,
              validCue(
                audience.cue,
                allowsEmptyLines: envelope.schemaVersion >= 2,
                payloadVersion: envelope.schemaVersion
              ) else {
            throw TchurchStudioLANError.invalidPayload
        }
        if let stage = envelope.payload.stage {
            guard stage.chordLines.count <= limits.maximumChordLines,
                  stage.timers.count <= limits.maximumTimers,
                  validCue(
                    stage.nextCue,
                    allowsEmptyLines: envelope.schemaVersion >= 2,
                    payloadVersion: envelope.schemaVersion
                  ),
                  stage.chordLines.allSatisfy({ validText($0, maximumBytes: limits.maximumTextBytes) }),
                  validOptionalText(stage.message, maximumBytes: limits.maximumTextBytes),
                  stage.timers.allSatisfy({ timer in
                    validText(timer.id, maximumBytes: limits.maximumIdentifierBytes) &&
                        validText(timer.label, maximumBytes: limits.maximumTextBytes) &&
                        validDateMilliseconds(timer.anchorDate)
                  }) else {
                throw TchurchStudioLANError.invalidPayload
            }
            try validateChordSlide(
                stage.currentChordSlide,
                chordLines: stage.chordLines,
                audience: audience,
                payloadVersion: envelope.schemaVersion
            )
        } else if envelope.schemaVersion >= 2,
                  envelope.channel == .stage || envelope.channel == .control {
            throw TchurchStudioLANError.invalidPayload
        }
        if envelope.schemaVersion == 6, envelope.channel != .control {
            throw TchurchStudioLANError.invalidPayload
        }
        if envelope.channel == .control {
            guard envelope.schemaVersion == 4 || envelope.schemaVersion == 5 ||
                    envelope.schemaVersion == 6,
                  let control = envelope.payload.control,
                  let routeEpoch = control.routeEpoch,
                  routeEpoch > 0,
                  routeEpoch != UInt64.max,
                  control.healthyOutputCount >= 0,
                  control.expectedOutputCount >= 0,
                  control.healthyOutputCount <= control.expectedOutputCount,
                  control.chordsVisible || envelope.payload.stage?.currentChordSlide == nil else {
                throw TchurchStudioLANError.invalidPayload
            }
            if envelope.schemaVersion == 4 {
                guard let cueCatalog = control.cueCatalog,
                      cueCatalog.count <= snapshot.cueCount,
                      cueCatalog.count <= 4_096,
                      Set(cueCatalog.map(\.cueID)).count == cueCatalog.count,
                      cueCatalog.allSatisfy({
                          validText($0.cueID, maximumBytes: limits.maximumIdentifierBytes) &&
                              validText($0.title, maximumBytes: limits.maximumTextBytes)
                      }),
                      control.routing == nil,
                      control.cueCatalogManifest == nil,
                      control.operatorTimers == nil else {
                    throw TchurchStudioLANError.invalidPayload
                }
            } else {
                guard control.cueCatalog == nil,
                      let routing = control.routing,
                      routing.schemaVersion == TchurchStudioLANRoutingProjection.schemaVersion,
                      routing.lanRemoteControl,
                      !routing.tchurchCloudProgram,
                      routing.stageAndMusicians || !routing.tchurchCloudProgram,
                      let manifest = control.cueCatalogManifest,
                      manifest.schemaVersion == TchurchStudioLANCueCatalogManifest.schemaVersion,
                      TchurchStudioLANCueCatalogAccumulator.validCatalogID(manifest.catalogID),
                      manifest.totalCount == snapshot.cueCount,
                      (0 ... TchurchStudioLANCueCatalogManifest.maximumTotalCount).contains(manifest.totalCount),
                      manifest.pageSize == TchurchStudioLANCueCatalogManifest.pageSize,
                      envelope.schemaVersion == 5
                        ? control.operatorTimers == nil
                        : (control.operatorTimers?.isCanonical ?? true) else {
                    throw TchurchStudioLANError.invalidPayload
                }
            }
        } else if envelope.payload.control != nil {
            throw TchurchStudioLANError.invalidPayload
        }
    }

    private func validateChordSlide(
        _ slide: TchurchStudioLANChordSlide?,
        chordLines: [String],
        audience: TchurchStudioLANAudiencePayload,
        payloadVersion: Int
    ) throws {
        if payloadVersion == 1 {
            guard slide == nil else { throw TchurchStudioLANError.invalidPayload }
            return
        }
        guard payloadVersion == 2 || payloadVersion == 3 || payloadVersion == 4 ||
                payloadVersion == 5 || payloadVersion == 6 else {
            throw TchurchStudioLANError.unsupportedPayloadVersion
        }
        guard let slide else {
            guard chordLines.isEmpty else { throw TchurchStudioLANError.invalidPayload }
            return
        }
        guard let currentCueID = audience.snapshot.currentCueID,
              let currentCue = audience.cue,
              slide.cueID == currentCueID,
              slide.cueID == currentCue.cueID,
              validText(slide.cueID, maximumBytes: limits.maximumIdentifierBytes),
              validChordKey(slide.key),
              !slide.lines.isEmpty,
              slide.lines.count <= limits.maximumChordLines,
              slide.lines.map(\.text) == currentCue.lines else {
            throw TchurchStudioLANError.invalidPayload
        }
        var totalChordTokens = 0
        for line in slide.lines {
            guard validBoundedText(line.text, maximumBytes: limits.maximumTextBytes, allowsEmpty: true),
                  line.chords.count <= limits.maximumChordTokensPerLine else {
                throw TchurchStudioLANError.invalidPayload
            }
            totalChordTokens += line.chords.count
            var previousOffset = -1
            for token in line.chords {
                guard validChordToken(token.value),
                      token.offsetUtf16 >= 0,
                      token.offsetUtf16 <= line.text.utf16.count,
                      token.offsetUtf16 >= previousOffset,
                      isUTF16Boundary(token.offsetUtf16, in: line.text) else {
                    throw TchurchStudioLANError.invalidPayload
                }
                previousOffset = token.offsetUtf16
            }
        }
        guard (1 ... limits.maximumChordTokensTotal).contains(totalChordTokens),
              chordLines == legacyChordLines(from: slide) else {
            throw TchurchStudioLANError.invalidPayload
        }
    }

    private func legacyChordLines(from slide: TchurchStudioLANChordSlide) -> [String] {
        slide.lines.compactMap { line in
            let values = line.chords.map(\.value)
            return values.isEmpty ? nil : values.joined(separator: "   ")
        }
    }

    private func validChordKey(_ value: String?) -> Bool {
        guard let value else { return true }
        guard validText(value, maximumBytes: 20) else { return false }
        return value.range(
            of: "^(?:[A-G](?:#|b)?|Do|Re|Mi|Fa|Sol|La|Si)$",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    private func validChordToken(_ value: String) -> Bool {
        guard validText(value, maximumBytes: 24) else { return false }
        return value.range(
            of: "^(?:(?:[A-G](?:#|b)?)(?:(?:maj|min|m|dim|aug|sus|add)?[0-9]*)?(?:/[A-G](?:#|b)?)?|N\\.?C\\.?|[1-7](?:#|b)?(?:m)?(?:/[1-7](?:#|b)?)?)$",
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    private func isUTF16Boundary(_ offset: Int, in value: String) -> Bool {
        guard offset >= 0, offset <= value.utf16.count else { return false }
        let index = value.utf16.index(value.utf16.startIndex, offsetBy: offset)
        return String.Index(index, within: value) != nil
    }

    private func validCue(
        _ cue: TchurchStudioLANPublicCue?,
        allowsEmptyLines: Bool,
        payloadVersion: Int
    ) -> Bool {
        guard let cue = cue else { return true }
        return validText(cue.cueID, maximumBytes: limits.maximumIdentifierBytes) &&
            validOptionalText(cue.title, maximumBytes: limits.maximumTextBytes) &&
            cue.lines.count <= limits.maximumCueLines &&
            cue.lines.allSatisfy({
                validCueLine($0, allowsEmpty: allowsEmptyLines)
            }) &&
            validAssetID(cue.mediaAssetID) &&
            validImageAsset(
                cue.imageAsset,
                mediaAssetID: cue.mediaAssetID,
                payloadVersion: payloadVersion
            )
    }

    private func validImageAsset(
        _ descriptor: TchurchStudioLANImageAssetDescriptor?,
        mediaAssetID: String?,
        payloadVersion: Int
    ) -> Bool {
        guard let descriptor else { return true }
        guard payloadVersion == 3 || payloadVersion == 4 || payloadVersion == 5 ||
                payloadVersion == 6 else { return false }
        return descriptor.schemaVersion == TchurchStudioLANImageAssetDescriptor.schemaVersion &&
            descriptor.objectID == mediaAssetID &&
            validAssetID(descriptor.referenceID) &&
            validAssetID(descriptor.objectID) &&
            descriptor.kind == .image &&
            ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"]
                .contains(descriptor.mimeType) &&
            descriptor.byteSize > 0 &&
            descriptor.byteSize <= 64 * 1_024 * 1_024
    }

    private func validCueLine(_ value: String, allowsEmpty: Bool) -> Bool {
        guard validBoundedText(value, maximumBytes: limits.maximumTextBytes, allowsEmpty: allowsEmpty) else {
            return false
        }
        return allowsEmpty || value == value.trimmingCharacters(in: .whitespacesAndNewlines)
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
        validBoundedText(value, maximumBytes: maximumBytes, allowsEmpty: false)
    }

    private func validBoundedText(_ value: String, maximumBytes: Int, allowsEmpty: Bool) -> Bool {
        (allowsEmpty || !value.isEmpty) && value.utf8.count <= maximumBytes &&
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
    case approvalPending
    case deviceRevoked
    case deviceExpired
    case protocolUpgradeRequired
    case rateLimited
    case protocolViolation
    case overloaded
    case serverUnavailable
}

enum TchurchStudioLANWireMessage: Codable, Equatable {
    case challenge(
        TchurchStudioLANServerChallenge,
        supportedPayloadVersions: [Int]? = nil
    )
    case subscribe(TchurchStudioLANSubscriptionRequest)
    case grant(TchurchStudioLANSubscriptionGrant)
    case envelope(Data)
    case ping(String)
    case pong(String)
    case assetRequest(TchurchStudioLANAssetRequest)
    case assetChunk(TchurchStudioLANAssetChunk)
    case assetUnavailable(TchurchStudioLANAssetUnavailable)
    case remoteCommand(TchurchStudioLANRemoteCommand)
    case remoteReceipt(TchurchStudioLANRemoteCommandReceipt)
    case operatorTimerCommand(TchurchStudioLANOperatorTimerCommand)
    case operatorTimerReceipt(TchurchStudioLANOperatorTimerReceipt)
    case catalogRequest(TchurchStudioLANCatalogRequest)
    case catalogPage(TchurchStudioLANCatalogPage)
    case catalogUnavailable(TchurchStudioLANCatalogUnavailable)
    case error(TchurchStudioLANWireErrorCode)

    private enum Kind: String, Codable {
        case challenge, subscribe, grant, envelope, ping, pong
        case assetRequest, assetChunk, assetUnavailable
        case remoteCommand, remoteReceipt, operatorTimerCommand, operatorTimerReceipt, error
        case catalogRequest, catalogPage, catalogUnavailable
    }
    private enum CodingKeys: String, CodingKey {
        case kind, challenge, supportedPayloadVersions, request, grant, envelope, nonce
        case assetRequest, assetChunk, assetUnavailable
        case remoteCommand, remoteReceipt, operatorTimerCommand, operatorTimerReceipt, error
        case catalogRequest, catalogPage, catalogUnavailable
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .kind)
        if kind == .operatorTimerCommand || kind == .operatorTimerReceipt {
            let expected: Set<String> = [
                CodingKeys.kind.rawValue,
                kind == .operatorTimerCommand
                    ? CodingKeys.operatorTimerCommand.rawValue
                    : CodingKeys.operatorTimerReceipt.rawValue,
            ]
            try TchurchStudioLANExactObject.requireKeys(expected, from: decoder)
        }
        switch kind {
        case .challenge:
            let challenge = try container.decode(
                TchurchStudioLANServerChallenge.self,
                forKey: .challenge
            )
            let hintIsPresent = container.contains(.supportedPayloadVersions)
            let decodedHint = try container.decodeIfPresent(
                [Int].self,
                forKey: .supportedPayloadVersions
            )
            guard !hintIsPresent || decodedHint ==
                    TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions else {
                throw TchurchStudioLANError.unsupportedPayloadVersion
            }
            self = .challenge(
                challenge,
                supportedPayloadVersions: decodedHint
            )
        case .subscribe: self = .subscribe(try container.decode(TchurchStudioLANSubscriptionRequest.self, forKey: .request))
        case .grant: self = .grant(try container.decode(TchurchStudioLANSubscriptionGrant.self, forKey: .grant))
        case .envelope: self = .envelope(try container.decode(Data.self, forKey: .envelope))
        case .ping: self = .ping(try container.decode(String.self, forKey: .nonce))
        case .pong: self = .pong(try container.decode(String.self, forKey: .nonce))
        case .assetRequest:
            self = .assetRequest(try container.decode(TchurchStudioLANAssetRequest.self, forKey: .assetRequest))
        case .assetChunk:
            self = .assetChunk(try container.decode(TchurchStudioLANAssetChunk.self, forKey: .assetChunk))
        case .assetUnavailable:
            self = .assetUnavailable(
                try container.decode(TchurchStudioLANAssetUnavailable.self, forKey: .assetUnavailable)
            )
        case .remoteCommand:
            self = .remoteCommand(
                try container.decode(TchurchStudioLANRemoteCommand.self, forKey: .remoteCommand)
            )
        case .remoteReceipt:
            self = .remoteReceipt(
                try container.decode(TchurchStudioLANRemoteCommandReceipt.self, forKey: .remoteReceipt)
            )
        case .operatorTimerCommand:
            self = .operatorTimerCommand(
                try container.decode(
                    TchurchStudioLANOperatorTimerCommand.self,
                    forKey: .operatorTimerCommand
                )
            )
        case .operatorTimerReceipt:
            self = .operatorTimerReceipt(
                try container.decode(
                    TchurchStudioLANOperatorTimerReceipt.self,
                    forKey: .operatorTimerReceipt
                )
            )
        case .catalogRequest:
            self = .catalogRequest(
                try container.decode(TchurchStudioLANCatalogRequest.self, forKey: .catalogRequest)
            )
        case .catalogPage:
            self = .catalogPage(
                try container.decode(TchurchStudioLANCatalogPage.self, forKey: .catalogPage)
            )
        case .catalogUnavailable:
            self = .catalogUnavailable(
                try container.decode(TchurchStudioLANCatalogUnavailable.self, forKey: .catalogUnavailable)
            )
        case .error: self = .error(try container.decode(TchurchStudioLANWireErrorCode.self, forKey: .error))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .challenge(let value, let supportedPayloadVersions):
            try container.encode(Kind.challenge, forKey: .kind)
            try container.encode(value, forKey: .challenge)
            if let supportedPayloadVersions {
                guard supportedPayloadVersions ==
                        TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions else {
                    throw TchurchStudioLANError.unsupportedPayloadVersion
                }
                try container.encode(
                    supportedPayloadVersions,
                    forKey: .supportedPayloadVersions
                )
            }
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
        case .assetRequest(let value):
            try container.encode(Kind.assetRequest, forKey: .kind)
            try container.encode(value, forKey: .assetRequest)
        case .assetChunk(let value):
            try container.encode(Kind.assetChunk, forKey: .kind)
            try container.encode(value, forKey: .assetChunk)
        case .assetUnavailable(let value):
            try container.encode(Kind.assetUnavailable, forKey: .kind)
            try container.encode(value, forKey: .assetUnavailable)
        case .remoteCommand(let value):
            try container.encode(Kind.remoteCommand, forKey: .kind)
            try container.encode(value, forKey: .remoteCommand)
        case .remoteReceipt(let value):
            try container.encode(Kind.remoteReceipt, forKey: .kind)
            try container.encode(value, forKey: .remoteReceipt)
        case .operatorTimerCommand(let value):
            try container.encode(Kind.operatorTimerCommand, forKey: .kind)
            try container.encode(value, forKey: .operatorTimerCommand)
        case .operatorTimerReceipt(let value):
            try container.encode(Kind.operatorTimerReceipt, forKey: .kind)
            try container.encode(value, forKey: .operatorTimerReceipt)
        case .catalogRequest(let value):
            try container.encode(Kind.catalogRequest, forKey: .kind)
            try container.encode(value, forKey: .catalogRequest)
        case .catalogPage(let value):
            try container.encode(Kind.catalogPage, forKey: .kind)
            try container.encode(value, forKey: .catalogPage)
        case .catalogUnavailable(let value):
            try container.encode(Kind.catalogUnavailable, forKey: .kind)
            try container.encode(value, forKey: .catalogUnavailable)
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
