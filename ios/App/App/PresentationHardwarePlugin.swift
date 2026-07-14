import Foundation
import UIKit
import Capacitor
import GameController
import CoreMIDI

private let supportedGamepadControls: Set<String> = [
    "button_a", "button_b", "button_x", "button_y",
    "left_shoulder", "right_shoulder", "left_trigger", "right_trigger",
    "left_thumbstick_button", "right_thumbstick_button",
    "dpad_up", "dpad_down", "dpad_left", "dpad_right",
    "left_stick_up", "left_stick_down", "left_stick_left", "left_stick_right",
    "right_stick_up", "right_stick_down", "right_stick_left", "right_stick_right"
]

private struct GamepadRule: Decodable {
    let deviceId: String?
    let control: String
}

private struct MIDIRule: Decodable {
    let deviceId: String?
    let message: String
    let channel: Int?
    let number: Int
    let activation: String
    let threshold: Int
    let releaseThreshold: Int

    var latchKey: String {
        "\(deviceId ?? "any"):\(message):\(channel.map(String.init) ?? "any"):\(number)"
    }
}

private struct StartOptions: Decodable {
    let gamepadEnabled: Bool
    let midiEnabled: Bool
    let gamepadBindings: [GamepadRule]
    let midiBindings: [MIDIRule]
}

private struct MIDIChannelMessage {
    let message: String
    let channel: Int
    let number: Int
    let value: Int
}

/// A bounded MIDI 1.0 byte-stream parser. Running status survives packet boundaries,
/// real-time bytes do not disturb it, and Note On velocity zero becomes a release.
private struct MIDIByteStreamParser {
    private var runningStatus: UInt8?
    private var currentStatus: UInt8?
    private var dataBytes: [UInt8] = []
    private var insideSysEx = false

    mutating func parse(_ bytes: [UInt8]) -> [MIDIChannelMessage] {
        var messages: [MIDIChannelMessage] = []
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
                messages.append(MIDIChannelMessage(message: "note_on", channel: channel, number: Int(dataBytes[0]), value: 0))
            } else if family == 0x90, dataBytes.count >= 2 {
                messages.append(MIDIChannelMessage(message: "note_on", channel: channel, number: Int(dataBytes[0]), value: Int(dataBytes[1])))
            } else if family == 0xB0, dataBytes.count >= 2 {
                messages.append(MIDIChannelMessage(message: "control_change", channel: channel, number: Int(dataBytes[0]), value: Int(dataBytes[1])))
            }
            dataBytes.removeAll(keepingCapacity: true)
            currentStatus = runningStatus
        }
        return messages
    }
}

private final class MIDISourceContext {
    let deviceId: String
    let deviceName: String

    init(deviceId: String, deviceName: String) {
        self.deviceId = deviceId
        self.deviceName = deviceName
    }
}

@objc(PresentationHardwarePlugin)
public final class PresentationHardwarePlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "PresentationHardwarePlugin"
    public let jsName = "PresentationHardware"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginLearning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelLearning", returnType: CAPPluginReturnPromise)
    ]

    private var monitoringRequested = false
    private var monitoringActive = false
    private var gamepadEnabled = false
    private var midiEnabled = false
    private var gamepadRules: [GamepadRule] = []
    private var midiRules: [MIDIRule] = []
    private var statusMessage: String?

    private var lifecycleObservers: [NSObjectProtocol] = []
    private var gamepadObservers: [NSObjectProtocol] = []
    private var gamepadIds: [ObjectIdentifier: String] = [:]
    private var gamepadLatches: Set<String> = []

    private var midiClient = MIDIClientRef()
    private var midiPort = MIDIPortRef()
    private var midiContexts: [MIDIEndpointRef: MIDISourceContext] = [:]
    private var midiContextPointers: [MIDIEndpointRef: UnsafeMutableRawPointer] = [:]
    private var midiParsers: [String: MIDIByteStreamParser] = [:]
    private var midiLatches: Set<String> = []

    private var learningSource: String?
    private var learningTimeout: DispatchWorkItem?

    @objc override public func load() {
        installLifecycleObservers()
    }

    deinit {
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        gamepadObservers.forEach(NotificationCenter.default.removeObserver)
        GCController.stopWirelessControllerDiscovery()
        teardownMIDI()
    }

    @objc public func start(_ call: CAPPluginCall) {
        let options: StartOptions
        do {
            options = try call.decode(StartOptions.self)
        } catch {
            call.reject("Configuración de entradas inválida.", "INVALID_CONFIGURATION")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return call.reject("Bridge no disponible.", "UNAVAILABLE") }
            self.deactivate(reason: "stopped", endLearning: true)
            self.gamepadEnabled = options.gamepadEnabled
            self.midiEnabled = options.midiEnabled
            self.gamepadRules = Array(options.gamepadBindings.prefix(32)).filter {
                supportedGamepadControls.contains($0.control) && self.validDeviceId($0.deviceId)
            }
            self.midiRules = Array(options.midiBindings.prefix(32)).filter { self.validMIDIRule($0) }
            self.monitoringRequested = self.gamepadEnabled || self.midiEnabled
            self.statusMessage = nil
            self.activateIfPossible()
            call.resolve(self.statusPayload())
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return call.resolve() }
            self.monitoringRequested = false
            self.deactivate(reason: "stopped", endLearning: true)
            self.statusMessage = nil
            call.resolve(self.statusPayload())
        }
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            call.resolve(self?.statusPayload() ?? [
                "active": false,
                "gamepads": [],
                "midiSources": [],
                "learningSource": NSNull(),
                "message": "Bridge no disponible."
            ])
        }
    }

    @objc public func beginLearning(_ call: CAPPluginCall) {
        let source = call.getString("source") ?? ""
        let timeoutMs = min(30_000, max(3_000, call.getInt("timeoutMs") ?? 10_000))
        DispatchQueue.main.async { [weak self] in
            guard let self else { return call.reject("Bridge no disponible.", "UNAVAILABLE") }
            guard self.monitoringActive else {
                call.reject("Tchurch debe estar visible y en primer plano.", "NOT_ACTIVE")
                return
            }
            guard (source == "gamepad" && self.gamepadEnabled) || (source == "midi" && self.midiEnabled) else {
                call.reject("Activa esa fuente antes de aprender.", "SOURCE_DISABLED")
                return
            }
            self.finishLearning(reason: "cancelled", notify: self.learningSource != nil)
            self.learningSource = source
            self.gamepadLatches.removeAll()
            self.midiLatches.removeAll()
            let timeout = DispatchWorkItem { [weak self] in
                self?.finishLearning(reason: "timeout", notify: true)
            }
            self.learningTimeout = timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: timeout)
            self.emitStatus()
            call.resolve(self.statusPayload())
        }
    }

    @objc public func cancelLearning(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return call.resolve() }
            self.finishLearning(reason: "cancelled", notify: self.learningSource != nil)
            call.resolve(self.statusPayload())
        }
    }

    private func installLifecycleObservers() {
        guard lifecycleObservers.isEmpty else { return }
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.deactivate(reason: "background", endLearning: true)
            self?.statusMessage = "En espera: Tchurch está en segundo plano."
            self?.emitStatus()
        })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.statusMessage = nil
            self?.activateIfPossible()
        })
    }

    private func activateIfPossible() {
        guard monitoringRequested, UIApplication.shared.applicationState == .active else {
            monitoringActive = false
            emitStatus()
            return
        }
        monitoringActive = true
        if gamepadEnabled { setupGamepads() }
        if midiEnabled { setupMIDI() }
        emitStatus()
    }

    private func deactivate(reason: String, endLearning: Bool) {
        if endLearning { finishLearning(reason: reason, notify: learningSource != nil) }
        teardownGamepads()
        teardownMIDI()
        gamepadLatches.removeAll()
        midiLatches.removeAll()
        monitoringActive = false
    }

    private func setupGamepads() {
        guard gamepadObservers.isEmpty else {
            refreshGamepads()
            return
        }
        gamepadObservers.append(NotificationCenter.default.addObserver(
            forName: .GCControllerDidConnect,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.refreshGamepads() })
        gamepadObservers.append(NotificationCenter.default.addObserver(
            forName: .GCControllerDidDisconnect,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let controller = notification.object as? GCController {
                self?.detachGamepad(controller)
            }
            self?.refreshGamepads()
        })
        GCController.startWirelessControllerDiscovery(completionHandler: nil)
        refreshGamepads()
    }

    private func teardownGamepads() {
        GCController.stopWirelessControllerDiscovery()
        gamepadObservers.forEach(NotificationCenter.default.removeObserver)
        gamepadObservers.removeAll()
        GCController.controllers().forEach(detachGamepad)
        gamepadIds.removeAll()
    }

    private func refreshGamepads() {
        guard monitoringActive, gamepadEnabled else { return }
        for controller in GCController.controllers() {
            attachGamepad(controller)
        }
        emitStatus()
    }

    private func attachGamepad(_ controller: GCController) {
        _ = gamepadId(for: controller)
        if let profile = controller.extendedGamepad {
            profile.valueChangedHandler = { [weak self, weak controller] _, _ in
                guard let controller else { return }
                DispatchQueue.main.async { self?.scanGamepad(controller) }
            }
        } else if let profile = controller.microGamepad {
            profile.valueChangedHandler = { [weak self, weak controller] _, _ in
                guard let controller else { return }
                DispatchQueue.main.async { self?.scanGamepad(controller) }
            }
        }
    }

    private func detachGamepad(_ controller: GCController) {
        controller.extendedGamepad?.valueChangedHandler = nil
        controller.microGamepad?.valueChangedHandler = nil
        let identifier = ObjectIdentifier(controller)
        if let deviceId = gamepadIds[identifier] {
            gamepadLatches = gamepadLatches.filter { !$0.hasPrefix("\(deviceId):") }
        }
        gamepadIds.removeValue(forKey: identifier)
    }

    private func scanGamepad(_ controller: GCController) {
        guard monitoringActive, gamepadEnabled else { return }
        let deviceId = gamepadId(for: controller)
        let deviceName = gamepadName(controller)
        if let gamepad = controller.extendedGamepad {
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "button_a", value: gamepad.buttonA.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "button_b", value: gamepad.buttonB.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "button_x", value: gamepad.buttonX.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "button_y", value: gamepad.buttonY.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "left_shoulder", value: gamepad.leftShoulder.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "right_shoulder", value: gamepad.rightShoulder.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "left_trigger", value: gamepad.leftTrigger.value, analog: true)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "right_trigger", value: gamepad.rightTrigger.value, analog: true)
            if let button = gamepad.leftThumbstickButton {
                processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "left_thumbstick_button", value: button.value, analog: false)
            }
            if let button = gamepad.rightThumbstickButton {
                processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "right_thumbstick_button", value: button.value, analog: false)
            }
            scanDirectionPad(gamepad.dpad, prefix: "dpad", deviceId: deviceId, deviceName: deviceName, analog: false)
            scanDirectionPad(gamepad.leftThumbstick, prefix: "left_stick", deviceId: deviceId, deviceName: deviceName, analog: true)
            scanDirectionPad(gamepad.rightThumbstick, prefix: "right_stick", deviceId: deviceId, deviceName: deviceName, analog: true)
        } else if let gamepad = controller.microGamepad {
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "button_a", value: gamepad.buttonA.value, analog: false)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "button_x", value: gamepad.buttonX.value, analog: false)
            scanDirectionPad(gamepad.dpad, prefix: "dpad", deviceId: deviceId, deviceName: deviceName, analog: false)
        }
    }

    private func scanDirectionPad(_ pad: GCControllerDirectionPad, prefix: String, deviceId: String, deviceName: String, analog: Bool) {
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "\(prefix)_up", value: max(0, pad.yAxis.value), analog: analog)
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "\(prefix)_down", value: max(0, -pad.yAxis.value), analog: analog)
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "\(prefix)_left", value: max(0, -pad.xAxis.value), analog: analog)
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, control: "\(prefix)_right", value: max(0, pad.xAxis.value), analog: analog)
    }

    private func processGamepadLevel(deviceId: String, deviceName: String, control: String, value: Float, analog: Bool) {
        guard supportedGamepadControls.contains(control) else { return }
        let key = "\(deviceId):\(control)"
        let pressThreshold: Float = analog ? 0.68 : 0.55
        let releaseThreshold: Float = analog ? 0.42 : 0.35
        if gamepadLatches.contains(key) {
            if value <= releaseThreshold { gamepadLatches.remove(key) }
            return
        }
        guard value >= pressThreshold else { return }
        gamepadLatches.insert(key)
        if let learningSource {
            guard learningSource == "gamepad" else { return }
            notifyListeners("hardwareLearned", data: [
                "source": "gamepad",
                "deviceId": deviceId,
                "deviceName": deviceName,
                "control": control
            ])
            finishLearning(reason: "learned", notify: true)
            return
        }
        guard gamepadRules.contains(where: { $0.control == control && ($0.deviceId == nil || $0.deviceId == deviceId) }) else { return }
        notifyListeners("hardwareInput", data: [
            "source": "gamepad",
            "deviceId": deviceId,
            "deviceName": deviceName,
            "control": control
        ])
    }

    private func gamepadId(for controller: GCController) -> String {
        let objectId = ObjectIdentifier(controller)
        if let existing = gamepadIds[objectId] { return existing }
        let descriptor = "\(controller.vendorName ?? "unknown")|\(controller.productCategory)"
        let base = "gamepad-\(stableDigest(descriptor))"
        let used = Set(gamepadIds.values)
        var ordinal = 1
        while used.contains("\(base)-\(ordinal)") { ordinal += 1 }
        let identifier = "\(base)-\(ordinal)"
        gamepadIds[objectId] = identifier
        return identifier
    }

    private func gamepadName(_ controller: GCController) -> String {
        let vendor = controller.vendorName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return vendor?.isEmpty == false ? vendor! : controller.productCategory
    }

    private func setupMIDI() {
        guard midiClient == 0, midiPort == 0 else {
            rebuildMIDISources()
            return
        }
        var client = MIDIClientRef()
        let clientStatus = MIDIClientCreateWithBlock("Tchurch Presentation MIDI" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async { self?.rebuildMIDISources() }
        }
        guard clientStatus == noErr else {
            statusMessage = "No se pudo abrir CoreMIDI (\(clientStatus))."
            return
        }
        midiClient = client
        var port = MIDIPortRef()
        let portStatus = MIDIInputPortCreateWithBlock(client, "Tchurch Presentation Input" as CFString, &port) { [weak self] packetList, sourceRefCon in
            guard let sourceRefCon else { return }
            let context = Unmanaged<MIDISourceContext>.fromOpaque(sourceRefCon).takeUnretainedValue()
            let deviceId = context.deviceId
            let deviceName = context.deviceName
            let packets = Self.copyMIDIPackets(packetList)
            DispatchQueue.main.async {
                self?.handleMIDIPackets(packets, deviceId: deviceId, deviceName: deviceName)
            }
        }
        guard portStatus == noErr else {
            statusMessage = "No se pudo abrir la entrada MIDI (\(portStatus))."
            MIDIClientDispose(client)
            midiClient = 0
            return
        }
        midiPort = port
        rebuildMIDISources()
    }

    private func teardownMIDI() {
        if midiPort != 0 {
            for endpoint in midiContexts.keys { MIDIPortDisconnectSource(midiPort, endpoint) }
            MIDIPortDispose(midiPort)
        }
        releaseMIDIContextPointers()
        midiContexts.removeAll()
        midiParsers.removeAll()
        if midiClient != 0 { MIDIClientDispose(midiClient) }
        midiPort = 0
        midiClient = 0
    }

    private func rebuildMIDISources() {
        guard monitoringActive, midiEnabled, midiPort != 0 else { return }
        for endpoint in midiContexts.keys { MIDIPortDisconnectSource(midiPort, endpoint) }
        releaseMIDIContextPointers()
        midiContexts.removeAll()
        let count = MIDIGetNumberOfSources()
        for index in 0..<count {
            let endpoint = MIDIGetSource(index)
            guard endpoint != 0 else { continue }
            let info = midiSourceInfo(endpoint: endpoint, index: index)
            let context = MIDISourceContext(deviceId: info.id, deviceName: info.name)
            let pointer = Unmanaged.passRetained(context).toOpaque()
            if MIDIPortConnectSource(midiPort, endpoint, pointer) == noErr {
                midiContexts[endpoint] = context
                midiContextPointers[endpoint] = pointer
            } else {
                Unmanaged<MIDISourceContext>.fromOpaque(pointer).release()
            }
        }
        // Every topology refresh reconnects the sources, so no running status or
        // pressed latch may survive across the old CoreMIDI connection.
        midiParsers.removeAll()
        midiLatches.removeAll()
        emitStatus()
    }

    private static func copyMIDIPackets(_ packetList: UnsafePointer<MIDIPacketList>) -> [[UInt8]] {
        var copied: [[UInt8]] = []
        let packetOffset = MemoryLayout<MIDIPacketList>.offset(of: \MIDIPacketList.packet)
            ?? (MemoryLayout<MIDIPacketList>.size - MemoryLayout<MIDIPacket>.size)
        var packetPointer = UnsafeMutableRawPointer(mutating: packetList)
            .advanced(by: packetOffset)
            .assumingMemoryBound(to: MIDIPacket.self)
        for _ in 0..<packetList.pointee.numPackets {
            let packet = packetPointer.pointee
            let available = MemoryLayout.size(ofValue: packet.data)
            let count = min(Int(packet.length), available)
            let bytes = withUnsafeBytes(of: packet.data) { bytes in
                Array(bytes.prefix(count))
            }
            copied.append(bytes)
            packetPointer = MIDIPacketNext(packetPointer)
        }
        return copied
    }

    private func handleMIDIPackets(_ packets: [[UInt8]], deviceId: String, deviceName: String) {
        guard monitoringActive, midiEnabled else { return }
        var parser = midiParsers[deviceId] ?? MIDIByteStreamParser()
        for bytes in packets {
            for message in parser.parse(bytes) {
                processMIDIMessage(message, deviceId: deviceId, deviceName: deviceName)
            }
        }
        midiParsers[deviceId] = parser
    }

    private func processMIDIMessage(_ message: MIDIChannelMessage, deviceId: String, deviceName: String) {
        guard (0...15).contains(message.channel), (0...127).contains(message.number), (0...127).contains(message.value) else { return }
        if let learningSource {
            guard learningSource == "midi" else { return }
            if message.message == "note_on" && message.value == 0 { return }
            let calibration = midiCalibration(message: message.message, value: message.value)
            notifyListeners("hardwareLearned", data: [
                "source": "midi",
                "deviceId": deviceId,
                "deviceName": deviceName,
                "message": message.message,
                "channel": message.channel,
                "number": message.number,
                "value": message.value,
                "activation": calibration.activation,
                "threshold": calibration.threshold,
                "releaseThreshold": calibration.releaseThreshold
            ])
            finishLearning(reason: "learned", notify: true)
            return
        }

        var shouldEmit = false
        for rule in midiRules where rule.message == message.message
            && rule.number == message.number
            && (rule.channel == nil || rule.channel == message.channel)
            && (rule.deviceId == nil || rule.deviceId == deviceId) {
            let key = "\(deviceId):\(rule.latchKey)"
            let latched = midiLatches.contains(key)
            if rule.activation == "zero" {
                if latched {
                    if message.value >= rule.releaseThreshold { midiLatches.remove(key) }
                } else if message.value <= rule.threshold {
                    midiLatches.insert(key)
                    shouldEmit = true
                }
            } else if latched {
                if message.value <= rule.releaseThreshold { midiLatches.remove(key) }
            } else if message.value >= rule.threshold {
                midiLatches.insert(key)
                shouldEmit = true
            }
        }
        if shouldEmit { emitMIDIInput(message, deviceId: deviceId, deviceName: deviceName) }
    }

    private func emitMIDIInput(_ message: MIDIChannelMessage, deviceId: String, deviceName: String) {
        notifyListeners("hardwareInput", data: [
            "source": "midi",
            "deviceId": deviceId,
            "deviceName": deviceName,
            "message": message.message,
            "channel": message.channel,
            "number": message.number,
            "value": message.value
        ])
    }

    private func midiCalibration(message: String, value: Int) -> (activation: String, threshold: Int, releaseThreshold: Int) {
        if message == "note_on" { return ("positive", 1, 0) }
        if value == 0 { return ("zero", 0, 1) }
        if value == 1 { return ("positive", 1, 0) }
        let threshold = max(2, min(127, Int((Double(value) * 0.65).rounded())))
        return ("positive", threshold, max(0, threshold / 2))
    }

    private func midiSourceInfo(endpoint: MIDIEndpointRef, index: Int) -> (id: String, name: String) {
        let name = midiStringProperty(endpoint, kMIDIPropertyDisplayName)
            ?? midiStringProperty(endpoint, kMIDIPropertyName)
            ?? "Fuente MIDI \(index + 1)"
        var uniqueId: Int32 = 0
        if MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &uniqueId) == noErr, uniqueId != 0 {
            return ("midi-\(UInt32(bitPattern: uniqueId))", name)
        }
        let manufacturer = midiStringProperty(endpoint, kMIDIPropertyManufacturer) ?? "unknown"
        let model = midiStringProperty(endpoint, kMIDIPropertyModel) ?? "unknown"
        return ("midi-\(stableDigest("\(manufacturer)|\(model)|\(name)"))-\(index + 1)", name)
    }

    private func midiStringProperty(_ object: MIDIObjectRef, _ property: CFString) -> String? {
        var value: Unmanaged<CFString>?
        guard MIDIObjectGetStringProperty(object, property, &value) == noErr else { return nil }
        return value?.takeRetainedValue() as String?
    }

    private func releaseMIDIContextPointers() {
        for pointer in midiContextPointers.values {
            Unmanaged<MIDISourceContext>.fromOpaque(pointer).release()
        }
        midiContextPointers.removeAll()
    }

    private func validDeviceId(_ value: String?) -> Bool {
        guard let value else { return true }
        return !value.isEmpty && value.count <= 160 && value.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil
    }

    private func validMIDIRule(_ rule: MIDIRule) -> Bool {
        guard validDeviceId(rule.deviceId), ["note_on", "control_change"].contains(rule.message), (0...127).contains(rule.number), (0...127).contains(rule.threshold), (0...127).contains(rule.releaseThreshold) else { return false }
        if let channel = rule.channel, !(0...15).contains(channel) { return false }
        if rule.activation == "positive" { return rule.releaseThreshold < rule.threshold }
        if rule.activation == "zero" { return rule.releaseThreshold > rule.threshold }
        return false
    }

    private func finishLearning(reason: String, notify: Bool) {
        let source = learningSource
        learningTimeout?.cancel()
        learningTimeout = nil
        learningSource = nil
        if notify {
            notifyListeners("hardwareLearningEnded", data: [
                "source": source ?? NSNull(),
                "reason": reason
            ])
        }
        emitStatus()
    }

    private func statusPayload() -> JSObject {
        let gamepads: [JSObject] = gamepadEnabled ? GCController.controllers().map { controller in
            ["id": gamepadId(for: controller), "name": gamepadName(controller)]
        } : []
        let midiSources: [JSObject] = midiEnabled ? midiContexts.values
            .sorted { $0.deviceName.localizedCaseInsensitiveCompare($1.deviceName) == .orderedAscending }
            .map { ["id": $0.deviceId, "name": $0.deviceName] } : []
        return [
            "active": monitoringActive,
            "gamepads": gamepads,
            "midiSources": midiSources,
            "learningSource": learningSource ?? NSNull(),
            "message": statusMessage ?? NSNull()
        ]
    }

    private func emitStatus() {
        notifyListeners("hardwareStatus", data: statusPayload())
    }

    private func stableDigest(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(hash, radix: 16)
    }
}
