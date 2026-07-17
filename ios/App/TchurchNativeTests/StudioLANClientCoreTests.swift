import CryptoKit
import Darwin
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
            clientNonce: Data(repeating: 0x21, count: 24),
            schemaVersion: 1
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
        XCTAssertNil(request.supportedPayloadVersions)
        XCTAssertFalse(String(decoding: try TchurchStudioLANCoding.encoder().encode(request), as: UTF8.self)
            .contains("supportedPayloadVersions"))

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
        XCTAssertNil(grant.selectedPayloadVersion)
        XCTAssertFalse(String(decoding: try TchurchStudioLANCoding.encoder().encode(grant), as: UTF8.self)
            .contains("selectedPayloadVersion"))
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

    func testV2NegotiationBindsV3OfferAndSelectedPayloadVersion() throws {
        let secret = try fixedSecret(0x41)
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
        XCTAssertEqual(request.schemaVersion, 2)
        XCTAssertEqual(request.supportedPayloadVersions, [3, 2, 1])
        XCTAssertTrue(TchurchStudioLANCrypto.validatesAuthenticationCode(
            request.authenticationProof,
            for: TestRequestProofV2(
                challenge: challenge,
                requestID: request.requestID,
                clientID: request.clientID,
                clientName: request.clientName,
                channel: request.channel,
                clientNonce: request.clientNonce,
                supportedPayloadVersions: [3, 2, 1]
            ),
            secret: secret
        ))
        let grant = try makeGrant(challenge: challenge, request: request, identity: identity, secret: secret)
        let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            grant, request: request, challenge: challenge, secret: secret, nowMilliseconds: 1_000_100
        )
        XCTAssertEqual(grant.schemaVersion, 2)
        XCTAssertEqual(grant.selectedPayloadVersion, 2)
        XCTAssertEqual(subscription.payloadVersion, 2)

        let downgraded = TchurchStudioLANSubscriptionGrant(
            schemaVersion: grant.schemaVersion,
            sessionID: grant.sessionID,
            requestID: grant.requestID,
            channel: grant.channel,
            authority: grant.authority,
            signingKeyID: grant.signingKeyID,
            signingPublicKey: grant.signingPublicKey,
            minimumSequence: grant.minimumSequence,
            expiresAtMilliseconds: grant.expiresAtMilliseconds,
            selectedPayloadVersion: 1,
            serverProof: grant.serverProof
        )
        XCTAssertThrowsError(try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            downgraded, request: request, challenge: challenge, secret: secret, nowMilliseconds: 1_000_100
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidAuthenticationProof)
        }
    }

    func testNegotiationAcceptsEveryCryptographicallyBoundOfferedVersion() throws {
        let secret = try fixedSecret(0x41)
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

        for selectedVersion in TchurchStudioLANSubscriptionRequest.supportedPayloadVersions {
            let grant = try makeGrant(
                challenge: challenge,
                request: request,
                identity: identity,
                secret: secret,
                selectedPayloadVersion: selectedVersion
            )
            let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
                grant,
                request: request,
                challenge: challenge,
                secret: secret,
                nowMilliseconds: 1_000_100
            )
            var negotiation = TchurchStudioLANPayloadNegotiation()
            XCTAssertNoThrow(try negotiation.recordAuthenticatedGrant(subscription))
            XCTAssertEqual(negotiation.negotiatedPayloadVersion, selectedVersion)
            XCTAssertEqual(
                negotiation.requestSchemaVersion,
                TchurchStudioLANSubscriptionRequest.currentSchemaVersion,
                "payload v\(selectedVersion) must map back to a supported subscription schema"
            )
        }
    }

    func testStudioV3AssetFixtureIsByteExactAndFullyVerifiable() throws {
        let fixture: StudioLANV3AssetFixture = try loadStudioLANFixture(
            named: "studio_lan_v3_asset_fixture"
        )
        XCTAssertEqual(fixture.fixtureID, "studio-lan-v3-assets-swift-1")
        XCTAssertEqual(fixture.schemaVersion, 1)

        let challengeWire = try fixtureData(fixture.challengeWire)
        let challengeMessage = try TchurchStudioLANWireCodec.decode(challengeWire)
        guard case .challenge(let challenge) = challengeMessage else {
            return XCTFail("Expected challenge fixture")
        }
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(challengeMessage), challengeWire)

        let subscribeWire = try fixtureData(fixture.subscribeWire)
        let subscribeMessage = try TchurchStudioLANWireCodec.decode(subscribeWire)
        guard case .subscribe(let request) = subscribeMessage else {
            return XCTFail("Expected subscription fixture")
        }
        XCTAssertEqual(request.schemaVersion, 2)
        XCTAssertEqual(request.supportedPayloadVersions, [3, 2, 1])
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(subscribeMessage), subscribeWire)

        let grantWire = try fixtureData(fixture.grantWire)
        let grantMessage = try TchurchStudioLANWireCodec.decode(grantWire)
        guard case .grant(let grant) = grantMessage else {
            return XCTFail("Expected grant fixture")
        }
        XCTAssertEqual(grant.schemaVersion, 2)
        XCTAssertEqual(grant.selectedPayloadVersion, 3)
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(grantMessage), grantWire)
        let secret = try TchurchStudioLANPairingSecret(rawRepresentation: fixtureData(fixture.secret))
        let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            grant,
            request: request,
            challenge: challenge,
            secret: secret,
            nowMilliseconds: challenge.issuedAtMilliseconds + 100
        )
        XCTAssertEqual(subscription.payloadVersion, 3)

        let envelopeWire = try fixtureData(fixture.envelopeWire)
        let envelopeMessage = try TchurchStudioLANWireCodec.decode(envelopeWire)
        guard case .envelope(let encodedEnvelope) = envelopeMessage else {
            return XCTFail("Expected envelope fixture")
        }
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(envelopeMessage), envelopeWire)
        let envelope = try TchurchStudioLANEnvelopeVerifier(subscription: subscription).verify(encodedEnvelope)
        let descriptor = try XCTUnwrap(envelope.payload.audience.cue?.imageAsset)
        XCTAssertEqual(envelope.schemaVersion, 3)
        XCTAssertEqual(descriptor.kind, .image)
        XCTAssertEqual(descriptor.objectID, envelope.payload.audience.cue?.mediaAssetID)

        let assetBytes = try fixtureData(fixture.assetBytes)
        XCTAssertEqual(descriptor.byteSize, Int64(assetBytes.count))
        XCTAssertEqual(descriptor.objectID, "sha256:\(TchurchStudioLANCrypto.sha256Hex(assetBytes))")

        let requestWire = try fixtureData(fixture.assetRequestWire)
        let requestMessage = try TchurchStudioLANWireCodec.decode(requestWire)
        guard case .assetRequest(let assetRequest) = requestMessage else {
            return XCTFail("Expected asset request fixture")
        }
        XCTAssertEqual(assetRequest.maximumBytes, TchurchStudioLANAssetChunk.byteCount)
        XCTAssertEqual(assetRequest.objectID, descriptor.objectID)
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(requestMessage), requestWire)

        let chunkWire = try fixtureData(fixture.assetChunkWire)
        let chunkMessage = try TchurchStudioLANWireCodec.decode(chunkWire)
        guard case .assetChunk(let chunk) = chunkMessage else {
            return XCTFail("Expected asset chunk fixture")
        }
        XCTAssertEqual(chunk.requestID, assetRequest.requestID)
        XCTAssertEqual(chunk.objectID, assetRequest.objectID)
        XCTAssertEqual(chunk.offset, assetRequest.offset)
        XCTAssertEqual(chunk.totalByteSize, Int64(assetBytes.count))
        XCTAssertEqual(chunk.data, Data(assetBytes.dropFirst(Int(assetRequest.offset))))
        XCTAssertEqual(chunk.dataSha256, "sha256:\(TchurchStudioLANCrypto.sha256Hex(chunk.data))")
        XCTAssertTrue(chunk.isFinal)
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(chunkMessage), chunkWire)

        let unavailableWire = try fixtureData(fixture.assetUnavailableWire)
        let unavailableMessage = try TchurchStudioLANWireCodec.decode(unavailableWire)
        guard case .assetUnavailable(let unavailable) = unavailableMessage else {
            return XCTFail("Expected asset unavailable fixture")
        }
        XCTAssertEqual(unavailable.objectID, descriptor.objectID)
        XCTAssertEqual(unavailable.code, .invalidRange)
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(unavailableMessage), unavailableWire)
    }

    func testStudioV1FixtureRemainsByteExactWithoutV3Fields() throws {
        let fixture: StudioLANV1Fixture = try loadStudioLANFixture(
            named: "studio_lan_v1_7f816eb_fixture"
        )
        let challengeWire = try fixtureData(fixture.challengeWire)
        let challengeMessage = try TchurchStudioLANWireCodec.decode(challengeWire)
        guard case .challenge(let challenge) = challengeMessage else {
            return XCTFail("Expected v1 challenge fixture")
        }
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(challengeMessage), challengeWire)

        let expectedSubscribeWire = try fixtureData(fixture.expectedSubscribeWire)
        let expectedSubscribeMessage = try TchurchStudioLANWireCodec.decode(expectedSubscribeWire)
        guard case .subscribe(let expectedRequest) = expectedSubscribeMessage else {
            return XCTFail("Expected v1 subscribe fixture")
        }
        let secret = try TchurchStudioLANPairingSecret(rawRepresentation: fixtureData(fixture.secret))
        let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: expectedRequest.clientID,
            clientName: expectedRequest.clientName,
            channel: expectedRequest.channel,
            secret: secret,
            requestID: expectedRequest.requestID,
            clientNonce: try XCTUnwrap(Data(base64Encoded: expectedRequest.clientNonce)),
            schemaVersion: 1
        )
        XCTAssertEqual(request, expectedRequest)
        XCTAssertEqual(
            try TchurchStudioLANCoding.encoder().encode(TchurchStudioLANWireMessage.subscribe(request)),
            expectedSubscribeWire
        )
        XCTAssertNil(request.supportedPayloadVersions)

        let grantWire = try fixtureData(fixture.grantWire)
        let grantMessage = try TchurchStudioLANWireCodec.decode(grantWire)
        guard case .grant(let grant) = grantMessage else {
            return XCTFail("Expected v1 grant fixture")
        }
        XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(grantMessage), grantWire)
        let subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            grant,
            request: request,
            challenge: challenge,
            secret: secret,
            nowMilliseconds: challenge.issuedAtMilliseconds + 100
        )
        XCTAssertEqual(subscription.payloadVersion, 1)

        let verifier = try TchurchStudioLANEnvelopeVerifier(subscription: subscription)
        for encodedWire in [fixture.envelopeWire, fixture.nextEnvelopeWire] {
            let wire = try fixtureData(encodedWire)
            let message = try TchurchStudioLANWireCodec.decode(wire)
            guard case .envelope(let encodedEnvelope) = message else {
                return XCTFail("Expected v1 envelope fixture")
            }
            XCTAssertEqual(try TchurchStudioLANCoding.encoder().encode(message), wire)
            let envelope = try verifier.verify(encodedEnvelope)
            XCTAssertNil(envelope.payload.audience.cue?.imageAsset)
            XCTAssertFalse(String(decoding: encodedEnvelope, as: UTF8.self).contains("imageAsset"))
        }
    }

    func testPreGrantTransportEndNeverDowngrades() throws {
        let secret = try fixedSecret(0x41)
        let identity = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 0x33, count: 32))
        let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: makeChallenge(identity: identity),
            clientID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: secret,
            requestID: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            clientNonce: Data(repeating: 0x21, count: 24)
        )
        var negotiation = TchurchStudioLANPayloadNegotiation()
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: request,
            signal: .transportEnded
        ))
        XCTAssertEqual(negotiation.requestSchemaVersion, 2)
        XCTAssertFalse(negotiation.didAttemptLegacyFallback)
    }

    func testExplicitAuthenticatedLegacyErrorAllowsOneV1RetryAndExposesV1() throws {
        let secret = try fixedSecret(0x41)
        let identity = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 0x33, count: 32))
        let challenge = makeChallenge(identity: identity)
        let v2Request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: secret,
            requestID: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            clientNonce: Data(repeating: 0x21, count: 24)
        )
        var negotiation = TchurchStudioLANPayloadNegotiation()
        XCTAssertEqual(negotiation.requestSchemaVersion, 2)
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: nil,
            signal: .authenticatedLegacyError
        ))
        XCTAssertTrue(negotiation.attemptLegacyFallback(
            afterSentRequest: v2Request,
            signal: .authenticatedLegacyError
        ))
        XCTAssertEqual(negotiation.requestSchemaVersion, 1)
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: v2Request,
            signal: .authenticatedLegacyError
        ))

        let v1Request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: v2Request.clientID,
            clientName: v2Request.clientName,
            channel: v2Request.channel,
            secret: secret,
            requestID: UUID(uuidString: "ffffffff-ffff-4fff-8fff-ffffffffffff")!,
            clientNonce: Data(repeating: 0x22, count: 24),
            schemaVersion: negotiation.requestSchemaVersion
        )
        let v1Grant = try makeGrant(challenge: challenge, request: v1Request, identity: identity, secret: secret)
        let v1Subscription = try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            v1Grant,
            request: v1Request,
            challenge: challenge,
            secret: secret,
            nowMilliseconds: 1_000_100
        )
        try negotiation.recordAuthenticatedGrant(v1Subscription)
        XCTAssertEqual(v1Subscription.payloadVersion, 1)
        XCTAssertEqual(negotiation.negotiatedPayloadVersion, 1)
        XCTAssertEqual(negotiation.requestSchemaVersion, 1)
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: v2Request,
            signal: .authenticatedLegacyError
        ))
    }

    func testNegotiationNeverDowngradesAfterAuthenticatedV2Grant() throws {
        let fixture = try makeSubscriptionFixture(channel: .stage, requestSchemaVersion: 2)
        var negotiation = TchurchStudioLANPayloadNegotiation()
        try negotiation.recordAuthenticatedGrant(fixture.subscription)
        XCTAssertEqual(negotiation.negotiatedPayloadVersion, 2)
        XCTAssertEqual(negotiation.requestSchemaVersion, 2)

        let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: fixture.challenge,
            clientID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: try fixedSecret(0x41),
            requestID: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
            clientNonce: Data(repeating: 0x21, count: 24)
        )
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: request,
            signal: .authenticatedLegacyError
        ))
        XCTAssertEqual(negotiation.requestSchemaVersion, 2)
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

    func testV2EnvelopePreservesUnicodeChordOffsetsAndRejectsMismatch() throws {
        let fixture = try makeSubscriptionFixture(channel: .stage, requestSchemaVersion: 2)
        let verifier = try TchurchStudioLANEnvelopeVerifier(subscription: fixture.subscription)
        let payload = stagePayloadV2(revision: 8)
        let envelope = try signEnvelope(
            payload: payload,
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 2
        )
        let verified = try verifier.verify(TchurchStudioLANCoding.encoder().encode(envelope))
        XCTAssertEqual(verified.payload.stage?.currentChordSlide?.key, "C")
        XCTAssertEqual(verified.payload.stage?.currentChordSlide?.lines[0].chords.map(\.offsetUtf16), [0, 0, 8])

        for invalidPayload in [
            stagePayloadV2(revision: 8, cueID: "cue-other"),
            stagePayloadV2(revision: 8, chordOffset: 6),
            stagePayloadV2(revision: 8, includeChordSlide: false),
        ] {
            let invalidEnvelope = try signEnvelope(
                payload: invalidPayload,
                authority: fixture.challenge.authority,
                identity: fixture.identity,
                sequence: 13,
                revision: 8,
                schemaVersion: 2
            )
            XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(invalidEnvelope))) {
                XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload)
            }
        }

        let legacyEnvelope = try signEnvelope(
            payload: stagePayload(revision: 8),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 13,
            revision: 8,
            schemaVersion: 1
        )
        XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(legacyEnvelope))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidEnvelope)
        }
    }

    func testV2PreservesPaddedAndEmptyCueSeparatorsWithoutLooseningV1() throws {
        let lines = ["  verso  ", "", "final"]
        let baseline = stagePayloadV2(revision: 8)
        guard case .stage(let baselineStage) = baseline else {
            return XCTFail("Expected stage payload")
        }
        let audience = TchurchStudioLANAudiencePayload(
            snapshot: baselineStage.audience.snapshot,
            cue: .init(cueID: "cue-1", title: "Verse", lines: lines, mediaAssetID: nil)
        )
        let payload = TchurchStudioLANChannelPayload.stage(.init(
            audience: audience,
            stage: .init(
                nextCue: nil,
                chordLines: ["C", "G"],
                currentChordSlide: .init(
                    cueID: "cue-1",
                    key: "Sol",
                    lines: [
                        .init(text: lines[0], chords: [.init(value: "C", offsetUtf16: 2)]),
                        .init(text: lines[1], chords: []),
                        .init(text: lines[2], chords: [.init(value: "G", offsetUtf16: 0)]),
                    ]
                ),
                timers: [],
                message: nil
            )
        ))

        let v2Fixture = try makeSubscriptionFixture(channel: .stage, requestSchemaVersion: 2)
        let v2Envelope = try signEnvelope(
            payload: payload,
            authority: v2Fixture.challenge.authority,
            identity: v2Fixture.identity,
            sequence: 30,
            revision: 8,
            schemaVersion: 2
        )
        let verified = try TchurchStudioLANEnvelopeVerifier(subscription: v2Fixture.subscription)
            .verify(TchurchStudioLANCoding.encoder().encode(v2Envelope))
        XCTAssertEqual(verified.payload.audience.cue?.lines, lines)
        XCTAssertEqual(verified.payload.stage?.currentChordSlide?.lines.map(\.text), lines)
        XCTAssertEqual(verified.payload.stage?.currentChordSlide?.lines[0].chords[0].offsetUtf16, 2)

        let v1Fixture = try makeSubscriptionFixture(channel: .stage, requestSchemaVersion: 1)
        let legacyPayload = TchurchStudioLANChannelPayload.stage(.init(
            audience: audience,
            stage: .init(nextCue: nil, chordLines: ["C", "G"], timers: [], message: nil)
        ))
        let v1Envelope = try signEnvelope(
            payload: legacyPayload,
            authority: v1Fixture.challenge.authority,
            identity: v1Fixture.identity,
            sequence: 30,
            revision: 8,
            schemaVersion: 1
        )
        XCTAssertThrowsError(try TchurchStudioLANEnvelopeVerifier(subscription: v1Fixture.subscription)
            .verify(TchurchStudioLANCoding.encoder().encode(v1Envelope))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload)
        }

        let paddedLegacyAudience = TchurchStudioLANAudiencePayload(
            snapshot: audience.snapshot,
            cue: .init(cueID: "cue-1", title: "Verse", lines: ["  verso  ", "final"], mediaAssetID: nil)
        )
        let paddedLegacyPayload = TchurchStudioLANChannelPayload.stage(.init(
            audience: paddedLegacyAudience,
            stage: .init(nextCue: nil, chordLines: ["C", "G"], timers: [], message: nil)
        ))
        let paddedLegacyEnvelope = try signEnvelope(
            payload: paddedLegacyPayload,
            authority: v1Fixture.challenge.authority,
            identity: v1Fixture.identity,
            sequence: 31,
            revision: 8,
            schemaVersion: 1
        )
        XCTAssertThrowsError(try TchurchStudioLANEnvelopeVerifier(subscription: v1Fixture.subscription)
            .verify(TchurchStudioLANCoding.encoder().encode(paddedLegacyEnvelope))) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload)
        }
    }

    func testV2EnvelopeRequiresStudioChordGrammarDensityAndExactLegacyProjection() throws {
        let fixture = try makeSubscriptionFixture(channel: .stage, requestSchemaVersion: 2)
        let verifier = try TchurchStudioLANEnvelopeVerifier(subscription: fixture.subscription)
        guard case .stage(let baseline) = stagePayloadV2(revision: 8),
              let baselineSlide = baseline.stage.currentChordSlide,
              let baselineCue = baseline.audience.cue else {
            return XCTFail("Expected structured stage payload")
        }

        func payload(
            slide: TchurchStudioLANChordSlide?,
            chordLines: [String],
            audience: TchurchStudioLANAudiencePayload? = nil
        ) -> TchurchStudioLANChannelPayload {
            .stage(.init(
                audience: audience ?? baseline.audience,
                stage: .init(
                    nextCue: baseline.stage.nextCue,
                    chordLines: chordLines,
                    currentChordSlide: slide,
                    timers: baseline.stage.timers,
                    message: baseline.stage.message
                )
            ))
        }

        func assertRejected(_ payload: TchurchStudioLANChannelPayload, sequence: UInt64) throws {
            let envelope = try signEnvelope(
                payload: payload,
                authority: fixture.challenge.authority,
                identity: fixture.identity,
                sequence: sequence,
                revision: 8,
                schemaVersion: 2
            )
            XCTAssertThrowsError(try verifier.verify(TchurchStudioLANCoding.encoder().encode(envelope))) {
                XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload)
            }
        }

        try assertRejected(payload(slide: baselineSlide, chordLines: ["DIVERGES"]), sequence: 20)
        try assertRejected(payload(
            slide: .init(cueID: baselineSlide.cueID, key: "H", lines: baselineSlide.lines),
            chordLines: baseline.stage.chordLines
        ), sequence: 21)
        try assertRejected(payload(
            slide: .init(cueID: baselineSlide.cueID, key: "C", lines: [
                .init(text: baselineSlide.lines[0].text, chords: [.init(value: "<script>", offsetUtf16: 0)]),
            ]),
            chordLines: ["<script>"]
        ), sequence: 22)

        let thirteen = Array(repeating: TchurchStudioLANChordToken(value: "C", offsetUtf16: 0), count: 13)
        try assertRejected(payload(
            slide: .init(cueID: baselineSlide.cueID, key: "C", lines: [
                .init(text: baselineSlide.lines[0].text, chords: thirteen),
            ]),
            chordLines: [Array(repeating: "C", count: 13).joined(separator: "   ")]
        ), sequence: 23)

        let texts = (0 ..< 5).map { "Line \($0)" }
        let denseLines = texts.enumerated().map { index, text in
            TchurchStudioLANChordLine(
                text: text,
                chords: Array(
                    repeating: TchurchStudioLANChordToken(value: "C", offsetUtf16: 0),
                    count: index == 4 ? 9 : 10
                )
            )
        }
        let denseAudience = TchurchStudioLANAudiencePayload(
            snapshot: baseline.audience.snapshot,
            cue: .init(
                cueID: baselineCue.cueID,
                title: baselineCue.title,
                lines: texts,
                mediaAssetID: baselineCue.mediaAssetID
            )
        )
        try assertRejected(payload(
            slide: .init(cueID: baselineSlide.cueID, key: "Sol", lines: denseLines),
            chordLines: denseLines.map { $0.chords.map(\.value).joined(separator: "   ") },
            audience: denseAudience
        ), sequence: 24)

        let hidden = payload(slide: nil, chordLines: [])
        let hiddenEnvelope = try signEnvelope(
            payload: hidden,
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 25,
            revision: 8,
            schemaVersion: 2
        )
        XCTAssertNoThrow(try verifier.verify(TchurchStudioLANCoding.encoder().encode(hiddenEnvelope)))
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

        let repeatedState = try signEnvelope(
            payload: stagePayload(revision: 8),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 13,
            revision: 8
        )
        XCTAssertNoThrow(try guardState.accept(repeatedState))
        let equivocated = try signEnvelope(
            payload: stagePayload(revision: 8, message: "Contenido distinto"),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 14,
            revision: 8
        )
        XCTAssertThrowsError(try guardState.accept(equivocated)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .equivocatedRevision)
        }

        try guardState.begin(fixture.subscription)
        XCTAssertThrowsError(try guardState.accept(repeatedState)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .replayedEnvelope)
        }
        let next = try signEnvelope(
            payload: stagePayload(revision: 9),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 14,
            revision: 9
        )
        XCTAssertNoThrow(try guardState.accept(next))

        let rotated = try makeSubscriptionFixture(channel: .stage, epoch: 8, identity: fixture.identity)
        XCTAssertNoThrow(try guardState.begin(rotated.subscription))
        XCTAssertNil(guardState.lastSequence)
        XCTAssertNil(guardState.lastPayloadChecksum)
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
        XCTAssertNil(guardState.lastPayloadChecksum)

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

final class StudioLANAssetCacheTests: XCTestCase {
    private var rootURL: URL!

    override func setUpWithError() throws {
        rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-studio-assets-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        if let rootURL { try? FileManager.default.removeItem(at: rootURL) }
        rootURL = nil
    }

    func testPartCheckpointResumePromotionReauthorizationAndPurge() throws {
        let data = syntheticPNG(byteCount: 70_000)
        let descriptor = makeDescriptor(data: data)
        let cache = makeCache()
        XCTAssertEqual(
            try cache.prepare(
                descriptor: descriptor,
                authority: makeAuthority(),
                cueID: "cue-1",
                protectedObjectIDs: []
            ),
            .resume(offset: 0)
        )

        let first = makeChunk(data: data, descriptor: descriptor, offset: 0)
        XCTAssertEqual(
            try cache.append(first, descriptor: descriptor),
            .partial(nextOffset: Int64(TchurchStudioLANAssetChunk.byteCount))
        )
        let partURL = stagingURL(for: descriptor, pathExtension: "part")
        let checkpointURL = stagingURL(for: descriptor, pathExtension: "checkpoint")
        XCTAssertTrue(FileManager.default.fileExists(atPath: partURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: checkpointURL.path))

        let restarted = makeCache()
        XCTAssertEqual(
            try restarted.prepare(
                descriptor: descriptor,
                authority: makeAuthority(),
                cueID: "cue-1",
                protectedObjectIDs: []
            ),
            .resume(offset: Int64(TchurchStudioLANAssetChunk.byteCount))
        )
        let finalChunk = makeChunk(
            data: data,
            descriptor: descriptor,
            offset: Int64(TchurchStudioLANAssetChunk.byteCount)
        )
        guard case .ready(let readyURL) = try restarted.append(finalChunk, descriptor: descriptor) else {
            return XCTFail("Expected completed cache object")
        }
        XCTAssertEqual(try Data(contentsOf: readyURL), data)
        XCTAssertFalse(FileManager.default.fileExists(atPath: partURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: checkpointURL.path))
        let attributes = try FileManager.default.attributesOfItem(atPath: readyURL.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0, 0o600)
        XCTAssertEqual(try readyURL.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)

        guard case .ready(let reauthorizedURL) = try restarted.prepare(
            descriptor: descriptor,
            authority: makeAuthority(),
            cueID: "cue-reauthorized",
            protectedObjectIDs: [descriptor.objectID]
        ) else {
            return XCTFail("A complete object should be reusable only through a fresh verified prepare call")
        }
        XCTAssertEqual(reauthorizedURL, readyURL)
        let authorizationFiles = try FileManager.default.contentsOfDirectory(
            at: rootURL.appendingPathComponent("authorizations", isDirectory: true),
            includingPropertiesForKeys: nil
        )
        XCTAssertEqual(authorizationFiles.filter { $0.pathExtension == "authorization" }.count, 2)

        try restarted.purgeAll()
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))
    }

    func testCheckpointCorruptionRestartsFromZeroWithoutTrustingPart() throws {
        let data = syntheticPNG(byteCount: 70_000)
        let descriptor = makeDescriptor(data: data)
        let cache = makeCache()
        _ = try cache.prepare(
            descriptor: descriptor,
            authority: makeAuthority(),
            cueID: "cue-checkpoint",
            protectedObjectIDs: []
        )
        _ = try cache.append(makeChunk(data: data, descriptor: descriptor, offset: 0), descriptor: descriptor)
        let checkpointURL = stagingURL(for: descriptor, pathExtension: "checkpoint")
        try Data("tampered-checkpoint".utf8).write(to: checkpointURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: checkpointURL.path)

        XCTAssertEqual(
            try makeCache().prepare(
                descriptor: descriptor,
                authority: makeAuthority(),
                cueID: "cue-checkpoint",
                protectedObjectIDs: []
            ),
            .resume(offset: 0)
        )
        let partAttributes = try FileManager.default.attributesOfItem(
            atPath: stagingURL(for: descriptor, pathExtension: "part").path
        )
        XCTAssertEqual((partAttributes[.size] as? NSNumber)?.int64Value, 0)
    }

    func testRejectsChunkHashAndFullObjectMagicMismatch() throws {
        let validData = syntheticPNG(byteCount: 512)
        let validDescriptor = makeDescriptor(data: validData)
        let cache = makeCache()
        _ = try cache.prepare(
            descriptor: validDescriptor,
            authority: makeAuthority(),
            cueID: "cue-hash",
            protectedObjectIDs: []
        )
        let validChunk = makeChunk(data: validData, descriptor: validDescriptor, offset: 0)
        let invalidChunk = TchurchStudioLANAssetChunk(
            schemaVersion: validChunk.schemaVersion,
            requestID: validChunk.requestID,
            objectID: validChunk.objectID,
            offset: validChunk.offset,
            totalByteSize: validChunk.totalByteSize,
            data: validChunk.data,
            dataSha256: "sha256:\(String(repeating: "0", count: 64))",
            isFinal: validChunk.isFinal
        )
        XCTAssertThrowsError(try cache.append(invalidChunk, descriptor: validDescriptor)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .invalidAssetChunk)
        }

        let badMagic = Data("not-an-image-but-content-addressed".utf8)
        let badDescriptor = makeDescriptor(data: badMagic, referenceDigit: "c")
        let badCache = makeCache(root: rootURL.appendingPathComponent("bad-magic", isDirectory: true))
        _ = try badCache.prepare(
            descriptor: badDescriptor,
            authority: makeAuthority(),
            cueID: "cue-magic",
            protectedObjectIDs: []
        )
        XCTAssertThrowsError(
            try badCache.append(makeChunk(data: badMagic, descriptor: badDescriptor, offset: 0), descriptor: badDescriptor)
        ) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .assetCacheCorrupted)
        }
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: stagingURL(for: badDescriptor, pathExtension: "part", root: badCache.rootURL).path
        ))
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: stagingURL(for: badDescriptor, pathExtension: "checkpoint", root: badCache.rootURL).path
        ))
    }

    func testHiddenSymlinkAndSymlinkRootFailClosed() throws {
        let firstData = syntheticPNG(byteCount: 256)
        let cache = makeCache()
        _ = try cache.prepare(
            descriptor: makeDescriptor(data: firstData),
            authority: makeAuthority(),
            cueID: "cue-first",
            protectedObjectIDs: []
        )
        let target = rootURL.appendingPathComponent("symlink-target", isDirectory: false)
        try Data("target".utf8).write(to: target)
        let hiddenSymlink = rootURL
            .appendingPathComponent("objects", isDirectory: true)
            .appendingPathComponent(".hidden-object", isDirectory: false)
        try FileManager.default.createSymbolicLink(at: hiddenSymlink, withDestinationURL: target)
        let secondDescriptor = makeDescriptor(data: syntheticPNG(byteCount: 257, fill: 0x42), referenceDigit: "d")
        XCTAssertThrowsError(try cache.prepare(
            descriptor: secondDescriptor,
            authority: makeAuthority(),
            cueID: "cue-second",
            protectedObjectIDs: []
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .assetCacheCorrupted)
        }

        let realRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-studio-assets-real-\(UUID().uuidString)", isDirectory: true)
        let linkedRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-studio-assets-link-\(UUID().uuidString)", isDirectory: false)
        defer {
            try? FileManager.default.removeItem(at: linkedRoot)
            try? FileManager.default.removeItem(at: realRoot)
        }
        try FileManager.default.createDirectory(at: realRoot, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: linkedRoot, withDestinationURL: realRoot)
        XCTAssertThrowsError(try makeCache(root: linkedRoot).prepare(
            descriptor: secondDescriptor,
            authority: makeAuthority(),
            cueID: "cue-linked-root",
            protectedObjectIDs: []
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .assetCacheCorrupted)
        }
    }

    func testConcurrentFinalPromotionDeduplicatesAndRemovesPartialState() throws {
        let data = syntheticPNG(byteCount: 70_000)
        let descriptor = makeDescriptor(data: data)
        let cache = makeCache()
        _ = try cache.prepare(
            descriptor: descriptor,
            authority: makeAuthority(),
            cueID: "cue-race",
            protectedObjectIDs: []
        )
        _ = try cache.append(makeChunk(data: data, descriptor: descriptor, offset: 0), descriptor: descriptor)

        let finalURL = rootURL
            .appendingPathComponent("objects", isDirectory: true)
            .appendingPathComponent("\(digestComponent(descriptor.objectID)).png", isDirectory: false)
        try data.write(to: finalURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: finalURL.path)

        let finalChunk = makeChunk(
            data: data,
            descriptor: descriptor,
            offset: Int64(TchurchStudioLANAssetChunk.byteCount)
        )
        XCTAssertEqual(try cache.append(finalChunk, descriptor: descriptor), .ready(finalURL))
        XCTAssertEqual(try Data(contentsOf: finalURL), data)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: stagingURL(for: descriptor, pathExtension: "part").path
        ))
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: stagingURL(for: descriptor, pathExtension: "checkpoint").path
        ))
    }

    func testDiskReserveAndProtectedQuotaAreEnforced() throws {
        let data = syntheticPNG(byteCount: 60_000)
        let descriptor = makeDescriptor(data: data)
        let lowDiskLimits = TchurchStudioLANAssetCacheLimits(
            maximumImageBytes: 70_000,
            maximumCacheBytes: 70_000,
            minimumAvailableCapacity: 50_000,
            streamChunkBytes: 4_096,
            maximumAuthorizationManifests: 8
        )
        let lowDisk = TchurchStudioLANAssetCache(
            rootURL: rootURL.appendingPathComponent("low-disk", isDirectory: true),
            limits: lowDiskLimits,
            diskCapacity: { _ in 100_000 }
        )
        XCTAssertThrowsError(try lowDisk.prepare(
            descriptor: descriptor,
            authority: makeAuthority(),
            cueID: "cue-low-disk",
            protectedObjectIDs: []
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .insufficientDiskSpace)
        }

        let quotaRoot = rootURL.appendingPathComponent("quota", isDirectory: true)
        let quotaCache = TchurchStudioLANAssetCache(
            rootURL: quotaRoot,
            limits: TchurchStudioLANAssetCacheLimits(
                maximumImageBytes: 70_000,
                maximumCacheBytes: 70_000,
                minimumAvailableCapacity: 0,
                streamChunkBytes: 4_096,
                maximumAuthorizationManifests: 8
            ),
            diskCapacity: { _ in 1_000_000 }
        )
        _ = try quotaCache.prepare(
            descriptor: descriptor,
            authority: makeAuthority(),
            cueID: "cue-quota-one",
            protectedObjectIDs: []
        )
        _ = try quotaCache.append(makeChunk(data: data, descriptor: descriptor, offset: 0), descriptor: descriptor)

        let secondData = syntheticPNG(byteCount: 60_000, fill: 0x17)
        let secondDescriptor = makeDescriptor(data: secondData, referenceDigit: "e")
        XCTAssertThrowsError(try quotaCache.prepare(
            descriptor: secondDescriptor,
            authority: makeAuthority(),
            cueID: "cue-quota-two",
            protectedObjectIDs: [descriptor.objectID]
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .assetCacheLimitExceeded)
        }
    }

    private func makeCache(root: URL? = nil) -> TchurchStudioLANAssetCache {
        TchurchStudioLANAssetCache(
            rootURL: root ?? rootURL,
            limits: TchurchStudioLANAssetCacheLimits(
                maximumImageBytes: 256 * 1_024,
                maximumCacheBytes: 512 * 1_024,
                minimumAvailableCapacity: 0,
                streamChunkBytes: 4_096,
                maximumAuthorizationManifests: 8
            ),
            diskCapacity: { _ in 4 * 1_024 * 1_024 }
        )
    }

    private func syntheticPNG(byteCount: Int, fill: UInt8 = 0xA5) -> Data {
        precondition(byteCount >= 8)
        var data = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        data.append(Data(repeating: fill, count: byteCount - data.count))
        return data
    }

    private func makeDescriptor(
        data: Data,
        referenceDigit: Character = "b"
    ) -> TchurchStudioLANImageAssetDescriptor {
        TchurchStudioLANImageAssetDescriptor(
            schemaVersion: 1,
            referenceID: "sha256:\(String(repeating: String(referenceDigit), count: 64))",
            objectID: "sha256:\(TchurchStudioLANCrypto.sha256Hex(data))",
            kind: .image,
            mimeType: "image/png",
            byteSize: Int64(data.count),
            required: true,
            imageFit: .cover
        )
    }

    private func makeChunk(
        data: Data,
        descriptor: TchurchStudioLANImageAssetDescriptor,
        offset: Int64
    ) -> TchurchStudioLANAssetChunk {
        let start = Int(offset)
        let end = min(data.count, start + TchurchStudioLANAssetChunk.byteCount)
        let chunkData = Data(data[start ..< end])
        return TchurchStudioLANAssetChunk(
            schemaVersion: 1,
            requestID: UUID(),
            objectID: descriptor.objectID,
            offset: offset,
            totalByteSize: descriptor.byteSize,
            data: chunkData,
            dataSha256: "sha256:\(TchurchStudioLANCrypto.sha256Hex(chunkData))",
            isFinal: end == data.count
        )
    }

    private func stagingURL(
        for descriptor: TchurchStudioLANImageAssetDescriptor,
        pathExtension: String,
        root: URL? = nil
    ) -> URL {
        (root ?? rootURL)
            .appendingPathComponent("staging", isDirectory: true)
            .appendingPathComponent("\(digestComponent(descriptor.objectID)).\(pathExtension)", isDirectory: false)
    }

    private func digestComponent(_ objectID: String) -> String {
        String(objectID.dropFirst("sha256:".count))
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

final class StudioLANExactReplayRangeIntegrationTests: XCTestCase {
    func testTwoAutomaticReconnectsResumeExactRangesWithOneMonotonicUISequence() throws {
        let serviceName = "Tchurch Range \(UUID().uuidString.prefix(8))"
        let secret = try fixedSecret(0x6A)
        let identity = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x5C, count: 32)
        )
        let authority = makeAuthority()
        var assetBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        assetBytes.append(Data(
            repeating: 0x71,
            count: TchurchStudioLANAssetChunk.byteCount * 2 + 4_096 - assetBytes.count
        ))
        let descriptor = TchurchStudioLANImageAssetDescriptor(
            schemaVersion: 1,
            referenceID: "sha256:\(String(repeating: "b", count: 64))",
            objectID: "sha256:\(TchurchStudioLANCrypto.sha256Hex(assetBytes))",
            kind: .image,
            mimeType: "image/png",
            byteSize: Int64(assetBytes.count),
            required: true,
            imageFit: .cover
        )
        let payload = stageAssetPayload(authority: authority, descriptor: descriptor, revision: 8)
        let envelope = try signEnvelope(
            payload: payload,
            authority: authority,
            identity: identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 3
        )
        let encodedEnvelope = try TchurchStudioLANCoding.encoder().encode(envelope)

        let listenerReady = expectation(description: "exact-replay Studio listener ready")
        let firstRequest = expectation(description: "first asset Range requested")
        let finalRange = expectation(description: "third connection requested final Range")
        let server = try ExactReplayRangeStudioServer(
            serviceName: serviceName,
            secret: secret,
            identity: identity,
            authority: authority,
            encodedEnvelope: encodedEnvelope,
            assetBytes: assetBytes,
            objectID: descriptor.objectID,
            onReady: { listenerReady.fulfill() },
            onFirstRequest: { firstRequest.fulfill() },
            onFinalRange: { finalRange.fulfill() }
        )
        server.start()
        defer { server.stop() }
        wait(for: [listenerReady], timeout: 5)

        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-exact-replay-range-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let suiteName = "app.tchurch.tests.exact-replay-range.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let secretStore = RecordingStudioLANSecretStore()
        let client = try TchurchStudioLANClient(
            secretStore: secretStore,
            defaults: defaults,
            assetCache: TchurchStudioLANAssetCache(
                rootURL: rootURL,
                diskCapacity: { _ in 10 * 1_024 * 1_024 * 1_024 }
            ),
            privacyStateStore: RecordingStudioLANPrivacyStateStore()
        )
        defer {
            client.disconnect()
            client.stopDiscovery()
        }

        let privacyReady = expectation(description: "exact-replay privacy ready")
        client.synchronizePrivacyContext(
            access: .authorized,
            principalID: "range-principal",
            churchID: "range-church"
        ) { result in
            if case .failure(let error) = result { XCTFail("privacy scope failed: \(error)") }
            privacyReady.fulfill()
        }
        wait(for: [privacyReady], timeout: 3)
        let privacySetupDeleteCount = secretStore.deleteAllCount

        let observations = ExactReplayRangeClientObservations()
        let discovered = expectation(description: "exact-replay Studio discovered")
        let envelopePublished = expectation(description: "authenticated envelope published once")
        envelopePublished.assertForOverFulfill = true
        let imageReady = expectation(description: "ranged image completed after reconnect")
        client.statusHandler = { status in
            observations.recordStatus(status)
            guard let service = status.services.first(where: { $0.name.hasPrefix(serviceName) }),
                  observations.recordServiceIDIfNeeded(service.id) else { return }
            discovered.fulfill()
        }
        client.envelopeHandler = { received in
            guard received.sequence == envelope.sequence else { return }
            observations.recordEnvelopePublication()
            envelopePublished.fulfill()
        }
        client.imageAssetHandler = { status in
            guard status.objectID == descriptor.objectID else { return }
            observations.recordAssetStatus(status)
            if status.phase == .ready { imageReady.fulfill() }
        }

        client.startDiscovery()
        wait(for: [discovered], timeout: 10)
        client.connect(
            serviceID: try XCTUnwrap(observations.serviceID),
            channel: .stage,
            pairingCode: secret.transportKeyMaterial.base64EncodedString()
        )
        wait(for: [envelopePublished, firstRequest], timeout: 10)
        let authorizationBeforeReconnects = try authorizationSnapshot(rootURL: rootURL)
        XCTAssertEqual(authorizationBeforeReconnects.count, 1)
        wait(for: [finalRange, imageReady], timeout: 25)

        XCTAssertEqual(observations.envelopePublicationCount, 1)
        XCTAssertTrue(
            observations.statuses.contains(where: { $0.phase == .reconnecting }),
            "statuses: \(observations.statuses)"
        )
        XCTAssertFalse(
            observations.statuses.contains(where: { $0.phase == .failed }),
            "a valid reconnect after payload v3 must not fail closed or purge: \(observations.statuses)"
        )
        XCTAssertEqual(
            secretStore.deleteAllCount,
            privacySetupDeleteCount,
            "a valid payload-v3 reconnect must not purge pairing"
        )
        XCTAssertEqual(
            server.connectionCount,
            3,
            "server events: \(server.observedEvents); statuses: \(observations.statuses)"
        )
        XCTAssertEqual(observations.readyAsset?.receivedBytes, descriptor.byteSize)
        XCTAssertNotNil(observations.readyAsset?.fileURL)
        XCTAssertEqual(
            observations.assetStatuses.map { "\($0.phase.rawValue):\($0.receivedBytes)" },
            [
                "loading:0",
                "loading:\(TchurchStudioLANAssetChunk.byteCount)",
                "loading:\(TchurchStudioLANAssetChunk.byteCount * 2)",
                "ready:\(descriptor.byteSize)",
            ],
            "replay recovery must not regress or repeat asset UI events"
        )
        XCTAssertEqual(
            try authorizationSnapshot(rootURL: rootURL),
            authorizationBeforeReconnects,
            "exact replay recovery must not rewrite signed-envelope authorization bookkeeping"
        )
        XCTAssertEqual(
            server.observedRequests,
            [
                .init(connection: 1, offset: 0),
                .init(connection: 1, offset: Int64(TchurchStudioLANAssetChunk.byteCount)),
                .init(connection: 2, offset: Int64(TchurchStudioLANAssetChunk.byteCount)),
                .init(connection: 2, offset: Int64(TchurchStudioLANAssetChunk.byteCount * 2)),
                .init(connection: 3, offset: Int64(TchurchStudioLANAssetChunk.byteCount * 2)),
            ],
            "server events: \(server.observedEvents); statuses: \(observations.statuses)"
        )
        XCTAssertNil(
            server.recordedFailure,
            "server events: \(server.observedEvents); statuses: \(observations.statuses)"
        )
    }

    func testManualDisconnectAndFreshConnectPreventLaterAutomaticReplayRecovery() throws {
        let serviceName = "Tchurch Manual \(UUID().uuidString.prefix(8))"
        let secret = try fixedSecret(0x6B)
        let identity = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x5D, count: 32)
        )
        let authority = makeAuthority()
        var assetBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        assetBytes.append(Data(
            repeating: 0x72,
            count: TchurchStudioLANAssetChunk.byteCount + 4_096 - assetBytes.count
        ))
        let descriptor = TchurchStudioLANImageAssetDescriptor(
            schemaVersion: 1,
            referenceID: "sha256:\(String(repeating: "c", count: 64))",
            objectID: "sha256:\(TchurchStudioLANCrypto.sha256Hex(assetBytes))",
            kind: .image,
            mimeType: "image/png",
            byteSize: Int64(assetBytes.count),
            required: true,
            imageFit: .cover
        )
        let envelope = try signEnvelope(
            payload: stageAssetPayload(authority: authority, descriptor: descriptor, revision: 8),
            authority: authority,
            identity: identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 3
        )
        let encodedEnvelope = try TchurchStudioLANCoding.encoder().encode(envelope)

        let listenerReady = expectation(description: "manual-reset Studio listener ready")
        let checkpointReady = expectation(description: "manual-reset checkpoint ready")
        let thirdEnvelope = expectation(description: "automatic retry received exact old envelope")
        let unexpectedAssetRequest = expectation(description: "old replay evidence reused after manual reset")
        unexpectedAssetRequest.isInverted = true
        let server = try ExactReplayRangeStudioServer(
            serviceName: serviceName,
            secret: secret,
            identity: identity,
            authority: authority,
            encodedEnvelope: encodedEnvelope,
            assetBytes: assetBytes,
            objectID: descriptor.objectID,
            onReady: { listenerReady.fulfill() },
            scenario: .manualReset,
            onCheckpointReady: { checkpointReady.fulfill() },
            onThirdConnectionEnvelope: { thirdEnvelope.fulfill() },
            onUnexpectedAssetRequest: { unexpectedAssetRequest.fulfill() }
        )
        server.start()
        defer { server.stop() }
        wait(for: [listenerReady], timeout: 5)

        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-manual-reset-range-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let suiteName = "app.tchurch.tests.manual-reset-range.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let secretStore = RecordingStudioLANSecretStore()
        let client = try TchurchStudioLANClient(
            secretStore: secretStore,
            defaults: defaults,
            assetCache: TchurchStudioLANAssetCache(
                rootURL: rootURL,
                diskCapacity: { _ in 10 * 1_024 * 1_024 * 1_024 }
            ),
            privacyStateStore: RecordingStudioLANPrivacyStateStore()
        )
        defer {
            client.disconnect()
            client.stopDiscovery()
        }

        let privacyReady = expectation(description: "manual-reset privacy ready")
        client.synchronizePrivacyContext(
            access: .authorized,
            principalID: "manual-principal",
            churchID: "manual-church"
        ) { result in
            if case .failure(let error) = result { XCTFail("privacy scope failed: \(error)") }
            privacyReady.fulfill()
        }
        wait(for: [privacyReady], timeout: 3)
        let privacySetupDeleteCount = secretStore.deleteAllCount

        let observations = ExactReplayRangeClientObservations()
        let discovered = expectation(description: "manual-reset Studio discovered")
        let envelopePublished = expectation(description: "manual-reset envelope published once")
        envelopePublished.assertForOverFulfill = true
        client.statusHandler = { status in
            observations.recordStatus(status)
            guard let service = status.services.first(where: { $0.name.hasPrefix(serviceName) }),
                  observations.recordServiceIDIfNeeded(service.id) else { return }
            discovered.fulfill()
        }
        client.envelopeHandler = { received in
            guard received.sequence == envelope.sequence else { return }
            observations.recordEnvelopePublication()
            envelopePublished.fulfill()
        }
        client.imageAssetHandler = { status in
            guard status.objectID == descriptor.objectID else { return }
            observations.recordAssetStatus(status)
        }

        client.startDiscovery()
        wait(for: [discovered], timeout: 10)
        let serviceID = try XCTUnwrap(observations.serviceID)
        let pairingCode = secret.transportKeyMaterial.base64EncodedString()
        client.connect(serviceID: serviceID, channel: .stage, pairingCode: pairingCode)
        wait(for: [envelopePublished, checkpointReady], timeout: 10)
        let authorizationBeforeManualReset = try authorizationSnapshot(rootURL: rootURL)
        XCTAssertEqual(authorizationBeforeManualReset.count, 1)

        let manuallyDisconnected = expectation(description: "manual disconnect completed")
        manuallyDisconnected.assertForOverFulfill = false
        client.statusHandler = { status in
            observations.recordStatus(status)
            if status.phase == .idle, status.selectedServiceID == nil {
                manuallyDisconnected.fulfill()
            }
        }
        client.disconnect()
        wait(for: [manuallyDisconnected], timeout: 3)

        client.statusHandler = { observations.recordStatus($0) }
        client.connect(serviceID: serviceID, channel: .stage, pairingCode: pairingCode)
        wait(for: [thirdEnvelope, unexpectedAssetRequest], timeout: 6)

        XCTAssertEqual(observations.envelopePublicationCount, 1)
        XCTAssertEqual(
            observations.assetStatuses.map { "\($0.phase.rawValue):\($0.receivedBytes)" },
            ["loading:0", "loading:\(TchurchStudioLANAssetChunk.byteCount)"],
            "manual reset must prevent any asset UI replay on its later automatic retry"
        )
        XCTAssertEqual(
            server.observedRequests,
            [
                .init(connection: 1, offset: 0),
                .init(connection: 1, offset: Int64(TchurchStudioLANAssetChunk.byteCount)),
            ],
            "server events: \(server.observedEvents); statuses: \(observations.statuses)"
        )
        XCTAssertEqual(server.connectionCount, 3, "server events: \(server.observedEvents)")
        XCTAssertEqual(try authorizationSnapshot(rootURL: rootURL), authorizationBeforeManualReset)
        XCTAssertEqual(secretStore.deleteAllCount, privacySetupDeleteCount)
        XCTAssertFalse(observations.statuses.contains(where: { $0.phase == .failed }))
        XCTAssertNil(server.recordedFailure, "server events: \(server.observedEvents)")
    }
}

final class StudioLANReconnectPolicyTests: XCTestCase {
    func testAuthenticatedWiFiLossAndRepeatedPreGrantFailuresPreserveRecoveryState() {
        var policy = TchurchStudioLANReconnectPolicy()
        policy.recordAuthenticatedSession()

        let causes: [TchurchStudioLANConnectionEndCause] = [
            .network(.init(domain: .posix, code: Int32(ENETDOWN))),
            .timeout(lastNetworkFailure: .init(domain: .posix, code: Int32(ETIMEDOUT))),
            .eof,
            .cancelled,
            .network(.init(domain: .tls, code: Int32(errSSLHandshakeFail))),
        ]
        let dispositions = causes.map { policy.record($0) }

        XCTAssertEqual(dispositions, [
            .reconnect(afterSeconds: 1),
            .reconnect(afterSeconds: 2),
            .reconnect(afterSeconds: 4),
            .reconnect(afterSeconds: 8),
            .reconnect(afterSeconds: 16),
        ])
        XCTAssertTrue(policy.authenticatedSessionEstablished)
        XCTAssertEqual(policy.consecutiveFailures, 5)

        policy.recordAuthenticatedSession()
        XCTAssertTrue(policy.authenticatedSessionEstablished)
        XCTAssertEqual(policy.consecutiveFailures, 0)
    }

    func testOnlyExplicitUnknownPSKAlertPurgesAndTransportNeverDowngrades() throws {
        var policy = TchurchStudioLANReconnectPolicy()
        policy.recordAuthenticatedSession()

        XCTAssertEqual(
            policy.record(.network(.init(domain: .tls, code: Int32(errSSLUnknownPSKIdentity)))),
            .purgePairing
        )

        var genericPolicy = TchurchStudioLANReconnectPolicy()
        XCTAssertEqual(
            genericPolicy.record(.network(.init(domain: .tls, code: Int32(errSSLHandshakeFail)))),
            .reconnect(afterSeconds: 1)
        )

        let identity = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 0x33, count: 32))
        let secret = try fixedSecret(0x41)
        let challenge = makeChallenge(identity: identity)
        let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: UUID(),
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: secret
        )
        var negotiation = TchurchStudioLANPayloadNegotiation()
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: request,
            signal: .transportEnded
        ))
        XCTAssertEqual(
            negotiation.requestSchemaVersion,
            TchurchStudioLANSubscriptionRequest.currentSchemaVersion
        )
    }

    func testOnlyExactLatestAuthenticatedReplayCanRehydratePendingAssetsOncePerReconnect() throws {
        let fixture = try makeSubscriptionFixture(
            channel: .stage,
            requestSchemaVersion: TchurchStudioLANSubscriptionRequest.currentSchemaVersion
        )
        let envelope = try signEnvelope(
            payload: stagePayloadV2(revision: 8),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 2
        )
        let encoded = try TchurchStudioLANCoding.encoder().encode(envelope)
        var replayGuard = TchurchStudioLANReplayGuard()
        try replayGuard.begin(fixture.subscription)
        try replayGuard.accept(envelope)

        var gate = TchurchStudioLANExactReplayAssetRehydrationGate()
        let key = "service:stage"
        let pendingObjectID = "sha256:\(String(repeating: "d", count: 64))"
        let pendingObjectIDs: Set<String> = [pendingObjectID]
        gate.recordAccepted(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            pendingAssetObjectIDs: pendingObjectIDs
        )
        gate.beginAuthenticatedConnection(
            replayKey: key,
            subscription: fixture.subscription,
            replayGuard: replayGuard,
            isAutomaticReconnect: true
        )
        XCTAssertEqual(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            replayGuard: replayGuard
        ), pendingObjectIDs)
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            replayGuard: replayGuard
        ), "the exact replay is a one-shot per authenticated connection, not a replay bypass")

        gate.beginAuthenticatedConnection(
            replayKey: key,
            subscription: fixture.subscription,
            replayGuard: replayGuard,
            isAutomaticReconnect: true
        )
        XCTAssertEqual(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            replayGuard: replayGuard
        ), pendingObjectIDs, "an unresolved checkpoint may recover again on a later connection")

        gate.beginAuthenticatedConnection(
            replayKey: key,
            subscription: fixture.subscription,
            replayGuard: replayGuard,
            isAutomaticReconnect: true
        )
        var differentlyEncoded = encoded
        differentlyEncoded.append(0x0A)
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: differentlyEncoded,
            replayGuard: replayGuard
        ), "semantically equivalent but byte-different JSON is not exact evidence")

        let equivocated = try signEnvelope(
            payload: stagePayloadV2(revision: 8, text: "Contenido distinto", chordOffset: 10),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 2
        )
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: equivocated,
            encodedEnvelope: try TchurchStudioLANCoding.encoder().encode(equivocated),
            replayGuard: replayGuard
        ))

        let stale = try signEnvelope(
            payload: stagePayloadV2(revision: 7),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 11,
            revision: 7,
            schemaVersion: 2
        )
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: stale,
            encodedEnvelope: try TchurchStudioLANCoding.encoder().encode(stale),
            replayGuard: replayGuard
        ))

        let otherAuthority = try signEnvelope(
            payload: stagePayloadV2(revision: 8),
            authority: makeAuthority(epoch: 8),
            identity: fixture.identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 2
        )
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: otherAuthority,
            encodedEnvelope: try TchurchStudioLANCoding.encoder().encode(otherAuthority),
            replayGuard: replayGuard
        ))

        gate.beginAuthenticatedConnection(
            replayKey: key,
            subscription: fixture.subscription,
            replayGuard: replayGuard,
            isAutomaticReconnect: false
        )
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            replayGuard: replayGuard
        ), "a fresh manual connection cannot consume retained replay evidence")
    }

    func testResolvedAssetsAndManualResetCannotRearmOldReplayEvidence() throws {
        let fixture = try makeSubscriptionFixture(
            channel: .stage,
            requestSchemaVersion: TchurchStudioLANSubscriptionRequest.currentSchemaVersion
        )
        let envelope = try signEnvelope(
            payload: stagePayloadV2(revision: 8),
            authority: fixture.challenge.authority,
            identity: fixture.identity,
            sequence: 12,
            revision: 8,
            schemaVersion: 2
        )
        let encoded = try TchurchStudioLANCoding.encoder().encode(envelope)
        var replayGuard = TchurchStudioLANReplayGuard()
        try replayGuard.begin(fixture.subscription)
        try replayGuard.accept(envelope)
        let key = "service:stage"
        let objectID = "sha256:\(String(repeating: "d", count: 64))"

        var gate = TchurchStudioLANExactReplayAssetRehydrationGate()
        gate.recordAccepted(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            pendingAssetObjectIDs: [objectID]
        )
        gate.resolveAsset(
            replayKey: key,
            authority: envelope.authority,
            signingKeyID: envelope.signingKeyID,
            sequence: envelope.sequence,
            revision: envelope.revision,
            payloadChecksum: envelope.payloadChecksum,
            objectID: objectID
        )
        gate.beginAuthenticatedConnection(
            replayKey: key,
            subscription: fixture.subscription,
            replayGuard: replayGuard,
            isAutomaticReconnect: true
        )
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            replayGuard: replayGuard
        ), "a completed asset must not rearm on another reconnect")

        gate.recordAccepted(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            pendingAssetObjectIDs: [objectID]
        )
        gate.clearAll()
        gate.beginAuthenticatedConnection(
            replayKey: key,
            subscription: fixture.subscription,
            replayGuard: replayGuard,
            isAutomaticReconnect: true
        )
        XCTAssertNil(gate.consumeIfExactLatestReplay(
            replayKey: key,
            envelope: envelope,
            encodedEnvelope: encoded,
            replayGuard: replayGuard
        ), "a manual reset must also block a later automatic retry from reviving old evidence")
    }
}

final class StudioLANBonjourIntegrationTests: XCTestCase {
    func testBonjourDiscoveryFindsTheAdvertisedStudioService() throws {
        let serviceName = "Tchurch Test \(UUID().uuidString.prefix(8))"
        let listenerReady = expectation(description: "Bonjour listener ready")
        let discovered = expectation(description: "Studio Bonjour service discovered")
        discovered.assertForOverFulfill = false
        let listener = try NWListener(using: .tcp, on: .any)
        listener.service = .init(
            name: serviceName,
            type: TchurchStudioLANClient.bonjourServiceType,
            domain: "local.",
            txtRecord: nil
        )
        listener.stateUpdateHandler = { state in
            if case .ready = state { listenerReady.fulfill() }
        }
        listener.newConnectionHandler = { $0.cancel() }
        listener.start(queue: DispatchQueue(label: "app.tchurch.tests.studio-lan-bonjour-listener"))
        defer { listener.cancel() }
        wait(for: [listenerReady], timeout: 3)

        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-studio-bonjour-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let suiteName = "app.tchurch.tests.studio-lan-bonjour.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let client = try TchurchStudioLANClient(
            secretStore: RecordingStudioLANSecretStore(),
            defaults: defaults,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: RecordingStudioLANPrivacyStateStore()
        )
        client.statusHandler = { status in
            if status.services.contains(where: { $0.name.hasPrefix(serviceName) }) {
                discovered.fulfill()
            }
        }
        let privacyReady = expectation(description: "LAN privacy scope ready")
        client.synchronizePrivacyContext(
            access: .authorized,
            principalID: "test-principal",
            churchID: "test-church"
        ) { result in
            if case .failure(let error) = result { XCTFail("privacy scope failed: \(error)") }
            privacyReady.fulfill()
        }
        wait(for: [privacyReady], timeout: 2)
        client.startDiscovery()
        defer {
            client.disconnect()
            client.stopDiscovery()
        }

        wait(for: [discovered], timeout: 8)
    }
}

final class StudioLANAssetRequestWatchdogTests: XCTestCase {
    func testSilentRequestExpiresAndCancelledStaleRequestCannotFireForNewCue() {
        let queue = DispatchQueue(label: "app.tchurch.tests.asset-watchdog")
        let watchdog = TchurchStudioLANAssetRequestWatchdog(queue: queue)
        let stale = expectation(description: "stale request")
        stale.isInverted = true
        let expired = expectation(description: "silent current request expires")

        queue.async {
            watchdog.arm(after: 0.05) { stale.fulfill() }
            watchdog.cancel()
            watchdog.arm(after: 0.05) { expired.fulfill() }
        }

        wait(for: [expired, stale], timeout: 0.3)
    }
}

final class StudioLANPrivateStateTests: XCTestCase {
    func testKeychainPairingCanBeReadAndFullyDeleted() throws {
        let store = TchurchStudioLANKeychainSecretStore()
        let serviceID = "test-\(UUID().uuidString.lowercased())"
        let secret = Data(repeating: 0x52, count: 32)
        defer { try? store.deleteAll() }

        try store.write(secret, serviceID: serviceID)
        XCTAssertEqual(try store.read(serviceID: serviceID), secret)
        try store.deleteAll()
        XCTAssertNil(try store.read(serviceID: serviceID))
    }

    func testPrivacyKeychainAtomicallyReplacesTombstoneWithCompletedScope() throws {
        let store = TchurchStudioLANKeychainPrivacyStateStore(
            service: "app.tchurch.tests.studio-lan-privacy.\(UUID().uuidString.lowercased())"
        )
        defer { try? store.delete() }
        let principal = "sha256:\(String(repeating: "c", count: 64))"
        let target = "sha256:\(String(repeating: "b", count: 64))"
        var tombstone = TchurchStudioLANPrivacyState.empty
        tombstone.purgeRequired = true
        tombstone.purgeTargetPrincipalFingerprint = principal
        tombstone.purgeTargetScopeFingerprint = target
        tombstone.clientIdentityInitialized = true
        tombstone.clientID = UUID().uuidString.lowercased()

        try store.write(tombstone)
        XCTAssertEqual(try store.read(), tombstone)

        var completed = tombstone
        completed.scopeInitialized = true
        completed.principalFingerprint = principal
        completed.scopeFingerprint = target
        completed.purgeRequired = false
        completed.purgeTargetPrincipalFingerprint = nil
        completed.purgeTargetScopeFingerprint = nil
        completed.clientID = nil
        try store.write(completed)
        XCTAssertEqual(try store.read(), completed)
    }

    func testLogoutPurgeDeletesSecretsCacheClientIdentityAndDisconnects() throws {
        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-studio-private-state-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try Data("private-cache-marker".utf8).write(
            to: rootURL.appendingPathComponent("marker", isDirectory: false)
        )
        defer { try? FileManager.default.removeItem(at: rootURL) }

        let secretStore = RecordingStudioLANSecretStore()
        secretStore.entries["service"] = Data(repeating: 0x41, count: 32)
        let suiteName = "app.tchurch.tests.studio-lan-private-state.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(UUID().uuidString.lowercased(), forKey: "tchurch.studio-lan.client-id")

        let client = try TchurchStudioLANClient(
            secretStore: secretStore,
            defaults: defaults,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: RecordingStudioLANPrivacyStateStore()
        )
        let purged = expectation(description: "private Studio LAN state purged")
        var purgeError: Error?
        client.purgePrivateState { result in
            if case .failure(let error) = result { purgeError = error }
            purged.fulfill()
        }
        wait(for: [purged], timeout: 2)

        XCTAssertNil(purgeError)
        XCTAssertTrue(secretStore.didDeleteAll)
        XCTAssertTrue(secretStore.entries.isEmpty)
        XCTAssertNil(defaults.string(forKey: "tchurch.studio-lan.client-id"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))

        let statusRead = expectation(description: "disconnected status read")
        client.currentStatus { status in
            XCTAssertEqual(status.phase, .failed, "signed-out clients must not expose a cold LAN scope")
            XCTAssertNil(status.selectedServiceID)
            XCTAssertFalse(status.paired)
            statusRead.fulfill()
        }
        wait(for: [statusRead], timeout: 1)
    }

    func testCachedPrincipalCanResumeOfflineButDifferentAccountPurgesBeforeMembershipFetch() throws {
        let rootURL = temporaryRoot("privacy-principal")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let privacy = RecordingStudioLANPrivacyStateStore()
        let secrets = RecordingStudioLANSecretStore()
        let initial = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )
        try synchronize(initial, access: .authorized, principalID: "user-1", churchID: "church-1")
        XCTAssertEqual(secrets.deleteAllCount, 1)

        let offlineRestart = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )
        try synchronize(offlineRestart, access: .principal, principalID: "user-1", churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 1, "same cached principal keeps the verified offline scope")
        let ready = expectation(description: "same-principal offline scope ready")
        offlineRestart.currentStatus { status in
            XCTAssertEqual(status.phase, .idle)
            ready.fulfill()
        }
        wait(for: [ready], timeout: 1)

        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        try synchronize(offlineRestart, access: .principal, principalID: "user-2", churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 2)
        XCTAssertNil(privacy.state.scopeFingerprint)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))
        let blocked = expectation(description: "different principal blocked pending church scope")
        offlineRestart.currentStatus { status in
            XCTAssertEqual(status.phase, .failed)
            XCTAssertFalse(status.paired)
            blocked.fulfill()
        }
        wait(for: [blocked], timeout: 1)
    }

    func testCentralPrivacyContextPurgesOnlyForPrincipalChurchLogoutOrRevocation() throws {
        let rootURL = temporaryRoot("privacy-context")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let secrets = RecordingStudioLANSecretStore()
        let privacy = RecordingStudioLANPrivacyStateStore()
        let client = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )

        try synchronize(client, access: .authorized, principalID: "user-1", churchID: "church-1")
        XCTAssertEqual(secrets.deleteAllCount, 1, "first scoped migration must delete legacy private state")
        let firstScope = try XCTUnwrap(privacy.state.scopeFingerprint)

        try synchronize(client, access: .authorized, principalID: "user-1", churchID: "church-1")
        XCTAssertEqual(secrets.deleteAllCount, 1, "same scope must not churn pairing or cache")

        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        try synchronize(client, access: .unknown, principalID: nil, churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 1, "temporary token/Internet uncertainty is not revocation")
        XCTAssertTrue(FileManager.default.fileExists(atPath: rootURL.path))

        try synchronize(client, access: .authorized, principalID: "user-2", churchID: "church-1")
        XCTAssertEqual(secrets.deleteAllCount, 2)
        XCTAssertNotEqual(privacy.state.scopeFingerprint, firstScope)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))

        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        try synchronize(client, access: .authorized, principalID: "user-2", churchID: "church-2")
        XCTAssertEqual(secrets.deleteAllCount, 3)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))

        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        try synchronize(client, access: .revoked, principalID: nil, churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 4)
        XCTAssertNil(privacy.state.scopeFingerprint)

        try synchronize(client, access: .authorized, principalID: "user-2", churchID: "church-2")
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        try synchronize(client, access: .signedOut, principalID: nil, churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 6)
        XCTAssertNil(privacy.state.scopeFingerprint)
        XCTAssertNil(privacy.state.clientID)
        XCTAssertFalse(privacy.state.purgeRequired)
    }

    func testTombstoneBeginWriteFailureDeletesNothingAndNextColdStartCanRetry() throws {
        let rootURL = temporaryRoot("privacy-begin-failure")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let clientID = UUID().uuidString.lowercased()
        let privacy = RecordingStudioLANPrivacyStateStore(state: scopedPrivacyState(clientID: clientID))
        privacy.failingWriteAttempts = [1]
        let secrets = RecordingStudioLANSecretStore()
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let firstClient = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )

        XCTAssertThrowsError(try purge(firstClient))
        XCTAssertEqual(privacy.writeAttempts, 1)
        XCTAssertEqual(secrets.deleteAllCount, 0, "no deletion may begin without a durable tombstone")
        XCTAssertFalse(privacy.state.purgeRequired)
        XCTAssertEqual(privacy.state.clientID, clientID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: rootURL.path))

        let restarted = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )
        try synchronize(restarted, access: .signedOut, principalID: nil, churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 1)
        XCTAssertFalse(privacy.state.purgeRequired)
        XCTAssertNil(privacy.state.scopeFingerprint)
        XCTAssertNil(privacy.state.clientID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))
    }

    func testCompletionWriteFailureLeavesColdStartBlockedUntilTombstoneRetrySucceeds() throws {
        let rootURL = temporaryRoot("privacy-completion-failure")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let clientID = UUID().uuidString.lowercased()
        let privacy = RecordingStudioLANPrivacyStateStore(state: scopedPrivacyState(clientID: clientID))
        privacy.failingWriteAttempts = [2]
        let secrets = RecordingStudioLANSecretStore()
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let firstClient = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )

        XCTAssertThrowsError(try purge(firstClient))
        XCTAssertTrue(privacy.state.purgeRequired)
        XCTAssertEqual(privacy.state.clientID, clientID, "identity is cleared only by the checked completion record")
        XCTAssertEqual(secrets.deleteAllCount, 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))

        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let restarted = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )
        let statusRead = expectation(description: "cold cache blocked")
        restarted.currentStatus { status in
            XCTAssertEqual(status.phase, .failed)
            XCTAssertFalse(status.paired)
            XCTAssertNil(status.selectedServiceID)
            statusRead.fulfill()
        }
        wait(for: [statusRead], timeout: 1)

        try synchronize(restarted, access: .signedOut, principalID: nil, churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 2)
        XCTAssertFalse(privacy.state.purgeRequired)
        XCTAssertNil(privacy.state.clientID)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))
    }

    func testInjectedCachePurgeFailureSurvivesRestartAsDurableTombstone() throws {
        let rootURL = temporaryRoot("privacy-cache-failure")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let privacy = RecordingStudioLANPrivacyStateStore(state: scopedPrivacyState())
        let secrets = RecordingStudioLANSecretStore()
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let failingClient = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            assetCachePurge: { throw TchurchStudioLANError.assetCacheUnavailable },
            privacyStateStore: privacy
        )

        XCTAssertThrowsError(try purge(failingClient))
        XCTAssertTrue(privacy.state.purgeRequired)
        XCTAssertTrue(FileManager.default.fileExists(atPath: rootURL.path))

        let restarted = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy
        )
        try synchronize(restarted, access: .signedOut, principalID: nil, churchID: nil)
        XCTAssertFalse(privacy.state.purgeRequired)
        XCTAssertFalse(FileManager.default.fileExists(atPath: rootURL.path))
    }

    func testAuthenticatedWiFiLossMultipleFailuresAndSuccessfulRangedResumePreservePrivateState() throws {
        let rootURL = temporaryRoot("range-reconnect")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let cache = TchurchStudioLANAssetCache(rootURL: rootURL, diskCapacity: { _ in 10 * 1_024 * 1_024 * 1_024 })
        var bytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        bytes.append(Data(repeating: 0x61, count: TchurchStudioLANAssetChunk.byteCount + 512))
        let descriptor = TchurchStudioLANImageAssetDescriptor(
            schemaVersion: 1,
            referenceID: "sha256:\(String(repeating: "b", count: 64))",
            objectID: "sha256:\(TchurchStudioLANCrypto.sha256Hex(bytes))",
            kind: .image,
            mimeType: "image/png",
            byteSize: Int64(bytes.count),
            required: true,
            imageFit: .cover
        )
        let authority = makeAuthority()
        XCTAssertEqual(
            try cache.prepare(descriptor: descriptor, authority: authority, cueID: "cue-1", protectedObjectIDs: []),
            .resume(offset: 0)
        )
        let firstBytes = Data(bytes.prefix(TchurchStudioLANAssetChunk.byteCount))
        let firstChunk = TchurchStudioLANAssetChunk(
            schemaVersion: 1,
            requestID: UUID(),
            objectID: descriptor.objectID,
            offset: 0,
            totalByteSize: descriptor.byteSize,
            data: firstBytes,
            dataSha256: "sha256:\(TchurchStudioLANCrypto.sha256Hex(firstBytes))",
            isFinal: false
        )
        XCTAssertEqual(try cache.append(firstChunk, descriptor: descriptor), .partial(nextOffset: Int64(firstBytes.count)))

        let clientID = UUID().uuidString.lowercased()
        let privacy = RecordingStudioLANPrivacyStateStore(state: scopedPrivacyState(clientID: clientID))
        let secrets = RecordingStudioLANSecretStore()
        secrets.entries["service"] = Data(repeating: 0x41, count: 32)
        var policy = TchurchStudioLANReconnectPolicy()
        policy.recordAuthenticatedSession()
        XCTAssertEqual(policy.record(.network(.init(domain: .posix, code: Int32(ENETDOWN)))), .reconnect(afterSeconds: 1))
        XCTAssertEqual(policy.record(.timeout(lastNetworkFailure: .init(domain: .posix, code: Int32(ETIMEDOUT)))), .reconnect(afterSeconds: 2))
        XCTAssertEqual(policy.record(.eof), .reconnect(afterSeconds: 4))

        XCTAssertEqual(secrets.entries["service"], Data(repeating: 0x41, count: 32))
        XCTAssertEqual(privacy.state.clientID, clientID)
        XCTAssertEqual(
            try TchurchStudioLANAssetCache(rootURL: rootURL, diskCapacity: { _ in 10 * 1_024 * 1_024 * 1_024 })
                .prepare(descriptor: descriptor, authority: authority, cueID: "cue-1", protectedObjectIDs: []),
            .resume(offset: Int64(firstBytes.count))
        )
        policy.recordAuthenticatedSession()
        XCTAssertEqual(policy.consecutiveFailures, 0)
        XCTAssertTrue(policy.authenticatedSessionEstablished)
    }

    private func synchronize(
        _ client: TchurchStudioLANClient,
        access: TchurchStudioLANPrivacyAccess,
        principalID: String?,
        churchID: String?
    ) throws {
        let completed = expectation(description: "privacy context \(access.rawValue)")
        var result: Result<Void, Error>?
        client.synchronizePrivacyContext(
            access: access,
            principalID: principalID,
            churchID: churchID
        ) {
            result = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 2)
        try XCTUnwrap(result).get()
    }

    private func purge(_ client: TchurchStudioLANClient) throws {
        let completed = expectation(description: "explicit private purge")
        var result: Result<Void, Error>?
        client.purgePrivateState {
            result = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 2)
        try XCTUnwrap(result).get()
    }

    private func temporaryRoot(_ suffix: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-studio-\(suffix)-\(UUID().uuidString)", isDirectory: true)
    }

    private func seedPrivateState(
        rootURL: URL,
        secrets: RecordingStudioLANSecretStore
    ) throws {
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try Data("private-cache-marker".utf8).write(to: rootURL.appendingPathComponent("marker"))
        secrets.entries["service"] = Data(repeating: 0x41, count: 32)
    }

    private func scopedPrivacyState(clientID: String? = UUID().uuidString.lowercased()) -> TchurchStudioLANPrivacyState {
        TchurchStudioLANPrivacyState(
            schemaVersion: TchurchStudioLANPrivacyState.schemaVersion,
            scopeInitialized: true,
            principalFingerprint: "sha256:\(String(repeating: "c", count: 64))",
            scopeFingerprint: "sha256:\(String(repeating: "a", count: 64))",
            purgeRequired: false,
            purgeTargetPrincipalFingerprint: nil,
            purgeTargetScopeFingerprint: nil,
            clientIdentityInitialized: true,
            clientID: clientID
        )
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

private struct TestRequestProofV2: Codable {
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let supportedPayloadVersions: [Int]
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

private struct TestGrantProofV2: Codable {
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

private struct StudioLANV3AssetFixture: Decodable {
    let fixtureID: String
    let schemaVersion: Int
    let secret: String
    let signingPrivateKeySeed: String
    let challengeWire: String
    let subscribeWire: String
    let grantWire: String
    let envelopeWire: String
    let assetBytes: String
    let assetRequestWire: String
    let assetChunkWire: String
    let assetUnavailableWire: String
}

private struct StudioLANV1Fixture: Decodable {
    let secret: String
    let challengeWire: String
    let expectedSubscribeWire: String
    let grantWire: String
    let envelopeWire: String
    let nextEnvelopeWire: String
}

private func loadStudioLANFixture<Value: Decodable>(named name: String) throws -> Value {
    let sourceDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let url = sourceDirectory
        .appendingPathComponent("Fixtures", isDirectory: true)
        .appendingPathComponent("\(name).json", isDirectory: false)
    return try JSONDecoder().decode(Value.self, from: Data(contentsOf: url))
}

private func fixtureData(_ base64: String) throws -> Data {
    try XCTUnwrap(Data(base64Encoded: base64))
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
    minimumSequence: UInt64 = 12,
    selectedPayloadVersion requestedPayloadVersion: Int = 2
) throws -> TchurchStudioLANSubscriptionGrant {
    let sessionID = UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!
    let publicKey = identity.publicKey.rawRepresentation.base64EncodedString()
    let selectedPayloadVersion: Int? = request.schemaVersion == 2 ? requestedPayloadVersion : nil
    let proof: String
    if let selectedPayloadVersion {
        proof = try TchurchStudioLANCrypto.authenticationCode(for: TestGrantProofV2(
            challengeID: challenge.challengeID,
            sessionID: sessionID,
            requestID: request.requestID,
            channel: request.channel,
            authority: challenge.authority,
            signingKeyID: challenge.signingKeyID,
            signingPublicKey: publicKey,
            minimumSequence: minimumSequence,
            expiresAtMilliseconds: 1_500_000,
            clientNonce: request.clientNonce,
            selectedPayloadVersion: selectedPayloadVersion
        ), secret: secret)
    } else {
        proof = try TchurchStudioLANCrypto.authenticationCode(for: TestGrantProof(
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
        ), secret: secret)
    }
    return TchurchStudioLANSubscriptionGrant(
        schemaVersion: request.schemaVersion,
        sessionID: sessionID,
        requestID: request.requestID,
        channel: request.channel,
        authority: challenge.authority,
        signingKeyID: challenge.signingKeyID,
        signingPublicKey: publicKey,
        minimumSequence: minimumSequence,
        expiresAtMilliseconds: 1_500_000,
        selectedPayloadVersion: selectedPayloadVersion,
        serverProof: proof
    )
}

private func makeSubscriptionFixture(
    channel: TchurchStudioLANChannel,
    epoch: UInt64 = 7,
    identity suppliedIdentity: Curve25519.Signing.PrivateKey? = nil,
    minimumSequence: UInt64 = 12,
    requestSchemaVersion: Int = 1
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
        clientNonce: Data(repeating: 0x21, count: 24),
        schemaVersion: requestSchemaVersion
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

private func stagePayload(
    revision: UInt64,
    message: String = "Puente dos veces"
) -> TchurchStudioLANChannelPayload {
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
            message: message
        )
    ))
}

private func stagePayloadV2(
    revision: UInt64,
    cueID: String = "cue-1",
    text: String = "Dios 🙌 es fiel",
    chordOffset: Int = 8,
    includeChordSlide: Bool = true
) -> TchurchStudioLANChannelPayload {
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
            countdown: nil
        ),
        cue: .init(cueID: "cue-1", title: "Verse", lines: [text], mediaAssetID: nil)
    )
    return .stage(.init(
        audience: audience,
        stage: .init(
            nextCue: nil,
            chordLines: ["C   C/E   G"],
            currentChordSlide: includeChordSlide ? .init(
                cueID: cueID,
                key: "C",
                lines: [.init(text: text, chords: [
                    .init(value: "C", offsetUtf16: 0),
                    .init(value: "C/E", offsetUtf16: 0),
                    .init(value: "G", offsetUtf16: chordOffset),
                ])]
            ) : nil,
            timers: [],
            message: nil
        )
    ))
}

private func signEnvelope(
    payload: TchurchStudioLANChannelPayload,
    authority: TchurchStudioLANAuthority,
    identity: Curve25519.Signing.PrivateKey,
    sequence: UInt64,
    revision: UInt64,
    schemaVersion: Int = 1
) throws -> TchurchStudioLANSignedEnvelope {
    let checksum = TchurchStudioLANCrypto.sha256Hex(try TchurchStudioLANCoding.encoder().encode(payload))
    let keyID = String(TchurchStudioLANCrypto.sha256Hex(identity.publicKey.rawRepresentation).prefix(24))
    let material = TestEnvelopeMaterial(
        schemaVersion: schemaVersion,
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
        schemaVersion: schemaVersion,
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

private func stageAssetPayload(
    authority: TchurchStudioLANAuthority,
    descriptor: TchurchStudioLANImageAssetDescriptor,
    revision: UInt64
) -> TchurchStudioLANChannelPayload {
    .stage(.init(
        audience: .init(
            snapshot: .init(
                schemaVersion: TchurchStudioLANAudienceSnapshot.schemaVersion,
                runID: authority.runID,
                authorityEpoch: authority.authorityEpoch,
                packageID: authority.packageID,
                serviceVersion: authority.serviceVersion,
                revision: revision,
                currentCueID: "cue-range",
                currentCueIndex: 0,
                cueCount: 1,
                isBlackout: false,
                countdown: nil
            ),
            cue: .init(
                cueID: "cue-range",
                title: "Range",
                lines: ["Resume exacto"],
                mediaAssetID: descriptor.objectID,
                imageAsset: descriptor
            )
        ),
        stage: .init(
            nextCue: nil,
            chordLines: [],
            currentChordSlide: nil,
            timers: [],
            message: nil
        )
    ))
}

private func authorizationSnapshot(rootURL: URL) throws -> [String: Data] {
    let directory = rootURL.appendingPathComponent("authorizations", isDirectory: true)
    guard FileManager.default.fileExists(atPath: directory.path) else { return [:] }
    let files = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    ).filter { $0.pathExtension == "authorization" }
    return try Dictionary(uniqueKeysWithValues: files.map { url in
        (url.lastPathComponent, try Data(contentsOf: url))
    })
}

private struct ExactReplayRangeRequestObservation: Equatable {
    let connection: Int
    let offset: Int64
}

private enum ExactReplayRangeServerScenario {
    case resumeAcrossThreeConnections
    case manualReset
}

private final class ExactReplayRangeClientObservations: @unchecked Sendable {
    private let lock = NSLock()
    private var storedServiceID: String?
    private var storedEnvelopePublicationCount = 0
    private var storedAssetStatuses: [TchurchStudioLANImageAssetStatus] = []
    private var storedStatuses: [TchurchStudioLANClientStatus] = []

    var serviceID: String? {
        lock.withLock { storedServiceID }
    }

    var envelopePublicationCount: Int {
        lock.withLock { storedEnvelopePublicationCount }
    }

    var readyAsset: TchurchStudioLANImageAssetStatus? {
        lock.withLock { storedAssetStatuses.last(where: { $0.phase == .ready }) }
    }

    var assetStatuses: [TchurchStudioLANImageAssetStatus] {
        lock.withLock { storedAssetStatuses }
    }

    var statuses: [TchurchStudioLANClientStatus] {
        lock.withLock { storedStatuses }
    }

    func recordServiceIDIfNeeded(_ value: String) -> Bool {
        lock.withLock {
            guard storedServiceID == nil else { return false }
            storedServiceID = value
            return true
        }
    }

    func recordEnvelopePublication() {
        lock.withLock { storedEnvelopePublicationCount += 1 }
    }

    func recordAssetStatus(_ status: TchurchStudioLANImageAssetStatus) {
        lock.withLock { storedAssetStatuses.append(status) }
    }

    func recordStatus(_ status: TchurchStudioLANClientStatus) {
        lock.withLock { storedStatuses.append(status) }
    }
}

private final class ExactReplayRangeStudioServer: @unchecked Sendable {
    private final class Session: @unchecked Sendable {
        let index: Int
        let connection: NWConnection
        var decoder: TchurchStudioLANLengthPrefixedFrameDecoder
        var challenge: TchurchStudioLANServerChallenge?

        init(index: Int, connection: NWConnection) throws {
            self.index = index
            self.connection = connection
            decoder = try TchurchStudioLANLengthPrefixedFrameDecoder(
                maximumFrameBytes: TchurchStudioLANLimits.production.maximumFrameBytes,
                maximumBufferedBytes: TchurchStudioLANLimits.production.maximumBufferedInputBytes
            )
        }
    }

    private let queue = DispatchQueue(label: "app.tchurch.tests.exact-replay-range-server")
    private let listener: NWListener
    private let secret: TchurchStudioLANPairingSecret
    private let identity: Curve25519.Signing.PrivateKey
    private let authority: TchurchStudioLANAuthority
    private let encodedEnvelope: Data
    private let assetBytes: Data
    private let objectID: String
    private let scenario: ExactReplayRangeServerScenario
    private let onReady: @Sendable () -> Void
    private let onFirstRequest: @Sendable () -> Void
    private let onCheckpointReady: @Sendable () -> Void
    private let onFinalRange: @Sendable () -> Void
    private let onThirdConnectionEnvelope: @Sendable () -> Void
    private let onUnexpectedAssetRequest: @Sendable () -> Void
    private var sessions: [ObjectIdentifier: Session] = [:]
    private var nextConnectionIndex = 0
    private var requests: [ExactReplayRangeRequestObservation] = []
    private var events: [String] = []
    private var failure: Error?
    private var signaledReady = false
    private var signaledFirstRequest = false
    private var signaledCheckpointReady = false
    private var signaledFinalRange = false
    private var signaledThirdConnectionEnvelope = false

    init(
        serviceName: String,
        secret: TchurchStudioLANPairingSecret,
        identity: Curve25519.Signing.PrivateKey,
        authority: TchurchStudioLANAuthority,
        encodedEnvelope: Data,
        assetBytes: Data,
        objectID: String,
        onReady: @escaping @Sendable () -> Void,
        scenario: ExactReplayRangeServerScenario = .resumeAcrossThreeConnections,
        onFirstRequest: @escaping @Sendable () -> Void = {},
        onCheckpointReady: @escaping @Sendable () -> Void = {},
        onFinalRange: @escaping @Sendable () -> Void = {},
        onThirdConnectionEnvelope: @escaping @Sendable () -> Void = {},
        onUnexpectedAssetRequest: @escaping @Sendable () -> Void = {}
    ) throws {
        listener = try NWListener(
            using: TchurchStudioLANNetworkParameters.makeListener(pairingSecret: secret),
            on: .any
        )
        listener.service = .init(
            name: serviceName,
            type: TchurchStudioLANClient.bonjourServiceType,
            domain: "local.",
            txtRecord: nil
        )
        self.secret = secret
        self.identity = identity
        self.authority = authority
        self.encodedEnvelope = encodedEnvelope
        self.assetBytes = assetBytes
        self.objectID = objectID
        self.scenario = scenario
        self.onReady = onReady
        self.onFirstRequest = onFirstRequest
        self.onCheckpointReady = onCheckpointReady
        self.onFinalRange = onFinalRange
        self.onThirdConnectionEnvelope = onThirdConnectionEnvelope
        self.onUnexpectedAssetRequest = onUnexpectedAssetRequest
    }

    var observedRequests: [ExactReplayRangeRequestObservation] {
        queue.sync { requests }
    }

    var recordedFailure: Error? {
        queue.sync { failure }
    }

    var observedEvents: [String] {
        queue.sync { events }
    }

    var connectionCount: Int {
        queue.sync { nextConnectionIndex }
    }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready where !self.signaledReady:
                self.signaledReady = true
                self.onReady()
            case .failed(let error):
                self.record(error)
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
    }

    func stop() {
        queue.sync {
            listener.stateUpdateHandler = nil
            listener.newConnectionHandler = nil
            listener.cancel()
            let retained = sessions.values
            sessions.removeAll(keepingCapacity: false)
            retained.forEach {
                $0.connection.stateUpdateHandler = nil
                $0.connection.cancel()
            }
        }
    }

    private func accept(_ connection: NWConnection) {
        do {
            nextConnectionIndex += 1
            let session = try Session(index: nextConnectionIndex, connection: connection)
            events.append("accepted-\(session.index)")
            sessions[ObjectIdentifier(connection)] = session
            connection.stateUpdateHandler = { [weak self, weak session] state in
                guard let self, let session else { return }
                switch state {
                case .ready:
                    self.events.append("ready-\(session.index)")
                    self.begin(session)
                case .failed, .cancelled:
                    self.events.append("ended-\(session.index)-\(String(describing: state))")
                    self.sessions.removeValue(forKey: ObjectIdentifier(connection))
                default:
                    break
                }
            }
            connection.start(queue: queue)
        } catch {
            record(error)
            connection.cancel()
        }
    }

    private func begin(_ session: Session) {
        let now = TchurchStudioLANTime.nowMilliseconds()
        let challenge = TchurchStudioLANServerChallenge(
            schemaVersion: TchurchStudioLANServerChallenge.schemaVersion,
            challengeID: UUID(),
            serverNonce: Data(repeating: UInt8(truncatingIfNeeded: session.index), count: 32)
                .base64EncodedString(),
            authority: authority,
            signingKeyID: String(
                TchurchStudioLANCrypto.sha256Hex(identity.publicKey.rawRepresentation).prefix(24)
            ),
            issuedAtMilliseconds: now,
            expiresAtMilliseconds: now + 60_000
        )
        session.challenge = challenge
        do {
            events.append("challenge-\(session.index)")
            try send([.challenge(challenge)], to: session)
            receiveNext(session)
        } catch {
            record(error)
            close(session)
        }
    }

    private func receiveNext(_ session: Session) {
        guard sessions[ObjectIdentifier(session.connection)] === session else { return }
        session.connection.receive(
            minimumIncompleteLength: 1,
            maximumLength: 64 * 1_024
        ) { [weak self, weak session] content, _, isComplete, error in
            guard let self, let session,
                  self.sessions[ObjectIdentifier(session.connection)] === session else { return }
            if let error {
                self.record(error)
                self.close(session)
                return
            }
            if isComplete {
                self.close(session)
                return
            }
            do {
                if let content, !content.isEmpty {
                    for frame in try session.decoder.append(content) {
                        try self.process(frame, session: session)
                        guard self.sessions[ObjectIdentifier(session.connection)] === session else { return }
                    }
                }
                self.receiveNext(session)
            } catch {
                self.record(error)
                self.close(session)
            }
        }
    }

    private func process(_ frame: Data, session: Session) throws {
        switch try TchurchStudioLANWireCodec.decode(frame) {
        case .subscribe(let request):
            events.append("subscribe-\(session.index)")
            guard let challenge = session.challenge,
                  request.schemaVersion == TchurchStudioLANSubscriptionRequest.currentSchemaVersion,
                  request.channel == .stage else {
                throw TchurchStudioLANError.protocolViolation
            }
            let grant = try liveGrant(
                challenge: challenge,
                request: request,
                identity: identity,
                secret: secret,
                minimumSequence: 12,
                selectedPayloadVersion: 3
            )
            events.append("grant-envelope-\(session.index)")
            try send([.grant(grant), .envelope(encodedEnvelope)], to: session)
            if session.index == 3, !signaledThirdConnectionEnvelope {
                signaledThirdConnectionEnvelope = true
                onThirdConnectionEnvelope()
            }
            if case .manualReset = scenario, session.index == 2 {
                queue.asyncAfter(deadline: .now() + .milliseconds(200)) { [weak self, weak session] in
                    guard let self, let session,
                          self.sessions[ObjectIdentifier(session.connection)] === session else { return }
                    self.finishTransport(session)
                }
            }
        case .assetRequest(let request):
            try handle(request, session: session)
        case .pong:
            break
        default:
            throw TchurchStudioLANError.protocolViolation
        }
    }

    private func handle(_ request: TchurchStudioLANAssetRequest, session: Session) throws {
        guard request.schemaVersion == TchurchStudioLANAssetRequest.schemaVersion,
              request.objectID == objectID,
              request.maximumBytes == TchurchStudioLANAssetChunk.byteCount else {
            throw TchurchStudioLANError.protocolViolation
        }
        requests.append(.init(connection: session.index, offset: request.offset))
        events.append("asset-\(session.index)-\(request.offset)")
        let chunkBytes = Int64(TchurchStudioLANAssetChunk.byteCount)
        if session.index == 1, request.offset == 0, !signaledFirstRequest {
            signaledFirstRequest = true
            onFirstRequest()
        }

        switch scenario {
        case .resumeAcrossThreeConnections:
            if session.index == 1, request.offset == chunkBytes {
                // The first chunk is durable. Drop the unanswered next Range.
                finishTransport(session)
                return
            }
            if session.index == 2, request.offset == chunkBytes * 2 {
                // Recovery itself can be interrupted; leave its second chunk
                // durable so the third connection must rehydrate once more.
                finishTransport(session)
                return
            }
            if session.index == 3, request.offset == chunkBytes * 2, !signaledFinalRange {
                signaledFinalRange = true
                onFinalRange()
            }
        case .manualReset:
            if session.index == 1, request.offset == chunkBytes {
                if !signaledCheckpointReady {
                    signaledCheckpointReady = true
                    onCheckpointReady()
                }
                return
            }
            if session.index >= 2 {
                onUnexpectedAssetRequest()
                return
            }
        }

        guard request.offset >= 0,
              request.offset < Int64(assetBytes.count) else {
            throw TchurchStudioLANError.invalidAssetRequest
        }
        let start = Int(request.offset)
        let end = min(assetBytes.count, start + request.maximumBytes)
        let chunkData = Data(assetBytes[start ..< end])
        let chunk = TchurchStudioLANAssetChunk(
            schemaVersion: TchurchStudioLANAssetChunk.schemaVersion,
            requestID: request.requestID,
            objectID: request.objectID,
            offset: request.offset,
            totalByteSize: Int64(assetBytes.count),
            data: chunkData,
            dataSha256: "sha256:\(TchurchStudioLANCrypto.sha256Hex(chunkData))",
            isFinal: end == assetBytes.count
        )
        try send([.assetChunk(chunk)], to: session)
    }

    private func send(_ messages: [TchurchStudioLANWireMessage], to session: Session) throws {
        var content = Data()
        for message in messages {
            content.append(try TchurchStudioLANWireCodec.encode(
                message,
                maximumFrameBytes: TchurchStudioLANLimits.production.maximumFrameBytes
            ))
        }
        session.connection.send(content: content, completion: .contentProcessed { [weak self] error in
            if let error { self?.queue.async { self?.record(error) } }
        })
    }

    private func close(_ session: Session) {
        sessions.removeValue(forKey: ObjectIdentifier(session.connection))
        session.connection.stateUpdateHandler = nil
        session.connection.cancel()
    }

    private func finishTransport(_ session: Session) {
        sessions.removeValue(forKey: ObjectIdentifier(session.connection))
        session.connection.stateUpdateHandler = nil
        session.connection.send(
            content: nil,
            contentContext: .finalMessage,
            isComplete: true,
            completion: .contentProcessed { [weak connection = session.connection] _ in
                connection?.cancel()
            }
        )
    }

    private func record(_ error: Error) {
        if failure == nil { failure = error }
    }
}

private func liveGrant(
    challenge: TchurchStudioLANServerChallenge,
    request: TchurchStudioLANSubscriptionRequest,
    identity: Curve25519.Signing.PrivateKey,
    secret: TchurchStudioLANPairingSecret,
    minimumSequence: UInt64,
    selectedPayloadVersion: Int
) throws -> TchurchStudioLANSubscriptionGrant {
    let now = TchurchStudioLANTime.nowMilliseconds()
    let expiresAtMilliseconds = now + 60_000
    let sessionID = UUID()
    let publicKey = identity.publicKey.rawRepresentation.base64EncodedString()
    let proof = try TchurchStudioLANCrypto.authenticationCode(
        for: TestGrantProofV2(
            challengeID: challenge.challengeID,
            sessionID: sessionID,
            requestID: request.requestID,
            channel: request.channel,
            authority: challenge.authority,
            signingKeyID: challenge.signingKeyID,
            signingPublicKey: publicKey,
            minimumSequence: minimumSequence,
            expiresAtMilliseconds: expiresAtMilliseconds,
            clientNonce: request.clientNonce,
            selectedPayloadVersion: selectedPayloadVersion
        ),
        secret: secret
    )
    return TchurchStudioLANSubscriptionGrant(
        schemaVersion: request.schemaVersion,
        sessionID: sessionID,
        requestID: request.requestID,
        channel: request.channel,
        authority: challenge.authority,
        signingKeyID: challenge.signingKeyID,
        signingPublicKey: publicKey,
        minimumSequence: minimumSequence,
        expiresAtMilliseconds: expiresAtMilliseconds,
        selectedPayloadVersion: selectedPayloadVersion,
        serverProof: proof
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

private final class RecordingStudioLANSecretStore: TchurchStudioLANSecretStoring, @unchecked Sendable {
    var entries: [String: Data] = [:]
    private(set) var didDeleteAll = false
    private(set) var deleteAllCount = 0
    var deleteAllError: Error?

    func read(serviceID: String) throws -> Data? {
        entries[serviceID]
    }

    func write(_ secret: Data, serviceID: String) throws {
        entries[serviceID] = secret
    }

    func delete(serviceID: String) throws {
        entries.removeValue(forKey: serviceID)
    }

    func deleteAll() throws {
        deleteAllCount += 1
        if let deleteAllError { throw deleteAllError }
        didDeleteAll = true
        entries.removeAll(keepingCapacity: false)
    }
}

private final class RecordingStudioLANPrivacyStateStore: TchurchStudioLANPrivacyStateStoring, @unchecked Sendable {
    var state: TchurchStudioLANPrivacyState
    var failingWriteAttempts: Set<Int> = []
    var readError: Error?
    private(set) var writeAttempts = 0
    private(set) var writes: [TchurchStudioLANPrivacyState] = []

    init(state: TchurchStudioLANPrivacyState = .empty) {
        self.state = state
    }

    func read() throws -> TchurchStudioLANPrivacyState {
        if let readError { throw readError }
        return state
    }

    func write(_ state: TchurchStudioLANPrivacyState) throws {
        writeAttempts += 1
        if failingWriteAttempts.contains(writeAttempts) {
            throw TchurchStudioLANError.invalidConfiguration
        }
        guard state.isValid else { throw TchurchStudioLANError.invalidConfiguration }
        self.state = state
        writes.append(state)
    }
}
