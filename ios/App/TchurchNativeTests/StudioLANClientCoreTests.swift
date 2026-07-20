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
        guard case .challenge(
            let challenge,
            let supportedPayloadVersions,
            let controlSupportedPayloadVersions,
            let localOBSControlPayloadVersions
        ) = challengeMessage else {
            return XCTFail("Expected challenge fixture")
        }
        XCTAssertNil(supportedPayloadVersions)
        XCTAssertNil(controlSupportedPayloadVersions)
        XCTAssertNil(localOBSControlPayloadVersions)
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
        guard case .challenge(
            let challenge,
            let supportedPayloadVersions,
            let controlSupportedPayloadVersions,
            let localOBSControlPayloadVersions
        ) = challengeMessage else {
            return XCTFail("Expected v1 challenge fixture")
        }
        XCTAssertNil(supportedPayloadVersions)
        XCTAssertNil(controlSupportedPayloadVersions)
        XCTAssertNil(localOBSControlPayloadVersions)
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
        XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(TchurchStudioLANChannelPayload.self, from: control))
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

final class StudioLANHeartbeatIntegrationTests: XCTestCase {
    func testSilentAuthenticatedTransportReconnectsWithoutPurgingPrivateState() throws {
        try assertHeartbeatFailure(mode: .silent, expectsClientPing: true)
    }

    func testWrongHeartbeatPongReconnectsWithoutPurgingPrivateState() throws {
        try assertHeartbeatFailure(mode: .wrongPong, expectsClientPing: true)
    }

    func testUnsolicitedHeartbeatPongReconnectsWithoutPurgingPrivateState() throws {
        try assertHeartbeatFailure(mode: .unsolicitedPong, expectsClientPing: false)
    }

    func testReconnectCancelsOldHeartbeatTimersAndEchoedPongsKeepNewTransportAlive() throws {
        let firstPing = expectation(description: "first silent transport received heartbeat")
        let secondPing = expectation(description: "replacement transport echoed heartbeat")
        firstPing.assertForOverFulfill = false
        secondPing.assertForOverFulfill = false
        let context = try makeHeartbeatContext(
            mode: .silentThenEcho,
            onPing: { connectionIndex, _ in
                if connectionIndex == 1 { firstPing.fulfill() }
                if connectionIndex == 2 { secondPing.fulfill() }
            }
        )
        defer { context.stop() }

        let discovered = expectation(description: "heartbeat Studio discovered")
        let firstConnected = expectation(description: "first heartbeat transport connected")
        let firstReconnect = expectation(description: "silent heartbeat transport reconnecting")
        let secondConnected = expectation(description: "replacement heartbeat transport connected")
        let unexpectedReconnect = expectation(description: "old heartbeat timer closed replacement transport")
        unexpectedReconnect.isInverted = true
        [discovered, firstConnected, firstReconnect, secondConnected].forEach {
            $0.assertForOverFulfill = false
        }

        context.client.statusHandler = { status in
            let event = context.observations.record(status, serviceNamePrefix: context.serviceName)
            if event.discoveredServiceID != nil { discovered.fulfill() }
            if event.connectedCount == 1, event.didEnterConnected { firstConnected.fulfill() }
            if event.connectedCount == 1, event.didEnterReconnecting { firstReconnect.fulfill() }
            if event.connectedCount == 2, event.didEnterConnected { secondConnected.fulfill() }
            if event.connectedCount >= 2, event.didEnterReconnecting { unexpectedReconnect.fulfill() }
        }

        context.client.startDiscovery()
        wait(for: [discovered], timeout: 10)
        let serviceID = try XCTUnwrap(context.observations.serviceID)
        context.client.connect(
            serviceID: serviceID,
            channel: .stage,
            pairingCode: context.secret.transportKeyMaterial.base64EncodedString()
        )
        wait(for: [firstConnected, firstPing, firstReconnect, secondConnected, secondPing], timeout: 8)
        wait(for: [unexpectedReconnect], timeout: 1)

        XCTAssertEqual(context.secretStore.deleteAllCount, context.baselineDeleteAllCount)
        XCTAssertEqual(context.purgeCounter.value, context.baselineCachePurgeCount)
        XCTAssertEqual(context.secretStore.entries[serviceID], context.secret.transportKeyMaterial)
        XCTAssertFalse(context.privacyStore.state.purgeRequired)
        XCTAssertGreaterThanOrEqual(context.server.connectionCount, 2)
    }

    private func assertHeartbeatFailure(
        mode: HeartbeatStudioServerMode,
        expectsClientPing: Bool
    ) throws {
        let heartbeatReceived = expectation(description: "client heartbeat reached Studio")
        heartbeatReceived.isInverted = !expectsClientPing
        heartbeatReceived.assertForOverFulfill = false
        let context = try makeHeartbeatContext(mode: mode) { _, _ in
            heartbeatReceived.fulfill()
        }
        defer { context.stop() }

        let discovered = expectation(description: "heartbeat Studio discovered")
        let connected = expectation(description: "heartbeat transport authenticated")
        let reconnecting = expectation(description: "heartbeat failure reconnecting")
        [discovered, connected, reconnecting].forEach { $0.assertForOverFulfill = false }
        context.client.statusHandler = { status in
            let event = context.observations.record(status, serviceNamePrefix: context.serviceName)
            if event.discoveredServiceID != nil { discovered.fulfill() }
            if event.didEnterConnected { connected.fulfill() }
            if event.didEnterReconnecting { reconnecting.fulfill() }
        }

        context.client.startDiscovery()
        wait(for: [discovered], timeout: 10)
        let serviceID = try XCTUnwrap(context.observations.serviceID)
        context.client.connect(
            serviceID: serviceID,
            channel: .stage,
            pairingCode: context.secret.transportKeyMaterial.base64EncodedString()
        )
        wait(for: [connected, reconnecting, heartbeatReceived], timeout: 5)

        XCTAssertEqual(context.secretStore.deleteAllCount, context.baselineDeleteAllCount)
        XCTAssertEqual(context.purgeCounter.value, context.baselineCachePurgeCount)
        XCTAssertEqual(context.secretStore.entries[serviceID], context.secret.transportKeyMaterial)
        XCTAssertFalse(context.privacyStore.state.purgeRequired)
    }

    private func makeHeartbeatContext(
        mode: HeartbeatStudioServerMode,
        onPing: @escaping @Sendable (Int, String) -> Void
    ) throws -> HeartbeatTestContext {
        let serviceName = "Tchurch Heartbeat \(UUID().uuidString.prefix(8))"
        let secret = try fixedSecret(0x6D)
        let identity = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x4D, count: 32)
        )
        let listenerReady = expectation(description: "heartbeat Studio listener ready")
        let server = try HeartbeatStudioServer(
            serviceName: serviceName,
            secret: secret,
            identity: identity,
            authority: makeAuthority(),
            mode: mode,
            onReady: { listenerReady.fulfill() },
            onPing: onPing
        )
        server.start()
        wait(for: [listenerReady], timeout: 5)

        let rootURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("tchurch-heartbeat-\(UUID().uuidString)", isDirectory: true)
        let suiteName = "app.tchurch.tests.heartbeat.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let secretStore = RecordingStudioLANSecretStore()
        let privacyStore = RecordingStudioLANPrivacyStateStore()
        let purgeCounter = HeartbeatPurgeCounter()
        let client = try TchurchStudioLANClient(
            heartbeatTimings: .init(idleInterval: 0.2, pongTimeout: 0.3),
            secretStore: secretStore,
            defaults: defaults,
            assetCache: TchurchStudioLANAssetCache(
                rootURL: rootURL,
                diskCapacity: { _ in 10 * 1_024 * 1_024 * 1_024 }
            ),
            assetCachePurge: { purgeCounter.increment() },
            privacyStateStore: privacyStore
        )
        let privacyReady = expectation(description: "heartbeat privacy scope ready")
        client.synchronizePrivacyContext(
            access: .authorized,
            principalID: "heartbeat-principal",
            churchID: "heartbeat-church"
        ) { result in
            if case .failure(let error) = result { XCTFail("privacy scope failed: \(error)") }
            privacyReady.fulfill()
        }
        wait(for: [privacyReady], timeout: 3)

        return HeartbeatTestContext(
            serviceName: serviceName,
            secret: secret,
            server: server,
            client: client,
            defaults: defaults,
            defaultsSuiteName: suiteName,
            rootURL: rootURL,
            secretStore: secretStore,
            privacyStore: privacyStore,
            purgeCounter: purgeCounter,
            baselineDeleteAllCount: secretStore.deleteAllCount,
            baselineCachePurgeCount: purgeCounter.value
        )
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
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let trustStore = TestStudioLANDeviceTrustStateStore()
        let deviceTrust = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: trustStore
        )
        let studioID = UUID()
        let identity = try deviceTrust.beginEnrollment(studioID: studioID)
        try deviceTrust.accept(
            makeStudioLANDeviceGrant(
                identity: identity,
                signer: Curve25519.Signing.PrivateKey(),
                studioID: studioID,
                permissions: [.observe, .controlProgram],
                role: .production
            ),
            nowMilliseconds: 1_100_000
        )

        let client = try TchurchStudioLANClient(
            secretStore: secretStore,
            defaults: defaults,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: RecordingStudioLANPrivacyStateStore(),
            deviceTrust: deviceTrust
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
        XCTAssertNil(trustStore.state)
        XCTAssertNil(trustStore.recoveryMarker)
        XCTAssertEqual(trustStore.protocolFloor, 4)
        XCTAssertFalse(identityProvider.hasIdentity)
        XCTAssertEqual(deviceTrust.snapshot.enrollmentState, .unenrolled)
        XCTAssertEqual(deviceTrust.snapshot.protocolFloor, 4)
        XCTAssertNil(deviceTrust.presentedGrant)
        XCTAssertFalse(deviceTrust.permitsLegacyFallback)

        let restartedTrust = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: trustStore
        )
        XCTAssertEqual(restartedTrust.snapshot.enrollmentState, .unenrolled)
        XCTAssertEqual(restartedTrust.snapshot.protocolFloor, 4)
        XCTAssertFalse(identityProvider.hasIdentity, "restart must not recreate a purged P-256 identity")
        let freshIdentity = try restartedTrust.beginEnrollment(studioID: UUID())
        XCTAssertNotEqual(freshIdentity.deviceID, identity.deviceID)
        XCTAssertNotEqual(freshIdentity.fingerprint, identity.fingerprint)
        XCTAssertEqual(restartedTrust.snapshot.enrollmentState, .pending)
        XCTAssertNil(restartedTrust.presentedGrant)

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
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let trustStore = TestStudioLANDeviceTrustStateStore()
        let initialTrust = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: trustStore
        )
        let initial = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy,
            deviceTrust: initialTrust
        )
        try synchronize(initial, access: .authorized, principalID: "user-1", churchID: "church-1")
        XCTAssertEqual(secrets.deleteAllCount, 1)
        let studioID = UUID()
        let productionIdentity = try initialTrust.beginEnrollment(studioID: studioID)
        try initialTrust.accept(
            makeStudioLANDeviceGrant(
                identity: productionIdentity,
                signer: Curve25519.Signing.PrivateKey(),
                studioID: studioID,
                permissions: [.observe, .controlProgram],
                role: .production
            ),
            nowMilliseconds: 1_100_000
        )

        let offlineTrust = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: trustStore
        )
        let offlineRestart = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy,
            deviceTrust: offlineTrust
        )
        try synchronize(offlineRestart, access: .principal, principalID: "user-1", churchID: nil)
        XCTAssertEqual(secrets.deleteAllCount, 1, "same cached principal keeps the verified offline scope")
        XCTAssertEqual(offlineTrust.snapshot.role, .production)
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
        XCTAssertNil(trustStore.state)
        XCTAssertFalse(identityProvider.hasIdentity)
        XCTAssertEqual(offlineTrust.snapshot.enrollmentState, .unenrolled)
        XCTAssertEqual(offlineTrust.snapshot.protocolFloor, 4)
        XCTAssertNil(offlineTrust.presentedGrant)
        let isolated = expectation(description: "different principal owns an isolated local-only scope")
        offlineRestart.currentStatus { status in
            XCTAssertEqual(status.phase, .idle)
            XCTAssertFalse(status.paired)
            isolated.fulfill()
        }
        wait(for: [isolated], timeout: 1)

        try synchronize(offlineRestart, access: .authorized, principalID: "user-2", churchID: "church-2")
        XCTAssertEqual(secrets.deleteAllCount, 3, "learning the church isolates the principal-only scope before use")
        XCTAssertNotNil(privacy.state.scopeFingerprint)
    }

    func testCentralPrivacyContextPurgesOnlyForPrincipalChurchLogoutOrRevocation() throws {
        let rootURL = temporaryRoot("privacy-context")
        defer { try? FileManager.default.removeItem(at: rootURL) }
        let secrets = RecordingStudioLANSecretStore()
        let privacy = RecordingStudioLANPrivacyStateStore()
        let deviceTrust = try isolatedDeviceTrust()
        let client = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
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
        let deviceTrust = try isolatedDeviceTrust()
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let firstClient = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
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
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
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
        let deviceTrust = try isolatedDeviceTrust()
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let firstClient = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
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
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
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
        let deviceTrust = try isolatedDeviceTrust()
        try seedPrivateState(rootURL: rootURL, secrets: secrets)
        let failingClient = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            assetCachePurge: { throw TchurchStudioLANError.assetCacheUnavailable },
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
        )

        XCTAssertThrowsError(try purge(failingClient))
        XCTAssertTrue(privacy.state.purgeRequired)
        XCTAssertTrue(FileManager.default.fileExists(atPath: rootURL.path))

        let restarted = try TchurchStudioLANClient(
            secretStore: secrets,
            assetCache: TchurchStudioLANAssetCache(rootURL: rootURL),
            privacyStateStore: privacy,
            deviceTrust: deviceTrust
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

    private func isolatedDeviceTrust() throws -> StudioLANDeviceTrustController {
        try StudioLANDeviceTrustController(
            identityProvider: TestStudioLANDeviceIdentityProvider(),
            stateStore: TestStudioLANDeviceTrustStateStore()
        )
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

private struct StudioLANV6OperatorTimerFixture: Decodable {
    let schemaVersion: Int
    let fixtureID: String
    let devicePrivateKeyRawHex: String
    let devicePublicKey: String
    let studioPrivateKeyRawHex: String
    let studioSigningPublicKey: String
    let studioSigningKeyID: String
    let initialOperatorTimers: TchurchStudioLANOperatorTimersProjection
    let initialOperatorTimersCanonicalHex: String
    let operatorTimers: TchurchStudioLANOperatorTimersProjection
    let operatorTimersCanonicalHex: String
    let commandSigningMaterialCanonicalHex: String
    let commandWire: TchurchStudioLANWireMessage
    let receiptSigningMaterialCanonicalHex: String
    let receiptWire: TchurchStudioLANWireMessage
}

private struct StudioLANV7LocalBroadcastLowerThirdFixture: Decodable {
    let schemaVersion: Int
    let fixtureID: String
    let devicePublicKey: String
    let devicePublicKeyFingerprint: String
    let studioSigningPublicKey: String
    let studioSigningKeyID: String
    let initialState: TchurchStudioLANLocalBroadcastLowerThirdProjection
    let visibleState: TchurchStudioLANLocalBroadcastLowerThirdProjection
    let hiddenState: TchurchStudioLANLocalBroadcastLowerThirdProjection
    let showCommand: TchurchStudioLANLocalBroadcastLowerThirdCommand
    let showCommandSigningMaterialHex: String
    let showReceipt: TchurchStudioLANLocalBroadcastLowerThirdReceipt
    let showReceiptSigningMaterialHex: String
    let hideCommand: TchurchStudioLANLocalBroadcastLowerThirdCommand
    let hideCommandSigningMaterialHex: String
    let hideReceipt: TchurchStudioLANLocalBroadcastLowerThirdReceipt
    let hideReceiptSigningMaterialHex: String
}

private struct StudioLANV8LocalOBSFixture: Decodable {
    let schemaVersion: Int
    let fixtureID: String
    let devicePrivateKeyRawHex: String
    let devicePublicKey: String
    let devicePublicKeyFingerprint: String
    let studioPrivateKeyRawHex: String
    let studioSigningPublicKey: String
    let studioSigningKeyID: String
    let state: TchurchStudioLANLocalOBSProjection
    let stateCanonicalHex: String
    let action: TchurchStudioLANLocalOBSSceneAction
    let command: TchurchStudioLANLocalOBSSceneCommand
    let commandSigningMaterialHex: String
    let acceptedReceipt: TchurchStudioLANLocalOBSSceneReceipt
    let acceptedReceiptSigningMaterialHex: String
    let unconfirmedReceipt: TchurchStudioLANLocalOBSSceneReceipt
    let unconfirmedReceiptSigningMaterialHex: String
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

private func fixtureHexData(_ hex: String) -> Data? {
    let characters = Array(hex.utf8)
    guard characters.count.isMultiple(of: 2) else { return nil }

    func nibble(_ character: UInt8) -> UInt8? {
        switch character {
        case 48 ... 57: return character - 48
        case 65 ... 70: return character - 55
        case 97 ... 102: return character - 87
        default: return nil
        }
    }

    var result = Data(capacity: characters.count / 2)
    for index in stride(from: 0, to: characters.count, by: 2) {
        guard let high = nibble(characters[index]),
              let low = nibble(characters[index + 1]) else { return nil }
        result.append((high << 4) | low)
    }
    return result
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

private enum HeartbeatStudioServerMode {
    case silent
    case wrongPong
    case unsolicitedPong
    case silentThenEcho
}

private struct HeartbeatStatusEvent {
    let discoveredServiceID: String?
    let connectedCount: Int
    let didEnterConnected: Bool
    let didEnterReconnecting: Bool
}

private final class HeartbeatClientObservations: @unchecked Sendable {
    private let lock = NSLock()
    private var storedServiceID: String?
    private var storedConnectedCount = 0
    private var lastPhase: TchurchStudioLANConnectionPhase?

    var serviceID: String? {
        lock.withLock { storedServiceID }
    }

    func record(
        _ status: TchurchStudioLANClientStatus,
        serviceNamePrefix: String
    ) -> HeartbeatStatusEvent {
        lock.withLock {
            var discoveredServiceID: String?
            if storedServiceID == nil,
               let service = status.services.first(where: { $0.name.hasPrefix(serviceNamePrefix) }) {
                storedServiceID = service.id
                discoveredServiceID = service.id
            }
            let didEnterConnected = status.phase == .connected && lastPhase != .connected
            if didEnterConnected { storedConnectedCount += 1 }
            let didEnterReconnecting = status.phase == .reconnecting && lastPhase != .reconnecting
            lastPhase = status.phase
            return HeartbeatStatusEvent(
                discoveredServiceID: discoveredServiceID,
                connectedCount: storedConnectedCount,
                didEnterConnected: didEnterConnected,
                didEnterReconnecting: didEnterReconnecting
            )
        }
    }
}

private final class HeartbeatPurgeCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var storedValue = 0

    var value: Int { lock.withLock { storedValue } }

    func increment() {
        lock.withLock { storedValue += 1 }
    }
}

private struct HeartbeatTestContext {
    let serviceName: String
    let secret: TchurchStudioLANPairingSecret
    let server: HeartbeatStudioServer
    let client: TchurchStudioLANClient
    let defaults: UserDefaults
    let defaultsSuiteName: String
    let rootURL: URL
    let secretStore: RecordingStudioLANSecretStore
    let privacyStore: RecordingStudioLANPrivacyStateStore
    let purgeCounter: HeartbeatPurgeCounter
    let baselineDeleteAllCount: Int
    let baselineCachePurgeCount: Int
    let observations = HeartbeatClientObservations()

    func stop() {
        client.statusHandler = nil
        client.envelopeHandler = nil
        client.imageAssetHandler = nil
        client.disconnect()
        client.stopDiscovery()
        server.stop()
        defaults.removePersistentDomain(forName: defaultsSuiteName)
        try? FileManager.default.removeItem(at: rootURL)
    }
}

private final class HeartbeatStudioServer: @unchecked Sendable {
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

    private let queue = DispatchQueue(label: "app.tchurch.tests.heartbeat-server")
    private let listener: NWListener
    private let secret: TchurchStudioLANPairingSecret
    private let identity: Curve25519.Signing.PrivateKey
    private let authority: TchurchStudioLANAuthority
    private let mode: HeartbeatStudioServerMode
    private let onReady: @Sendable () -> Void
    private let onPing: @Sendable (Int, String) -> Void
    private var sessions: [ObjectIdentifier: Session] = [:]
    private var nextConnectionIndex = 0
    private var signaledReady = false

    init(
        serviceName: String,
        secret: TchurchStudioLANPairingSecret,
        identity: Curve25519.Signing.PrivateKey,
        authority: TchurchStudioLANAuthority,
        mode: HeartbeatStudioServerMode,
        onReady: @escaping @Sendable () -> Void,
        onPing: @escaping @Sendable (Int, String) -> Void
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
        self.mode = mode
        self.onReady = onReady
        self.onPing = onPing
    }

    var connectionCount: Int { queue.sync { nextConnectionIndex } }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            if case .ready = state, !self.signaledReady {
                self.signaledReady = true
                self.onReady()
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
            sessions[ObjectIdentifier(connection)] = session
            connection.stateUpdateHandler = { [weak self, weak session] state in
                guard let self, let session else { return }
                switch state {
                case .ready:
                    self.begin(session)
                case .failed, .cancelled:
                    self.sessions.removeValue(forKey: ObjectIdentifier(connection))
                default:
                    break
                }
            }
            connection.start(queue: queue)
        } catch {
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
            try send([.challenge(challenge)], to: session)
            receiveNext(session)
        } catch {
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
            if error != nil || isComplete {
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
                self.close(session)
            }
        }
    }

    private func process(_ frame: Data, session: Session) throws {
        switch try TchurchStudioLANWireCodec.decode(frame) {
        case .subscribe(let request):
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
            if mode == .unsolicitedPong {
                try send([.grant(grant), .pong("unsolicited")], to: session)
            } else {
                try send([.grant(grant)], to: session)
            }
        case .ping(let nonce) where !nonce.isEmpty && nonce.utf8.count <= 128:
            onPing(session.index, nonce)
            switch mode {
            case .silent, .unsolicitedPong:
                break
            case .wrongPong:
                try send([.pong("\(nonce)-wrong")], to: session)
            case .silentThenEcho where session.index == 1:
                break
            case .silentThenEcho:
                try send([.pong(nonce)], to: session)
            }
        case .pong:
            break
        default:
            throw TchurchStudioLANError.protocolViolation
        }
    }

    private func send(_ messages: [TchurchStudioLANWireMessage], to session: Session) throws {
        var content = Data()
        for message in messages {
            content.append(try TchurchStudioLANWireCodec.encode(
                message,
                maximumFrameBytes: TchurchStudioLANLimits.production.maximumFrameBytes
            ))
        }
        session.connection.send(content: content, completion: .contentProcessed { _ in })
    }

    private func close(_ session: Session) {
        sessions.removeValue(forKey: ObjectIdentifier(session.connection))
        session.connection.stateUpdateHandler = nil
        session.connection.cancel()
    }
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
        case .ping(let nonce) where !nonce.isEmpty && nonce.utf8.count <= 128:
            try send([.pong(nonce)], to: session)
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

final class StudioLANDeviceTrustV4Tests: XCTestCase {
    func testDeviceGrantAllowsOnlyBoundedFutureClockSkewAndKeepsExpirationStrict() throws {
        let nowMilliseconds: Int64 = 1_100_000
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        let controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let signer = Curve25519.Signing.PrivateKey()
        let studioID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!

        XCTAssertEqual(
            StudioLANDeviceTrustContract.maximumFutureClockSkewMilliseconds,
            TchurchStudioLANRemoteControlContract.maximumFutureClockSkewMilliseconds
        )

        let withinSkew = try makeStudioLANDeviceGrant(
            identity: identityProvider.identity,
            signer: signer,
            studioID: studioID,
            permissions: [.observe, .controlProgram],
            issuedAtMilliseconds: nowMilliseconds + 4_999,
            expiresAtMilliseconds: nowMilliseconds + 60_000
        )
        XCTAssertNoThrow(try controller.accept(withinSkew, nowMilliseconds: nowMilliseconds))
        XCTAssertEqual(controller.snapshot.enrollmentState, .approved)
        XCTAssertEqual(controller.presentedGrant, withinSkew)

        let beyondSkew = try makeStudioLANDeviceGrant(
            identity: identityProvider.identity,
            signer: signer,
            studioID: studioID,
            permissions: [.observe, .controlProgram],
            issuedAtMilliseconds: nowMilliseconds + 5_001,
            expiresAtMilliseconds: nowMilliseconds + 60_000
        )
        XCTAssertThrowsError(try beyondSkew.verify(
            identity: identityProvider.identity,
            nowMilliseconds: nowMilliseconds,
            pinnedStudioID: studioID
        )) {
            XCTAssertEqual($0 as? StudioLANDeviceTrustError, .invalidGrant)
        }

        let expired = try makeStudioLANDeviceGrant(
            identity: identityProvider.identity,
            signer: signer,
            studioID: studioID,
            permissions: [.observe, .controlProgram],
            issuedAtMilliseconds: nowMilliseconds - 60_000,
            expiresAtMilliseconds: nowMilliseconds
        )
        XCTAssertThrowsError(try expired.verify(
            identity: identityProvider.identity,
            nowMilliseconds: nowMilliseconds,
            pinnedStudioID: studioID
        )) {
            XCTAssertEqual($0 as? StudioLANDeviceTrustError, .expiredGrant)
        }
    }

    func testPossessionProofAndSubscriptionHMACMatchStudioV4CanonicalContract() throws {
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        let controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let studioID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let challenge = TchurchStudioLANServerChallenge(
            schemaVersion: 1,
            challengeID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            serverNonce: Data(repeating: 0x41, count: 32).base64EncodedString(),
            authority: TchurchStudioLANAuthority(
                runID: UUID(uuidString: "cccccccc-cccc-4ccc-8ccc-cccccccccccc")!,
                authorityEpoch: 7,
                packageID: "package",
                serviceVersion: "v4"
            ),
            signingKeyID: "0123456789abcdef01234567",
            issuedAtMilliseconds: 1_000_000,
            expiresAtMilliseconds: 1_060_000,
            deviceTrustVersion: 4,
            minimumPayloadVersion: 4,
            studioID: studioID
        )
        let requestID = UUID(uuidString: "dddddddd-dddd-4ddd-8ddd-dddddddddddd")!
        let nonce = Data(repeating: 0x22, count: 24)
        let versions = [4, 3, 2, 1]
        let attestation = try controller.makeAttestation(
            challenge: challenge,
            requestID: requestID,
            clientName: "Tchurch iOS",
            channel: .stage,
            clientNonce: nonce.base64EncodedString(),
            supportedPayloadVersions: versions,
            requestedRole: .musicians
        )

        XCTAssertEqual(attestation.schemaVersion, 4)
        XCTAssertEqual(attestation.deviceID, identityProvider.identity.deviceID)
        XCTAssertEqual(attestation.devicePublicKey.utf8.count, 88)
        XCTAssertTrue(attestation.devicePublicKeyFingerprint.hasPrefix("sha256:"))
        XCTAssertNil(attestation.presentedGrant)
        let possession = TestStudioLANDevicePossessionProof(
            schemaVersion: 4,
            domain: "tchurch-studio-lan-device-possession-v4",
            challenge: challenge,
            requestID: requestID,
            clientID: identityProvider.identity.deviceID,
            clientName: "Tchurch iOS",
            channel: .stage,
            clientNonce: nonce.base64EncodedString(),
            supportedPayloadVersions: versions,
            deviceID: identityProvider.identity.deviceID,
            requestedRole: .musicians,
            keyAlgorithm: .p256Signing,
            devicePublicKey: identityProvider.identity.publicKey,
            devicePublicKeyFingerprint: identityProvider.identity.fingerprint,
            presentedGrantChecksum: nil
        )
        let signatureData = try XCTUnwrap(Data(base64Encoded: attestation.proof))
        let signature = try P256.Signing.ECDSASignature(derRepresentation: signatureData)
        let publicKeyData = try XCTUnwrap(Data(base64Encoded: attestation.devicePublicKey))
        let publicKey = try P256.Signing.PublicKey(x963Representation: publicKeyData)
        XCTAssertTrue(publicKey.isValidSignature(
            signature,
            for: try TchurchStudioLANCoding.encoder().encode(possession)
        ))

        let secret = try TchurchStudioLANPairingSecret(rawRepresentation: Data(repeating: 0x55, count: 32))
        let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: identityProvider.identity.deviceID,
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: secret,
            requestID: requestID,
            clientNonce: nonce,
            schemaVersion: TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion,
            offeredPayloadVersions: versions,
            deviceAttestation: attestation
        )
        XCTAssertEqual(request.schemaVersion, 3)
        XCTAssertEqual(request.supportedPayloadVersions, versions)
        XCTAssertEqual(request.deviceAttestation, attestation)
        XCTAssertTrue(TchurchStudioLANCrypto.validatesAuthenticationCode(
            request.authenticationProof,
            for: TestStudioLANSubscriptionRequestProofV4(
                challenge: challenge,
                requestID: requestID,
                clientID: identityProvider.identity.deviceID,
                clientName: "Tchurch iOS",
                channel: .stage,
                clientNonce: nonce.base64EncodedString(),
                supportedPayloadVersions: versions,
                deviceAttestation: attestation
            ),
            secret: secret
        ))

        var negotiation = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
        XCTAssertEqual(negotiation.requestSchemaVersion, 3)
        XCTAssertFalse(negotiation.attemptLegacyFallback(
            afterSentRequest: request,
            signal: .authenticatedLegacyError
        ))
        XCTAssertThrowsError(try controller.requireLegacyFallbackAllowed()) {
            XCTAssertEqual($0 as? StudioLANDeviceTrustError, .legacyDowngradeDenied)
        }
    }

    func testSignedDeviceGrantApprovalAndRevocationAreStickyAcrossRestart() throws {
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        var controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let studioID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        _ = try controller.beginEnrollment(studioID: studioID)
        XCTAssertEqual(controller.snapshot.enrollmentState, .pending)
        XCTAssertEqual(controller.snapshot.protocolFloor, 4)

        let signer = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x33, count: 32)
        )
        let grant = try makeStudioLANDeviceGrant(
            identity: identityProvider.identity,
            signer: signer,
            studioID: studioID,
            permissions: [.observe, .controlProgram]
        )
        try controller.accept(grant, nowMilliseconds: 1_100_000)
        XCTAssertEqual(controller.snapshot.enrollmentState, .approved)
        XCTAssertEqual(controller.snapshot.role, .musicians)
        XCTAssertEqual(controller.snapshot.permissions, [.observe, .controlProgram])
        XCTAssertEqual(controller.snapshot.permissionRevision, 7)

        controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        XCTAssertEqual(controller.snapshot.enrollmentState, .approved)
        XCTAssertFalse(controller.permitsLegacyFallback)

        XCTAssertTrue(try controller.revoke(studioID: studioID, revocationGeneration: 3))
        XCTAssertEqual(controller.snapshot.enrollmentState, .revoked)
        XCTAssertEqual(controller.snapshot.revocationGeneration, 3)
        XCTAssertThrowsError(try controller.accept(grant, nowMilliseconds: 1_100_001)) {
            XCTAssertEqual($0 as? StudioLANDeviceTrustError, .revoked)
        }

        let reversed = try makeStudioLANDeviceGrant(
            identity: identityProvider.identity,
            signer: signer,
            studioID: studioID,
            permissions: [.controlProgram, .observe]
        )
        XCTAssertThrowsError(try reversed.verify(
            identity: identityProvider.identity,
            nowMilliseconds: 1_100_000,
            pinnedStudioID: studioID
        )) {
            XCTAssertEqual($0 as? StudioLANDeviceTrustError, .invalidGrant)
        }
    }

    func testExplicitReapprovalRotatesRevokedKeyAndDeviceIDWithoutDowngrade() throws {
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        var controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let studioID = UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!
        let oldIdentity = try controller.beginEnrollment(studioID: studioID)
        let signer = Curve25519.Signing.PrivateKey()
        let oldGrant = try makeStudioLANDeviceGrant(
            identity: oldIdentity,
            signer: signer,
            studioID: studioID,
            permissions: [.observe, .controlProgram]
        )
        try controller.accept(oldGrant, nowMilliseconds: 1_100_000)
        XCTAssertTrue(try controller.revoke(studioID: studioID, revocationGeneration: 9))

        let newIdentity = try controller.rotateRevokedIdentityForReapproval()
        XCTAssertNotEqual(newIdentity.deviceID, oldIdentity.deviceID)
        XCTAssertNotEqual(newIdentity.fingerprint, oldIdentity.fingerprint)
        XCTAssertEqual(controller.snapshot.enrollmentState, .pending)
        XCTAssertEqual(controller.snapshot.protocolFloor, 4)
        XCTAssertEqual(controller.snapshot.studioID, studioID)
        XCTAssertEqual(controller.snapshot.permissionRevision, 0)
        XCTAssertEqual(controller.snapshot.revocationGeneration, 0)
        XCTAssertFalse(controller.permitsLegacyFallback)
        XCTAssertNil(controller.presentedGrant)
        XCTAssertThrowsError(try controller.accept(oldGrant, nowMilliseconds: 1_100_001)) {
            XCTAssertEqual($0 as? StudioLANDeviceTrustError, .invalidGrant)
        }

        controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        XCTAssertEqual(controller.snapshot.deviceID, newIdentity.deviceID)
        XCTAssertEqual(controller.snapshot.enrollmentState, .pending)
        XCTAssertEqual(controller.snapshot.protocolFloor, 4)
    }

    func testReapprovalRecoveryAfterMarkerWriteRotatesRevokedIdentityWithoutRestoringGrant() throws {
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        let controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let studioID = UUID()
        let revokedIdentity = try controller.beginEnrollment(studioID: studioID)
        let grant = try makeStudioLANDeviceGrant(
            identity: revokedIdentity,
            signer: Curve25519.Signing.PrivateKey(),
            studioID: studioID,
            permissions: [.observe, .controlProgram],
            role: .production
        )
        try controller.accept(grant, nowMilliseconds: 1_100_000)
        XCTAssertTrue(try controller.revoke(studioID: studioID, revocationGeneration: 5))
        try stateStore.writeRecoveryMarker(StudioLANDeviceTrustRecoveryMarker(
            schemaVersion: StudioLANDeviceTrustRecoveryMarker.schemaVersion,
            intent: .reapproveRevokedIdentity,
            protocolFloor: 4,
            revokedDeviceID: revokedIdentity.deviceID,
            revokedPublicKeyFingerprint: revokedIdentity.fingerprint,
            studioID: studioID
        ))

        let recovered = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )

        XCTAssertEqual(identityProvider.deleteCount, 1)
        XCTAssertNotEqual(recovered.snapshot.deviceID, revokedIdentity.deviceID)
        XCTAssertNotEqual(recovered.snapshot.devicePublicKeyFingerprint, revokedIdentity.fingerprint)
        XCTAssertEqual(recovered.snapshot.enrollmentState, .pending)
        XCTAssertEqual(recovered.snapshot.protocolFloor, 4)
        XCTAssertEqual(recovered.snapshot.permissionRevision, 0)
        XCTAssertEqual(recovered.snapshot.revocationGeneration, 0)
        XCTAssertNil(recovered.presentedGrant)
        XCTAssertNil(stateStore.recoveryMarker)
        XCTAssertFalse(recovered.permitsLegacyFallback)
    }

    func testReapprovalRecoveryAfterIdentityRotationFinishesPendingRecordWithoutASecondRotation() throws {
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        let controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let studioID = UUID()
        let revokedIdentity = try controller.beginEnrollment(studioID: studioID)
        let grant = try makeStudioLANDeviceGrant(
            identity: revokedIdentity,
            signer: Curve25519.Signing.PrivateKey(),
            studioID: studioID,
            permissions: [.observe, .controlProgram],
            role: .production
        )
        try controller.accept(grant, nowMilliseconds: 1_100_000)
        XCTAssertTrue(try controller.revoke(studioID: studioID, revocationGeneration: 6))
        try stateStore.writeRecoveryMarker(StudioLANDeviceTrustRecoveryMarker(
            schemaVersion: StudioLANDeviceTrustRecoveryMarker.schemaVersion,
            intent: .reapproveRevokedIdentity,
            protocolFloor: 4,
            revokedDeviceID: revokedIdentity.deviceID,
            revokedPublicKeyFingerprint: revokedIdentity.fingerprint,
            studioID: studioID
        ))
        let alreadyRotated = try identityProvider.rotateAfterRevocation()
        XCTAssertEqual(identityProvider.deleteCount, 1)

        let recovered = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )

        XCTAssertEqual(identityProvider.deleteCount, 1)
        XCTAssertEqual(recovered.snapshot.deviceID, alreadyRotated.deviceID)
        XCTAssertEqual(recovered.snapshot.devicePublicKeyFingerprint, alreadyRotated.fingerprint)
        XCTAssertEqual(recovered.snapshot.enrollmentState, .pending)
        XCTAssertNil(recovered.presentedGrant)
        XCTAssertNil(stateStore.recoveryMarker)
        XCTAssertFalse(recovered.permitsLegacyFallback)
    }

    func testPrivatePurgeRecoveryAfterRecordDeletionRetiresIdentityAndKeepsOnlyFloor() throws {
        let identityProvider = TestStudioLANDeviceIdentityProvider()
        let stateStore = TestStudioLANDeviceTrustStateStore()
        let controller = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )
        let studioID = UUID()
        let oldIdentity = try controller.beginEnrollment(studioID: studioID)
        try controller.accept(
            makeStudioLANDeviceGrant(
                identity: oldIdentity,
                signer: Curve25519.Signing.PrivateKey(),
                studioID: studioID,
                permissions: [.observe, .controlProgram],
                role: .production
            ),
            nowMilliseconds: 1_100_000
        )
        try stateStore.writeRecoveryMarker(StudioLANDeviceTrustRecoveryMarker(
            schemaVersion: StudioLANDeviceTrustRecoveryMarker.schemaVersion,
            intent: .purgePrivateState,
            protocolFloor: 4,
            revokedDeviceID: nil,
            revokedPublicKeyFingerprint: nil,
            studioID: nil
        ))
        try stateStore.delete()

        let recovered = try StudioLANDeviceTrustController(
            identityProvider: identityProvider,
            stateStore: stateStore
        )

        XCTAssertNil(stateStore.state)
        XCTAssertNil(stateStore.recoveryMarker)
        XCTAssertEqual(stateStore.protocolFloor, 4)
        XCTAssertFalse(identityProvider.hasIdentity)
        XCTAssertEqual(recovered.snapshot.enrollmentState, .unenrolled)
        XCTAssertEqual(recovered.snapshot.protocolFloor, 4)
        XCTAssertNil(recovered.snapshot.role)
        XCTAssertTrue(recovered.snapshot.permissions.isEmpty)
        XCTAssertNil(recovered.presentedGrant)
        XCTAssertFalse(recovered.permitsLegacyFallback)
    }

    func testLegacySchemaCannotAdvertiseOrNegotiatePayloadV4() throws {
        let identity = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x33, count: 32)
        )
        let challenge = makeChallenge(identity: identity)
        XCTAssertThrowsError(try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
            challenge: challenge,
            clientID: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            clientName: "Tchurch iOS",
            channel: .stage,
            secret: fixedSecret(0x41),
            requestID: UUID(uuidString: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!,
            clientNonce: Data(repeating: 0x22, count: 24),
            schemaVersion: TchurchStudioLANSubscriptionRequest.currentSchemaVersion,
            offeredPayloadVersions: [4, 3, 2, 1]
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .unsupportedPayloadVersion)
        }
    }

    func testProductionRemoteCommandAndReceiptUseCanonicalSignedContract() throws {
        let device = TestStudioLANDeviceIdentityProvider()
        let studioSigner = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x33, count: 32)
        )
        let grant = try makeStudioLANDeviceGrant(
            identity: device.identity,
            signer: studioSigner,
            studioID: UUID(uuidString: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")!,
            permissions: [.observe, .controlProgram],
            role: .production
        )
        let encodedGrant = try TchurchStudioLANCoding.encoder().encode(grant)
        let checksum = "sha256:\(TchurchStudioLANCrypto.sha256Hex(encodedGrant))"
        let unsigned = TchurchStudioLANRemoteCommand(
            schemaVersion: 1,
            commandID: UUID(uuidString: "abcdefab-cdef-4abc-8def-abcdefabcdef")!,
            sessionID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            deviceID: grant.deviceID,
            grantID: grant.grantID,
            deviceGrantChecksum: checksum,
            permissionRevision: grant.permissionRevision,
            revocationGeneration: grant.revocationGeneration,
            authority: TchurchStudioLANAuthority(
                runID: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!,
                authorityEpoch: 9,
                packageID: "package",
                serviceVersion: "v4"
            ),
            routeEpoch: 12,
            expectedRevision: 41,
            issuedAtMilliseconds: 1_500_000,
            expiresAtMilliseconds: 1_515_000,
            action: .jump(cueID: "cue-2"),
            signature: ""
        )
        let canonical = try TchurchStudioLANRemoteCommandCrypto.signingData(for: unsigned)
        let json = String(decoding: canonical, as: UTF8.self)
        XCTAssertTrue(json.contains("\"domain\":\"tchurch-studio-lan-remote-command-v1\""))
        XCTAssertTrue(json.contains("\"commandID\":\"ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF\""))
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
            signature: try device.signPossessionProof(canonical)
        )
        XCTAssertNoThrow(try TchurchStudioLANRemoteCommandCrypto.verify(command, deviceGrant: grant))

        let signingKeyID = String(
            TchurchStudioLANCrypto.sha256Hex(studioSigner.publicKey.rawRepresentation).prefix(24)
        )
        let unsignedReceipt = TchurchStudioLANRemoteCommandReceipt(
            schemaVersion: 1,
            commandID: command.commandID,
            deviceID: command.deviceID,
            authority: command.authority,
            routeEpoch: command.routeEpoch,
            permissionRevision: command.permissionRevision,
            status: .accepted,
            rejection: nil,
            revision: 42,
            wasIdempotentReplay: false,
            issuedAtMilliseconds: 1_500_100,
            studioSigningKeyID: signingKeyID,
            signature: ""
        )
        let receipt = TchurchStudioLANRemoteCommandReceipt(
            schemaVersion: unsignedReceipt.schemaVersion,
            commandID: unsignedReceipt.commandID,
            deviceID: unsignedReceipt.deviceID,
            authority: unsignedReceipt.authority,
            routeEpoch: unsignedReceipt.routeEpoch,
            permissionRevision: unsignedReceipt.permissionRevision,
            status: unsignedReceipt.status,
            rejection: unsignedReceipt.rejection,
            revision: unsignedReceipt.revision,
            wasIdempotentReplay: unsignedReceipt.wasIdempotentReplay,
            issuedAtMilliseconds: unsignedReceipt.issuedAtMilliseconds,
            studioSigningKeyID: unsignedReceipt.studioSigningKeyID,
            signature: try studioSigner.signature(
                for: TchurchStudioLANRemoteReceiptCrypto.signingData(for: unsignedReceipt)
            ).base64EncodedString()
        )
        XCTAssertNoThrow(try TchurchStudioLANRemoteReceiptCrypto.verify(
            receipt,
            studioSigningPublicKey: studioSigner.publicKey.rawRepresentation.base64EncodedString()
        ))

        // A lost receipt is ambiguous: reconnect and re-sign for the new
        // authenticated context, but retain the journal identity and the
        // original optimistic action boundary exactly.
        var recovery = TchurchStudioLANRemoteCommandRecoveryState(command: command)
        XCTAssertTrue(recovery.markAmbiguous(nowMilliseconds: 1_518_000))
        let recoveredUnsigned = TchurchStudioLANRemoteCommand(
            schemaVersion: command.schemaVersion,
            commandID: command.commandID,
            sessionID: UUID(uuidString: "33333333-3333-4333-8333-333333333333")!,
            deviceID: command.deviceID,
            grantID: command.grantID,
            deviceGrantChecksum: command.deviceGrantChecksum,
            permissionRevision: command.permissionRevision,
            revocationGeneration: command.revocationGeneration,
            authority: TchurchStudioLANAuthority(
                runID: UUID(uuidString: "44444444-4444-4444-8444-444444444444")!,
                authorityEpoch: 10,
                packageID: "package",
                serviceVersion: "v4"
            ),
            routeEpoch: 13,
            expectedRevision: command.expectedRevision,
            issuedAtMilliseconds: 1_520_000,
            expiresAtMilliseconds: 1_535_000,
            action: command.action,
            signature: ""
        )
        let recovered = TchurchStudioLANRemoteCommand(
            schemaVersion: recoveredUnsigned.schemaVersion,
            commandID: recoveredUnsigned.commandID,
            sessionID: recoveredUnsigned.sessionID,
            deviceID: recoveredUnsigned.deviceID,
            grantID: recoveredUnsigned.grantID,
            deviceGrantChecksum: recoveredUnsigned.deviceGrantChecksum,
            permissionRevision: recoveredUnsigned.permissionRevision,
            revocationGeneration: recoveredUnsigned.revocationGeneration,
            authority: recoveredUnsigned.authority,
            routeEpoch: recoveredUnsigned.routeEpoch,
            expectedRevision: recoveredUnsigned.expectedRevision,
            issuedAtMilliseconds: recoveredUnsigned.issuedAtMilliseconds,
            expiresAtMilliseconds: recoveredUnsigned.expiresAtMilliseconds,
            action: recoveredUnsigned.action,
            signature: try device.signPossessionProof(
                TchurchStudioLANRemoteCommandCrypto.signingData(for: recoveredUnsigned)
            )
        )
        let changedRevision = TchurchStudioLANRemoteCommand(
            schemaVersion: recovered.schemaVersion,
            commandID: recovered.commandID,
            sessionID: recovered.sessionID,
            deviceID: recovered.deviceID,
            grantID: recovered.grantID,
            deviceGrantChecksum: recovered.deviceGrantChecksum,
            permissionRevision: recovered.permissionRevision,
            revocationGeneration: recovered.revocationGeneration,
            authority: recovered.authority,
            routeEpoch: recovered.routeEpoch,
            expectedRevision: recovered.expectedRevision + 1,
            issuedAtMilliseconds: recovered.issuedAtMilliseconds,
            expiresAtMilliseconds: recovered.expiresAtMilliseconds,
            action: recovered.action,
            signature: recovered.signature
        )
        XCTAssertThrowsError(try recovery.recordResignedAttempt(
            changedRevision,
            nowMilliseconds: 1_520_000
        )) {
            XCTAssertEqual($0 as? TchurchStudioLANRemoteControlError, .invalidCommand)
        }
        try recovery.recordResignedAttempt(recovered, nowMilliseconds: 1_520_000)
        XCTAssertEqual(recovered.commandID, command.commandID)
        XCTAssertEqual(recovered.action, command.action)
        XCTAssertEqual(recovered.expectedRevision, command.expectedRevision)
        XCTAssertNotEqual(recovered.sessionID, command.sessionID)
        XCTAssertNotEqual(recovered.routeEpoch, command.routeEpoch)
        XCTAssertNoThrow(try TchurchStudioLANRemoteCommandCrypto.verify(
            recovered,
            deviceGrant: grant
        ))
        XCTAssertTrue(recovery.markAmbiguous(nowMilliseconds: 1_538_000))
        try recovery.recordResignedAttempt(recovered, nowMilliseconds: 1_539_000)
        XCTAssertFalse(recovery.markAmbiguous(nowMilliseconds: 1_540_000))
    }
}

final class StudioLANCueCatalogV5Tests: XCTestCase {
    func testSingleBoundedRequestLaneNeverOverlapsAndIgnoresLateCompletion() {
        let assetID = UUID()
        let catalogID = UUID()
        let commandID = UUID()
        var lane = TchurchStudioLANBoundedRequestLane()

        XCTAssertTrue(lane.begin(.asset(assetID)))
        XCTAssertFalse(lane.begin(.catalog(catalogID)))
        XCTAssertFalse(lane.begin(.remoteCommand(commandID)))
        XCTAssertFalse(lane.finish(.catalog(catalogID)))
        XCTAssertEqual(lane.active, .asset(assetID))
        XCTAssertTrue(lane.finish(.asset(assetID)))

        XCTAssertTrue(lane.begin(.catalog(catalogID)))
        lane.reset()
        XCTAssertTrue(lane.begin(.remoteCommand(commandID)))
        XCTAssertFalse(lane.finish(.catalog(catalogID)))
        XCTAssertEqual(lane.active, .remoteCommand(commandID))
        XCTAssertTrue(lane.finish(.remoteCommand(commandID)))
        XCTAssertTrue(lane.isIdle)
    }

    func testDiscardedCatalogRequestIDsIgnoreOneLateResponseAndResetOnReconnect() {
        let lateID = UUID()
        var discarded = TchurchStudioLANDiscardedRequestIDs()
        discarded.remember(lateID)
        XCTAssertTrue(discarded.consume(lateID))
        XCTAssertFalse(discarded.consume(lateID))

        for _ in 0 ... TchurchStudioLANDiscardedRequestIDs.capacity {
            discarded.remember(UUID())
        }
        XCTAssertEqual(discarded.values.count, TchurchStudioLANDiscardedRequestIDs.capacity)
        discarded.reset()
        XCTAssertTrue(discarded.values.isEmpty)
    }

    func testCurrentCatalogUnavailableFailsClosedUnlessItMatchesTheInFlightRequest() throws {
        let activeID = UUID()
        let unknownID = UUID()

        XCTAssertNoThrow(try TchurchStudioLANCatalogResponseStrictness
            .validateCurrentUnavailableRequest(
                responseRequestID: activeID,
                inFlightRequestID: activeID
            ))
        XCTAssertThrowsError(try TchurchStudioLANCatalogResponseStrictness
            .validateCurrentUnavailableRequest(
                responseRequestID: unknownID,
                inFlightRequestID: activeID
            )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .protocolViolation)
        }
        XCTAssertThrowsError(try TchurchStudioLANCatalogResponseStrictness
            .validateCurrentUnavailableRequest(
                responseRequestID: unknownID,
                inFlightRequestID: nil
            )) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .protocolViolation)
        }

        // A known request cancelled during reset/reconnect is consumed before
        // strict current-manifest validation and ignored exactly once.
        var discarded = TchurchStudioLANDiscardedRequestIDs()
        discarded.remember(unknownID)
        XCTAssertTrue(discarded.consume(unknownID))
        XCTAssertFalse(discarded.consume(unknownID))
    }

    func testCatalogPacingAndOverloadBackoffStayBoundedBelowServerRate() {
        XCTAssertGreaterThanOrEqual(TchurchStudioLANClient.catalogInterPageDelaySeconds, 1.0 / 32.0)
        XCTAssertEqual(
            (1 ... TchurchStudioLANClient.maximumCatalogOverloadRetries).compactMap {
                TchurchStudioLANClient.catalogOverloadRetryDelaySeconds($0)
            },
            [1, 2, 4]
        )
        XCTAssertNil(TchurchStudioLANClient.catalogOverloadRetryDelaySeconds(0))
        XCTAssertNil(TchurchStudioLANClient.catalogOverloadRetryDelaySeconds(4))
    }

    func testProgramCommandAlwaysWinsTheNextFreeLaneSlot() {
        XCTAssertEqual(
            TchurchStudioLANBoundedRequestPriority.next(
                remoteCommandQueued: true,
                catalogReady: true,
                catalogHasPriority: true,
                assetReady: true
            ),
            .remoteCommand
        )
        XCTAssertEqual(
            TchurchStudioLANBoundedRequestPriority.next(
                remoteCommandQueued: false,
                catalogReady: true,
                catalogHasPriority: true,
                assetReady: true
            ),
            .catalog
        )
        XCTAssertEqual(
            TchurchStudioLANBoundedRequestPriority.next(
                remoteCommandQueued: false,
                catalogReady: true,
                catalogHasPriority: false,
                assetReady: true
            ),
            .asset
        )
    }

    func testReconnectAmbiguousV5JumpLoadsPagedCatalogBeforeCommandReplay() throws {
        // A v5 jump whose receipt was lost must wait for the new signed
        // catalog, but it must not itself block the catalog request lane.
        XCTAssertFalse(
            TchurchStudioLANBoundedRequestPriority.remoteCommandBlocksCatalogRequest(
                isAwaitingReceipt: false,
                isAwaitingAuthenticatedContext: true
            )
        )
        XCTAssertTrue(
            TchurchStudioLANBoundedRequestPriority.remoteCommandBlocksCatalogRequest(
                isAwaitingReceipt: true,
                isAwaitingAuthenticatedContext: true
            )
        )

        let cues = (0 ..< 129).map {
            TchurchStudioLANRemoteCueDescriptor(cueID: "cue-\($0)", title: "Cue \($0)")
        }
        let manifest = TchurchStudioLANCueCatalogManifest(
            schemaVersion: 1,
            catalogID: try TchurchStudioLANCueCatalogDigest.catalogID(for: cues),
            totalCount: cues.count,
            pageSize: 128
        )
        var accumulator = try TchurchStudioLANCueCatalogAccumulator(
            manifest: manifest,
            routeEpoch: 17
        )
        var lane = TchurchStudioLANBoundedRequestLane()

        XCTAssertEqual(
            TchurchStudioLANBoundedRequestPriority.next(
                remoteCommandQueued: false,
                catalogReady: true,
                catalogHasPriority: true,
                assetReady: true
            ),
            .catalog
        )
        let firstRequestID = UUID()
        XCTAssertTrue(lane.begin(.catalog(firstRequestID)))
        XCTAssertNil(try accumulator.append(
            TchurchStudioLANCatalogPage(
                schemaVersion: 1,
                requestID: firstRequestID,
                catalogID: manifest.catalogID,
                routeEpoch: 17,
                offset: 0,
                totalCount: cues.count,
                cues: Array(cues[0 ..< 128]),
                isFinal: false
            ),
            expectedRequestID: firstRequestID
        ))
        XCTAssertTrue(lane.finish(.catalog(firstRequestID)))

        let secondRequestID = UUID()
        XCTAssertTrue(lane.begin(.catalog(secondRequestID)))
        let completed = try accumulator.append(
            TchurchStudioLANCatalogPage(
                schemaVersion: 1,
                requestID: secondRequestID,
                catalogID: manifest.catalogID,
                routeEpoch: 17,
                offset: 128,
                totalCount: cues.count,
                cues: [cues[128]],
                isFinal: true
            ),
            expectedRequestID: secondRequestID
        )
        XCTAssertTrue(lane.finish(.catalog(secondRequestID)))
        XCTAssertEqual(completed, cues)

        // Once the complete catalog authenticates the jump target, Program
        // becomes the next and only higher-priority operation.
        XCTAssertEqual(
            TchurchStudioLANBoundedRequestPriority.next(
                remoteCommandQueued: true,
                catalogReady: false,
                catalogHasPriority: false,
                assetReady: true
            ),
            .remoteCommand
        )
    }

    func testCrossPlatformUnicodeCatalogDigestFixture() throws {
        let cues = [
            TchurchStudioLANRemoteCueDescriptor(cueID: "cue-1", title: "Bienvenida"),
            TchurchStudioLANRemoteCueDescriptor(cueID: "cántico-α", title: "Gracia y paz — Jesús"),
            TchurchStudioLANRemoteCueDescriptor(cueID: "emoji-🙏", title: "Oración 🙏"),
        ]
        XCTAssertEqual(
            try TchurchStudioLANCueCatalogDigest.catalogID(for: cues),
            "sha256:f9288023c2d9aefdad7c477a6df4a42034c99d672f97c5ba26d08ea04a7830bd"
        )
    }

    func testCatalogAccumulatorVerifiesBoundaryCatalogSizesWithoutPublishingPartialCues() throws {
        for count in [0, 1, 4_096, 4_097, 20_000] {
            let cues = (0 ..< count).map {
                TchurchStudioLANRemoteCueDescriptor(cueID: "cue-\($0)", title: "Diapositiva \($0)")
            }
            let manifest = TchurchStudioLANCueCatalogManifest(
                schemaVersion: 1,
                catalogID: try TchurchStudioLANCueCatalogDigest.catalogID(for: cues),
                totalCount: count,
                pageSize: 128
            )
            var accumulator = try TchurchStudioLANCueCatalogAccumulator(manifest: manifest, routeEpoch: 9)
            if count == 0 {
                XCTAssertEqual(try accumulator.verifiedEmptyCatalog(), [])
                continue
            }
            var completed: [TchurchStudioLANRemoteCueDescriptor]?
            while accumulator.nextOffset < count {
                let offset = accumulator.nextOffset
                let end = min(offset + 128, count)
                let requestID = UUID()
                completed = try accumulator.append(
                    TchurchStudioLANCatalogPage(
                        schemaVersion: 1,
                        requestID: requestID,
                        catalogID: manifest.catalogID,
                        routeEpoch: 9,
                        offset: offset,
                        totalCount: count,
                        cues: Array(cues[offset ..< end]),
                        isFinal: end == count
                    ),
                    expectedRequestID: requestID
                )
                if end < count { XCTAssertNil(completed) }
            }
            XCTAssertEqual(completed, cues)
        }
    }

    func testCatalogAccumulatorRejectsReorderedDuplicateOversizedAndStalePages() throws {
        let cues = (0 ..< 129).map {
            TchurchStudioLANRemoteCueDescriptor(cueID: "cue-\($0)", title: "Slide \($0)")
        }
        let catalogID = try TchurchStudioLANCueCatalogDigest.catalogID(for: cues)
        let manifest = TchurchStudioLANCueCatalogManifest(
            schemaVersion: 1,
            catalogID: catalogID,
            totalCount: cues.count,
            pageSize: 128
        )
        let requestID = UUID()

        var reordered = try TchurchStudioLANCueCatalogAccumulator(manifest: manifest, routeEpoch: 5)
        XCTAssertThrowsError(try reordered.append(
            TchurchStudioLANCatalogPage(
                schemaVersion: 1,
                requestID: requestID,
                catalogID: catalogID,
                routeEpoch: 5,
                offset: 1,
                totalCount: cues.count,
                cues: [cues[1]],
                isFinal: false
            ),
            expectedRequestID: requestID
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .protocolViolation) }

        var duplicate = try TchurchStudioLANCueCatalogAccumulator(manifest: manifest, routeEpoch: 5)
        let first = TchurchStudioLANCatalogPage(
            schemaVersion: 1,
            requestID: requestID,
            catalogID: catalogID,
            routeEpoch: 5,
            offset: 0,
            totalCount: cues.count,
            cues: [cues[0]],
            isFinal: false
        )
        XCTAssertNil(try duplicate.append(first, expectedRequestID: requestID))
        XCTAssertThrowsError(try duplicate.append(first, expectedRequestID: requestID)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .protocolViolation)
        }

        var oversized = try TchurchStudioLANCueCatalogAccumulator(manifest: manifest, routeEpoch: 5)
        XCTAssertThrowsError(try oversized.append(
            TchurchStudioLANCatalogPage(
                schemaVersion: 1,
                requestID: requestID,
                catalogID: catalogID,
                routeEpoch: 5,
                offset: 0,
                totalCount: cues.count,
                cues: cues,
                isFinal: true
            ),
            expectedRequestID: requestID
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .protocolViolation) }

        for (staleCatalogID, staleEpoch) in [(String(repeating: "a", count: 71), UInt64(5)), (catalogID, UInt64(6))] {
            var stale = try TchurchStudioLANCueCatalogAccumulator(manifest: manifest, routeEpoch: 5)
            XCTAssertThrowsError(try stale.append(
                TchurchStudioLANCatalogPage(
                    schemaVersion: 1,
                    requestID: requestID,
                    catalogID: staleCatalogID,
                    routeEpoch: staleEpoch,
                    offset: 0,
                    totalCount: cues.count,
                    cues: [cues[0]],
                    isFinal: false
                ),
                expectedRequestID: requestID
            )) { XCTAssertEqual($0 as? TchurchStudioLANError, .protocolViolation) }
        }

        let afterReconnect = try TchurchStudioLANCueCatalogAccumulator(manifest: manifest, routeEpoch: 5)
        XCTAssertEqual(afterReconnect.nextOffset, 0)
    }

    func testCatalogWireWrappersAndUnavailableCodesAreCrossPlatformExact() throws {
        let request = TchurchStudioLANCatalogRequest(
            schemaVersion: 1,
            requestID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!,
            catalogID: "sha256:f9288023c2d9aefdad7c477a6df4a42034c99d672f97c5ba26d08ea04a7830bd",
            routeEpoch: 9,
            offset: 0,
            maximumEntries: 128
        )
        let requestJSON = String(
            decoding: try TchurchStudioLANCoding.encoder().encode(TchurchStudioLANWireMessage.catalogRequest(request)),
            as: UTF8.self
        )
        XCTAssertTrue(requestJSON.contains("\"kind\":\"catalogRequest\""))
        XCTAssertTrue(requestJSON.contains("\"catalogRequest\""))

        let canonicalCues = [
            TchurchStudioLANRemoteCueDescriptor(cueID: "cue-1", title: "Bienvenida"),
            TchurchStudioLANRemoteCueDescriptor(cueID: "cántico-α", title: "Gracia y paz — Jesús"),
            TchurchStudioLANRemoteCueDescriptor(cueID: "emoji-🙏", title: "Oración 🙏"),
        ]
        let page = TchurchStudioLANCatalogPage(
            schemaVersion: 1,
            requestID: request.requestID,
            catalogID: request.catalogID,
            routeEpoch: request.routeEpoch,
            offset: 0,
            totalCount: 3,
            cues: canonicalCues,
            isFinal: true
        )
        let pageJSON = String(
            decoding: try TchurchStudioLANCoding.encoder().encode(TchurchStudioLANWireMessage.catalogPage(page)),
            as: UTF8.self
        )
        XCTAssertTrue(pageJSON.contains("\"kind\":\"catalogPage\""))
        XCTAssertTrue(pageJSON.contains("\"catalogPage\""))
        XCTAssertEqual(
            try TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANWireMessage.self,
                from: Data(pageJSON.utf8)
            ),
            .catalogPage(page)
        )

        for code in [
            TchurchStudioLANCatalogUnavailableCode.staleCatalog,
            .invalidRange,
            .overloaded,
        ] {
            let value = TchurchStudioLANCatalogUnavailable(
                schemaVersion: 1,
                requestID: request.requestID,
                catalogID: request.catalogID,
                code: code
            )
            let encoded = try TchurchStudioLANCoding.encoder().encode(
                TchurchStudioLANWireMessage.catalogUnavailable(value)
            )
            XCTAssertEqual(
                try TchurchStudioLANCoding.decoder().decode(TchurchStudioLANWireMessage.self, from: encoded),
                .catalogUnavailable(value)
            )
            XCTAssertTrue(String(decoding: encoded, as: UTF8.self).contains("\"code\":\"\(code.rawValue)\""))
        }
    }

    func testUpdatedDeviceTrustUsesBonjourHintAndPreservesExactLegacyOffers() throws {
        XCTAssertEqual(TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions, [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions, [7, 6, 5, 4, 3, 2, 1])
        XCTAssertEqual(TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions, [5, 4, 3, 2, 1])
        XCTAssertEqual(TchurchStudioLANSubscriptionRequest.v4SupportedPayloadVersions, [4, 3, 2, 1])
        let negotiation = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
        XCTAssertEqual(negotiation.supportedPayloadVersions, [7, 6, 5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(for: .control), [4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(for: .stage), [4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(for: .audience), [4, 3, 2, 1])

        let advertisedV6 = TchurchStudioLANService.parseAdvertisedPayloadVersions("6,5,4,3,2,1")
        let advertisedV5 = TchurchStudioLANService.parseAdvertisedPayloadVersions("5,4,3,2,1")
        XCTAssertEqual(advertisedV6, [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(advertisedV5, [5, 4, 3, 2, 1])
        XCTAssertEqual(TchurchStudioLANService(
            id: "studio-v6",
            name: "Tchurch Studio",
            protocolFloor: 4,
            advertisedPayloadVersions: advertisedV6
        ).advertisedPayloadVersions, advertisedV6)
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .control,
            advertisedPayloadVersions: advertisedV6
        ), [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .control,
            advertisedPayloadVersions: advertisedV5
        ), [5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .stage,
            advertisedPayloadVersions: advertisedV6
        ), [5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .audience,
            advertisedPayloadVersions: advertisedV6
        ), [5, 4, 3, 2, 1])

        for malformed in [
            nil,
            "",
            "3,2,1",
            "6,5,4",
            "6,5,5,4,3,2,1",
            " 6,5,4,3,2,1",
            "7,6,5,4,3,2,1",
        ] as [String?] {
            let parsed = TchurchStudioLANService.parseAdvertisedPayloadVersions(malformed)
            XCTAssertNil(parsed)
            XCTAssertEqual(negotiation.supportedPayloadVersions(
                for: .control,
                advertisedPayloadVersions: parsed
            ), [4, 3, 2, 1])
        }
    }
}

final class StudioLANOperatorTimerV6Tests: XCTestCase {
    func testProductionNegotiatesTheExactAdvertisedV5MacOffer() throws {
        let advertised = try XCTUnwrap(
            TchurchStudioLANService.parseAdvertisedPayloadVersions("5,4,3,2,1")
        )
        let offered = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
            .supportedPayloadVersions(
                for: .control,
                advertisedPayloadVersions: advertised
            )
        XCTAssertEqual(offered, [5, 4, 3, 2, 1])
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 5,
            channel: .control,
            offeredPayloadVersions: offered
        )
        XCTAssertEqual(fixture.subscription.payloadVersion, 5)
        XCTAssertEqual(fixture.subscription.channel, .control)
    }

    func testProductionNegotiatesV6OnlyFromTheExactAdvertisedV6MacOffer() throws {
        let advertised = try XCTUnwrap(
            TchurchStudioLANService.parseAdvertisedPayloadVersions("6,5,4,3,2,1")
        )
        let offered = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
            .supportedPayloadVersions(
                for: .control,
                advertisedPayloadVersions: advertised
            )
        XCTAssertEqual(offered, [6, 5, 4, 3, 2, 1])
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 6,
            channel: .control,
            offeredPayloadVersions: offered
        )
        XCTAssertEqual(fixture.subscription.payloadVersion, 6)
        XCTAssertEqual(fixture.subscription.channel, .control)
    }

    func testOuterChallengeV6HintOverridesV5BonjourOnlyForProduction() throws {
        let signer = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x68, count: 32)
        )
        let challenge = makeChallenge(identity: signer)
        let encoder = TchurchStudioLANCoding.encoder()
        let legacyWire = try encoder.encode(
            TchurchStudioLANWireMessage.challenge(challenge)
        )
        let hintedWire = try encoder.encode(TchurchStudioLANWireMessage.challenge(
            challenge,
            supportedPayloadVersions:
                TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions
        ))
        let legacyObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: legacyWire) as? [String: Any]
        )
        let hintedObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: hintedWire) as? [String: Any]
        )
        XCTAssertNil(legacyObject["supportedPayloadVersions"])
        XCTAssertEqual(
            hintedObject["supportedPayloadVersions"] as? [Int],
            [6, 5, 4, 3, 2, 1]
        )
        XCTAssertEqual(
            try JSONSerialization.data(
                withJSONObject: try XCTUnwrap(legacyObject["challenge"]),
                options: [.sortedKeys]
            ),
            try JSONSerialization.data(
                withJSONObject: try XCTUnwrap(hintedObject["challenge"]),
                options: [.sortedKeys]
            ),
            "the optional outer hint must not change the signed inner challenge"
        )

        guard case .challenge(
            let decodedChallenge,
            let outerHint,
            let controlOuterHint,
            let localOBSOuterHint
        ) =
                try TchurchStudioLANWireCodec.decode(hintedWire) else {
            return XCTFail("Expected hinted challenge")
        }
        XCTAssertEqual(decodedChallenge, challenge)
        XCTAssertEqual(outerHint, [6, 5, 4, 3, 2, 1])
        XCTAssertNil(controlOuterHint)
        XCTAssertNil(localOBSOuterHint)
        let v5BonjourHint = try XCTUnwrap(
            TchurchStudioLANService.parseAdvertisedPayloadVersions("5,4,3,2,1")
        )
        let negotiation = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .control,
            advertisedPayloadVersions: outerHint ?? v5BonjourHint
        ), [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .stage,
            advertisedPayloadVersions: outerHint ?? v5BonjourHint
        ), [5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .audience,
            advertisedPayloadVersions: outerHint ?? v5BonjourHint
        ), [5, 4, 3, 2, 1])
    }

    func testAbsentOuterChallengeHintPreservesV5MacAndMalformedHintsAreRejected() throws {
        let signer = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x69, count: 32)
        )
        let challenge = makeChallenge(identity: signer)
        let legacyWire = try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANWireMessage.challenge(challenge)
        )
        guard case .challenge(
            let decodedChallenge,
            let outerHint,
            let controlOuterHint,
            let localOBSOuterHint
        ) =
                try TchurchStudioLANWireCodec.decode(legacyWire) else {
            return XCTFail("Expected legacy challenge")
        }
        XCTAssertEqual(decodedChallenge, challenge)
        XCTAssertNil(outerHint)
        XCTAssertNil(controlOuterHint)
        XCTAssertNil(localOBSOuterHint)
        let v5BonjourHint = try XCTUnwrap(
            TchurchStudioLANService.parseAdvertisedPayloadVersions("5,4,3,2,1")
        )
        XCTAssertEqual(TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
            .supportedPayloadVersions(
                for: .control,
                advertisedPayloadVersions: outerHint ?? v5BonjourHint
            ), [5, 4, 3, 2, 1])

        let legacyObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: legacyWire) as? [String: Any]
        )
        let malformedHints: [Any] = [
            [6, 5, 4],
            [7, 6, 5, 4, 3, 2, 1],
            "6,5,4,3,2,1",
            NSNull(),
        ]
        for malformedHint in malformedHints {
            var malformedObject = legacyObject
            malformedObject["supportedPayloadVersions"] = malformedHint
            let malformedWire = try JSONSerialization.data(
                withJSONObject: malformedObject,
                options: [.sortedKeys]
            )
            XCTAssertThrowsError(try TchurchStudioLANWireCodec.decode(malformedWire))
        }
        XCTAssertThrowsError(try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANWireMessage.challenge(
                challenge,
                supportedPayloadVersions:
                    TchurchStudioLANSubscriptionRequest.v5SupportedPayloadVersions
            )
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .unsupportedPayloadVersion) }
    }

    func testOuterChallengeV7ControlHintRequiresExactV6CompanionAndStaysControlOnly() throws {
        let signer = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x70, count: 32)
        )
        let challenge = makeChallenge(identity: signer)
        let message = TchurchStudioLANWireMessage.challenge(
            challenge,
            supportedPayloadVersions:
                TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions,
            controlSupportedPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        let encoded = try TchurchStudioLANCoding.encoder().encode(message)
        guard case .challenge(let decoded, let v6Hint, let v7Hint, let v8Hint) =
                try TchurchStudioLANWireCodec.decode(encoded) else {
            return XCTFail("Expected v7-capable challenge")
        }
        XCTAssertEqual(decoded, challenge)
        XCTAssertEqual(v6Hint, [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(v7Hint, [7, 6, 5, 4, 3, 2, 1])
        XCTAssertNil(v8Hint)

        let negotiation = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .control,
            controlAdvertisedPayloadVersions: v7Hint,
            advertisedPayloadVersions: v6Hint
        ), [7, 6, 5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .stage,
            controlAdvertisedPayloadVersions: v7Hint,
            advertisedPayloadVersions: v6Hint
        ), [5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .audience,
            controlAdvertisedPayloadVersions: v7Hint,
            advertisedPayloadVersions: v6Hint
        ), [5, 4, 3, 2, 1])

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        var standalone = object
        standalone.removeValue(forKey: "supportedPayloadVersions")
        XCTAssertThrowsError(try TchurchStudioLANWireCodec.decode(
            JSONSerialization.data(withJSONObject: standalone, options: [.sortedKeys])
        ))
        let invalidControlHints: [Any] = [
            NSNull(),
            [7, 6, 5],
            [8, 7, 6, 5, 4, 3, 2, 1],
            "7,6,5,4,3,2,1",
        ]
        for invalid in invalidControlHints {
            var malformed = object
            malformed["controlSupportedPayloadVersions"] = invalid
            XCTAssertThrowsError(try TchurchStudioLANWireCodec.decode(
                JSONSerialization.data(withJSONObject: malformed, options: [.sortedKeys])
            ))
        }
        XCTAssertThrowsError(try TchurchStudioLANCoding.encoder().encode(
            TchurchStudioLANWireMessage.challenge(
                challenge,
                controlSupportedPayloadVersions:
                    TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
            )
        ))
    }

    func testV7NegotiationIsProductionControlOnly() throws {
        XCTAssertNoThrow(try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        ))
        XCTAssertThrowsError(try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            channel: .stage,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidSubscription) }
    }

    func testV6NegotiationIsControlOnlyAndStageRemainsV5Compatible() throws {
        XCTAssertNoThrow(try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 5,
            channel: .stage
        ))
        XCTAssertThrowsError(try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 6,
            channel: .stage,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidSubscription) }
    }

    func testV7CrossPlatformFixtureMatchesCanonicalBytesAndRealSignatures() throws {
        let fixture: StudioLANV7LocalBroadcastLowerThirdFixture = try loadStudioLANFixture(
            named: "studio_lan_v7_local_broadcast_lower_third_fixture"
        )
        XCTAssertEqual(fixture.schemaVersion, 1)
        XCTAssertEqual(
            fixture.fixtureID,
            "studio-lan-v7-local-broadcast-lower-third-1"
        )
        XCTAssertTrue(fixture.initialState.isCanonical)
        XCTAssertTrue(fixture.visibleState.isCanonical)
        XCTAssertTrue(fixture.hiddenState.isCanonical)
        XCTAssertNil(fixture.initialState.title)
        XCTAssertNil(fixture.initialState.subtitle)
        XCTAssertEqual(fixture.visibleState.title, "Welcome Home")
        XCTAssertEqual(fixture.visibleState.subtitle, "Tchurch Sunday")
        XCTAssertNil(fixture.hiddenState.title)
        XCTAssertNil(fixture.hiddenState.subtitle)
        let hiddenJSON = String(
            decoding: try TchurchStudioLANCoding.encoder().encode(fixture.hiddenState),
            as: UTF8.self
        )
        XCTAssertFalse(hiddenJSON.contains("title"))
        XCTAssertFalse(hiddenJSON.contains("subtitle"))

        let publicKeyData = try XCTUnwrap(Data(base64Encoded: fixture.devicePublicKey))
        XCTAssertEqual(
            StudioLANDeviceGrant.fingerprint(forPublicKeyData: publicKeyData),
            fixture.devicePublicKeyFingerprint
        )
        let grant = StudioLANDeviceGrant(
            schemaVersion: 4,
            protocolFloor: 4,
            grantID: fixture.showCommand.grantID,
            deviceID: fixture.showCommand.deviceID,
            deviceName: "Tchurch iOS",
            role: .production,
            permissions: [.observe, .controlProgram],
            keyAlgorithm: .p256Signing,
            devicePublicKey: fixture.devicePublicKey,
            devicePublicKeyFingerprint: fixture.devicePublicKeyFingerprint,
            studioID: UUID(uuidString: "70000000-0000-4000-8000-000000000006")!,
            studioSigningKeyID: fixture.studioSigningKeyID,
            studioSigningPublicKey: fixture.studioSigningPublicKey,
            permissionRevision: fixture.showCommand.permissionRevision,
            revocationGeneration: fixture.showCommand.revocationGeneration,
            issuedAtMilliseconds: fixture.showCommand.issuedAtMilliseconds - 1_000,
            expiresAtMilliseconds: fixture.hideCommand.expiresAtMilliseconds + 1_000,
            signature: ""
        )

        for (command, signingHex) in [
            (fixture.showCommand, fixture.showCommandSigningMaterialHex),
            (fixture.hideCommand, fixture.hideCommandSigningMaterialHex),
        ] {
            XCTAssertEqual(
                try TchurchStudioLANLocalBroadcastLowerThirdCommandCrypto
                    .signingData(for: command).hex,
                signingHex
            )
            XCTAssertNoThrow(try TchurchStudioLANLocalBroadcastLowerThirdCommandCrypto.verify(
                command,
                deviceGrant: grant
            ))
            let wire = TchurchStudioLANWireMessage
                .localBroadcastLowerThirdCommand(command)
            let encoded = try TchurchStudioLANCoding.encoder().encode(wire)
            XCTAssertEqual(
                try TchurchStudioLANCoding.decoder().decode(
                    TchurchStudioLANWireMessage.self,
                    from: encoded
                ),
                wire
            )
            XCTAssertTrue(String(decoding: encoded, as: UTF8.self).contains(
                "\"kind\":\"localBroadcastLowerThirdCommand\",\"localBroadcastLowerThirdCommand\""
            ))
        }

        for (receipt, signingHex) in [
            (fixture.showReceipt, fixture.showReceiptSigningMaterialHex),
            (fixture.hideReceipt, fixture.hideReceiptSigningMaterialHex),
        ] {
            XCTAssertEqual(
                try TchurchStudioLANLocalBroadcastLowerThirdReceiptCrypto
                    .signingData(for: receipt).hex,
                signingHex
            )
            XCTAssertNoThrow(try TchurchStudioLANLocalBroadcastLowerThirdReceiptCrypto.verify(
                receipt,
                studioSigningPublicKey: fixture.studioSigningPublicKey
            ))
            let wire = TchurchStudioLANWireMessage
                .localBroadcastLowerThirdReceipt(receipt)
            let encoded = try TchurchStudioLANCoding.encoder().encode(wire)
            XCTAssertEqual(
                try TchurchStudioLANCoding.decoder().decode(
                    TchurchStudioLANWireMessage.self,
                    from: encoded
                ),
                wire
            )
            XCTAssertTrue(String(decoding: encoded, as: UTF8.self).contains(
                "\"kind\":\"localBroadcastLowerThirdReceipt\",\"localBroadcastLowerThirdReceipt\""
            ))
        }
    }

    func testV7SignedLowerThirdTamperingAndUnknownKeysFailClosed() throws {
        let fixture: StudioLANV7LocalBroadcastLowerThirdFixture = try loadStudioLANFixture(
            named: "studio_lan_v7_local_broadcast_lower_third_fixture"
        )
        let publicKeyData = try XCTUnwrap(Data(base64Encoded: fixture.devicePublicKey))
        let grant = StudioLANDeviceGrant(
            schemaVersion: 4,
            protocolFloor: 4,
            grantID: fixture.showCommand.grantID,
            deviceID: fixture.showCommand.deviceID,
            deviceName: "Tchurch iOS",
            role: .production,
            permissions: [.observe, .controlProgram],
            keyAlgorithm: .p256Signing,
            devicePublicKey: fixture.devicePublicKey,
            devicePublicKeyFingerprint:
                StudioLANDeviceGrant.fingerprint(forPublicKeyData: publicKeyData),
            studioID: UUID(),
            studioSigningKeyID: fixture.studioSigningKeyID,
            studioSigningPublicKey: fixture.studioSigningPublicKey,
            permissionRevision: fixture.showCommand.permissionRevision,
            revocationGeneration: fixture.showCommand.revocationGeneration,
            issuedAtMilliseconds: 1,
            expiresAtMilliseconds: fixture.hideCommand.expiresAtMilliseconds + 1,
            signature: ""
        )
        let tamperedCommand = replacingLocalBroadcastLowerThirdCommand(
            fixture.showCommand,
            action: .show(title: "Changed", subtitle: "Tchurch Sunday")
        )
        XCTAssertThrowsError(try TchurchStudioLANLocalBroadcastLowerThirdCommandCrypto.verify(
            tamperedCommand,
            deviceGrant: grant
        )) { XCTAssertEqual($0 as? TchurchStudioLANRemoteControlError, .invalidCommand) }
        let tamperedReceipt = replacingLocalBroadcastLowerThirdReceipt(
            fixture.showReceipt,
            lowerThirdRevision: fixture.showReceipt.lowerThirdRevision + 1
        )
        XCTAssertThrowsError(try TchurchStudioLANLocalBroadcastLowerThirdReceiptCrypto.verify(
            tamperedReceipt,
            studioSigningPublicKey: fixture.studioSigningPublicKey
        )) { XCTAssertEqual($0 as? TchurchStudioLANRemoteControlError, .invalidReceipt) }

        let encoder = TchurchStudioLANCoding.encoder()
        let decoder = TchurchStudioLANCoding.decoder()
        var commandWire = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoder.encode(
                TchurchStudioLANWireMessage.localBroadcastLowerThirdCommand(
                    fixture.showCommand
                )
            )) as? [String: Any]
        )
        var command = try XCTUnwrap(
            commandWire["localBroadcastLowerThirdCommand"] as? [String: Any]
        )
        var action = try XCTUnwrap(command["action"] as? [String: Any])
        action["unexpected"] = true
        command["action"] = action
        commandWire["localBroadcastLowerThirdCommand"] = command
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANWireMessage.self,
            from: JSONSerialization.data(withJSONObject: commandWire)
        ))

        var hidden = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoder.encode(fixture.hiddenState))
                as? [String: Any]
        )
        hidden["title"] = NSNull()
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANLocalBroadcastLowerThirdProjection.self,
            from: JSONSerialization.data(withJSONObject: hidden)
        ))
    }

    func testCrossPlatformFixtureMatchesCanonicalBytesWireAndRealSignatures() throws {
        let fixture: StudioLANV6OperatorTimerFixture = try loadStudioLANFixture(
            named: "studio_lan_v6_operator_timers_fixture"
        )
        XCTAssertEqual(fixture.schemaVersion, 1)
        XCTAssertEqual(
            fixture.fixtureID,
            "studio-lan-v6-operator-timers-cross-platform-1"
        )
        XCTAssertEqual(
            try TchurchStudioLANCoding.encoder().encode(fixture.initialOperatorTimers).hex,
            fixture.initialOperatorTimersCanonicalHex
        )
        XCTAssertTrue(fixture.initialOperatorTimers.isCanonical)
        XCTAssertEqual(fixture.initialOperatorTimers.revision, 0)
        XCTAssertTrue(fixture.initialOperatorTimers.timers.allSatisfy {
            $0.anchorTimestampMilliseconds == 0
                && $0.anchorValueMilliseconds == 0
                && !$0.isRunning
        })
        XCTAssertEqual(
            try TchurchStudioLANCoding.encoder().encode(fixture.operatorTimers).hex,
            fixture.operatorTimersCanonicalHex
        )
        XCTAssertTrue(fixture.operatorTimers.isCanonical)

        guard case .operatorTimerCommand(let command) = fixture.commandWire else {
            return XCTFail("Expected operatorTimerCommand fixture")
        }
        XCTAssertEqual(
            try TchurchStudioLANOperatorTimerCommandCrypto.signingData(for: command).hex,
            fixture.commandSigningMaterialCanonicalHex
        )
        let devicePublicKey = try XCTUnwrap(Data(base64Encoded: fixture.devicePublicKey))
        let deviceGrant = StudioLANDeviceGrant(
            schemaVersion: 4,
            protocolFloor: 4,
            grantID: command.grantID,
            deviceID: command.deviceID,
            deviceName: "Tchurch iOS",
            role: .production,
            permissions: [.observe, .controlProgram],
            keyAlgorithm: .p256Signing,
            devicePublicKey: fixture.devicePublicKey,
            devicePublicKeyFingerprint: StudioLANDeviceGrant.fingerprint(
                forPublicKeyData: devicePublicKey
            ),
            studioID: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!,
            studioSigningKeyID: fixture.studioSigningKeyID,
            studioSigningPublicKey: fixture.studioSigningPublicKey,
            permissionRevision: command.permissionRevision,
            revocationGeneration: command.revocationGeneration,
            issuedAtMilliseconds: command.issuedAtMilliseconds - 1_000,
            expiresAtMilliseconds: command.expiresAtMilliseconds + 1_000,
            signature: ""
        )
        XCTAssertNoThrow(try TchurchStudioLANOperatorTimerCommandCrypto.verify(
            command,
            deviceGrant: deviceGrant
        ))
        let encodedCommandWire = try TchurchStudioLANCoding.encoder().encode(
            fixture.commandWire
        )
        XCTAssertEqual(
            try TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANWireMessage.self,
                from: encodedCommandWire
            ),
            fixture.commandWire
        )
        XCTAssertTrue(String(decoding: encodedCommandWire, as: UTF8.self).contains(
            "\"kind\":\"operatorTimerCommand\",\"operatorTimerCommand\""
        ))

        guard case .operatorTimerReceipt(let receipt) = fixture.receiptWire else {
            return XCTFail("Expected operatorTimerReceipt fixture")
        }
        XCTAssertEqual(
            try TchurchStudioLANOperatorTimerReceiptCrypto.signingData(for: receipt).hex,
            fixture.receiptSigningMaterialCanonicalHex
        )
        XCTAssertNoThrow(try TchurchStudioLANOperatorTimerReceiptCrypto.verify(
            receipt,
            studioSigningPublicKey: fixture.studioSigningPublicKey
        ))
        let encodedReceiptWire = try TchurchStudioLANCoding.encoder().encode(
            fixture.receiptWire
        )
        XCTAssertEqual(
            try TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANWireMessage.self,
                from: encodedReceiptWire
            ),
            fixture.receiptWire
        )
        XCTAssertTrue(String(decoding: encodedReceiptWire, as: UTF8.self).contains(
            "\"kind\":\"operatorTimerReceipt\",\"operatorTimerReceipt\""
        ))
    }

    func testV6DecodingRejectsUnknownKeysAtEverySignedTimerBoundary() throws {
        let fixture: StudioLANV6OperatorTimerFixture = try loadStudioLANFixture(
            named: "studio_lan_v6_operator_timers_fixture"
        )
        let encoder = TchurchStudioLANCoding.encoder()
        let decoder = TchurchStudioLANCoding.decoder()

        var projection = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.operatorTimers)
            ) as? [String: Any]
        )
        projection["unexpected"] = true
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANOperatorTimersProjection.self,
            from: JSONSerialization.data(withJSONObject: projection)
        ))

        projection = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.operatorTimers)
            ) as? [String: Any]
        )
        var timers = try XCTUnwrap(projection["timers"] as? [[String: Any]])
        timers[0]["unexpected"] = true
        projection["timers"] = timers
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANOperatorTimersProjection.self,
            from: JSONSerialization.data(withJSONObject: projection)
        ))

        var commandWire = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.commandWire)
            ) as? [String: Any]
        )
        commandWire["unexpected"] = true
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANWireMessage.self,
            from: JSONSerialization.data(withJSONObject: commandWire)
        ))

        commandWire = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.commandWire)
            ) as? [String: Any]
        )
        var command = try XCTUnwrap(
            commandWire["operatorTimerCommand"] as? [String: Any]
        )
        command["unexpected"] = true
        commandWire["operatorTimerCommand"] = command
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANWireMessage.self,
            from: JSONSerialization.data(withJSONObject: commandWire)
        ))

        commandWire = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.commandWire)
            ) as? [String: Any]
        )
        command = try XCTUnwrap(
            commandWire["operatorTimerCommand"] as? [String: Any]
        )
        var action = try XCTUnwrap(command["action"] as? [String: Any])
        action["unexpected"] = true
        command["action"] = action
        commandWire["operatorTimerCommand"] = command
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANWireMessage.self,
            from: JSONSerialization.data(withJSONObject: commandWire)
        ))

        var receiptWire = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.receiptWire)
            ) as? [String: Any]
        )
        var receipt = try XCTUnwrap(
            receiptWire["operatorTimerReceipt"] as? [String: Any]
        )
        receipt["unexpected"] = true
        receiptWire["operatorTimerReceipt"] = receipt
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANWireMessage.self,
            from: JSONSerialization.data(withJSONObject: receiptWire)
        ))

        receiptWire = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: encoder.encode(fixture.receiptWire)
            ) as? [String: Any]
        )
        receipt = try XCTUnwrap(
            receiptWire["operatorTimerReceipt"] as? [String: Any]
        )
        receipt["rejection"] = NSNull()
        receiptWire["operatorTimerReceipt"] = receipt
        XCTAssertThrowsError(try decoder.decode(
            TchurchStudioLANWireMessage.self,
            from: JSONSerialization.data(withJSONObject: receiptWire)
        ))
    }

    func testCommandAndReceiptTamperingFailClosed() throws {
        let fixture: StudioLANV6OperatorTimerFixture = try loadStudioLANFixture(
            named: "studio_lan_v6_operator_timers_fixture"
        )
        guard case .operatorTimerCommand(let command) = fixture.commandWire,
              case .operatorTimerReceipt(let receipt) = fixture.receiptWire else {
            return XCTFail("Missing v6 fixture messages")
        }
        let publicKeyData = try XCTUnwrap(Data(base64Encoded: fixture.devicePublicKey))
        let grant = StudioLANDeviceGrant(
            schemaVersion: 4,
            protocolFloor: 4,
            grantID: command.grantID,
            deviceID: command.deviceID,
            deviceName: "Tchurch iOS",
            role: .production,
            permissions: [.observe, .controlProgram],
            keyAlgorithm: .p256Signing,
            devicePublicKey: fixture.devicePublicKey,
            devicePublicKeyFingerprint: StudioLANDeviceGrant.fingerprint(
                forPublicKeyData: publicKeyData
            ),
            studioID: UUID(),
            studioSigningKeyID: fixture.studioSigningKeyID,
            studioSigningPublicKey: fixture.studioSigningPublicKey,
            permissionRevision: command.permissionRevision,
            revocationGeneration: command.revocationGeneration,
            issuedAtMilliseconds: 1,
            expiresAtMilliseconds: command.expiresAtMilliseconds + 1,
            signature: ""
        )
        let tamperedCommand = replacingOperatorTimerCommand(
            command,
            action: .set(scope: .item, operation: .pause)
        )
        XCTAssertThrowsError(try TchurchStudioLANOperatorTimerCommandCrypto.verify(
            tamperedCommand,
            deviceGrant: grant
        )) { XCTAssertEqual($0 as? TchurchStudioLANRemoteControlError, .invalidCommand) }

        let tamperedReceipt = replacingOperatorTimerReceipt(
            receipt,
            timerRevision: receipt.timerRevision + 1
        )
        XCTAssertThrowsError(try TchurchStudioLANOperatorTimerReceiptCrypto.verify(
            tamperedReceipt,
            studioSigningPublicKey: fixture.studioSigningPublicKey
        )) { XCTAssertEqual($0 as? TchurchStudioLANRemoteControlError, .invalidReceipt) }
    }

    func testProjectionAcceptsFreshZeroAndExactBoundsButRejectsOverflowAndOrder() {
        let initial = makeOperatorTimers(
            revision: 0,
            serviceAnchor: 0,
            serviceValue: 0,
            serviceRunning: false,
            itemAnchor: 0,
            itemValue: 0,
            itemRunning: false
        )
        XCTAssertTrue(initial.isCanonical)
        XCTAssertTrue(makeOperatorTimers(
            revision: TchurchStudioLANOperatorTimersProjection.maximumRevision,
            serviceAnchor: TchurchStudioLANOperatorTimersProjection.maximumAnchorTimestampMilliseconds,
            serviceValue: TchurchStudioLANOperatorTimersProjection.maximumAnchorValueMilliseconds
        ).isCanonical)
        XCTAssertFalse(TchurchStudioLANOperatorTimersProjection(
            schemaVersion: 1,
            revision: 1,
            timers: Array(initial.timers.reversed())
        ).isCanonical)
        XCTAssertFalse(makeOperatorTimers(
            revision: TchurchStudioLANOperatorTimersProjection.maximumRevision + 1
        ).isCanonical)
        XCTAssertFalse(makeOperatorTimers(
            revision: 1,
            serviceValue: TchurchStudioLANOperatorTimersProjection.maximumAnchorValueMilliseconds + 1
        ).isCanonical)
    }

    func testV6VerifierAcceptsInitialAndUnavailableTimerStateButRejectsMalformedState() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 6)
        let verifier = try TchurchStudioLANEnvelopeVerifier(
            subscription: fixture.subscription
        )
        let initial = makeOperatorTimers(
            revision: 0,
            serviceAnchor: 0,
            serviceValue: 0,
            serviceRunning: false,
            itemAnchor: 0,
            itemValue: 0,
            itemRunning: false
        )
        for (sequence, timers) in [(UInt64(12), initial as TchurchStudioLANOperatorTimersProjection?), (13, nil)] {
            let envelope = try signEnvelope(
                payload: makeV6ControlPayload(
                    authority: fixture.authority,
                    programRevision: 4,
                    operatorTimers: timers
                ),
                authority: fixture.authority,
                identity: fixture.signer,
                sequence: sequence,
                revision: 4,
                schemaVersion: 6
            )
            XCTAssertNoThrow(try verifier.verify(
                TchurchStudioLANCoding.encoder().encode(envelope)
            ))
        }

        let malformed = TchurchStudioLANOperatorTimersProjection(
            schemaVersion: 1,
            revision: 1,
            timers: Array(initial.timers.reversed())
        )
        let badEnvelope = try signEnvelope(
            payload: makeV6ControlPayload(
                authority: fixture.authority,
                programRevision: 4,
                operatorTimers: malformed
            ),
            authority: fixture.authority,
            identity: fixture.signer,
            sequence: 14,
            revision: 4,
            schemaVersion: 6
        )
        XCTAssertThrowsError(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(badEnvelope)
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidEnvelope) }
    }

    func testV7VerifierBindsOptionalLowerThirdToSignedLocalBroadcastRoute() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        let verifier = try TchurchStudioLANEnvelopeVerifier(
            subscription: fixture.subscription
        )
        let lowerThird = makeLowerThird(revision: 4, title: "Welcome Home")
        XCTAssertNoThrow(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(try makeV7Envelope(
                fixture: fixture,
                sequence: 12,
                programRevision: 4,
                operatorTimers: makeOperatorTimers(revision: 3),
                localBroadcastLowerThird: lowerThird
            ))
        ))
        XCTAssertNoThrow(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(try makeV7Envelope(
                fixture: fixture,
                sequence: 13,
                programRevision: 5,
                operatorTimers: makeOperatorTimers(revision: 4),
                localBroadcastLowerThird: nil,
                localBroadcastRouteEnabled: false
            ))
        ), "Program and timers remain valid without the optional lower-third sidecar")
        XCTAssertThrowsError(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(try makeV7Envelope(
                fixture: fixture,
                sequence: 14,
                programRevision: 6,
                operatorTimers: makeOperatorTimers(revision: 5),
                localBroadcastLowerThird: lowerThird,
                localBroadcastRouteEnabled: false
            ))
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload) }

        let v6Fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 6,
            signer: fixture.signer
        )
        let v6Verifier = try TchurchStudioLANEnvelopeVerifier(
            subscription: v6Fixture.subscription
        )
        let illegalV6 = try signEnvelope(
            payload: makeV6ControlPayload(
                authority: v6Fixture.authority,
                programRevision: 7,
                operatorTimers: makeOperatorTimers(revision: 6),
                localBroadcastLowerThird: lowerThird
            ),
            authority: v6Fixture.authority,
            identity: v6Fixture.signer,
            sequence: 12,
            revision: 7,
            schemaVersion: 6
        )
        XCTAssertThrowsError(try v6Verifier.verify(
            TchurchStudioLANCoding.encoder().encode(illegalV6)
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload) }
    }

    func testV7LowerThirdCanonicalTextAndJSSafeRevisionLimits() throws {
        XCTAssertTrue(makeLowerThird(
            revision: TchurchStudioLANLocalBroadcastLowerThirdProjection.maximumRevision,
            title: String(repeating: "é", count: 80),
            subtitle: String(repeating: "é", count: 120)
        ).isCanonical)
        XCTAssertFalse(makeLowerThird(
            revision: TchurchStudioLANLocalBroadcastLowerThirdProjection.maximumRevision + 1,
            title: "Welcome"
        ).isCanonical)
        XCTAssertFalse(makeLowerThird(revision: 1, title: " Welcome").isCanonical)
        XCTAssertFalse(makeLowerThird(revision: 1, title: "Welcome\nHome").isCanonical)
        XCTAssertFalse(makeLowerThird(revision: 1, title: "Welcome\u{2028}Home").isCanonical)
        XCTAssertFalse(makeLowerThird(
            revision: 1,
            title: "Welcome",
            subtitle: "Tchurch\u{2029}Studio"
        ).isCanonical)
        XCTAssertFalse(TchurchStudioLANLocalBroadcastLowerThirdAction.show(
            title: "Welcome\u{2028}Home"
        ).isValid)
        XCTAssertFalse(TchurchStudioLANLocalBroadcastLowerThirdAction.show(
            title: "Welcome",
            subtitle: "Tchurch\u{2029}Studio"
        ).isValid)
        XCTAssertFalse(makeLowerThird(
            revision: 1,
            title: String(repeating: "é", count: 81)
        ).isCanonical)
        XCTAssertFalse(makeLowerThird(
            revision: 1,
            title: "Welcome",
            subtitle: String(repeating: "é", count: 121)
        ).isCanonical)
        XCTAssertFalse(TchurchStudioLANLocalBroadcastLowerThirdProjection(
            schemaVersion: 1,
            revision: 1,
            target: .localBrowserOBS,
            visible: false,
            title: "stale",
            subtitle: nil
        ).isCanonical)
    }

    func testV7ReplayTracksProgramTimerAndLowerThirdIndependently() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 8,
            operatorTimers: makeOperatorTimers(revision: 12),
            localBroadcastLowerThird: makeLowerThird(revision: 20, title: "Welcome")
        ))
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 8,
            operatorTimers: makeOperatorTimers(revision: 13),
            localBroadcastLowerThird: makeLowerThird(revision: 20, title: "Welcome")
        )))
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 8,
            operatorTimers: makeOperatorTimers(revision: 14),
            localBroadcastLowerThird: makeLowerThird(revision: 21, title: "Updated")
        )), "simultaneous sidecar advances are valid at one Program revision")
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 15,
            programRevision: 9,
            operatorTimers: makeOperatorTimers(revision: 14),
            localBroadcastLowerThird: makeLowerThird(revision: 21, title: "Updated"),
            isBlackout: true
        )))
        XCTAssertThrowsError(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 16,
            programRevision: 10,
            operatorTimers: makeOperatorTimers(revision: 14),
            localBroadcastLowerThird: makeLowerThird(revision: 21, title: "Equivocated")
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .equivocatedRevision) }
    }

    func testV7NilSidecarsRetainIdentityAndRequireStrictlyNewReappearance() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        func seededGuard() throws -> TchurchStudioLANReplayGuard {
            var value = TchurchStudioLANReplayGuard()
            try value.begin(fixture.subscription)
            try value.accept(makeV7Envelope(
                fixture: fixture,
                sequence: 12,
                programRevision: 3,
                operatorTimers: makeOperatorTimers(revision: 7),
                localBroadcastLowerThird: makeLowerThird(revision: 9, title: "Welcome")
            ))
            try value.accept(makeV7Envelope(
                fixture: fixture,
                sequence: 13,
                programRevision: 3,
                operatorTimers: nil,
                localBroadcastLowerThird: nil
            ))
            return value
        }

        var staleTimer = try seededGuard()
        XCTAssertThrowsError(try staleTimer.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 7),
            localBroadcastLowerThird: nil
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }

        var freshTimer = try seededGuard()
        XCTAssertNoThrow(try freshTimer.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 4,
            operatorTimers: makeOperatorTimers(revision: 8),
            localBroadcastLowerThird: nil
        )))

        var staleLowerThird = try seededGuard()
        XCTAssertThrowsError(try staleLowerThird.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 4,
            operatorTimers: nil,
            localBroadcastLowerThird: makeLowerThird(revision: 9, title: "Welcome")
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }

        var freshLowerThird = try seededGuard()
        XCTAssertNoThrow(try freshLowerThird.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 3,
            operatorTimers: nil,
            localBroadcastLowerThird: makeLowerThird(revision: 10, title: "Welcome")
        )))
    }

    func testReplayGuardTracksIndependentProgramAndTimerRevisions() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 6)
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        let timers12 = makeOperatorTimers(revision: 12)
        let first = try makeV6Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 8,
            operatorTimers: timers12
        )
        try guardState.accept(first)
        let timers13 = makeOperatorTimers(
            revision: 13,
            serviceAnchor: 1_800_000_001_000,
            serviceValue: 91_000
        )
        let timerOnly = try makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 8,
            operatorTimers: timers13
        )
        XCTAssertNoThrow(try guardState.accept(timerOnly))

        let programOnly = try makeV6Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 9,
            operatorTimers: timers13,
            isBlackout: true
        )
        XCTAssertNoThrow(try guardState.accept(programOnly))

        let changedAtSameTimerRevision = try makeV6Envelope(
            fixture: fixture,
            sequence: 15,
            programRevision: 10,
            operatorTimers: makeOperatorTimers(
                revision: 13,
                serviceAnchor: 1_800_000_002_000,
                serviceValue: 92_000
            )
        )
        XCTAssertThrowsError(try guardState.accept(changedAtSameTimerRevision)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .equivocatedRevision)
        }
    }

    func testReplayGuardAcceptsRoutingLightingAndHealthAtSameProgramRevision() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        let timers = makeOperatorTimers(revision: 4)
        let lower = makeLowerThird(revision: 6, title: "Routing lane")
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 8,
            operatorTimers: timers,
            localBroadcastLowerThird: lower,
            routeEpoch: 9
        ))

        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 8,
            operatorTimers: timers,
            localBroadcastLowerThird: lower,
            stageAndMusiciansRouteEnabled: true,
            routeEpoch: 10
        )), "routing may advance without fabricating a Program revision")
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 8,
            operatorTimers: timers,
            localBroadcastLowerThird: lower,
            stageAndMusiciansRouteEnabled: true,
            routeEpoch: 10,
            lightingArmed: true
        )), "lighting telemetry is ordered by envelope sequence")
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 15,
            programRevision: 8,
            operatorTimers: timers,
            localBroadcastLowerThird: lower,
            stageAndMusiciansRouteEnabled: true,
            routeEpoch: 10,
            lightingArmed: true,
            healthyOutputCount: 1,
            expectedOutputCount: 2
        )), "health telemetry is ordered by envelope sequence")
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 16,
            programRevision: 8,
            operatorTimers: timers,
            localBroadcastLowerThird: lower,
            stageAndMusiciansRouteEnabled: true,
            routeEpoch: 10,
            lightingArmed: true,
            healthyOutputCount: 1,
            expectedOutputCount: 2
        )), "an exact payload at a higher leased sequence remains idempotent")
    }

    func testReplayGuardRejectsRoutingRollbackAndSameEpochEquivocation() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 6)
        let timers = makeOperatorTimers(revision: 2)

        func seeded() throws -> TchurchStudioLANReplayGuard {
            var value = TchurchStudioLANReplayGuard()
            try value.begin(fixture.subscription)
            try value.accept(makeV6Envelope(
                fixture: fixture,
                sequence: 12,
                programRevision: 5,
                operatorTimers: timers,
                routeEpoch: 9
            ))
            return value
        }

        var routingEquivocation = try seeded()
        XCTAssertThrowsError(try routingEquivocation.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 5,
            operatorTimers: timers,
            routeEpoch: 9,
            stageAndMusiciansRouteEnabled: true
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .equivocatedRevision) }

        var catalogEquivocation = try seeded()
        let changedManifest = TchurchStudioLANCueCatalogManifest(
            schemaVersion: 1,
            catalogID: "sha256:" + String(repeating: "a", count: 64),
            totalCount: 0,
            pageSize: 128
        )
        XCTAssertThrowsError(try catalogEquivocation.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 5,
            operatorTimers: timers,
            routeEpoch: 9,
            cueCatalogManifestOverride: changedManifest
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .equivocatedRevision) }

        var rollback = try seeded()
        XCTAssertThrowsError(try rollback.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 6,
            operatorTimers: timers,
            routeEpoch: 8
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }
    }

    func testReplayGuardRetainsRoutingAcrossUnavailableProjection() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        let timers = makeOperatorTimers(revision: 3)
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 4,
            operatorTimers: timers,
            localBroadcastLowerThird: nil,
            routeEpoch: 20
        ))
        let retainedChecksum = guardState.lastRoutingChecksum
        try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 4,
            operatorTimers: timers,
            localBroadcastLowerThird: nil,
            routeEpoch: nil,
            routingAvailable: false
        ))
        XCTAssertEqual(guardState.lastRouteEpoch, 20)
        XCTAssertEqual(guardState.lastRoutingChecksum, retainedChecksum)
        XCTAssertEqual(guardState.lastEnvelopeRoutingAvailable, false)
        XCTAssertNil(guardState.lastEnvelopeRouteEpoch)

        XCTAssertThrowsError(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 4,
            operatorTimers: timers,
            localBroadcastLowerThird: nil,
            routeEpoch: 20
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 4,
            operatorTimers: timers,
            localBroadcastLowerThird: nil,
            stageAndMusiciansRouteEnabled: true,
            routeEpoch: 21
        )))
    }

    func testReplayGuardPreservesRoutingAuthorityAcrossSameKeyReconnect() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 6)
        let timers = makeOperatorTimers(revision: 5)
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        try guardState.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 7,
            operatorTimers: timers,
            routeEpoch: 30
        ))
        let retainedChecksum = guardState.lastRoutingChecksum

        try guardState.begin(fixture.subscription)
        XCTAssertEqual(guardState.lastRouteEpoch, 30)
        XCTAssertEqual(guardState.lastRoutingChecksum, retainedChecksum)
        XCTAssertNoThrow(try guardState.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 7,
            operatorTimers: timers,
            routeEpoch: 31,
            stageAndMusiciansRouteEnabled: true
        )))

        try guardState.begin(fixture.subscription)
        XCTAssertThrowsError(try guardState.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 8,
            operatorTimers: timers,
            routeEpoch: 30
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }
    }

    func testReplayGuardTreatsV4AndV5RouteEpochAsIndependentAuthority() throws {
        for payloadVersion in [4, 5] {
            let fixture = try makeDeviceTrustV6SubscriptionFixture(
                selectedPayloadVersion: payloadVersion
            )
            var guardState = TchurchStudioLANReplayGuard()
            try guardState.begin(fixture.subscription)
            let first = try signEnvelope(
                payload: makeV6ControlPayload(
                    authority: fixture.authority,
                    programRevision: 2,
                    operatorTimers: nil,
                    routeEpoch: 4,
                    routingAvailable: payloadVersion >= 5
                ),
                authority: fixture.authority,
                identity: fixture.signer,
                sequence: 12,
                revision: 2,
                schemaVersion: payloadVersion
            )
            try guardState.accept(first)
            let routeOnly = try signEnvelope(
                payload: makeV6ControlPayload(
                    authority: fixture.authority,
                    programRevision: 2,
                    operatorTimers: nil,
                    stageAndMusiciansRouteEnabled: payloadVersion >= 5,
                    routeEpoch: 5,
                    routingAvailable: payloadVersion >= 5
                ),
                authority: fixture.authority,
                identity: fixture.signer,
                sequence: 13,
                revision: 2,
                schemaVersion: payloadVersion
            )
            XCTAssertNoThrow(try guardState.accept(routeOnly), "payload v\(payloadVersion)")
        }
    }

    func testReplayGuardRetainsTimerIdentityAcrossSignedUnavailableState() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 6)
        let timers = makeOperatorTimers(revision: 7)
        var valid = TchurchStudioLANReplayGuard()
        try valid.begin(fixture.subscription)
        try valid.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 3,
            operatorTimers: timers
        ))
        try valid.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 3,
            operatorTimers: nil
        ))
        XCTAssertThrowsError(try valid.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 3,
            operatorTimers: timers
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }
        XCTAssertNoThrow(try valid.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 8)
        )))

        var tampered = TchurchStudioLANReplayGuard()
        try tampered.begin(fixture.subscription)
        try tampered.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 3,
            operatorTimers: timers
        ))
        try tampered.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 3,
            operatorTimers: nil
        ))
        XCTAssertThrowsError(try tampered.accept(makeV6Envelope(
            fixture: fixture,
            sequence: 14,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(
                revision: 7,
                serviceAnchor: 1_800_000_100_000
            )
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .equivocatedRevision) }
    }

    func testNegotiatedVersionTransitionPreservesAuthenticatedReplayEpoch() throws {
        let v5 = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 5)
        let v6 = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 6,
            signer: v5.signer
        )
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(v5.subscription)
        let v5Payload = try makeV6ControlPayload(
            authority: v5.authority,
            programRevision: 20,
            operatorTimers: nil
        )
        let v5Envelope = try signEnvelope(
            payload: v5Payload,
            authority: v5.authority,
            identity: v5.signer,
            sequence: 50,
            revision: 20,
            schemaVersion: 5
        )
        try guardState.accept(v5Envelope)
        try guardState.begin(v6.subscription)
        XCTAssertEqual(guardState.lastSequence, 50)
        XCTAssertEqual(guardState.lastRevision, 20)
        XCTAssertEqual(guardState.lastRouteEpoch, 9)
        XCTAssertThrowsError(try guardState.accept(makeV6Envelope(
            fixture: v6,
            sequence: 12,
            programRevision: 1,
            operatorTimers: makeOperatorTimers(revision: 0)
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .replayedEnvelope) }
        XCTAssertThrowsError(try guardState.accept(makeV6Envelope(
            fixture: v6,
            sequence: 51,
            programRevision: 1,
            operatorTimers: makeOperatorTimers(revision: 0)
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }
        XCTAssertNoThrow(try guardState.accept(makeV6Envelope(
            fixture: v6,
            sequence: 51,
            programRevision: 21,
            operatorTimers: makeOperatorTimers(revision: 0)
        )))
    }

    func testV7ToV5ToV7PreservesPrivateProjectionFloors() throws {
        let v7 = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        let v5 = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 5,
            signer: v7.signer,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions
        )
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(v7.subscription)
        try guardState.accept(makeV7Envelope(
            fixture: v7,
            sequence: 12,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 7),
            localBroadcastLowerThird: makeLowerThird(revision: 9, title: "Retained"),
            routeEpoch: 10
        ))

        try guardState.begin(v5.subscription)
        let v5Envelope = try signEnvelope(
            payload: makeV6ControlPayload(
                authority: v5.authority,
                programRevision: 3,
                operatorTimers: nil,
                routeEpoch: 11
            ),
            authority: v5.authority,
            identity: v5.signer,
            sequence: 13,
            revision: 3,
            schemaVersion: 5
        )
        XCTAssertNoThrow(try guardState.accept(v5Envelope))
        XCTAssertEqual(guardState.lastOperatorTimerRevision, 7)
        XCTAssertEqual(guardState.lastLowerThirdRevision, 9)
        XCTAssertEqual(guardState.lastRouteEpoch, 11)
        XCTAssertEqual(guardState.lastEnvelopeOperatorTimersAvailable, false)
        XCTAssertEqual(guardState.lastEnvelopeLowerThirdAvailable, false)

        try guardState.begin(v7.subscription)
        XCTAssertEqual(guardState.lastSequence, 13)
        XCTAssertThrowsError(try guardState.accept(makeV7Envelope(
            fixture: v7,
            sequence: 13,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 8),
            localBroadcastLowerThird: makeLowerThird(revision: 10, title: "Fresh"),
            routeEpoch: 12
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .replayedEnvelope) }
        XCTAssertThrowsError(try guardState.accept(makeV7Envelope(
            fixture: v7,
            sequence: 14,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 7),
            localBroadcastLowerThird: makeLowerThird(revision: 9, title: "Retained"),
            routeEpoch: 12
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }
        XCTAssertNoThrow(try guardState.accept(makeV7Envelope(
            fixture: v7,
            sequence: 14,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 8),
            localBroadcastLowerThird: makeLowerThird(revision: 10, title: "Fresh"),
            routeEpoch: 12
        )))
    }

    func testRejectedStaleVersionTransitionDoesNotEraseTheAuthenticatedReplayEpoch() throws {
        let current = try makeDeviceTrustV6SubscriptionFixture(selectedPayloadVersion: 6)
        let stale = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 5,
            signer: current.signer,
            authorityEpoch: 6
        )
        let envelope = try makeV6Envelope(
            fixture: current,
            sequence: 12,
            programRevision: 3,
            operatorTimers: makeOperatorTimers(revision: 7)
        )
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(current.subscription)
        try guardState.accept(envelope)
        XCTAssertThrowsError(try guardState.begin(stale.subscription)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .staleAuthorityEpoch)
        }
        XCTAssertThrowsError(try guardState.accept(envelope)) {
            XCTAssertEqual($0 as? TchurchStudioLANError, .replayedEnvelope)
        }
    }

    func testLostReceiptRecoveryPreservesClosedActionRevisionAndCommandID() throws {
        let fixture: StudioLANV6OperatorTimerFixture = try loadStudioLANFixture(
            named: "studio_lan_v6_operator_timers_fixture"
        )
        guard case .operatorTimerCommand(let command) = fixture.commandWire else {
            return XCTFail("Missing command")
        }
        var recovery = TchurchStudioLANOperatorTimerCommandRecoveryState(
            command: command
        )
        XCTAssertTrue(recovery.markAmbiguous(
            nowMilliseconds: command.issuedAtMilliseconds + 1
        ))
        let replay = replacingOperatorTimerCommand(
            command,
            issuedAtMilliseconds: command.issuedAtMilliseconds + 2_000,
            expiresAtMilliseconds: command.expiresAtMilliseconds + 2_000,
            signature: "resigned"
        )
        XCTAssertNoThrow(try recovery.recordResignedAttempt(
            replay,
            nowMilliseconds: replay.issuedAtMilliseconds
        ))
        XCTAssertEqual(recovery.commandID, command.commandID)
        XCTAssertEqual(recovery.action, command.action)
        XCTAssertEqual(recovery.expectedTimerRevision, command.expectedTimerRevision)
    }

    func testV7LostReceiptRecoveryPreservesClosedActionRevisionAndCommandID() throws {
        let fixture: StudioLANV7LocalBroadcastLowerThirdFixture = try loadStudioLANFixture(
            named: "studio_lan_v7_local_broadcast_lower_third_fixture"
        )
        let command = fixture.showCommand
        var recovery = TchurchStudioLANLocalBroadcastLowerThirdCommandRecoveryState(
            command: command
        )
        XCTAssertTrue(recovery.markAmbiguous(
            nowMilliseconds: command.issuedAtMilliseconds + 1
        ))
        let replay = replacingLocalBroadcastLowerThirdCommand(
            command,
            signature: "resigned"
        )
        XCTAssertNoThrow(try recovery.recordResignedAttempt(
            replay,
            nowMilliseconds: command.issuedAtMilliseconds + 2
        ))
        XCTAssertEqual(recovery.commandID, command.commandID)
        XCTAssertEqual(recovery.action, command.action)
        XCTAssertEqual(
            recovery.expectedLowerThirdRevision,
            command.expectedLowerThirdRevision
        )
    }

    func testV8RequiresTheSeparateExactOuterHintAndKeepsV7AsTheFallback() throws {
        XCTAssertEqual(
            TchurchStudioLANSubscriptionRequest.localOBSControlPayloadVersions,
            [8]
        )
        XCTAssertEqual(
            TchurchStudioLANSubscriptionRequest.localOBSControlSupportedPayloadVersions,
            [8, 7, 6, 5, 4, 3, 2, 1]
        )
        let signer = try Curve25519.Signing.PrivateKey(
            rawRepresentation: Data(repeating: 0x78, count: 32)
        )
        let challenge = makeChallenge(identity: signer)
        let message = TchurchStudioLANWireMessage.challenge(
            challenge,
            supportedPayloadVersions:
                TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions,
            controlSupportedPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions,
            localOBSControlPayloadVersions:
                TchurchStudioLANSubscriptionRequest.localOBSControlPayloadVersions
        )
        let encoded = try TchurchStudioLANCoding.encoder().encode(message)
        guard case .challenge(let decoded, let v6Hint, let v7Hint, let v8Hint) =
                try TchurchStudioLANWireCodec.decode(encoded) else {
            return XCTFail("Expected v8-capable challenge")
        }
        XCTAssertEqual(decoded, challenge)
        XCTAssertEqual(v6Hint, [6, 5, 4, 3, 2, 1])
        XCTAssertEqual(v7Hint, [7, 6, 5, 4, 3, 2, 1])
        XCTAssertEqual(v8Hint, [8])

        let negotiation = TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .control,
            controlAdvertisedPayloadVersions: v7Hint,
            localOBSControlPayloadVersions: nil,
            advertisedPayloadVersions: v6Hint
        ), [7, 6, 5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .control,
            controlAdvertisedPayloadVersions: v7Hint,
            localOBSControlPayloadVersions: v8Hint,
            advertisedPayloadVersions: v6Hint
        ), [8, 7, 6, 5, 4, 3, 2, 1])
        XCTAssertEqual(negotiation.supportedPayloadVersions(
            for: .stage,
            controlAdvertisedPayloadVersions: v7Hint,
            localOBSControlPayloadVersions: v8Hint,
            advertisedPayloadVersions: v6Hint
        ), [5, 4, 3, 2, 1])

        var malformed = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        malformed.removeValue(forKey: "controlSupportedPayloadVersions")
        XCTAssertThrowsError(try TchurchStudioLANWireCodec.decode(
            JSONSerialization.data(withJSONObject: malformed, options: [.sortedKeys])
        ))
    }

    func testV8GrantIsExactAndV7ProjectsOutControlLocalOBS() throws {
        XCTAssertThrowsError(try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 7,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.controlSupportedPayloadVersions,
            permissions: [.observe, .controlProgram, .controlLocalOBS]
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidSubscription) }
        let v8 = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 8,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.localOBSControlSupportedPayloadVersions,
            permissions: [.observe, .controlProgram, .controlLocalOBS]
        )
        XCTAssertEqual(v8.subscription.payloadVersion, 8)
        XCTAssertEqual(
            v8.subscription.deviceGrant?.permissions,
            [.observe, .controlProgram, .controlLocalOBS]
        )
    }

    func testV8CrossPlatformFixtureMatchesCanonicalBytesWireAndRealSignatures() throws {
        let fixture: StudioLANV8LocalOBSFixture = try loadStudioLANFixture(
            named: "studio_lan_v8_local_obs_fixture"
        )
        XCTAssertEqual(
            fixture.fixtureID,
            "studio-lan-v8-local-obs-scenes-cross-platform-1"
        )
        XCTAssertEqual(fixture.schemaVersion, 1)
        XCTAssertTrue(fixture.state.isCanonical)
        XCTAssertTrue(fixture.action.isValid)
        XCTAssertEqual(fixture.state.scenes.count, 2)
        XCTAssertEqual(fixture.command.payloadVersion, 8)
        XCTAssertEqual(fixture.command.connectionID, fixture.state.connectionID)
        XCTAssertEqual(fixture.command.expectedOBSRevision, fixture.state.revision)
        XCTAssertEqual(fixture.command.action, fixture.action)
        XCTAssertTrue(fixture.state.scenes.contains(where: {
            $0.sceneID == fixture.action.sceneID
        }))
        XCTAssertEqual(
            try TchurchStudioLANCoding.encoder().encode(fixture.state).hex,
            fixture.stateCanonicalHex
        )

        let devicePrivateKey = try P256.Signing.PrivateKey(
            rawRepresentation: XCTUnwrap(fixtureHexData(fixture.devicePrivateKeyRawHex))
        )
        XCTAssertEqual(
            devicePrivateKey.publicKey.x963Representation.base64EncodedString(),
            fixture.devicePublicKey
        )
        XCTAssertEqual(
            StudioLANDeviceGrant.fingerprint(
                forPublicKeyData: devicePrivateKey.publicKey.x963Representation
            ),
            fixture.devicePublicKeyFingerprint
        )
        let studioPrivateKey = try Curve25519.Signing.PrivateKey(
            rawRepresentation: XCTUnwrap(fixtureHexData(fixture.studioPrivateKeyRawHex))
        )
        XCTAssertEqual(
            studioPrivateKey.publicKey.rawRepresentation.base64EncodedString(),
            fixture.studioSigningPublicKey
        )
        XCTAssertEqual(
            String(TchurchStudioLANCrypto.sha256Hex(
                studioPrivateKey.publicKey.rawRepresentation
            ).prefix(24)),
            fixture.studioSigningKeyID
        )

        XCTAssertEqual(
            try TchurchStudioLANLocalOBSSceneCommandCrypto
                .signingData(for: fixture.command).hex,
            fixture.commandSigningMaterialHex
        )
        let grant = StudioLANDeviceGrant(
            schemaVersion: 4,
            protocolFloor: 4,
            grantID: fixture.command.grantID,
            deviceID: fixture.command.deviceID,
            deviceName: "Tchurch iOS",
            role: .production,
            permissions: [.observe, .controlProgram, .controlLocalOBS],
            keyAlgorithm: .p256Signing,
            devicePublicKey: fixture.devicePublicKey,
            devicePublicKeyFingerprint: fixture.devicePublicKeyFingerprint,
            studioID: UUID(uuidString: "80000000-0000-4000-8000-000000000006")!,
            studioSigningKeyID: fixture.studioSigningKeyID,
            studioSigningPublicKey: fixture.studioSigningPublicKey,
            permissionRevision: fixture.command.permissionRevision,
            revocationGeneration: fixture.command.revocationGeneration,
            issuedAtMilliseconds: fixture.command.issuedAtMilliseconds - 1_000,
            expiresAtMilliseconds: fixture.command.expiresAtMilliseconds + 1_000,
            signature: ""
        )
        XCTAssertNoThrow(try TchurchStudioLANLocalOBSSceneCommandCrypto.verify(
            fixture.command,
            deviceGrant: grant
        ))

        let commandWire = TchurchStudioLANWireMessage.localOBSSceneCommand(fixture.command)
        let encodedCommandWire = try TchurchStudioLANCoding.encoder().encode(commandWire)
        XCTAssertEqual(
            try TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANWireMessage.self,
                from: encodedCommandWire
            ),
            commandWire
        )
        XCTAssertTrue(String(decoding: encodedCommandWire, as: UTF8.self).contains(
            "\"kind\":\"localOBSSceneCommand\",\"localOBSSceneCommand\""
        ))

        let receiptsAndSigningMaterial = [
            (fixture.acceptedReceipt, fixture.acceptedReceiptSigningMaterialHex),
            (fixture.unconfirmedReceipt, fixture.unconfirmedReceiptSigningMaterialHex),
        ]
        for (receipt, signingMaterialHex) in receiptsAndSigningMaterial {
            XCTAssertEqual(receipt.commandID, fixture.command.commandID)
            XCTAssertEqual(receipt.deviceID, fixture.command.deviceID)
            XCTAssertEqual(receipt.authority, fixture.command.authority)
            XCTAssertEqual(receipt.routeEpoch, fixture.command.routeEpoch)
            XCTAssertEqual(receipt.permissionRevision, fixture.command.permissionRevision)
            XCTAssertEqual(receipt.connectionID, fixture.command.connectionID)
            XCTAssertEqual(receipt.requestedSceneID, fixture.command.action.sceneID)
            XCTAssertEqual(
                try TchurchStudioLANLocalOBSSceneReceiptCrypto.signingData(for: receipt).hex,
                signingMaterialHex
            )
            XCTAssertNoThrow(try TchurchStudioLANLocalOBSSceneReceiptCrypto.verify(
                receipt,
                studioSigningPublicKey: fixture.studioSigningPublicKey
            ))

            let receiptWire = TchurchStudioLANWireMessage.localOBSSceneReceipt(receipt)
            let encodedReceiptWire = try TchurchStudioLANCoding.encoder().encode(receiptWire)
            XCTAssertEqual(
                try TchurchStudioLANCoding.decoder().decode(
                    TchurchStudioLANWireMessage.self,
                    from: encodedReceiptWire
                ),
                receiptWire
            )
            XCTAssertTrue(String(decoding: encodedReceiptWire, as: UTF8.self).contains(
                "\"kind\":\"localOBSSceneReceipt\",\"localOBSSceneReceipt\""
            ))
        }
        XCTAssertEqual(fixture.acceptedReceipt.status, .accepted)
        XCTAssertNil(fixture.acceptedReceipt.rejection)
        XCTAssertNil(fixture.acceptedReceipt.uncertaintyReason)
        XCTAssertEqual(fixture.acceptedReceipt.obsRevision, fixture.state.revision + 1)
        XCTAssertEqual(fixture.unconfirmedReceipt.status, .unconfirmed)
        XCTAssertNil(fixture.unconfirmedReceipt.rejection)
        XCTAssertEqual(
            fixture.unconfirmedReceipt.uncertaintyReason,
            .mutationMayHaveExecuted
        )
        XCTAssertEqual(fixture.unconfirmedReceipt.obsRevision, fixture.state.revision)

        var stateWithExplicitNull = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: TchurchStudioLANCoding.encoder().encode(fixture.state)
            ) as? [String: Any]
        )
        stateWithExplicitNull["currentSceneID"] = NSNull()
        XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(
            TchurchStudioLANLocalOBSProjection.self,
            from: JSONSerialization.data(
                withJSONObject: stateWithExplicitNull,
                options: [.sortedKeys]
            )
        ), "currentSceneID must be omitted instead of encoded as null")

        let acceptedData = try TchurchStudioLANCoding.encoder().encode(
            fixture.acceptedReceipt
        )
        let acceptedObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: acceptedData) as? [String: Any]
        )
        XCTAssertNil(acceptedObject["rejection"])
        XCTAssertNil(acceptedObject["uncertaintyReason"])
        XCTAssertNil(acceptedObject["wasIdempotentReplay"])

        let unconfirmedObject = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: TchurchStudioLANCoding.encoder().encode(
                    fixture.unconfirmedReceipt
                )
            ) as? [String: Any]
        )
        XCTAssertEqual(
            unconfirmedObject["uncertaintyReason"] as? String,
            "mutationMayHaveExecuted"
        )
        XCTAssertNil(unconfirmedObject["wasIdempotentReplay"])

        var illegalAccepted = acceptedObject
        illegalAccepted["uncertaintyReason"] = "mutationMayHaveExecuted"
        XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(
            TchurchStudioLANLocalOBSSceneReceipt.self,
            from: JSONSerialization.data(
                withJSONObject: illegalAccepted,
                options: [.sortedKeys]
            )
        ))

        var missingUncertainty = unconfirmedObject
        missingUncertainty.removeValue(forKey: "uncertaintyReason")
        XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(
            TchurchStudioLANLocalOBSSceneReceipt.self,
            from: JSONSerialization.data(
                withJSONObject: missingUncertainty,
                options: [.sortedKeys]
            )
        ))

        var tamperedCommandObject = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: TchurchStudioLANCoding.encoder().encode(fixture.command)
            ) as? [String: Any]
        )
        var tamperedAction = try XCTUnwrap(
            tamperedCommandObject["action"] as? [String: Any]
        )
        tamperedAction["sceneID"] = fixture.state.currentSceneID
        tamperedCommandObject["action"] = tamperedAction
        let tamperedCommand = try TchurchStudioLANCoding.decoder().decode(
            TchurchStudioLANLocalOBSSceneCommand.self,
            from: JSONSerialization.data(
                withJSONObject: tamperedCommandObject,
                options: [.sortedKeys]
            )
        )
        XCTAssertThrowsError(try TchurchStudioLANLocalOBSSceneCommandCrypto.verify(
            tamperedCommand,
            deviceGrant: grant
        )) { XCTAssertEqual(
            $0 as? TchurchStudioLANRemoteControlError,
            .invalidCommand
        ) }

        var tamperedReceiptObject = acceptedObject
        tamperedReceiptObject["obsRevision"] = fixture.acceptedReceipt.obsRevision + 1
        let tamperedReceipt = try TchurchStudioLANCoding.decoder().decode(
            TchurchStudioLANLocalOBSSceneReceipt.self,
            from: JSONSerialization.data(
                withJSONObject: tamperedReceiptObject,
                options: [.sortedKeys]
            )
        )
        XCTAssertThrowsError(try TchurchStudioLANLocalOBSSceneReceiptCrypto.verify(
            tamperedReceipt,
            studioSigningPublicKey: fixture.studioSigningPublicKey
        )) { XCTAssertEqual(
            $0 as? TchurchStudioLANRemoteControlError,
            .invalidReceipt
        ) }
    }

    func testV8DisconnectedFallbackRoundTripsAndMalformedStatesFailClosed() throws {
        let fallback = TchurchStudioLANLocalOBSProjection(
            schemaVersion: 1,
            revision: 1,
            connectionID: nil,
            availability: .disconnected,
            currentSceneID: nil,
            scenes: []
        )
        XCTAssertTrue(fallback.isCanonical)
        let encodedFallback = try TchurchStudioLANCoding.encoder().encode(fallback)
        let fallbackObject = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encodedFallback) as? [String: Any]
        )
        XCTAssertEqual(
            Set(fallbackObject.keys),
            Set(["availability", "revision", "scenes", "schemaVersion"])
        )
        XCTAssertNil(fallbackObject["connectionID"])
        XCTAssertNil(fallbackObject["currentSceneID"])
        XCTAssertEqual(
            try TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANLocalOBSProjection.self,
                from: encodedFallback
            ),
            fallback
        )

        var fallbackWithNullConnection = fallbackObject
        fallbackWithNullConnection["connectionID"] = NSNull()
        XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(
            TchurchStudioLANLocalOBSProjection.self,
            from: JSONSerialization.data(
                withJSONObject: fallbackWithNullConnection,
                options: [.sortedKeys]
            )
        ))

        let fixture: StudioLANV8LocalOBSFixture = try loadStudioLANFixture(
            named: "studio_lan_v8_local_obs_fixture"
        )
        let validConnected = try XCTUnwrap(
            JSONSerialization.jsonObject(
                with: TchurchStudioLANCoding.encoder().encode(fixture.state)
            ) as? [String: Any]
        )
        var invalidStates: [[String: Any]] = []

        var zeroRevision = fallbackObject
        zeroRevision["revision"] = 0
        invalidStates.append(zeroRevision)

        var disconnectedWithConnection = validConnected
        disconnectedWithConnection["availability"] = "disconnected"
        invalidStates.append(disconnectedWithConnection)

        var readyWithoutConnection = validConnected
        readyWithoutConnection.removeValue(forKey: "connectionID")
        invalidStates.append(readyWithoutConnection)

        var readyWithInvalidConnection = validConnected
        readyWithInvalidConnection["connectionID"] = "obs-local"
        invalidStates.append(readyWithInvalidConnection)

        var readyWithNonRFCConnection = validConnected
        readyWithNonRFCConnection["connectionID"] =
            "00000000-0000-0000-0000-000000000000"
        invalidStates.append(readyWithNonRFCConnection)

        for availability in ["busy", "ready", "uncertain"] {
            var connectedWithoutCurrentScene = validConnected
            connectedWithoutCurrentScene["availability"] = availability
            connectedWithoutCurrentScene.removeValue(forKey: "currentSceneID")
            invalidStates.append(connectedWithoutCurrentScene)
        }

        var readyWithoutScenes = validConnected
        readyWithoutScenes["scenes"] = []
        invalidStates.append(readyWithoutScenes)

        var invalidSceneDigest = validConnected
        var invalidDigestScenes = try XCTUnwrap(
            invalidSceneDigest["scenes"] as? [[String: Any]]
        )
        invalidDigestScenes[0]["sceneID"] = "scene-program"
        invalidSceneDigest["scenes"] = invalidDigestScenes
        invalidStates.append(invalidSceneDigest)

        var duplicateTitle = validConnected
        var duplicateTitleScenes = try XCTUnwrap(
            duplicateTitle["scenes"] as? [[String: Any]]
        )
        duplicateTitleScenes[1]["title"] = duplicateTitleScenes[0]["title"]
        duplicateTitle["scenes"] = duplicateTitleScenes
        invalidStates.append(duplicateTitle)

        for invalid in invalidStates {
            XCTAssertThrowsError(try TchurchStudioLANCoding.decoder().decode(
                TchurchStudioLANLocalOBSProjection.self,
                from: JSONSerialization.data(
                    withJSONObject: invalid,
                    options: [.sortedKeys]
                )
            ))
        }
    }

    func testV8ReplayRevisionIsScopedToTheSignedConnectionID() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 8,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.localOBSControlSupportedPayloadVersions,
            permissions: [.observe, .controlProgram, .controlLocalOBS]
        )
        var guardState = TchurchStudioLANReplayGuard()
        try guardState.begin(fixture.subscription)
        try guardState.accept(makeV8Envelope(
            fixture: fixture,
            sequence: 12,
            programRevision: 3,
            localOBS: makeLocalOBS(connectionID: testLocalOBSConnectionA, revision: 31)
        ))
        XCTAssertThrowsError(try guardState.accept(makeV8Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 3,
            localOBS: makeLocalOBS(connectionID: testLocalOBSConnectionA, revision: 30)
        ))) { XCTAssertEqual($0 as? TchurchStudioLANError, .staleRevision) }

        XCTAssertNoThrow(try guardState.accept(makeV8Envelope(
            fixture: fixture,
            sequence: 13,
            programRevision: 3,
            localOBS: makeLocalOBS(connectionID: testLocalOBSConnectionB, revision: 1)
        )), "a signed new OBS connection starts a fresh revision epoch")
        XCTAssertEqual(guardState.lastOBSConnectionID, testLocalOBSConnectionB)
        XCTAssertEqual(guardState.lastOBSRevision, 1)
    }

    func testV8VerifierBindsLocalOBSStateToTheSignedLocalBroadcastRoute() throws {
        let fixture = try makeDeviceTrustV6SubscriptionFixture(
            selectedPayloadVersion: 8,
            offeredPayloadVersions:
                TchurchStudioLANSubscriptionRequest.localOBSControlSupportedPayloadVersions,
            permissions: [.observe, .controlProgram, .controlLocalOBS]
        )
        let verifier = try TchurchStudioLANEnvelopeVerifier(
            subscription: fixture.subscription
        )
        let localOBS = makeLocalOBS(connectionID: testLocalOBSConnectionA, revision: 1)
        XCTAssertNoThrow(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(try makeV8Envelope(
                fixture: fixture,
                sequence: 12,
                programRevision: 3,
                localOBS: localOBS
            ))
        ))
        XCTAssertThrowsError(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(try makeV8Envelope(
                fixture: fixture,
                sequence: 13,
                programRevision: 4,
                localOBS: localOBS,
                localBroadcastRouteEnabled: false
            ))
        )) { XCTAssertEqual($0 as? TchurchStudioLANError, .invalidPayload) }
        XCTAssertNoThrow(try verifier.verify(
            TchurchStudioLANCoding.encoder().encode(try makeV8Envelope(
                fixture: fixture,
                sequence: 14,
                programRevision: 5,
                localOBS: nil,
                localBroadcastRouteEnabled: false
            ))
        ))
    }

    func testOperatorTimerAndV7LowerThirdUseTheSameBoundedCommandPriorityLane() {
        var lane = TchurchStudioLANBoundedRequestLane()
        let assetID = UUID()
        let timerID = UUID()
        let lowerThirdID = UUID()
        let localOBSID = UUID()
        XCTAssertTrue(lane.begin(.asset(assetID)))
        XCTAssertFalse(lane.begin(.operatorTimerCommand(timerID)))
        XCTAssertFalse(lane.begin(.localBroadcastLowerThirdCommand(lowerThirdID)))
        XCTAssertFalse(lane.begin(.localOBSSceneCommand(localOBSID)))
        XCTAssertTrue(lane.finish(.asset(assetID)))
        XCTAssertEqual(TchurchStudioLANBoundedRequestPriority.next(
            remoteCommandQueued: true,
            catalogReady: true,
            catalogHasPriority: true,
            assetReady: true
        ), .remoteCommand)
        XCTAssertTrue(lane.begin(.operatorTimerCommand(timerID)))
        XCTAssertFalse(lane.begin(.localBroadcastLowerThirdCommand(lowerThirdID)))
        XCTAssertTrue(lane.finish(.operatorTimerCommand(timerID)))
        XCTAssertTrue(lane.begin(.localBroadcastLowerThirdCommand(lowerThirdID)))
        XCTAssertFalse(lane.begin(.remoteCommand(UUID())))
        XCTAssertTrue(lane.finish(.localBroadcastLowerThirdCommand(lowerThirdID)))
        XCTAssertTrue(lane.begin(.localOBSSceneCommand(localOBSID)))
        XCTAssertFalse(lane.begin(.operatorTimerCommand(UUID())))
        XCTAssertTrue(lane.finish(.localOBSSceneCommand(localOBSID)))
    }
}

private struct TestStudioLANDevicePossessionProof: Codable {
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

private struct TestStudioLANSubscriptionRequestProofV4: Codable {
    let challenge: TchurchStudioLANServerChallenge
    let requestID: UUID
    let clientID: UUID
    let clientName: String
    let channel: TchurchStudioLANChannel
    let clientNonce: String
    let supportedPayloadVersions: [Int]
    let deviceAttestation: StudioLANDeviceAttestation
}

private final class TestStudioLANDeviceIdentityProvider: StudioLANDeviceIdentityProviding {
    private var privateKey: P256.Signing.PrivateKey
    private(set) var identity: StudioLANDeviceIdentity
    private(set) var hasIdentity = true
    private(set) var deleteCount = 0

    init() {
        privateKey = P256.Signing.PrivateKey()
        let publicKey = privateKey.publicKey.x963Representation
        identity = StudioLANDeviceIdentity(
            deviceID: UUID(uuidString: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")!,
            keyAlgorithm: .p256Signing,
            publicKey: publicKey.base64EncodedString(),
            fingerprint: StudioLANDeviceGrant.fingerprint(forPublicKeyData: publicKey),
            secureEnclaveBacked: false
        )
    }

    func loadOrCreate() throws -> StudioLANDeviceIdentity {
        if !hasIdentity { generateIdentity() }
        return identity
    }

    func deleteIdentity() throws {
        hasIdentity = false
        deleteCount += 1
    }

    func rotateAfterRevocation() throws -> StudioLANDeviceIdentity {
        try deleteIdentity()
        generateIdentity()
        return identity
    }

    private func generateIdentity() {
        privateKey = P256.Signing.PrivateKey()
        let publicKey = privateKey.publicKey.x963Representation
        identity = StudioLANDeviceIdentity(
            deviceID: UUID(),
            keyAlgorithm: .p256Signing,
            publicKey: publicKey.base64EncodedString(),
            fingerprint: StudioLANDeviceGrant.fingerprint(forPublicKeyData: publicKey),
            secureEnclaveBacked: false
        )
        hasIdentity = true
    }

    func signPossessionProof(_ canonicalPayload: Data) throws -> String {
        try privateKey.signature(for: canonicalPayload).derRepresentation.base64EncodedString()
    }
}

private final class TestStudioLANDeviceTrustStateStore: StudioLANDeviceTrustStateStoring {
    var state: StudioLANDeviceTrustRecord?
    var protocolFloor: Int?
    var recoveryMarker: StudioLANDeviceTrustRecoveryMarker?

    func read() throws -> StudioLANDeviceTrustRecord? { state }
    func write(_ state: StudioLANDeviceTrustRecord) throws { self.state = state }
    func delete() throws { state = nil }
    func readProtocolFloor() throws -> Int? { protocolFloor }
    func writeProtocolFloor(_ protocolFloor: Int) throws {
        guard protocolFloor >= (self.protocolFloor ?? 1) else {
            throw StudioLANDeviceTrustError.legacyDowngradeDenied
        }
        self.protocolFloor = protocolFloor
    }
    func readRecoveryMarker() throws -> StudioLANDeviceTrustRecoveryMarker? { recoveryMarker }
    func writeRecoveryMarker(_ marker: StudioLANDeviceTrustRecoveryMarker) throws {
        recoveryMarker = marker
    }
    func deleteRecoveryMarker() throws { recoveryMarker = nil }
}

private func makeStudioLANDeviceGrant(
    identity: StudioLANDeviceIdentity,
    signer: Curve25519.Signing.PrivateKey,
    studioID: UUID,
    permissions: [StudioLANDevicePermission],
    role: StudioLANDeviceRole = .musicians,
    issuedAtMilliseconds: Int64 = 1_000_000,
    expiresAtMilliseconds: Int64 = 2_000_000
) throws -> StudioLANDeviceGrant {
    let signingPublicKey = signer.publicKey.rawRepresentation
    let signingKeyID = String(TchurchStudioLANCrypto.sha256Hex(signingPublicKey).prefix(24))
    let unsigned = StudioLANDeviceGrant(
        schemaVersion: 4,
        protocolFloor: 4,
        grantID: UUID(uuidString: "ffffffff-ffff-4fff-8fff-ffffffffffff")!,
        deviceID: identity.deviceID,
        deviceName: "Tchurch iOS",
        role: role,
        permissions: permissions,
        keyAlgorithm: .p256Signing,
        devicePublicKey: identity.publicKey,
        devicePublicKeyFingerprint: identity.fingerprint,
        studioID: studioID,
        studioSigningKeyID: signingKeyID,
        studioSigningPublicKey: signingPublicKey.base64EncodedString(),
        permissionRevision: 7,
        revocationGeneration: 2,
        issuedAtMilliseconds: issuedAtMilliseconds,
        expiresAtMilliseconds: expiresAtMilliseconds,
        signature: ""
    )
    let signature = try signer.signature(for: unsigned.canonicalSigningData()).base64EncodedString()
    return StudioLANDeviceGrant(
        schemaVersion: unsigned.schemaVersion,
        protocolFloor: unsigned.protocolFloor,
        grantID: unsigned.grantID,
        deviceID: unsigned.deviceID,
        deviceName: unsigned.deviceName,
        role: unsigned.role,
        permissions: unsigned.permissions,
        keyAlgorithm: unsigned.keyAlgorithm,
        devicePublicKey: unsigned.devicePublicKey,
        devicePublicKeyFingerprint: unsigned.devicePublicKeyFingerprint,
        studioID: unsigned.studioID,
        studioSigningKeyID: unsigned.studioSigningKeyID,
        studioSigningPublicKey: unsigned.studioSigningPublicKey,
        permissionRevision: unsigned.permissionRevision,
        revocationGeneration: unsigned.revocationGeneration,
        issuedAtMilliseconds: unsigned.issuedAtMilliseconds,
        expiresAtMilliseconds: unsigned.expiresAtMilliseconds,
        signature: signature
    )
}

private struct DeviceTrustV6SubscriptionFixture {
    let authority: TchurchStudioLANAuthority
    let signer: Curve25519.Signing.PrivateKey
    let subscription: TchurchStudioLANVerifiedSubscription
}

private struct TestStudioLANSubscriptionGrantProofV4: Codable {
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

private func makeDeviceTrustV6SubscriptionFixture(
    selectedPayloadVersion: Int,
    signer suppliedSigner: Curve25519.Signing.PrivateKey? = nil,
    authorityEpoch: UInt64 = 7,
    channel: TchurchStudioLANChannel = .control,
    offeredPayloadVersions suppliedOfferedPayloadVersions: [Int]? = nil,
    permissions suppliedPermissions: [StudioLANDevicePermission]? = nil
) throws -> DeviceTrustV6SubscriptionFixture {
    let signer = try suppliedSigner ?? Curve25519.Signing.PrivateKey(
        rawRepresentation: Data(repeating: 0x67, count: 32)
    )
    let identityProvider = TestStudioLANDeviceIdentityProvider()
    let stateStore = TestStudioLANDeviceTrustStateStore()
    let controller = try StudioLANDeviceTrustController(
        identityProvider: identityProvider,
        stateStore: stateStore
    )
    let studioID = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
    let authority = makeAuthority(epoch: authorityEpoch)
    let signingPublicKeyData = signer.publicKey.rawRepresentation
    let signingPublicKey = signingPublicKeyData.base64EncodedString()
    let signingKeyID = String(
        TchurchStudioLANCrypto.sha256Hex(signingPublicKeyData).prefix(24)
    )
    let challenge = TchurchStudioLANServerChallenge(
        schemaVersion: 1,
        challengeID: UUID(uuidString: "abababab-abab-4bab-8bab-abababababab")!,
        serverNonce: Data(repeating: 0x11, count: 32).base64EncodedString(),
        authority: authority,
        signingKeyID: signingKeyID,
        issuedAtMilliseconds: 1_000_000,
        expiresAtMilliseconds: 2_000_000,
        deviceTrustVersion: 4,
        minimumPayloadVersion: 4,
        studioID: studioID
    )
    let identity = try controller.beginEnrollment(studioID: studioID)
    let requestID = UUID(uuidString: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd")!
    let nonce = Data(repeating: 0x22, count: 24)
    let offeredPayloadVersions = suppliedOfferedPayloadVersions ??
        TchurchStudioLANPayloadNegotiation(protocolFloor: 4)
            .supportedPayloadVersions(
                for: channel,
                advertisedPayloadVersions:
                    TchurchStudioLANSubscriptionRequest.deviceTrustSupportedPayloadVersions
            )
    let requestedRole: StudioLANDeviceRole = channel == .control ? .production : .musicians
    let attestation = try controller.makeAttestation(
        challenge: challenge,
        requestID: requestID,
        clientName: "Tchurch iOS",
        channel: channel,
        clientNonce: nonce.base64EncodedString(),
        supportedPayloadVersions: offeredPayloadVersions,
        requestedRole: requestedRole
    )
    let secret = try fixedSecret(0x55)
    let request = try TchurchStudioLANSubscriptionAuthenticator.makeRequest(
        challenge: challenge,
        clientID: identity.deviceID,
        clientName: "Tchurch iOS",
        channel: channel,
        secret: secret,
        requestID: requestID,
        clientNonce: nonce,
        schemaVersion: TchurchStudioLANSubscriptionRequest.deviceTrustSchemaVersion,
        offeredPayloadVersions: offeredPayloadVersions,
        deviceAttestation: attestation
    )
    let deviceGrant = try makeStudioLANDeviceGrant(
        identity: identity,
        signer: signer,
        studioID: studioID,
        permissions: suppliedPermissions ??
            (channel == .control ? [.observe, .controlProgram] : [.observe]),
        role: requestedRole
    )
    let encodedDeviceGrant = try TchurchStudioLANCoding.encoder().encode(deviceGrant)
    let deviceGrantChecksum = "sha256:\(TchurchStudioLANCrypto.sha256Hex(encodedDeviceGrant))"
    let sessionID = UUID(uuidString: "efefefef-efef-4fef-8fef-efefefefefef")!
    let expiresAtMilliseconds: Int64 = 1_500_000
    let serverProof = try TchurchStudioLANCrypto.authenticationCode(
        for: TestStudioLANSubscriptionGrantProofV4(
            challengeID: challenge.challengeID,
            sessionID: sessionID,
            requestID: request.requestID,
            channel: request.channel,
            authority: authority,
            signingKeyID: signingKeyID,
            signingPublicKey: signingPublicKey,
            minimumSequence: 12,
            expiresAtMilliseconds: expiresAtMilliseconds,
            clientNonce: request.clientNonce,
            selectedPayloadVersion: selectedPayloadVersion,
            deviceGrantChecksum: deviceGrantChecksum
        ),
        secret: secret
    )
    let grant = TchurchStudioLANSubscriptionGrant(
        schemaVersion: request.schemaVersion,
        sessionID: sessionID,
        requestID: request.requestID,
        channel: request.channel,
        authority: authority,
        signingKeyID: signingKeyID,
        signingPublicKey: signingPublicKey,
        minimumSequence: 12,
        expiresAtMilliseconds: expiresAtMilliseconds,
        selectedPayloadVersion: selectedPayloadVersion,
        deviceGrant: deviceGrant,
        serverProof: serverProof
    )
    return DeviceTrustV6SubscriptionFixture(
        authority: authority,
        signer: signer,
        subscription: try TchurchStudioLANSubscriptionAuthenticator.verifyGrant(
            grant,
            request: request,
            challenge: challenge,
            secret: secret,
            nowMilliseconds: 1_100_000
        )
    )
}

private func makeOperatorTimers(
    revision: UInt64,
    serviceAnchor: Int64 = 1_800_000_000_000,
    serviceValue: Int64 = 90_000,
    serviceRunning: Bool = true,
    itemAnchor: Int64 = 1_799_999_990_000,
    itemValue: Int64 = 30_000,
    itemRunning: Bool = false
) -> TchurchStudioLANOperatorTimersProjection {
    TchurchStudioLANOperatorTimersProjection(
        schemaVersion: 1,
        revision: revision,
        timers: [
            TchurchStudioLANOperatorTimerState(
                scope: .service,
                anchorTimestampMilliseconds: serviceAnchor,
                anchorValueMilliseconds: serviceValue,
                isRunning: serviceRunning
            ),
            TchurchStudioLANOperatorTimerState(
                scope: .item,
                anchorTimestampMilliseconds: itemAnchor,
                anchorValueMilliseconds: itemValue,
                isRunning: itemRunning
            ),
        ]
    )
}

private func makeLowerThird(
    revision: UInt64,
    title: String,
    subtitle: String? = nil
) -> TchurchStudioLANLocalBroadcastLowerThirdProjection {
    TchurchStudioLANLocalBroadcastLowerThirdProjection(
        schemaVersion: 1,
        revision: revision,
        target: .localBrowserOBS,
        visible: true,
        title: title,
        subtitle: subtitle
    )
}

private let testLocalOBSConnectionA = "90000000-0000-4000-8000-00000000000a"
private let testLocalOBSConnectionB = "90000000-0000-4000-8000-00000000000b"
private let testLocalOBSProgramSceneID = "sha256:\(String(repeating: "1", count: 64))"
private let testLocalOBSMessageSceneID = "sha256:\(String(repeating: "2", count: 64))"

private func makeLocalOBS(
    connectionID: String,
    revision: UInt64,
    availability: TchurchStudioLANLocalOBSAvailability = .ready,
    currentSceneID: String? = testLocalOBSProgramSceneID
) -> TchurchStudioLANLocalOBSProjection {
    TchurchStudioLANLocalOBSProjection(
        schemaVersion: 1,
        revision: revision,
        connectionID: connectionID,
        availability: availability,
        currentSceneID: currentSceneID,
        scenes: [
            TchurchStudioLANLocalOBSScene(
                sceneID: testLocalOBSProgramSceneID,
                title: "Program"
            ),
            TchurchStudioLANLocalOBSScene(
                sceneID: testLocalOBSMessageSceneID,
                title: "Message"
            ),
        ]
    )
}

private func makeV6ControlPayload(
    authority: TchurchStudioLANAuthority,
    programRevision: UInt64,
    operatorTimers: TchurchStudioLANOperatorTimersProjection?,
    isBlackout: Bool = false,
    localBroadcastLowerThird:
        TchurchStudioLANLocalBroadcastLowerThirdProjection? = nil,
    localOBS: TchurchStudioLANLocalOBSProjection? = nil,
    localBroadcastRouteEnabled: Bool = true,
    stageAndMusiciansRouteEnabled: Bool = false,
    routeEpoch: UInt64? = 9,
    routingAvailable: Bool = true,
    lightingArmed: Bool = false,
    healthyOutputCount: Int = 2,
    expectedOutputCount: Int = 2,
    cueCatalogManifestOverride: TchurchStudioLANCueCatalogManifest? = nil
) throws -> TchurchStudioLANChannelPayload {
    let audience = TchurchStudioLANAudiencePayload(
        snapshot: TchurchStudioLANAudienceSnapshot(
            schemaVersion: 1,
            runID: authority.runID,
            authorityEpoch: authority.authorityEpoch,
            packageID: authority.packageID,
            serviceVersion: authority.serviceVersion,
            revision: programRevision,
            currentCueID: nil,
            currentCueIndex: nil,
            cueCount: 0,
            isBlackout: isBlackout,
            countdown: nil
        ),
        cue: nil
    )
    let stage = TchurchStudioLANStageSupplement(
        nextCue: nil,
        chordLines: [],
        currentChordSlide: nil,
        timers: [],
        message: nil
    )
    let manifest = TchurchStudioLANCueCatalogManifest(
        schemaVersion: 1,
        catalogID: try TchurchStudioLANCueCatalogDigest.catalogID(for: []),
        totalCount: 0,
        pageSize: 128
    )
    let control = TchurchStudioLANControlSupplement(
        chordsVisible: false,
        lightingArmed: lightingArmed,
        healthyOutputCount: healthyOutputCount,
        expectedOutputCount: expectedOutputCount,
        routeEpoch: routeEpoch,
        cueCatalog: nil,
        routing: routingAvailable
            ? TchurchStudioLANRoutingProjection(
                schemaVersion: 1,
                localAudience: true,
                localBroadcast: localBroadcastRouteEnabled,
                stageAndMusicians: stageAndMusiciansRouteEnabled,
                lanRemoteControl: true,
                lightingAndMIDI: false,
                tchurchCloudProgram: false
            )
            : nil,
        cueCatalogManifest: cueCatalogManifestOverride ?? manifest,
        operatorTimers: operatorTimers,
        localBroadcastLowerThird: localBroadcastLowerThird,
        localOBS: localOBS
    )
    return .control(TchurchStudioLANControlPayload(
        audience: audience,
        stage: stage,
        control: control
    ))
}

private func makeV7Envelope(
    fixture: DeviceTrustV6SubscriptionFixture,
    sequence: UInt64,
    programRevision: UInt64,
    operatorTimers: TchurchStudioLANOperatorTimersProjection?,
    localBroadcastLowerThird:
        TchurchStudioLANLocalBroadcastLowerThirdProjection?,
    isBlackout: Bool = false,
    localBroadcastRouteEnabled: Bool = true,
    stageAndMusiciansRouteEnabled: Bool = false,
    routeEpoch: UInt64? = 9,
    routingAvailable: Bool = true,
    lightingArmed: Bool = false,
    healthyOutputCount: Int = 2,
    expectedOutputCount: Int = 2,
    cueCatalogManifestOverride: TchurchStudioLANCueCatalogManifest? = nil
) throws -> TchurchStudioLANSignedEnvelope {
    try signEnvelope(
        payload: makeV6ControlPayload(
            authority: fixture.authority,
            programRevision: programRevision,
            operatorTimers: operatorTimers,
            isBlackout: isBlackout,
            localBroadcastLowerThird: localBroadcastLowerThird,
            localBroadcastRouteEnabled: localBroadcastRouteEnabled,
            stageAndMusiciansRouteEnabled: stageAndMusiciansRouteEnabled,
            routeEpoch: routeEpoch,
            routingAvailable: routingAvailable,
            lightingArmed: lightingArmed,
            healthyOutputCount: healthyOutputCount,
            expectedOutputCount: expectedOutputCount,
            cueCatalogManifestOverride: cueCatalogManifestOverride
        ),
        authority: fixture.authority,
        identity: fixture.signer,
        sequence: sequence,
        revision: programRevision,
        schemaVersion: 7
    )
}

private func makeV8Envelope(
    fixture: DeviceTrustV6SubscriptionFixture,
    sequence: UInt64,
    programRevision: UInt64,
    localOBS: TchurchStudioLANLocalOBSProjection?,
    localBroadcastRouteEnabled: Bool = true
) throws -> TchurchStudioLANSignedEnvelope {
    try signEnvelope(
        payload: makeV6ControlPayload(
            authority: fixture.authority,
            programRevision: programRevision,
            operatorTimers: nil,
            localOBS: localOBS,
            localBroadcastRouteEnabled: localBroadcastRouteEnabled
        ),
        authority: fixture.authority,
        identity: fixture.signer,
        sequence: sequence,
        revision: programRevision,
        schemaVersion: 8
    )
}

private func makeV6Envelope(
    fixture: DeviceTrustV6SubscriptionFixture,
    sequence: UInt64,
    programRevision: UInt64,
    operatorTimers: TchurchStudioLANOperatorTimersProjection?,
    isBlackout: Bool = false,
    routeEpoch: UInt64? = 9,
    localBroadcastRouteEnabled: Bool = true,
    stageAndMusiciansRouteEnabled: Bool = false,
    lightingArmed: Bool = false,
    healthyOutputCount: Int = 2,
    expectedOutputCount: Int = 2,
    cueCatalogManifestOverride: TchurchStudioLANCueCatalogManifest? = nil
) throws -> TchurchStudioLANSignedEnvelope {
    try signEnvelope(
        payload: makeV6ControlPayload(
            authority: fixture.authority,
            programRevision: programRevision,
            operatorTimers: operatorTimers,
            isBlackout: isBlackout,
            localBroadcastRouteEnabled: localBroadcastRouteEnabled,
            stageAndMusiciansRouteEnabled: stageAndMusiciansRouteEnabled,
            routeEpoch: routeEpoch,
            lightingArmed: lightingArmed,
            healthyOutputCount: healthyOutputCount,
            expectedOutputCount: expectedOutputCount,
            cueCatalogManifestOverride: cueCatalogManifestOverride
        ),
        authority: fixture.authority,
        identity: fixture.signer,
        sequence: sequence,
        revision: programRevision,
        schemaVersion: 6
    )
}

private func replacingOperatorTimerCommand(
    _ value: TchurchStudioLANOperatorTimerCommand,
    action: TchurchStudioLANOperatorTimerAction? = nil,
    issuedAtMilliseconds: Int64? = nil,
    expiresAtMilliseconds: Int64? = nil,
    signature: String? = nil
) -> TchurchStudioLANOperatorTimerCommand {
    TchurchStudioLANOperatorTimerCommand(
        schemaVersion: value.schemaVersion,
        payloadVersion: value.payloadVersion,
        commandID: value.commandID,
        sessionID: value.sessionID,
        deviceID: value.deviceID,
        grantID: value.grantID,
        deviceGrantChecksum: value.deviceGrantChecksum,
        permissionRevision: value.permissionRevision,
        revocationGeneration: value.revocationGeneration,
        authority: value.authority,
        routeEpoch: value.routeEpoch,
        expectedTimerRevision: value.expectedTimerRevision,
        issuedAtMilliseconds: issuedAtMilliseconds ?? value.issuedAtMilliseconds,
        expiresAtMilliseconds: expiresAtMilliseconds ?? value.expiresAtMilliseconds,
        action: action ?? value.action,
        signature: signature ?? value.signature
    )
}

private func replacingLocalBroadcastLowerThirdCommand(
    _ value: TchurchStudioLANLocalBroadcastLowerThirdCommand,
    action: TchurchStudioLANLocalBroadcastLowerThirdAction? = nil,
    signature: String? = nil
) -> TchurchStudioLANLocalBroadcastLowerThirdCommand {
    TchurchStudioLANLocalBroadcastLowerThirdCommand(
        schemaVersion: value.schemaVersion,
        payloadVersion: value.payloadVersion,
        commandID: value.commandID,
        sessionID: value.sessionID,
        deviceID: value.deviceID,
        grantID: value.grantID,
        deviceGrantChecksum: value.deviceGrantChecksum,
        permissionRevision: value.permissionRevision,
        revocationGeneration: value.revocationGeneration,
        authority: value.authority,
        routeEpoch: value.routeEpoch,
        expectedLowerThirdRevision: value.expectedLowerThirdRevision,
        issuedAtMilliseconds: value.issuedAtMilliseconds,
        expiresAtMilliseconds: value.expiresAtMilliseconds,
        action: action ?? value.action,
        signature: signature ?? value.signature
    )
}

private func replacingOperatorTimerReceipt(
    _ value: TchurchStudioLANOperatorTimerReceipt,
    timerRevision: UInt64
) -> TchurchStudioLANOperatorTimerReceipt {
    TchurchStudioLANOperatorTimerReceipt(
        schemaVersion: value.schemaVersion,
        payloadVersion: value.payloadVersion,
        commandID: value.commandID,
        deviceID: value.deviceID,
        authority: value.authority,
        routeEpoch: value.routeEpoch,
        permissionRevision: value.permissionRevision,
        status: value.status,
        rejection: value.rejection,
        timerRevision: timerRevision,
        wasIdempotentReplay: value.wasIdempotentReplay,
        issuedAtMilliseconds: value.issuedAtMilliseconds,
        studioSigningKeyID: value.studioSigningKeyID,
        signature: value.signature
    )
}

private func replacingLocalBroadcastLowerThirdReceipt(
    _ value: TchurchStudioLANLocalBroadcastLowerThirdReceipt,
    lowerThirdRevision: UInt64
) -> TchurchStudioLANLocalBroadcastLowerThirdReceipt {
    TchurchStudioLANLocalBroadcastLowerThirdReceipt(
        schemaVersion: value.schemaVersion,
        payloadVersion: value.payloadVersion,
        commandID: value.commandID,
        deviceID: value.deviceID,
        authority: value.authority,
        routeEpoch: value.routeEpoch,
        permissionRevision: value.permissionRevision,
        status: value.status,
        rejection: value.rejection,
        lowerThirdRevision: lowerThirdRevision,
        wasIdempotentReplay: value.wasIdempotentReplay,
        issuedAtMilliseconds: value.issuedAtMilliseconds,
        studioSigningKeyID: value.studioSigningKeyID,
        signature: value.signature
    )
}
