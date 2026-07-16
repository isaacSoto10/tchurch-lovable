import CryptoKit
import Network
import XCTest
@testable import Tchurch

final class StudioLANClientCoreTests: XCTestCase {
    func testPairingCodeAcceptsBase64AndBase64URLWithoutEverDescribingSecret() throws {
        let raw = Data((0 ..< 32).map(UInt8.init))
        let base64 = raw.base64EncodedString()
        let base64URL = base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let standard = try TchurchStudioLANPairingSecret(pairingCode: base64)
        let url = try TchurchStudioLANPairingSecret(pairingCode: "tchurch-studio:\n\(base64URL)")
        XCTAssertEqual(standard.transportKeyMaterial, raw)
        XCTAssertEqual(url.transportKeyMaterial, raw)
        XCTAssertEqual(standard.description, "TchurchStudioLANPairingSecret(<redacted>)")
        XCTAssertFalse(standard.description.contains(base64))
        XCTAssertThrowsError(try TchurchStudioLANPairingSecret(pairingCode: Data(repeating: 1, count: 31).base64EncodedString())) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPairingCode)
        }
    }

    func testSubscriptionProofMatchesContractAndWrongSecretFailsClosed() throws {
        let secret = try fixedSecret(0x41)
        let wrongSecret = try fixedSecret(0x42)
        let identity = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 0x33, count: 32))
        let challenge = makeChallenge(identity: identity)
        let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: secret,
            requestID: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            clientNonce: Data(repeating: 0x21, count: 24)
        )
        let independentlyEncodedProof = TestRequestProof(
            challenge: challenge,
            requestID: request.requestID,
            clientID: request.clientID,
            clientName: request.clientName,
            channel: request.channel,
            clientNonce: request.clientNonce
        )
        XCTAssertTrue(TchurchStudioLANCrypto.validatesAuthenticationCode(
            request.authenticationProof,
            for: independentlyEncodedProof,
            secret: secret
        ))

        let grant = try makeGrant(
            challenge: challenge,
            request: request,
            identity: identity,
            secret: secret
        )
        XCTAssertNoThrow(try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            grant,
            request: request,
            challenge: challenge,
            secret: secret,
            nowMilliseconds: 1_000_100
        ))
        XCTAssertThrowsError(try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            grant,
            request: request,
            challenge: challenge,
            secret: wrongSecret,
            nowMilliseconds: 1_000_100
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidAuthenticationProof)
        }
    }

    func testEnvelopeVerificationRejectsTamperWrongChannelAndControlPayload() throws {
        let fixture = try makeSubscriptionFixture(channel: .stage)
        let verifier = try TchurchStudioLANEnvelopeVerifier(subscription: fixture.subscription)
        let payload = stagePayload(revision: 8)
        let envelope = try signEnvelope(
            payload: payload,
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8
        )
        XCTAssertEqual(try verifier.verify(TchurchStudioLANCoding.encoder().encode(envelope)), envelope)

        let changedPayload = TchurchStudioLANChannelPayload.stage(.init(
            audience: .init(
                snapshot: payload.audience.snapshot,
                cue: .init(cueID: "cue-1", title: "Verse", lines: ["Changed"], mediaAssetID: nil)
            ),
            stage: payload.stage!
        ))
        let checksumTampered = tamperedEnvelope(envelope, payload: changedPayload, checksum: envelope.payloadChecksum)
        XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(checksumTampered))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidChecksum)
        }

        let recomputedChecksum = TchurchStudioLANCrypto.sha256Hex(
            try TchurchStudioLANCoding.encoder().encode(changedPayload)
        )
        let signatureTampered = tamperedEnvelope(envelope, payload: changedPayload, checksum: recomputedChecksum)
        XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(signatureTampered))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidSignature)
        }

        let audienceFixture = try makeSubscriptionFixture(channel: .audience)
        let audienceEnvelope = try signEnvelope(
            payload: .audience(payload.audience),
            authority: audienceFixture.challenge.authority,
            identity: audienceFixture.identity,
            sequence: 12,
            revision: 8
        )
        XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(audienceEnvelope))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .wrongChannel)
        }

        let control = Data(#"{"channel":"control","control":{"privateNotes":"must not decode"}}"#.utf8)
        XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(TchurchStudioLANChannelPayload.self, from: control)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .unsupportedChannel)
        }
    }

    func testReplayGuardPreservesMonotonicStateAcrossReconnectAndEpochRotation() throws {
        let fixture = try makeSubscriptionFixture(channel: .stage)
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        let first = try signEnvelope(
            payload: stagePayload(revision: 8),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8
        )
        try guardState.accept(first)

        try guardState.begin(fixture.subscription)
        XCTAssertThrowsError(try guardState.accept(first)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .replayedEnvelope)
        }
        let next = try signEnvelope(
            payload: stagePayload(revision: 9),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 13,
            revision: 9
        )
        XCTAssertNoThrow(try guardState.accept(next))

        let rotated = try makeSubscriptionFixture(channel: .stage, epoch: 8, identity: fixture.identity)
        XCTAssertNoThrow(try guardState.begin(rotated.subscription))
        XCTAssertNil(guardState.lastSequence)
        let old = try makeSubscriptionFixture(channel: .stage, epoch: 7, identity: fixture.identity)
        XCTAssertThrowsError(try guardState.begin(old.subscription)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .staleAuthorityEpoch)
        }
    }

    func testEnvelopeVerificationRejectsDatesOutsideBridgeIntegerRange() throws {
        let fixture = try makeSubscriptionFixture(channel: .stage)
        let verifier = try TchurchStudioLANEnvelopeVerifier(subscription: fixture.subscription)
        guard case .stage(let baseline) = stagePayload(revision: 8) else {
            return XCTFail("Expected stage payload")
        }
        let invalidDate = Date(timeIntervalSince1970: 1e20)
        let payload = TchurchStudioLANChannelPayload.stage(.init(
            audience: baseline.audience,
            stage: .init(
                nextCue: baseline.stage.nextCue,
                chordLines: baseline.stage.chordLines,
                timers: [.init(
                    id: "service",
                    label: "Servicio",
                    mode: .countDown,
                    anchorDate: invalidDate,
                    anchorValueMilliseconds: 5_000,
                    durationMilliseconds: 60_000,
                    isRunning: true
                )],
                message: baseline.stage.message
            )
        ))
        let envelope = try signEnvelope(
            payload: payload,
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8
        )

        XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(envelope))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload)
        }
    }

    func testReplayGuardResetsForAuthenticatedSigningKeyChangeButRejectsSameKeyReplay() throws {
        let original = try makeSubscriptionFixture(channel: .stage)
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(original.subscription)
        let beforeRestart = try signEnvelope(
            payload: stagePayload(revision: 8),
            authority: original.challenge.authority,
            identity: original.identity,
            sequence: 12,
            revision: 8
        )
        try guardState.accept(beforeRestart)

        try guardState.begin(original.subscription)
        XCTAssertThrowsError(try guardState.accept(beforeRestart)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .replayedEnvelope)
        }

        let restartedIdentity = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x44, count: 32)
        )
        let restarted = try makeSubscriptionFixture(
            channel: .stage,
            identity: restartedIdentity,
            minimumSequence: 1
        )
        XCTAssertEqual(restarted.challenge.authority, original.challenge.authority)
        XCTAssertNotEqual(restarted.challenge.signingKeyID, original.challenge.signingKeyID)
        XCTAssertNoThrow(try guardState.begin(restarted.subscription))
        XCTAssertNil(guardState.lastSequence)
        XCTAssertNil(guardState.lastRevision)

        let afterRestart = try signEnvelope(
            payload: stagePayload(revision: 1),
            authority: restarted.challenge.authority,
            identity: restarted.identity,
            sequence: 1,
            revision: 1
        )
        let verified = try TchurchStudioLANEnvelopeVerifier(subscription: restarted.subscription)
            .verify(TchurchStudioLANCoding.encoder().encode(afterRestart))
        XCTAssertNoThrow(try guardState.accept(verified))
        XCTAssertEqual(guardState.lastSequence, 1)
        XCTAssertEqual(guardState.lastRevision, 1)
    }

    func testLengthPrefixedFramesAreBoundedAndIncremental() throws {
        let one = try TchurchStudioLANWireCodec.encode(.ping("one"), maximumFrameBytes: 1_024)
        let two = try TchurchStudioLANWireCodec.encode(.pong("two"), maximumFrameBytes: 1_024)
        var decoder = try TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: 1_024,
            maximumBufferedBytes: 2_048
        )
        let joined = one + two
        XCTAssertTrue(try decoder.append(joined.prefix(3)).isEmpty)
        let frames = try decoder.append(joined.dropFirst(3))
        XCTAssertEqual(frames.count, 2)
        XCTAssertEqual(try TchurchStudioLANWireCodec.decode(frames[0]), .ping("one"))
        XCTAssertEqual(try TchurchStudioLANWireCodec.decode(frames[1]), .pong("two"))

        var invalid = try TchurchStudioLANLengthPrefixedFrameDecoder(
            maximumFrameBytes: 16,
            maximumBufferedBytes: 32
        )
        XCTAssertThrowsError(try invalid.append(Data([0, 0, 0, 17]))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidFrameLength(17))
        }
    }
}

final class StudioLANClientTLSIntegrationTests: XCTestCase {
    func testMatchingPSKNegotiatesAndWrongPSKCannotBecomeReady() throws {
        try assertTLS(listenerSecret: fixedSecret(0xA1), clientSecret: fixedSecret(0xA1), shouldConnect: true)
        try assertTLS(listenerSecret: fixedSecret(0xB1), clientSecret: fixedSecret(0xB2), shouldConnect: false)
    }

    private func assertTLS(
        listenerSecret: TchurchStudioLANPairingSecret,
        clientSecret: TchurchStudioLANPairingSecret,
        shouldConnect: Bool
    ) throws {
        let queue = DispatchQueue(label: "app.tchurch.tests.studio-lan-tls.\(UUID().uuidString)")
        let listenerReady = expectation(description: "listener ready")
        let clientReady = expectation(description: "client ready")
        let serverReady = expectation(description: "server ready")
        let clientRejected = expectation(description: "client rejected")
        let connections = LANConnectionRetainer()
        if shouldConnect {
            clientRejected.isInverted = true
        } else {
            clientReady.isInverted = true
            serverReady.isInverted = true
        }
        clientRejected.assertForOverFulfill = false

        let listener = try NWListener(
            using: TchurchStudioLANNetworkParameters.makeListener(pairingSecret: listenerSecret),
            on: .any
        )
        listener.stateUpdateHandler = { if case .ready = $0 { listenerReady.fulfill() } }
        listener.newConnectionHandler = { connection in
            connections.retain(connection)
            connection.stateUpdateHandler = { if case .ready = $0 { serverReady.fulfill() } }
            connection.start(queue: queue)
        }
        listener.start(queue: queue)
        wait(for: [listenerReady], timeout: 3)

        let client = NWConnection(
            host: "127.0.0.1",
            port: try XCTUnwrap(listener.port),
            using: TchurchStudioLANNetworkParameters.makeClient(pairingSecret: clientSecret)
        )
        connections.retain(client)
        client.stateUpdateHandler = { state in
            switch state {
            case .ready: clientReady.fulfill()
            case .waiting, .failed: clientRejected.fulfill()
            default: break
            }
        }
        client.start(queue: queue)

        wait(
            for: shouldConnect ? [clientReady, serverReady, clientRejected] : [clientRejected, clientReady, serverReady],
            timeout: shouldConnect ? 5 : 2
        )
        connections.cancelAll()
        listener.cancel()
    }
}

private struct TestRequestProof: Codable {
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
}

private struct TestGrantProof: Codable {
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

private struct TestEnvelopeMaterial: Codable {
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

private struct SubscriptionFixture {
    let challenge: TchurchStudioLANServerChallenge
    let identity: Curve25519.Signing.PrivateKey
    let subscription: TchurchStudioLANVerifiedSubscription
}

private func fixedSecret(_ byte: UInt8) throws -> TchurchStudioLANPairingSecret {
    try TchurchStudioLANPairingSecret(rawRepresentation: Data(repeating: byte, count: 32))
}

private func makeAuthority(epoch: UInt64 = 7) -> TchurchStudioLANAuthority {
    TchurchStudioLANAuthority(
        runID: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
        authorityEpoch: epoch,
        packageID: "sha256:package",
        serviceVersion: "2026-07-15T20:00:00.000Z"
    )
}

private func makeChallenge(
    identity: Curve25519.Signing.PrivateKey,
    epoch: UInt64 = 7
) -> TchurchStudioLANServerChallenge {
    let publicKey = identity.publicKey.rawRepresentation
    return TchurchStudioLANServerChallenge(
        schemaVersion: 1,
        challengeID: UUID(uuidString: "dddddddd-dddd-4ddd-8ddd-dddddddddddd")!,
        serverNonce: Data(repeating: 0x11, count: 32).base64EncodedString(),
        authority: makeAuthority(epoch: epoch),
        signingKeyID: String(TchurchStudioLANCrypto.sha256Hex(publicKey).prefix(24)),
        issuedAtMilliseconds: 1_000_000,
        expiresAtMilliseconds: 2_000_000
    )
}

private func makeGrant(
    challenge: TchurchStudioLANServerChallenge,
    request: TchurchStudioLANSubscriptionRequest,
    identity: Curve25519.Signing.PrivateKey,
    secret: TchurchStudioLANPairingSecret,
    minimumSequence: UInt64 = 12
) throws -> TchurchStudioLANSubscriptionGrant {
    let sessionID = UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!
    let publicKey = identity.publicKey.rawRepresentation.base64EncodedString()
    let proof = TestGrantProof(
        challengeID: challenge.challengeID,
        sessionID: sessionID,
        requestID: request.requestID,
        channel: request.channel,
        authority: challenge.authority,
        signingKeyID: challenge.signingKeyID,
        signingPublicKey: publicKey,
        minimumSequence: minimumSequence,
        expiresAtMilliseconds: 1_500_000,
        clientNonce: request.clientNonce
    )
    return TchurchStudioLANSubscriptionGrant(
        schemaVersion: 1,
        sessionID: sessionID,
        requestID: request.requestID,
        channel: request.channel,
        authority: challenge.authority,
        signingKeyID: challenge.signingKeyID,
        signingPublicKey: publicKey,
        minimumSequence: minimumSequence,
        expiresAtMilliseconds: 1_500_000,
        serverProof: try TchurchStudioLANCrypto.authenticationCode(for: proof, secret: secret)
    )
}

private func makeSubscriptionFixture(
    channel: TchurchStudioLANChannel,
    epoch: UInt64 = 7,
    identity suppliedIdentity: Curve25519.Signing.PrivateKey? = nil,
    minimumSequence: UInt64 = 12
) throws -> SubscriptionFixture {
    let secret = try fixedSecret(0x41)
    let identity = try suppliedIdentity ?? Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 0x33, count: 32))
    let challenge = makeChallenge(identity: identity, epoch: epoch)
    let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
        challenge: challenge,
        clientID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
        clientName: "Tchurch iOS",
        channel: channel,
        secret: secret,
        requestID: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
        clientNonce: Data(repeating: 0x21, count: 24)
    )
    let grant = try makeGrant(
        challenge: challenge,
        request: request,
        identity: identity,
        secret: secret,
        minimumSequence: minimumSequence
    )
    let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
        grant,
        request: request,
        challenge: challenge,
        secret: secret,
        nowMilliseconds: 1_000_100
    )
    return SubscriptionFixture(challenge: challenge, identity: identity, subscription: subscription)
}

private func stagePayload(revision: UInt64) -> TchurchStudioLANChannelPayload {
    let audience = TchurchStudioLANAudiencePayload(
        snapshot: .init(
            schemaVersion: 1,
            runID: makeAuthority().runID,
            authorityEpoch: makeAuthority().authorityEpoch,
            packageID: makeAuthority().packageID,
            serviceVersion: makeAuthority().serviceVersion,
            revision: revision,
            currentCueID: "cue-1",
            currentCueIndex: 0,
            cueCount: 2,
            isBlackout: false,
            countdown: .init(id: "countdown", label: "Inicio", targetDate: Date(timeIntervalSince1970: 1_100))
        ),
        cue: .init(cueID: "cue-1", title: "Verse", lines: ["Grace upon grace"], mediaAssetID: "sha256:" + String(repeating: "a", count: 64))
    )
    return .stage(.init(
        audience: audience,
        stage: .init(
            nextCue: .init(cueID: "cue-2", title: "Chorus", lines: ["Next line"], mediaAssetID: nil),
            chordLines: ["C  G  Am  F"],
            timers: [.init(id: "service", label: "Servicio", mode: .countDown, anchorDate: Date(timeIntervalSince1970: 1_000), anchorValueMilliseconds: 5_000, durationMilliseconds: 60_000, isRunning: true)],
            message: "Puente dos veces"
        )
    ))
}

private func signEnvelope(
    payload: TchurchStudioLANChannelPayload,
    authority: TchurchStudioLANAuthority,
    identity: Curve25519.Signing.PrivateKey,
    sequence: UInt64,
    revision: UInt64
) throws -> TchurchStudioLANSignedEnvelope {
    let checksum = TchurchStudioLANCrypto.sha256Hex(try TchurchStudioLANCoding.encoder().encode(payload))
    let keyID = String(TchurchStudioLANCrypto.sha256Hex(identity.publicKey.rawRepresentation).prefix(24))
    let material = TestEnvelopeMaterial(
        schemaVersion: 1,
        authority: authority,
        channel: payload.channel,
        sequence: sequence,
        revision: revision,
        issuedAtMilliseconds: 1_000_200,
        payload: payload,
        payloadChecksum: checksum,
        signingKeyID: keyID
    )
    return TchurchStudioLANSignedEnvelope(
        schemaVersion: 1,
        authority: authority,
        channel: payload.channel,
        sequence: sequence,
        revision: revision,
        issuedAtMilliseconds: 1_000_200,
        payload: payload,
        payloadChecksum: checksum,
        signingKeyID: keyID,
        signature: try identity.signature(for: TchurchStudioLANCoding.encoder().encode(material)).base64EncodedString()
    )
}

private func tamperedEnvelope(
    _ envelope: TchurchStudioLANSignedEnvelope,
    payload: TchurchStudioLANChannelPayload,
    checksum: String
) -> TchurchStudioLANSignedEnvelope {
    TchurchStudioLANSignedEnvelope(
        schemaVersion: envelope.schemaVersion,
        authority: envelope.authority,
        channel: envelope.channel,
        sequence: envelope.sequence,
        revision: envelope.revision,
        issuedAtMilliseconds: envelope.issuedAtMilliseconds,
        payload: payload,
        payloadChecksum: checksum,
        signingKeyID: envelope.signingKeyID,
        signature: envelope.signature
    )
}

private final class LANConnectionRetainer: @unchecked Sendable {
    private let lock = NSLock()
    private var connections: [NWConnection] = []

    func retain(_ connection: NWConnection) {
        lock.lock()
        connections.append(connection)
        lock.unlock()
    }

    func cancelAll() {
        lock.lock()
        let retained = connections
        connections.removeAll()
        lock.unlock()
        retained.forEach { $0.cancel() }
    }
}
