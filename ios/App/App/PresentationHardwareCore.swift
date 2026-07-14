import CryptoKit
import Foundation
import CoreMIDI

struct PresentationMIDIChannelMessage: Equatable {
    let message: String
    let channel: Int
    let number: Int
    let value: Int
}

/// A bounded MIDI 1.0 byte-stream parser. Running status survives packet
/// boundaries, real-time bytes never disturb it, and both Note Off and Note On
/// velocity zero become the same release event.
struct PresentationMIDIByteStreamParser {
    private var runningStatus: UInt8?
    private var currentStatus: UInt8?
    private var dataBytes: [UInt8] = []
    private var insideSysEx = false

    mutating func parse(_ bytes: [UInt8]) -> [PresentationMIDIChannelMessage] {
        var messages: [PresentationMIDIChannelMessage] = []
        for byte in bytes {
            if byte >= 0xF8 { continue }
            if byte == 0xF0 {
                insideSysEx = true
                runningStatus = nil
                currentStatus = nil
                dataBytes.removeAll(keepingCapacity: true)
                continue
            }
            if insideSysEx {
                if byte == 0xF7 { insideSysEx = false }
                continue
            }
            if byte >= 0xF0 {
                runningStatus = nil
                currentStatus = nil
                dataBytes.removeAll(keepingCapacity: true)
                continue
            }
            if byte >= 0x80 {
                runningStatus = byte
                currentStatus = byte
                dataBytes.removeAll(keepingCapacity: true)
                continue
            }

            guard let status = currentStatus ?? runningStatus else { continue }
            currentStatus = status
            dataBytes.append(byte)
            let family = status & 0xF0
            let expectedCount = (family == 0xC0 || family == 0xD0) ? 1 : 2
            guard dataBytes.count >= expectedCount else { continue }
            let channel = Int(status & 0x0F)
            if family == 0x80, dataBytes.count >= 2 {
                messages.append(PresentationMIDIChannelMessage(
                    message: "note_on",
                    channel: channel,
                    number: Int(dataBytes[0]),
                    value: 0
                ))
            } else if family == 0x90, dataBytes.count >= 2 {
                messages.append(PresentationMIDIChannelMessage(
                    message: "note_on",
                    channel: channel,
                    number: Int(dataBytes[0]),
                    value: Int(dataBytes[1])
                ))
            } else if family == 0xB0, dataBytes.count >= 2 {
                messages.append(PresentationMIDIChannelMessage(
                    message: "control_change",
                    channel: channel,
                    number: Int(dataBytes[0]),
                    value: Int(dataBytes[1])
                ))
            }
            dataBytes.removeAll(keepingCapacity: true)
            currentStatus = runningStatus
        }
        return messages
    }
}

enum PresentationHardwareIdentity {
    static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// GameController does not expose a public hardware serial on iOS. When a
    /// platform-provided stable identifier is unavailable, identical descriptors
    /// intentionally share one persisted ID instead of receiving order-based IDs.
    static func gamepadID(stableIdentifier: String?, descriptor: String) -> String {
        let stable = normalized(stableIdentifier)
        let material = stable.map { "stable|\($0)" } ?? "descriptor|\(normalized(descriptor) ?? "unknown")"
        return "gamepad-\(digest(material))"
    }

    /// CoreMIDI's non-zero UniqueID is stable across enumeration order and
    /// reconnects. Descriptor-only sources intentionally collapse to a shared ID.
    static func midiID(uniqueID: Int32?, descriptor: String) -> String {
        if let uniqueID, uniqueID != 0 {
            return "midi-\(UInt32(bitPattern: uniqueID))"
        }
        return "midi-\(digest("descriptor|\(normalized(descriptor) ?? "unknown")"))"
    }

    static func isCanonicalGamepadID(_ value: String) -> Bool {
        value.range(of: "^gamepad-[0-9a-f]{64}$", options: .regularExpression) != nil
    }

    static func isCanonicalMIDIID(_ value: String) -> Bool {
        if value.range(of: "^midi-[0-9a-f]{64}$", options: .regularExpression) != nil {
            return true
        }
        guard value.range(of: "^midi-(0|[1-9][0-9]{0,9})$", options: .regularExpression) != nil else {
            return false
        }
        let suffix = String(value.dropFirst("midi-".count))
        guard let numericID = UInt32(suffix) else { return false }
        return String(numericID) == suffix
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized.isEmpty ? nil : normalized
    }
}

struct PresentationHardwareActivationStatus: Equatable {
    let active: Bool
    let message: String?
}

enum PresentationHardwareActivationPolicy {
    static func evaluate(
        monitoringRequested: Bool,
        gamepadEnabled: Bool,
        gamepadStarted: Bool,
        midiEnabled: Bool,
        midiStarted: Bool
    ) -> PresentationHardwareActivationStatus {
        guard monitoringRequested, gamepadEnabled || midiEnabled else {
            return PresentationHardwareActivationStatus(active: false, message: nil)
        }
        let gamepadFailed = gamepadEnabled && !gamepadStarted
        let midiFailed = midiEnabled && !midiStarted
        if gamepadFailed && midiFailed {
            return PresentationHardwareActivationStatus(
                active: false,
                message: "No se pudieron iniciar Gamepad y MIDI. Vuelve a conectar los dispositivos y reactiva las entradas."
            )
        }
        if gamepadFailed {
            return PresentationHardwareActivationStatus(
                active: false,
                message: "No se pudo iniciar Gamepad. Vuelve a conectar el control y reactiva las entradas."
            )
        }
        if midiFailed {
            return PresentationHardwareActivationStatus(
                active: false,
                message: "No se pudo iniciar MIDI. Vuelve a conectar la interfaz y reactiva las entradas."
            )
        }
        return PresentationHardwareActivationStatus(active: true, message: nil)
    }
}

/// Copies flexible-length MIDIPacket payloads without assuming Swift's imported
/// 256-byte tuple is the allocation boundary. CoreMIDI owns and validates the
/// packet list; this adds a separate explicit application payload budget.
enum PresentationMIDIPacketCopier {
    static let maximumPayloadBytes = 65_536
    static let maximumPacketCount = 1_024

    static func copy(
        _ packetList: UnsafePointer<MIDIPacketList>,
        maximumTotalBytes: Int = maximumPayloadBytes
    ) -> [[UInt8]] {
        let packetCount = Int(packetList.pointee.numPackets)
        guard maximumTotalBytes >= 0, packetCount <= maximumPacketCount else { return [] }
        let packetOffset = MemoryLayout<MIDIPacketList>.offset(of: \MIDIPacketList.packet)
            ?? (MemoryLayout<MIDIPacketList>.size - MemoryLayout<MIDIPacket>.size)
        let dataOffset = MemoryLayout<MIDIPacket>.offset(of: \MIDIPacket.data)
            ?? (MemoryLayout<MIDIPacket>.size - MemoryLayout.size(ofValue: packetList.pointee.packet.data))
        var packetPointer = UnsafeMutableRawPointer(mutating: packetList)
            .advanced(by: packetOffset)
            .assumingMemoryBound(to: MIDIPacket.self)
        var totalBytes = 0
        var copied: [[UInt8]] = []
        copied.reserveCapacity(packetCount)

        for _ in 0..<packetCount {
            let count = Int(packetPointer.pointee.length)
            guard count <= maximumTotalBytes - totalBytes else { return [] }
            let bytePointer = UnsafeRawPointer(packetPointer)
                .advanced(by: dataOffset)
                .assumingMemoryBound(to: UInt8.self)
            copied.append(Array(UnsafeBufferPointer(start: bytePointer, count: count)))
            totalBytes += count
            packetPointer = MIDIPacketNext(packetPointer)
        }
        return copied
    }
}

struct PresentationLevelLatchBank {
    private(set) var held: Set<String> = []

    mutating func prime(key: String, value: Float, releaseThreshold: Float) {
        if value <= releaseThreshold {
            held.remove(key)
        } else {
            held.insert(key)
        }
    }

    mutating func edge(
        key: String,
        value: Float,
        pressThreshold: Float,
        releaseThreshold: Float
    ) -> Bool {
        if held.contains(key) {
            if value <= releaseThreshold { held.remove(key) }
            return false
        }
        guard value >= pressThreshold else { return false }
        held.insert(key)
        return true
    }

    mutating func remove(prefix: String) {
        held = held.filter { !$0.hasPrefix(prefix) }
    }

    mutating func removeAll() {
        held.removeAll()
    }
}

struct PresentationMIDIRule: Decodable, Equatable {
    let ruleKey: String
    let deviceId: String?
    let message: String
    let channel: Int?
    let number: Int
    let activation: String
    let threshold: Int
    let releaseThreshold: Int

    var canonicalRuleKey: String {
        let device = deviceId.map { "\($0):" } ?? ""
        return "midi:\(device)\(message):\(channel.map(String.init) ?? "any"):\(number)"
    }

    func matches(_ input: PresentationMIDIChannelMessage, deviceId inputDeviceId: String) -> Bool {
        message == input.message
            && number == input.number
            && (channel == nil || channel == input.channel)
            && (deviceId == nil || deviceId == inputDeviceId)
    }

    func isActive(value: Int) -> Bool {
        activation == "zero" ? value <= threshold : value >= threshold
    }

    func isReleased(value: Int) -> Bool {
        activation == "zero" ? value >= releaseThreshold : value <= releaseThreshold
    }

    var specificity: Int {
        (deviceId == nil ? 0 : 2) + (channel == nil ? 0 : 1)
    }
}

/// Maintains independent runtime routing state while emitting only stable rule
/// identities. A newly observed control is primed without firing and must reach
/// its release side before the next activation edge can emit.
struct PresentationMIDIRuleEngine {
    private var primedControls: Set<String> = []
    private var heldGestures: Set<String> = []
    private var held: Set<String> = []

    mutating func process(
        message: PresentationMIDIChannelMessage,
        deviceId: String,
        routingKey: String,
        rules: [PresentationMIDIRule]
    ) -> String? {
        let matchingRules = rules.filter { $0.matches(message, deviceId: deviceId) }
        guard !matchingRules.isEmpty else { return nil }
        let controlKey = "\(routingKey):\(message.message):\(message.channel):\(message.number)"
        let ruleGroups = Dictionary(grouping: matchingRules) { rule in
            "\(controlKey):\(rule.activation)"
        }
        if !primedControls.contains(controlKey) {
            primedControls.insert(controlKey)
            for (gestureKey, groupRules) in ruleGroups {
                if groupRules.allSatisfy({ $0.isReleased(value: message.value) }) {
                    heldGestures.remove(gestureKey)
                } else {
                    heldGestures.insert(gestureKey)
                }
            }
            for rule in matchingRules {
                let stateKey = "\(routingKey):\(rule.ruleKey)"
                if rule.isReleased(value: message.value) {
                    held.remove(stateKey)
                } else {
                    held.insert(stateKey)
                }
            }
            return nil
        }

        var crossed: [PresentationMIDIRule] = []
        for rule in matchingRules {
            let stateKey = "\(routingKey):\(rule.ruleKey)"
            if held.contains(stateKey) {
                if rule.isReleased(value: message.value) { held.remove(stateKey) }
            } else if rule.isActive(value: message.value) {
                held.insert(stateKey)
                crossed.append(rule)
            }
        }
        var candidates: [PresentationMIDIRule] = []
        for (gestureKey, groupRules) in ruleGroups {
            if heldGestures.contains(gestureKey) {
                if groupRules.allSatisfy({ $0.isReleased(value: message.value) }) {
                    heldGestures.remove(gestureKey)
                }
                continue
            }
            let groupRuleKeys = Set(groupRules.map(\.ruleKey))
            if let candidate = crossed.filter({ groupRuleKeys.contains($0.ruleKey) }).sorted(by: preferredRule).first {
                heldGestures.insert(gestureKey)
                candidates.append(candidate)
            }
        }
        return candidates.sorted(by: preferredRule).first?.ruleKey
    }

    private func preferredRule(_ left: PresentationMIDIRule, _ right: PresentationMIDIRule) -> Bool {
        if left.specificity != right.specificity { return left.specificity > right.specificity }
        return left.ruleKey < right.ruleKey
    }

    mutating func remove(routingKey: String) {
        let prefix = "\(routingKey):"
        primedControls = primedControls.filter { !$0.hasPrefix(prefix) }
        heldGestures = heldGestures.filter { !$0.hasPrefix(prefix) }
        held = held.filter { !$0.hasPrefix(prefix) }
    }

    mutating func removeAll() {
        primedControls.removeAll()
        heldGestures.removeAll()
        held.removeAll()
    }
}
