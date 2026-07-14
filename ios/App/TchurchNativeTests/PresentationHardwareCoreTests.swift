import CoreMIDI
import XCTest
@testable import Tchurch

final class PresentationHardwareCoreTests: XCTestCase {
    func testCanonicalSourceIdentifiersMatchTheTypeScriptContract() {
        let gamepadA = "gamepad-" + String(repeating: "a", count: 64)
        let gamepadHexPairs = "gamepad-" + String(repeating: "0a", count: 32)
        let midiHash = "midi-" + String(repeating: "0f", count: 32)

        for accepted in [gamepadA, gamepadHexPairs] {
            XCTAssertTrue(PresentationHardwareIdentity.isCanonicalGamepadID(accepted), accepted)
        }
        for rejected in [
            "gamepad-a",
            "gamepad-" + String(repeating: "A", count: 64),
            "gamepad-" + String(repeating: "a", count: 63),
            "gamepad-550e8400-e29b-41d4-a716-446655440000",
            "runtime-1",
            "midi-42",
        ] {
            XCTAssertFalse(PresentationHardwareIdentity.isCanonicalGamepadID(rejected), rejected)
        }

        for accepted in ["midi-0", "midi-42", "midi-4294967295", midiHash] {
            XCTAssertTrue(PresentationHardwareIdentity.isCanonicalMIDIID(accepted), accepted)
        }
        for rejected in [
            "midi-00",
            "midi-042",
            "midi-4294967296",
            "midi--1",
            "midi-" + String(repeating: "F", count: 64),
            "midi-550e8400-e29b-41d4-a716-446655440000",
            "route-1",
            gamepadA,
        ] {
            XCTAssertFalse(PresentationHardwareIdentity.isCanonicalMIDIID(rejected), rejected)
        }
    }

    func testActivationFailsClosedForEveryEnabledNativeSourceAndRecovers() {
        let bridgeIdle = PresentationHardwareActivationPolicy.evaluate(
            monitoringRequested: false,
            gamepadEnabled: false,
            gamepadStarted: false,
            midiEnabled: false,
            midiStarted: false
        )
        XCTAssertFalse(bridgeIdle.active)
        XCTAssertNil(bridgeIdle.message)

        let gamepadFailure = PresentationHardwareActivationPolicy.evaluate(
            monitoringRequested: true,
            gamepadEnabled: true,
            gamepadStarted: false,
            midiEnabled: false,
            midiStarted: false
        )
        XCTAssertFalse(gamepadFailure.active)
        XCTAssertEqual(gamepadFailure.message, "No se pudo iniciar Gamepad. Vuelve a conectar el control y reactiva las entradas.")

        let midiFailure = PresentationHardwareActivationPolicy.evaluate(
            monitoringRequested: true,
            gamepadEnabled: true,
            gamepadStarted: true,
            midiEnabled: true,
            midiStarted: false
        )
        XCTAssertFalse(midiFailure.active, "One failed enabled source must fail the whole native bridge closed")
        XCTAssertEqual(midiFailure.message, "No se pudo iniciar MIDI. Vuelve a conectar la interfaz y reactiva las entradas.")
        XCTAssertFalse(midiFailure.message?.contains("OSStatus") == true)
        XCTAssertFalse(midiFailure.message?.contains("CoreMIDI") == true)

        let recovered = PresentationHardwareActivationPolicy.evaluate(
            monitoringRequested: true,
            gamepadEnabled: true,
            gamepadStarted: true,
            midiEnabled: true,
            midiStarted: true
        )
        XCTAssertEqual(recovered, PresentationHardwareActivationStatus(active: true, message: nil))
    }

    func testGamepadAndMIDIIdentitiesIgnoreEnumerationOrderAndReconnect() {
        let descriptors = ["Acme|Extended|A,B", "Other|Micro|A,X"]
        let forward = descriptors.map {
            PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: $0)
        }
        let reverse = descriptors.reversed().map {
            PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: $0)
        }.reversed()
        XCTAssertEqual(forward, Array(reverse))
        XCTAssertEqual(
            PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: descriptors[0]),
            PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: descriptors[0])
        )

        let duplicateA = PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: descriptors[0])
        let duplicateB = PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: descriptors[0])
        XCTAssertEqual(duplicateA, duplicateB, "Indistinguishable controllers must share a safe descriptor identity")
        XCTAssertFalse(duplicateA.hasSuffix("-1"))
        XCTAssertNotEqual(
            PresentationHardwareIdentity.gamepadID(stableIdentifier: "serial-a", descriptor: descriptors[0]),
            PresentationHardwareIdentity.gamepadID(stableIdentifier: "serial-b", descriptor: descriptors[0])
        )

        let midiForward = [Int32(9001), Int32(-42)].map {
            PresentationHardwareIdentity.midiID(uniqueID: $0, descriptor: "Pedal")
        }
        let midiReverse = [Int32(-42), Int32(9001)].map {
            PresentationHardwareIdentity.midiID(uniqueID: $0, descriptor: "Pedal")
        }
        XCTAssertEqual(midiForward, midiReverse.reversed())
        XCTAssertEqual(
            PresentationHardwareIdentity.midiID(uniqueID: nil, descriptor: "Maker|Model|Port"),
            PresentationHardwareIdentity.midiID(uniqueID: nil, descriptor: "Maker|Model|Port")
        )
    }

    func testGamepadLatchPrimesHeldControlAndRequiresReleaseBeforeOneEdgePerPress() {
        var latch = PresentationLevelLatchBank()
        latch.prime(key: "route:button_a", value: 1, releaseThreshold: 0.35)
        XCTAssertFalse(latch.edge(key: "route:button_a", value: 1, pressThreshold: 0.55, releaseThreshold: 0.35))
        XCTAssertFalse(latch.edge(key: "route:button_a", value: 0, pressThreshold: 0.55, releaseThreshold: 0.35))
        XCTAssertTrue(latch.edge(key: "route:button_a", value: 1, pressThreshold: 0.55, releaseThreshold: 0.35))
        XCTAssertFalse(latch.edge(key: "route:button_a", value: 1, pressThreshold: 0.55, releaseThreshold: 0.35))
        XCTAssertFalse(latch.edge(key: "route:button_a", value: 0, pressThreshold: 0.55, releaseThreshold: 0.35))
        XCTAssertTrue(latch.edge(key: "route:button_a", value: 1, pressThreshold: 0.55, releaseThreshold: 0.35))
    }

    func testMIDIRuleEnginePrimesReconnectAndSelectsOnlyTheRuleThatCrossed() {
        let wildcard = PresentationMIDIRule(
            ruleKey: "midi:control_change:0:7",
            deviceId: nil,
            message: "control_change",
            channel: 0,
            number: 7,
            activation: "positive",
            threshold: 1,
            releaseThreshold: 0
        )
        let specific = PresentationMIDIRule(
            ruleKey: "midi:midi-42:control_change:0:7",
            deviceId: "midi-42",
            message: "control_change",
            channel: 0,
            number: 7,
            activation: "positive",
            threshold: 80,
            releaseThreshold: 40
        )
        let neutral = PresentationMIDIChannelMessage(message: "control_change", channel: 0, number: 7, value: 0)
        let lowPress = PresentationMIDIChannelMessage(message: "control_change", channel: 0, number: 7, value: 1)
        let highPress = PresentationMIDIChannelMessage(message: "control_change", channel: 0, number: 7, value: 100)
        var engine = PresentationMIDIRuleEngine()

        XCTAssertNil(engine.process(message: neutral, deviceId: "midi-42", routingKey: "route-1", rules: [specific, wildcard]))
        XCTAssertEqual(
            engine.process(message: lowPress, deviceId: "midi-42", routingKey: "route-1", rules: [specific, wildcard]),
            wildcard.ruleKey
        )
        XCTAssertNil(engine.process(message: lowPress, deviceId: "midi-42", routingKey: "route-1", rules: [specific, wildcard]))
        XCTAssertNil(
            engine.process(message: highPress, deviceId: "midi-42", routingKey: "route-1", rules: [specific, wildcard]),
            "One physical press cannot trigger a second overlapping rule"
        )
        XCTAssertNil(engine.process(message: neutral, deviceId: "midi-42", routingKey: "route-1", rules: [specific, wildcard]))
        XCTAssertEqual(
            engine.process(message: highPress, deviceId: "midi-42", routingKey: "route-1", rules: [wildcard, specific]),
            specific.ruleKey,
            "Rule order must not change the specific crossed rule"
        )

        XCTAssertNil(
            engine.process(message: highPress, deviceId: "midi-42", routingKey: "route-2", rules: [specific, wildcard]),
            "A hot-plugged route must prime an already-active control without firing"
        )
        XCTAssertNil(engine.process(message: neutral, deviceId: "midi-42", routingKey: "route-2", rules: [specific, wildcard]))
        XCTAssertEqual(
            engine.process(message: lowPress, deviceId: "midi-42", routingKey: "route-2", rules: [specific, wildcard]),
            wildcard.ruleKey
        )

        let releaseEdge = PresentationMIDIRule(
            ruleKey: "midi:midi-42:control_change:0:7",
            deviceId: "midi-42",
            message: "control_change",
            channel: 0,
            number: 7,
            activation: "zero",
            threshold: 0,
            releaseThreshold: 1
        )
        var mixedEngine = PresentationMIDIRuleEngine()
        XCTAssertNil(mixedEngine.process(message: neutral, deviceId: "midi-42", routingKey: "route-mixed", rules: [wildcard, releaseEdge]))
        XCTAssertEqual(
            mixedEngine.process(message: lowPress, deviceId: "midi-42", routingKey: "route-mixed", rules: [wildcard, releaseEdge]),
            wildcard.ruleKey
        )
        XCTAssertEqual(
            mixedEngine.process(message: neutral, deviceId: "midi-42", routingKey: "route-mixed", rules: [wildcard, releaseEdge]),
            releaseEdge.ruleKey,
            "Opposite press/release gestures must not permanently latch each other"
        )
    }

    func testMIDIParserHandlesRunningStatusRealtimeSysExAndReleaseForms() {
        var parser = PresentationMIDIByteStreamParser()
        var messages = parser.parse([0x90, 60, 100, 61])
        messages += parser.parse([0xF8, 0, 0x80, 62, 10, 0x90, 63, 0])
        messages += parser.parse([0xF0, 1, 2, 0xF8, 3, 0xF7, 0xB0, 64, 127])

        XCTAssertEqual(messages, [
            PresentationMIDIChannelMessage(message: "note_on", channel: 0, number: 60, value: 100),
            PresentationMIDIChannelMessage(message: "note_on", channel: 0, number: 61, value: 0),
            PresentationMIDIChannelMessage(message: "note_on", channel: 0, number: 62, value: 0),
            PresentationMIDIChannelMessage(message: "note_on", channel: 0, number: 63, value: 0),
            PresentationMIDIChannelMessage(message: "control_change", channel: 0, number: 64, value: 127),
        ])
    }

    func testFlexibleMIDIPacketCopyPreservesPayloadBeyond256BytesWithinExplicitLimit() throws {
        let payload = [UInt8(0xF0)]
            + [UInt8](repeating: 0x01, count: 300)
            + [0xF8, 0xF7, 0x90, 65, 127]
            + [UInt8](repeating: 0xF8, count: 297)
        let allocationSize = 2_048
        let storage = UnsafeMutableRawPointer.allocate(
            byteCount: allocationSize,
            alignment: MemoryLayout<MIDIPacketList>.alignment
        )
        defer { storage.deallocate() }
        let packetList = storage.bindMemory(to: MIDIPacketList.self, capacity: 1)
        let packet = MIDIPacketListInit(packetList)
        let addedPacket: UnsafeMutablePointer<MIDIPacket>? = payload.withUnsafeBytes { bytes -> UnsafeMutablePointer<MIDIPacket>? in
            guard let base = bytes.bindMemory(to: UInt8.self).baseAddress else { return nil }
            return MIDIPacketListAdd(packetList, allocationSize, packet, 0, payload.count, base)
        }
        XCTAssertNotNil(addedPacket)

        let copied = PresentationMIDIPacketCopier.copy(UnsafePointer(packetList))
        XCTAssertEqual(copied, [payload])
        XCTAssertGreaterThan(copied[0].count, 256)
        XCTAssertTrue(PresentationMIDIPacketCopier.copy(
            UnsafePointer(packetList),
            maximumTotalBytes: payload.count - 1
        ).isEmpty)

        var parser = PresentationMIDIByteStreamParser()
        XCTAssertEqual(parser.parse(copied[0]), [
            PresentationMIDIChannelMessage(message: "note_on", channel: 0, number: 65, value: 127),
        ])
    }
}
