import CryptoKit
import Foundation

enum TchurchStudioLANRemoteControlContract {
    static let schemaVersion = 1
    static let signatureDomain = "tchurch-studio-lan-remote-command-v1"
    static let receiptSignatureDomain = "tchurch-studio-lan-remote-receipt-v1"
    static let maximumCommandLifetimeMilliseconds: Int64 = 15_000
    static let maximumFutureClockSkewMilliseconds: Int64 = 5_000
    static let maximumCueIDBytes = 160
    static let maximumAmbiguousRecoveryAttempts = 2
    static let maximumAmbiguousRecoveryWindowMilliseconds: Int64 = 60_000
}

enum TchurchStudioLANRemoteActionKind: String, Codable, CaseIterable, Equatable {
    case next
    case previous
    case jump
    case setBlackout
}

/// The iOS command surface is intentionally closed. It cannot carry generic
/// media, OBS, lighting, Quick Edit, MIDI, URL, or stage-message commands.
struct TchurchStudioLANRemoteAction: Codable, Equatable {
    let kind: TchurchStudioLANRemoteActionKind
    let cueID: String?
    let enabled: Bool?

    static let next = Self(kind: .next, cueID: nil, enabled: nil)
    static let previous = Self(kind: .previous, cueID: nil, enabled: nil)

    static func jump(cueID: String) -> Self {
        Self(kind: .jump, cueID: cueID, enabled: nil)
    }

    static func setBlackout(_ enabled: Bool) -> Self {
        Self(kind: .setBlackout, cueID: nil, enabled: enabled)
    }

    var isValid: Bool {
        switch kind {
        case .next, .previous:
            return cueID == nil && enabled == nil
        case .jump:
            guard enabled == nil, let cueID else { return false }
            return !cueID.isEmpty &&
                cueID == cueID.trimmingCharacters(in: .whitespacesAndNewlines) &&
                cueID.utf8.count <= TchurchStudioLANRemoteControlContract.maximumCueIDBytes &&
                !cueID.unicodeScalars.contains(where: {
                    $0.properties.generalCategory == .control
                })
        case .setBlackout:
            return cueID == nil && enabled != nil
        }
    }
}

struct TchurchStudioLANRemoteCommand: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANRemoteControlContract.schemaVersion

    let schemaVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let expectedRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANRemoteAction
    /// ASN.1 DER P-256 ECDSA signature encoded as canonical Base64.
    let signature: String
}

/// Durable only for the lifetime of the foreground client. It captures the
/// three fields that must survive a lost receipt. Each recovery attempt is
/// signed against the newly authenticated session/grant/route while retaining
/// this command ID, action, and optimistic revision.
struct TchurchStudioLANRemoteCommandRecoveryState: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANRemoteAction
    let expectedRevision: UInt64
    let recoverUntilMilliseconds: Int64
    private(set) var recoveryAttempts: Int
    private(set) var isAwaitingAuthenticatedContext: Bool

    init(command: TchurchStudioLANRemoteCommand) {
        commandID = command.commandID
        action = command.action
        expectedRevision = command.expectedRevision
        recoverUntilMilliseconds = command.issuedAtMilliseconds +
            TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryWindowMilliseconds
        recoveryAttempts = 0
        isAwaitingAuthenticatedContext = false
    }

    mutating func markAmbiguous(nowMilliseconds: Int64) -> Bool {
        guard nowMilliseconds <= recoverUntilMilliseconds,
              recoveryAttempts < TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryAttempts else {
            return false
        }
        isAwaitingAuthenticatedContext = true
        return true
    }

    mutating func recordResignedAttempt(
        _ command: TchurchStudioLANRemoteCommand,
        nowMilliseconds: Int64
    ) throws {
        guard isAwaitingAuthenticatedContext,
              nowMilliseconds <= recoverUntilMilliseconds,
              recoveryAttempts < TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryAttempts,
              command.commandID == commandID,
              command.action == action,
              command.expectedRevision == expectedRevision else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
        recoveryAttempts += 1
        isAwaitingAuthenticatedContext = false
    }
}

private struct TchurchStudioLANRemoteCommandSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let expectedRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANRemoteAction
}

enum TchurchStudioLANRemoteCommandCrypto {
    static func signingData(for command: TchurchStudioLANRemoteCommand) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(material(for: command))
    }

    static func verify(
        _ command: TchurchStudioLANRemoteCommand,
        deviceGrant: StudioLANDeviceGrant
    ) throws {
        guard command.schemaVersion == TchurchStudioLANRemoteCommand.schemaVersion,
              command.deviceID == deviceGrant.deviceID,
              command.grantID == deviceGrant.grantID,
              command.permissionRevision == deviceGrant.permissionRevision,
              command.revocationGeneration == deviceGrant.revocationGeneration,
              command.action.isValid,
              let publicKeyData = Data(base64Encoded: deviceGrant.devicePublicKey),
              publicKeyData.count == 65,
              let publicKey = try? P256.Signing.PublicKey(x963Representation: publicKeyData),
              let signatureData = Data(base64Encoded: command.signature),
              (64 ... 80).contains(signatureData.count),
              let signature = try? P256.Signing.ECDSASignature(
                derRepresentation: signatureData
              ),
              publicKey.isValidSignature(
                signature,
                for: try signingData(for: command)
              ) else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
    }

    private static func material(
        for command: TchurchStudioLANRemoteCommand
    ) -> TchurchStudioLANRemoteCommandSigningMaterial {
        TchurchStudioLANRemoteCommandSigningMaterial(
            schemaVersion: command.schemaVersion,
            domain: TchurchStudioLANRemoteControlContract.signatureDomain,
            commandID: command.commandID,
            sessionID: command.sessionID,
            deviceID: command.deviceID,
            grantID: command.grantID,
            deviceGrantChecksum: command.deviceGrantChecksum,
            permissionRevision: command.permissionRevision,
            revocationGeneration: command.revocationGeneration,
            authority: command.authority,
            routeEpoch: command.routeEpoch,
            expectedRevision: command.expectedRevision,
            issuedAtMilliseconds: command.issuedAtMilliseconds,
            expiresAtMilliseconds: command.expiresAtMilliseconds,
            action: command.action
        )
    }
}

enum TchurchStudioLANRemoteReceiptStatus: String, Codable, Equatable {
    case accepted
    case rejected
}

enum TchurchStudioLANRemoteRejection: String, Codable, CaseIterable, Equatable {
    case routeDisabled
    case unauthorizedDevice
    case staleRoute
    case authorityMismatch
    case expiredCommand
    case invalidSignature
    case invalidCommand
    case revisionConflict
    case commandIDCollision
    case rateLimited
    case unavailable
}

struct TchurchStudioLANRemoteCommandReceipt: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANRemoteControlContract.schemaVersion

    let schemaVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANRemoteReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let revision: UInt64
    let wasIdempotentReplay: Bool
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
    let signature: String
}

private struct TchurchStudioLANRemoteReceiptSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANRemoteReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let revision: UInt64
    let wasIdempotentReplay: Bool
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
}

enum TchurchStudioLANRemoteReceiptCrypto {
    static func verify(
        _ receipt: TchurchStudioLANRemoteCommandReceipt,
        studioSigningPublicKey: String
    ) throws {
        guard receipt.schemaVersion == TchurchStudioLANRemoteCommandReceipt.schemaVersion,
              (receipt.status == .accepted) == (receipt.rejection == nil),
              let publicKeyData = Data(base64Encoded: studioSigningPublicKey),
              publicKeyData.count == 32,
              publicKeyData.base64EncodedString() == studioSigningPublicKey,
              String(TchurchStudioLANCrypto.sha256Hex(publicKeyData).prefix(24)) ==
                receipt.studioSigningKeyID,
              let signature = Data(base64Encoded: receipt.signature),
              signature.count == 64,
              signature.base64EncodedString() == receipt.signature,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData),
              key.isValidSignature(
                signature,
                for: try signingData(for: receipt)
              ) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
    }

    static func signingData(
        for receipt: TchurchStudioLANRemoteCommandReceipt
    ) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANRemoteReceiptSigningMaterial(
                schemaVersion: receipt.schemaVersion,
                domain: TchurchStudioLANRemoteControlContract.receiptSignatureDomain,
                commandID: receipt.commandID,
                deviceID: receipt.deviceID,
                authority: receipt.authority,
                routeEpoch: receipt.routeEpoch,
                permissionRevision: receipt.permissionRevision,
                status: receipt.status,
                rejection: receipt.rejection,
                revision: receipt.revision,
                wasIdempotentReplay: receipt.wasIdempotentReplay,
                issuedAtMilliseconds: receipt.issuedAtMilliseconds,
                studioSigningKeyID: receipt.studioSigningKeyID
            )
        )
    }
}

enum TchurchStudioLANRemoteControlError: Error, Equatable {
    case unavailable
    case unauthorized
    case commandInFlight
    case invalidAction
    case invalidCommand
    case invalidReceipt
}

enum TchurchStudioLANRemoteFeedbackState: String, Codable, Equatable {
    case queued
    case accepted
    case rejected
    case timedOut
    case interrupted
}

struct TchurchStudioLANRemoteFeedback: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANRemoteAction
    let state: TchurchStudioLANRemoteFeedbackState
    let rejection: TchurchStudioLANRemoteRejection?
    let revision: UInt64?
    let wasIdempotentReplay: Bool
}

enum TchurchStudioLANOperatorTimerContract {
    static let schemaVersion = 1
    static let payloadVersion = 6
    static let signatureDomain = "tchurch-studio-lan-operator-timer-command-v1"
    static let receiptSignatureDomain = "tchurch-studio-lan-operator-timer-receipt-v1"
}

enum TchurchStudioLANOperatorTimerActionKind: String, Codable, Equatable {
    case operatorTimer
}

enum TchurchStudioLANOperatorTimerOperation: String, Codable, CaseIterable, Equatable {
    case start
    case pause
}

/// This closed action cannot address Stage timers, countdowns, reset, routing,
/// OBS, Cloud, or any arbitrary command payload.
struct TchurchStudioLANOperatorTimerAction: Codable, Equatable {
    let kind: TchurchStudioLANOperatorTimerActionKind
    let scope: TchurchStudioLANOperatorTimerScope
    let operation: TchurchStudioLANOperatorTimerOperation

    static func set(
        scope: TchurchStudioLANOperatorTimerScope,
        operation: TchurchStudioLANOperatorTimerOperation
    ) -> Self {
        Self(kind: .operatorTimer, scope: scope, operation: operation)
    }

    var isValid: Bool { kind == .operatorTimer }
}

extension TchurchStudioLANOperatorTimerAction {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, scope, operation
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(TchurchStudioLANOperatorTimerActionKind.self, forKey: .kind)
        scope = try container.decode(TchurchStudioLANOperatorTimerScope.self, forKey: .scope)
        operation = try container.decode(TchurchStudioLANOperatorTimerOperation.self, forKey: .operation)
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Invalid operator timer action"
            ))
        }
    }
}

struct TchurchStudioLANOperatorTimerCommand: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANOperatorTimerContract.schemaVersion
    static let payloadVersion = TchurchStudioLANOperatorTimerContract.payloadVersion

    let schemaVersion: Int
    let payloadVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let expectedTimerRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANOperatorTimerAction
    /// ASN.1 DER P-256 ECDSA signature encoded as canonical Base64.
    let signature: String
}

extension TchurchStudioLANOperatorTimerCommand {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, payloadVersion, commandID, sessionID, deviceID, grantID
        case deviceGrantChecksum, permissionRevision, revocationGeneration, authority
        case routeEpoch, expectedTimerRevision, issuedAtMilliseconds, expiresAtMilliseconds
        case action, signature
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        payloadVersion = try container.decode(Int.self, forKey: .payloadVersion)
        commandID = try container.decode(UUID.self, forKey: .commandID)
        sessionID = try container.decode(UUID.self, forKey: .sessionID)
        deviceID = try container.decode(UUID.self, forKey: .deviceID)
        grantID = try container.decode(UUID.self, forKey: .grantID)
        deviceGrantChecksum = try container.decode(String.self, forKey: .deviceGrantChecksum)
        permissionRevision = try container.decode(UInt64.self, forKey: .permissionRevision)
        revocationGeneration = try container.decode(UInt64.self, forKey: .revocationGeneration)
        authority = try container.decode(TchurchStudioLANAuthority.self, forKey: .authority)
        routeEpoch = try container.decode(UInt64.self, forKey: .routeEpoch)
        expectedTimerRevision = try container.decode(UInt64.self, forKey: .expectedTimerRevision)
        issuedAtMilliseconds = try container.decode(Int64.self, forKey: .issuedAtMilliseconds)
        expiresAtMilliseconds = try container.decode(Int64.self, forKey: .expiresAtMilliseconds)
        action = try container.decode(TchurchStudioLANOperatorTimerAction.self, forKey: .action)
        signature = try container.decode(String.self, forKey: .signature)
    }
}

struct TchurchStudioLANOperatorTimerCommandRecoveryState: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANOperatorTimerAction
    let expectedTimerRevision: UInt64
    let recoverUntilMilliseconds: Int64
    private(set) var recoveryAttempts: Int
    private(set) var isAwaitingAuthenticatedContext: Bool

    init(command: TchurchStudioLANOperatorTimerCommand) {
        commandID = command.commandID
        action = command.action
        expectedTimerRevision = command.expectedTimerRevision
        recoverUntilMilliseconds = command.issuedAtMilliseconds +
            TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryWindowMilliseconds
        recoveryAttempts = 0
        isAwaitingAuthenticatedContext = false
    }

    mutating func markAmbiguous(nowMilliseconds: Int64) -> Bool {
        guard nowMilliseconds <= recoverUntilMilliseconds,
              recoveryAttempts < TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryAttempts else {
            return false
        }
        isAwaitingAuthenticatedContext = true
        return true
    }

    mutating func recordResignedAttempt(
        _ command: TchurchStudioLANOperatorTimerCommand,
        nowMilliseconds: Int64
    ) throws {
        guard isAwaitingAuthenticatedContext,
              nowMilliseconds <= recoverUntilMilliseconds,
              recoveryAttempts < TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryAttempts,
              command.commandID == commandID,
              command.action == action,
              command.expectedTimerRevision == expectedTimerRevision else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
        recoveryAttempts += 1
        isAwaitingAuthenticatedContext = false
    }
}

private struct TchurchStudioLANOperatorTimerCommandSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let payloadVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let expectedTimerRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANOperatorTimerAction
}

enum TchurchStudioLANOperatorTimerCommandCrypto {
    static func signingData(for command: TchurchStudioLANOperatorTimerCommand) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANOperatorTimerCommandSigningMaterial(
                schemaVersion: command.schemaVersion,
                domain: TchurchStudioLANOperatorTimerContract.signatureDomain,
                payloadVersion: command.payloadVersion,
                commandID: command.commandID,
                sessionID: command.sessionID,
                deviceID: command.deviceID,
                grantID: command.grantID,
                deviceGrantChecksum: command.deviceGrantChecksum,
                permissionRevision: command.permissionRevision,
                revocationGeneration: command.revocationGeneration,
                authority: command.authority,
                routeEpoch: command.routeEpoch,
                expectedTimerRevision: command.expectedTimerRevision,
                issuedAtMilliseconds: command.issuedAtMilliseconds,
                expiresAtMilliseconds: command.expiresAtMilliseconds,
                action: command.action
            )
        )
    }

    static func verify(
        _ command: TchurchStudioLANOperatorTimerCommand,
        deviceGrant: StudioLANDeviceGrant
    ) throws {
        guard command.schemaVersion == TchurchStudioLANOperatorTimerCommand.schemaVersion,
              command.payloadVersion == TchurchStudioLANOperatorTimerCommand.payloadVersion,
              command.deviceID == deviceGrant.deviceID,
              command.grantID == deviceGrant.grantID,
              command.permissionRevision == deviceGrant.permissionRevision,
              command.revocationGeneration == deviceGrant.revocationGeneration,
              command.routeEpoch > 0,
              command.expectedTimerRevision <=
                TchurchStudioLANOperatorTimersProjection.maximumRevision,
              command.action.isValid,
              let publicKeyData = Data(base64Encoded: deviceGrant.devicePublicKey),
              publicKeyData.count == 65,
              let publicKey = try? P256.Signing.PublicKey(x963Representation: publicKeyData),
              let signatureData = Data(base64Encoded: command.signature),
              (64 ... 80).contains(signatureData.count),
              let signature = try? P256.Signing.ECDSASignature(derRepresentation: signatureData),
              publicKey.isValidSignature(signature, for: try signingData(for: command)) else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
    }
}

struct TchurchStudioLANOperatorTimerReceipt: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANOperatorTimerContract.schemaVersion
    static let payloadVersion = TchurchStudioLANOperatorTimerContract.payloadVersion

    let schemaVersion: Int
    let payloadVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANRemoteReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let timerRevision: UInt64
    let wasIdempotentReplay: Bool
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
    let signature: String
}

extension TchurchStudioLANOperatorTimerReceipt {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, payloadVersion, commandID, deviceID, authority, routeEpoch
        case permissionRevision, status, rejection, timerRevision, wasIdempotentReplay
        case issuedAtMilliseconds, studioSigningKeyID, signature
    }

    init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: TchurchStudioLANAnyCodingKey.self)
        let statusKey = TchurchStudioLANAnyCodingKey(
            stringValue: CodingKeys.status.rawValue
        )!
        let decodedStatus = try dynamic.decode(
            TchurchStudioLANRemoteReceiptStatus.self,
            forKey: statusKey
        )
        var expected = Set(CodingKeys.allCases.map(\.rawValue))
        if decodedStatus == .accepted {
            expected.remove(CodingKeys.rejection.rawValue)
        }
        try TchurchStudioLANExactObject.requireKeys(expected, from: decoder)

        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        payloadVersion = try container.decode(Int.self, forKey: .payloadVersion)
        commandID = try container.decode(UUID.self, forKey: .commandID)
        deviceID = try container.decode(UUID.self, forKey: .deviceID)
        authority = try container.decode(TchurchStudioLANAuthority.self, forKey: .authority)
        routeEpoch = try container.decode(UInt64.self, forKey: .routeEpoch)
        permissionRevision = try container.decode(UInt64.self, forKey: .permissionRevision)
        status = decodedStatus
        rejection = try container.decodeIfPresent(
            TchurchStudioLANRemoteRejection.self,
            forKey: .rejection
        )
        timerRevision = try container.decode(UInt64.self, forKey: .timerRevision)
        wasIdempotentReplay = try container.decode(Bool.self, forKey: .wasIdempotentReplay)
        issuedAtMilliseconds = try container.decode(Int64.self, forKey: .issuedAtMilliseconds)
        studioSigningKeyID = try container.decode(String.self, forKey: .studioSigningKeyID)
        signature = try container.decode(String.self, forKey: .signature)
        guard (status == .accepted) == (rejection == nil) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Receipt status and rejection disagree"
            ))
        }
    }
}

private struct TchurchStudioLANOperatorTimerReceiptSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let payloadVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANRemoteReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let timerRevision: UInt64
    let wasIdempotentReplay: Bool
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
}

enum TchurchStudioLANOperatorTimerReceiptCrypto {
    static func signingData(for receipt: TchurchStudioLANOperatorTimerReceipt) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANOperatorTimerReceiptSigningMaterial(
                schemaVersion: receipt.schemaVersion,
                domain: TchurchStudioLANOperatorTimerContract.receiptSignatureDomain,
                payloadVersion: receipt.payloadVersion,
                commandID: receipt.commandID,
                deviceID: receipt.deviceID,
                authority: receipt.authority,
                routeEpoch: receipt.routeEpoch,
                permissionRevision: receipt.permissionRevision,
                status: receipt.status,
                rejection: receipt.rejection,
                timerRevision: receipt.timerRevision,
                wasIdempotentReplay: receipt.wasIdempotentReplay,
                issuedAtMilliseconds: receipt.issuedAtMilliseconds,
                studioSigningKeyID: receipt.studioSigningKeyID
            )
        )
    }

    static func verify(
        _ receipt: TchurchStudioLANOperatorTimerReceipt,
        studioSigningPublicKey: String
    ) throws {
        guard receipt.schemaVersion == TchurchStudioLANOperatorTimerReceipt.schemaVersion,
              receipt.payloadVersion == TchurchStudioLANOperatorTimerReceipt.payloadVersion,
              receipt.routeEpoch > 0,
              receipt.timerRevision <=
                TchurchStudioLANOperatorTimersProjection.maximumRevision,
              (receipt.status == .accepted) == (receipt.rejection == nil),
              let publicKeyData = Data(base64Encoded: studioSigningPublicKey),
              publicKeyData.count == 32,
              publicKeyData.base64EncodedString() == studioSigningPublicKey,
              String(TchurchStudioLANCrypto.sha256Hex(publicKeyData).prefix(24)) ==
                receipt.studioSigningKeyID,
              let signature = Data(base64Encoded: receipt.signature),
              signature.count == 64,
              signature.base64EncodedString() == receipt.signature,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData),
              key.isValidSignature(signature, for: try signingData(for: receipt)) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
    }
}

struct TchurchStudioLANOperatorTimerFeedback: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANOperatorTimerAction
    let state: TchurchStudioLANRemoteFeedbackState
    let rejection: TchurchStudioLANRemoteRejection?
    let timerRevision: UInt64?
    let wasIdempotentReplay: Bool
}

enum TchurchStudioLANLocalBroadcastLowerThirdContract {
    static let schemaVersion = 1
    static let payloadVersion = 7
    static let signatureDomain =
        "tchurch-studio-lan-local-broadcast-lower-third-command-v1"
    static let receiptSignatureDomain =
        "tchurch-studio-lan-local-broadcast-lower-third-receipt-v1"
}

enum TchurchStudioLANLocalBroadcastLowerThirdActionKind: String, Codable, Equatable {
    case localBroadcastLowerThird
}

enum TchurchStudioLANLocalBroadcastLowerThirdOperation: String, Codable, Equatable {
    case show
    case hide
}

struct TchurchStudioLANLocalBroadcastLowerThirdAction: Codable, Equatable {
    let kind: TchurchStudioLANLocalBroadcastLowerThirdActionKind
    let operation: TchurchStudioLANLocalBroadcastLowerThirdOperation
    let title: String?
    let subtitle: String?

    static func show(title: String, subtitle: String? = nil) -> Self {
        Self(
            kind: .localBroadcastLowerThird,
            operation: .show,
            title: title,
            subtitle: subtitle
        )
    }

    static let hide = Self(
        kind: .localBroadcastLowerThird,
        operation: .hide,
        title: nil,
        subtitle: nil
    )

    var isValid: Bool {
        guard kind == .localBroadcastLowerThird else { return false }
        switch operation {
        case .show:
            guard let title,
                  TchurchStudioLANLocalBroadcastLowerThirdProjection.validSingleLine(
                    title,
                    maximumBytes:
                        TchurchStudioLANLocalBroadcastLowerThirdProjection.maximumTitleBytes
                  ) else {
                return false
            }
            return subtitle.map {
                TchurchStudioLANLocalBroadcastLowerThirdProjection.validSingleLine(
                    $0,
                    maximumBytes:
                        TchurchStudioLANLocalBroadcastLowerThirdProjection.maximumSubtitleBytes
                )
            } ?? true
        case .hide:
            return title == nil && subtitle == nil
        }
    }
}

extension TchurchStudioLANLocalBroadcastLowerThirdAction {
    private enum CodingKeys: String, CodingKey {
        case kind, operation, title, subtitle
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        operation = try container.decode(
            TchurchStudioLANLocalBroadcastLowerThirdOperation.self,
            forKey: .operation
        )
        var expected: Set<String> = [CodingKeys.kind.rawValue, CodingKeys.operation.rawValue]
        if operation == .show {
            expected.insert(CodingKeys.title.rawValue)
            let anyContainer = try decoder.container(
                keyedBy: TchurchStudioLANAnyCodingKey.self
            )
            if anyContainer.contains(
                TchurchStudioLANAnyCodingKey(stringValue: CodingKeys.subtitle.rawValue)!
            ) {
                expected.insert(CodingKeys.subtitle.rawValue)
            }
        }
        try TchurchStudioLANExactObject.requireKeys(expected, from: decoder)
        kind = try container.decode(
            TchurchStudioLANLocalBroadcastLowerThirdActionKind.self,
            forKey: .kind
        )
        title = container.contains(.title)
            ? try container.decode(String.self, forKey: .title)
            : nil
        subtitle = container.contains(.subtitle)
            ? try container.decode(String.self, forKey: .subtitle)
            : nil
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Invalid local broadcast lower-third action"
            ))
        }
    }
}

struct TchurchStudioLANLocalBroadcastLowerThirdCommand: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANLocalBroadcastLowerThirdContract.schemaVersion
    static let payloadVersion = TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion

    let schemaVersion: Int
    let payloadVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let expectedLowerThirdRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANLocalBroadcastLowerThirdAction
    let signature: String
}

extension TchurchStudioLANLocalBroadcastLowerThirdCommand {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, payloadVersion, commandID, sessionID, deviceID, grantID
        case deviceGrantChecksum, permissionRevision, revocationGeneration, authority
        case routeEpoch, expectedLowerThirdRevision, issuedAtMilliseconds, expiresAtMilliseconds
        case action, signature
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        payloadVersion = try container.decode(Int.self, forKey: .payloadVersion)
        commandID = try container.decode(UUID.self, forKey: .commandID)
        sessionID = try container.decode(UUID.self, forKey: .sessionID)
        deviceID = try container.decode(UUID.self, forKey: .deviceID)
        grantID = try container.decode(UUID.self, forKey: .grantID)
        deviceGrantChecksum = try container.decode(String.self, forKey: .deviceGrantChecksum)
        permissionRevision = try container.decode(UInt64.self, forKey: .permissionRevision)
        revocationGeneration = try container.decode(UInt64.self, forKey: .revocationGeneration)
        authority = try container.decode(TchurchStudioLANAuthority.self, forKey: .authority)
        routeEpoch = try container.decode(UInt64.self, forKey: .routeEpoch)
        expectedLowerThirdRevision = try container.decode(
            UInt64.self,
            forKey: .expectedLowerThirdRevision
        )
        issuedAtMilliseconds = try container.decode(Int64.self, forKey: .issuedAtMilliseconds)
        expiresAtMilliseconds = try container.decode(Int64.self, forKey: .expiresAtMilliseconds)
        action = try container.decode(
            TchurchStudioLANLocalBroadcastLowerThirdAction.self,
            forKey: .action
        )
        signature = try container.decode(String.self, forKey: .signature)
    }
}

struct TchurchStudioLANLocalBroadcastLowerThirdCommandRecoveryState: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANLocalBroadcastLowerThirdAction
    let expectedLowerThirdRevision: UInt64
    let recoverUntilMilliseconds: Int64
    private(set) var recoveryAttempts: Int
    private(set) var isAwaitingAuthenticatedContext: Bool

    init(command: TchurchStudioLANLocalBroadcastLowerThirdCommand) {
        commandID = command.commandID
        action = command.action
        expectedLowerThirdRevision = command.expectedLowerThirdRevision
        recoverUntilMilliseconds = command.issuedAtMilliseconds +
            TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryWindowMilliseconds
        recoveryAttempts = 0
        isAwaitingAuthenticatedContext = false
    }

    mutating func markAmbiguous(nowMilliseconds: Int64) -> Bool {
        guard nowMilliseconds <= recoverUntilMilliseconds,
              recoveryAttempts <
                TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryAttempts else {
            return false
        }
        isAwaitingAuthenticatedContext = true
        return true
    }

    mutating func recordResignedAttempt(
        _ command: TchurchStudioLANLocalBroadcastLowerThirdCommand,
        nowMilliseconds: Int64
    ) throws {
        guard isAwaitingAuthenticatedContext,
              nowMilliseconds <= recoverUntilMilliseconds,
              recoveryAttempts <
                TchurchStudioLANRemoteControlContract.maximumAmbiguousRecoveryAttempts,
              command.commandID == commandID,
              command.action == action,
              command.expectedLowerThirdRevision == expectedLowerThirdRevision else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
        recoveryAttempts += 1
        isAwaitingAuthenticatedContext = false
    }
}

private struct TchurchStudioLANLocalBroadcastLowerThirdCommandSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let payloadVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let expectedLowerThirdRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANLocalBroadcastLowerThirdAction
}

enum TchurchStudioLANLocalBroadcastLowerThirdCommandCrypto {
    static func signingData(
        for command: TchurchStudioLANLocalBroadcastLowerThirdCommand
    ) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANLocalBroadcastLowerThirdCommandSigningMaterial(
                schemaVersion: command.schemaVersion,
                domain: TchurchStudioLANLocalBroadcastLowerThirdContract.signatureDomain,
                payloadVersion: command.payloadVersion,
                commandID: command.commandID,
                sessionID: command.sessionID,
                deviceID: command.deviceID,
                grantID: command.grantID,
                deviceGrantChecksum: command.deviceGrantChecksum,
                permissionRevision: command.permissionRevision,
                revocationGeneration: command.revocationGeneration,
                authority: command.authority,
                routeEpoch: command.routeEpoch,
                expectedLowerThirdRevision: command.expectedLowerThirdRevision,
                issuedAtMilliseconds: command.issuedAtMilliseconds,
                expiresAtMilliseconds: command.expiresAtMilliseconds,
                action: command.action
            )
        )
    }

    static func verify(
        _ command: TchurchStudioLANLocalBroadcastLowerThirdCommand,
        deviceGrant: StudioLANDeviceGrant
    ) throws {
        guard command.schemaVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdCommand.schemaVersion,
              command.payloadVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdCommand.payloadVersion,
              command.deviceID == deviceGrant.deviceID,
              command.grantID == deviceGrant.grantID,
              command.permissionRevision == deviceGrant.permissionRevision,
              command.revocationGeneration == deviceGrant.revocationGeneration,
              command.routeEpoch > 0,
              command.expectedLowerThirdRevision <=
                TchurchStudioLANLocalBroadcastLowerThirdProjection.maximumRevision,
              command.action.isValid,
              let publicKeyData = Data(base64Encoded: deviceGrant.devicePublicKey),
              publicKeyData.count == 65,
              let publicKey = try? P256.Signing.PublicKey(x963Representation: publicKeyData),
              let signatureData = Data(base64Encoded: command.signature),
              (64 ... 80).contains(signatureData.count),
              let signature = try? P256.Signing.ECDSASignature(
                derRepresentation: signatureData
              ),
              publicKey.isValidSignature(signature, for: try signingData(for: command)) else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
    }
}

struct TchurchStudioLANLocalBroadcastLowerThirdReceipt: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANLocalBroadcastLowerThirdContract.schemaVersion
    static let payloadVersion = TchurchStudioLANLocalBroadcastLowerThirdContract.payloadVersion

    let schemaVersion: Int
    let payloadVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANRemoteReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let lowerThirdRevision: UInt64
    let wasIdempotentReplay: Bool
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
    let signature: String
}

extension TchurchStudioLANLocalBroadcastLowerThirdReceipt {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, payloadVersion, commandID, deviceID, authority, routeEpoch
        case permissionRevision, status, rejection, lowerThirdRevision, wasIdempotentReplay
        case issuedAtMilliseconds, studioSigningKeyID, signature
    }

    init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: TchurchStudioLANAnyCodingKey.self)
        let statusKey = TchurchStudioLANAnyCodingKey(
            stringValue: CodingKeys.status.rawValue
        )!
        let decodedStatus = try dynamic.decode(
            TchurchStudioLANRemoteReceiptStatus.self,
            forKey: statusKey
        )
        var expected = Set(CodingKeys.allCases.map(\.rawValue))
        if decodedStatus == .accepted {
            expected.remove(CodingKeys.rejection.rawValue)
        }
        try TchurchStudioLANExactObject.requireKeys(expected, from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        payloadVersion = try container.decode(Int.self, forKey: .payloadVersion)
        commandID = try container.decode(UUID.self, forKey: .commandID)
        deviceID = try container.decode(UUID.self, forKey: .deviceID)
        authority = try container.decode(TchurchStudioLANAuthority.self, forKey: .authority)
        routeEpoch = try container.decode(UInt64.self, forKey: .routeEpoch)
        permissionRevision = try container.decode(UInt64.self, forKey: .permissionRevision)
        status = decodedStatus
        rejection = try container.decodeIfPresent(
            TchurchStudioLANRemoteRejection.self,
            forKey: .rejection
        )
        lowerThirdRevision = try container.decode(UInt64.self, forKey: .lowerThirdRevision)
        wasIdempotentReplay = try container.decode(Bool.self, forKey: .wasIdempotentReplay)
        issuedAtMilliseconds = try container.decode(Int64.self, forKey: .issuedAtMilliseconds)
        studioSigningKeyID = try container.decode(String.self, forKey: .studioSigningKeyID)
        signature = try container.decode(String.self, forKey: .signature)
        guard (status == .accepted) == (rejection == nil) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Receipt status and rejection disagree"
            ))
        }
    }
}

private struct TchurchStudioLANLocalBroadcastLowerThirdReceiptSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let payloadVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANRemoteReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let lowerThirdRevision: UInt64
    let wasIdempotentReplay: Bool
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
}

enum TchurchStudioLANLocalBroadcastLowerThirdReceiptCrypto {
    static func signingData(
        for receipt: TchurchStudioLANLocalBroadcastLowerThirdReceipt
    ) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANLocalBroadcastLowerThirdReceiptSigningMaterial(
                schemaVersion: receipt.schemaVersion,
                domain: TchurchStudioLANLocalBroadcastLowerThirdContract.receiptSignatureDomain,
                payloadVersion: receipt.payloadVersion,
                commandID: receipt.commandID,
                deviceID: receipt.deviceID,
                authority: receipt.authority,
                routeEpoch: receipt.routeEpoch,
                permissionRevision: receipt.permissionRevision,
                status: receipt.status,
                rejection: receipt.rejection,
                lowerThirdRevision: receipt.lowerThirdRevision,
                wasIdempotentReplay: receipt.wasIdempotentReplay,
                issuedAtMilliseconds: receipt.issuedAtMilliseconds,
                studioSigningKeyID: receipt.studioSigningKeyID
            )
        )
    }

    static func verify(
        _ receipt: TchurchStudioLANLocalBroadcastLowerThirdReceipt,
        studioSigningPublicKey: String
    ) throws {
        guard receipt.schemaVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdReceipt.schemaVersion,
              receipt.payloadVersion ==
                TchurchStudioLANLocalBroadcastLowerThirdReceipt.payloadVersion,
              receipt.routeEpoch > 0,
              receipt.lowerThirdRevision <=
                TchurchStudioLANLocalBroadcastLowerThirdProjection.maximumRevision,
              (receipt.status == .accepted) == (receipt.rejection == nil),
              let publicKeyData = Data(base64Encoded: studioSigningPublicKey),
              publicKeyData.count == 32,
              publicKeyData.base64EncodedString() == studioSigningPublicKey,
              String(TchurchStudioLANCrypto.sha256Hex(publicKeyData).prefix(24)) ==
                receipt.studioSigningKeyID,
              let signature = Data(base64Encoded: receipt.signature),
              signature.count == 64,
              signature.base64EncodedString() == receipt.signature,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData),
              key.isValidSignature(signature, for: try signingData(for: receipt)) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
    }
}

struct TchurchStudioLANLocalBroadcastLowerThirdFeedback: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANLocalBroadcastLowerThirdAction
    let state: TchurchStudioLANRemoteFeedbackState
    let rejection: TchurchStudioLANRemoteRejection?
    let lowerThirdRevision: UInt64?
    let wasIdempotentReplay: Bool
}

enum TchurchStudioLANLocalOBSSceneContract {
    static let schemaVersion = 1
    static let payloadVersion = 8
    static let signatureDomain = "tchurch-studio-lan-local-obs-scene-command-v1"
    static let receiptSignatureDomain = "tchurch-studio-lan-local-obs-scene-receipt-v1"
}

enum TchurchStudioLANLocalOBSSceneActionKind: String, Codable, Equatable {
    case selectLocalOBSScene
}

/// The only V8 OBS mutation is selecting one scene from Studio's signed
/// allowlist. The action cannot carry endpoints, credentials, stream/record
/// operations, routing, Stage, Cloud, lighting, or arbitrary payloads.
struct TchurchStudioLANLocalOBSSceneAction: Codable, Equatable {
    let kind: TchurchStudioLANLocalOBSSceneActionKind
    let sceneID: String

    static func select(sceneID: String) -> Self {
        Self(kind: .selectLocalOBSScene, sceneID: sceneID)
    }

    var isValid: Bool {
        kind == .selectLocalOBSScene &&
            TchurchStudioLANLocalOBSScene.validSceneID(sceneID)
    }
}

extension TchurchStudioLANLocalOBSSceneAction {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case kind, sceneID
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(TchurchStudioLANLocalOBSSceneActionKind.self, forKey: .kind)
        sceneID = try container.decode(String.self, forKey: .sceneID)
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Invalid local OBS scene action"
            ))
        }
    }
}

struct TchurchStudioLANLocalOBSSceneCommand: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANLocalOBSSceneContract.schemaVersion
    static let payloadVersion = TchurchStudioLANLocalOBSSceneContract.payloadVersion

    let schemaVersion: Int
    let payloadVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let connectionID: String
    let expectedOBSRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANLocalOBSSceneAction
    let signature: String
}

extension TchurchStudioLANLocalOBSSceneCommand {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, payloadVersion, commandID, sessionID, deviceID, grantID
        case deviceGrantChecksum, permissionRevision, revocationGeneration, authority
        case routeEpoch, connectionID, expectedOBSRevision, issuedAtMilliseconds
        case expiresAtMilliseconds
        case action, signature
    }

    init(from decoder: Decoder) throws {
        try TchurchStudioLANExactObject.requireKeys(
            Set(CodingKeys.allCases.map(\.rawValue)),
            from: decoder
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        payloadVersion = try container.decode(Int.self, forKey: .payloadVersion)
        commandID = try container.decode(UUID.self, forKey: .commandID)
        sessionID = try container.decode(UUID.self, forKey: .sessionID)
        deviceID = try container.decode(UUID.self, forKey: .deviceID)
        grantID = try container.decode(UUID.self, forKey: .grantID)
        deviceGrantChecksum = try container.decode(String.self, forKey: .deviceGrantChecksum)
        permissionRevision = try container.decode(UInt64.self, forKey: .permissionRevision)
        revocationGeneration = try container.decode(UInt64.self, forKey: .revocationGeneration)
        authority = try container.decode(TchurchStudioLANAuthority.self, forKey: .authority)
        routeEpoch = try container.decode(UInt64.self, forKey: .routeEpoch)
        connectionID = try container.decode(String.self, forKey: .connectionID)
        expectedOBSRevision = try container.decode(UInt64.self, forKey: .expectedOBSRevision)
        issuedAtMilliseconds = try container.decode(Int64.self, forKey: .issuedAtMilliseconds)
        expiresAtMilliseconds = try container.decode(Int64.self, forKey: .expiresAtMilliseconds)
        action = try container.decode(TchurchStudioLANLocalOBSSceneAction.self, forKey: .action)
        signature = try container.decode(String.self, forKey: .signature)
    }
}

private struct TchurchStudioLANLocalOBSSceneCommandSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let payloadVersion: Int
    let commandID: UUID
    let sessionID: UUID
    let deviceID: UUID
    let grantID: UUID
    let deviceGrantChecksum: String
    let permissionRevision: UInt64
    let revocationGeneration: UInt64
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let connectionID: String
    let expectedOBSRevision: UInt64
    let issuedAtMilliseconds: Int64
    let expiresAtMilliseconds: Int64
    let action: TchurchStudioLANLocalOBSSceneAction
}

enum TchurchStudioLANLocalOBSSceneCommandCrypto {
    static func signingData(for command: TchurchStudioLANLocalOBSSceneCommand) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANLocalOBSSceneCommandSigningMaterial(
                schemaVersion: command.schemaVersion,
                domain: TchurchStudioLANLocalOBSSceneContract.signatureDomain,
                payloadVersion: command.payloadVersion,
                commandID: command.commandID,
                sessionID: command.sessionID,
                deviceID: command.deviceID,
                grantID: command.grantID,
                deviceGrantChecksum: command.deviceGrantChecksum,
                permissionRevision: command.permissionRevision,
                revocationGeneration: command.revocationGeneration,
                authority: command.authority,
                routeEpoch: command.routeEpoch,
                connectionID: command.connectionID,
                expectedOBSRevision: command.expectedOBSRevision,
                issuedAtMilliseconds: command.issuedAtMilliseconds,
                expiresAtMilliseconds: command.expiresAtMilliseconds,
                action: command.action
            )
        )
    }

    static func verify(
        _ command: TchurchStudioLANLocalOBSSceneCommand,
        deviceGrant: StudioLANDeviceGrant
    ) throws {
        guard command.schemaVersion == TchurchStudioLANLocalOBSSceneCommand.schemaVersion,
              command.payloadVersion == TchurchStudioLANLocalOBSSceneCommand.payloadVersion,
              command.deviceID == deviceGrant.deviceID,
              command.grantID == deviceGrant.grantID,
              command.permissionRevision == deviceGrant.permissionRevision,
              command.revocationGeneration == deviceGrant.revocationGeneration,
              command.routeEpoch > 0,
              TchurchStudioLANLocalOBSProjection.validConnectionID(command.connectionID),
              (1 ... TchurchStudioLANLocalOBSProjection.maximumRevision).contains(
                command.expectedOBSRevision
              ),
              command.action.isValid,
              let publicKeyData = Data(base64Encoded: deviceGrant.devicePublicKey),
              publicKeyData.count == 65,
              let publicKey = try? P256.Signing.PublicKey(x963Representation: publicKeyData),
              let signatureData = Data(base64Encoded: command.signature),
              (64 ... 80).contains(signatureData.count),
              let signature = try? P256.Signing.ECDSASignature(
                derRepresentation: signatureData
              ),
              publicKey.isValidSignature(signature, for: try signingData(for: command)) else {
            throw TchurchStudioLANRemoteControlError.invalidCommand
        }
    }
}

enum TchurchStudioLANLocalOBSSceneReceiptStatus: String, Codable, Equatable {
    case accepted
    case rejected
    case unconfirmed
}

enum TchurchStudioLANLocalOBSSceneUncertaintyReason: String, Codable, Equatable {
    case mutationMayHaveExecuted
}

struct TchurchStudioLANLocalOBSSceneReceipt: Codable, Equatable {
    static let schemaVersion = TchurchStudioLANLocalOBSSceneContract.schemaVersion
    static let payloadVersion = TchurchStudioLANLocalOBSSceneContract.payloadVersion

    let schemaVersion: Int
    let payloadVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANLocalOBSSceneReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let uncertaintyReason: TchurchStudioLANLocalOBSSceneUncertaintyReason?
    let connectionID: String
    let requestedSceneID: String
    let obsRevision: UInt64
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
    let signature: String
}

extension TchurchStudioLANLocalOBSSceneReceipt {
    private enum CodingKeys: String, CodingKey, CaseIterable {
        case schemaVersion, payloadVersion, commandID, deviceID, authority, routeEpoch
        case permissionRevision, status, rejection, uncertaintyReason, connectionID
        case requestedSceneID, obsRevision
        case issuedAtMilliseconds, studioSigningKeyID, signature
    }

    init(from decoder: Decoder) throws {
        let dynamic = try decoder.container(keyedBy: TchurchStudioLANAnyCodingKey.self)
        let statusKey = TchurchStudioLANAnyCodingKey(stringValue: CodingKeys.status.rawValue)!
        let decodedStatus = try dynamic.decode(
            TchurchStudioLANLocalOBSSceneReceiptStatus.self,
            forKey: statusKey
        )
        var expected = Set(CodingKeys.allCases.map(\.rawValue))
        if decodedStatus != .rejected { expected.remove(CodingKeys.rejection.rawValue) }
        if decodedStatus != .unconfirmed {
            expected.remove(CodingKeys.uncertaintyReason.rawValue)
        }
        try TchurchStudioLANExactObject.requireKeys(expected, from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        payloadVersion = try container.decode(Int.self, forKey: .payloadVersion)
        commandID = try container.decode(UUID.self, forKey: .commandID)
        deviceID = try container.decode(UUID.self, forKey: .deviceID)
        authority = try container.decode(TchurchStudioLANAuthority.self, forKey: .authority)
        routeEpoch = try container.decode(UInt64.self, forKey: .routeEpoch)
        permissionRevision = try container.decode(UInt64.self, forKey: .permissionRevision)
        status = decodedStatus
        rejection = try container.decodeIfPresent(
            TchurchStudioLANRemoteRejection.self,
            forKey: .rejection
        )
        uncertaintyReason = try container.decodeIfPresent(
            TchurchStudioLANLocalOBSSceneUncertaintyReason.self,
            forKey: .uncertaintyReason
        )
        connectionID = try container.decode(String.self, forKey: .connectionID)
        requestedSceneID = try container.decode(String.self, forKey: .requestedSceneID)
        obsRevision = try container.decode(UInt64.self, forKey: .obsRevision)
        issuedAtMilliseconds = try container.decode(Int64.self, forKey: .issuedAtMilliseconds)
        studioSigningKeyID = try container.decode(String.self, forKey: .studioSigningKeyID)
        signature = try container.decode(String.self, forKey: .signature)
        guard (status == .rejected) == (rejection != nil),
              (status == .unconfirmed) == (uncertaintyReason != nil) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "Receipt status and rejection disagree"
            ))
        }
    }
}

private struct TchurchStudioLANLocalOBSSceneReceiptSigningMaterial: Codable {
    let schemaVersion: Int
    let domain: String
    let payloadVersion: Int
    let commandID: UUID
    let deviceID: UUID
    let authority: TchurchStudioLANAuthority
    let routeEpoch: UInt64
    let permissionRevision: UInt64
    let status: TchurchStudioLANLocalOBSSceneReceiptStatus
    let rejection: TchurchStudioLANRemoteRejection?
    let uncertaintyReason: TchurchStudioLANLocalOBSSceneUncertaintyReason?
    let connectionID: String
    let requestedSceneID: String
    let obsRevision: UInt64
    let issuedAtMilliseconds: Int64
    let studioSigningKeyID: String
}

enum TchurchStudioLANLocalOBSSceneReceiptCrypto {
    static func signingData(for receipt: TchurchStudioLANLocalOBSSceneReceipt) throws -> Data {
        try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANLocalOBSSceneReceiptSigningMaterial(
                schemaVersion: receipt.schemaVersion,
                domain: TchurchStudioLANLocalOBSSceneContract.receiptSignatureDomain,
                payloadVersion: receipt.payloadVersion,
                commandID: receipt.commandID,
                deviceID: receipt.deviceID,
                authority: receipt.authority,
                routeEpoch: receipt.routeEpoch,
                permissionRevision: receipt.permissionRevision,
                status: receipt.status,
                rejection: receipt.rejection,
                uncertaintyReason: receipt.uncertaintyReason,
                connectionID: receipt.connectionID,
                requestedSceneID: receipt.requestedSceneID,
                obsRevision: receipt.obsRevision,
                issuedAtMilliseconds: receipt.issuedAtMilliseconds,
                studioSigningKeyID: receipt.studioSigningKeyID
            )
        )
    }

    static func verify(
        _ receipt: TchurchStudioLANLocalOBSSceneReceipt,
        studioSigningPublicKey: String
    ) throws {
        guard receipt.schemaVersion == TchurchStudioLANLocalOBSSceneReceipt.schemaVersion,
              receipt.payloadVersion == TchurchStudioLANLocalOBSSceneReceipt.payloadVersion,
              receipt.routeEpoch > 0,
              (1 ... TchurchStudioLANLocalOBSProjection.maximumRevision).contains(
                receipt.obsRevision
              ),
              (receipt.status == .rejected) == (receipt.rejection != nil),
              (receipt.status == .unconfirmed) == (receipt.uncertaintyReason != nil),
              TchurchStudioLANLocalOBSProjection.validConnectionID(receipt.connectionID),
              TchurchStudioLANLocalOBSScene.validSceneID(receipt.requestedSceneID),
              let publicKeyData = Data(base64Encoded: studioSigningPublicKey),
              publicKeyData.count == 32,
              publicKeyData.base64EncodedString() == studioSigningPublicKey,
              String(TchurchStudioLANCrypto.sha256Hex(publicKeyData).prefix(24)) ==
                receipt.studioSigningKeyID,
              let signature = Data(base64Encoded: receipt.signature),
              signature.count == 64,
              signature.base64EncodedString() == receipt.signature,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData),
              key.isValidSignature(signature, for: try signingData(for: receipt)) else {
            throw TchurchStudioLANRemoteControlError.invalidReceipt
        }
    }
}

struct TchurchStudioLANLocalOBSSceneFeedback: Equatable {
    let commandID: UUID
    let action: TchurchStudioLANLocalOBSSceneAction
    let state: TchurchStudioLANLocalOBSSceneFeedbackState
    let rejection: TchurchStudioLANRemoteRejection?
    let uncertaintyReason: TchurchStudioLANLocalOBSSceneUncertaintyReason?
    let obsRevision: UInt64?
}

enum TchurchStudioLANLocalOBSSceneFeedbackState: String, Equatable {
    case queued
    case accepted
    case rejected
    case unconfirmed
    case interrupted
}
