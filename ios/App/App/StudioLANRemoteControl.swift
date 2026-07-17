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
