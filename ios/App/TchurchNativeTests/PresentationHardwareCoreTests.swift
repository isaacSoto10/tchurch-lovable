import CoreMIDI
import XCTest
@testable import Tchurch

final class PresentationHardwareCoreTests: XCTestCase {
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
            ruleKey: "midi:midi-a:control_change:0:7",
            deviceId: "midi-a",
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

        XCTAssertNil(engine.process(message: neutral, deviceId: "midi-a", routingKey: "route-1", rules: [specific, wildcard]))
        XCTAssertEqual(
            engine.process(message: lowPress, deviceId: "midi-a", routingKey: "route-1", rules: [specific, wildcard]),
            wildcard.ruleKey
        )
        XCTAssertNil(engine.process(message: lowPress, deviceId: "midi-a", routingKey: "route-1", rules: [specific, wildcard]))
        XCTAssertNil(
            engine.process(message: highPress, deviceId: "midi-a", routingKey: "route-1", rules: [specific, wildcard]),
            "One physical press cannot trigger a second overlapping rule"
        )
        XCTAssertNil(engine.process(message: neutral, deviceId: "midi-a", routingKey: "route-1", rules: [specific, wildcard]))
        XCTAssertEqual(
            engine.process(message: highPress, deviceId: "midi-a", routingKey: "route-1", rules: [wildcard, specific]),
            specific.ruleKey,
            "Rule order must not change the specific crossed rule"
        )

        XCTAssertNil(
            engine.process(message: highPress, deviceId: "midi-a", routingKey: "route-2", rules: [specific, wildcard]),
            "A hot-plugged route must prime an already-active control without firing"
        )
        XCTAssertNil(engine.process(message: neutral, deviceId: "midi-a", routingKey: "route-2", rules: [specific, wildcard]))
        XCTAssertEqual(
            engine.process(message: lowPress, deviceId: "midi-a", routingKey: "route-2", rules: [specific, wildcard]),
            wildcard.ruleKey
        )

        let releaseEdge = PresentationMIDIRule(
            ruleKey: "midi:midi-a:control_change:0:7",
            deviceId: "midi-a",
            message: "control_change",
            channel: 0,
            number: 7,
            activation: "zero",
            threshold: 0,
            releaseThreshold: 1
        )
        var mixedEngine = PresentationMIDIRuleEngine()
        XCTAssertNil(mixedEngine.process(message: neutral, deviceId: "midi-a", routingKey: "route-mixed", rules: [wildcard, releaseEdge]))
        XCTAssertEqual(
            mixedEngine.process(message: lowPress, deviceId: "midi-a", routingKey: "route-mixed", rules: [wildcard, releaseEdge]),
            wildcard.ruleKey
        )
        XCTAssertEqual(
            mixedEngine.process(message: neutral, deviceId: "midi-a", routingKey: "route-mixed", rules: [wildcard, releaseEdge]),
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
