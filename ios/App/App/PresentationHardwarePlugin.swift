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

private struct StartOptions: Decodable {
    let gamepadEnabled: Bool
    let midiEnabled: Bool
    let gamepadBindings: [GamepadRule]
    let midiBindings: [PresentationMIDIRule]
}

private final class MIDISourceContext {
    let deviceId: String
    let deviceName: String
    let routingKey: String

    init(deviceId: String, deviceName: String, routingKey: String) {
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.routingKey = routingKey
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
    private var midiRules: [PresentationMIDIRule] = []
    private var statusMessage: String?

    private var lifecycleObservers: [NSObjectProtocol] = []
    private var gamepadObservers: [NSObjectProtocol] = []
    private var gamepadIds: [ObjectIdentifier: String] = [:]
    private var gamepadRoutingIds: [ObjectIdentifier: String] = [:]
    private var gamepadLatches = PresentationLevelLatchBank()

    private var midiClient = MIDIClientRef()
    private var midiPort = MIDIPortRef()
    private var midiContexts: [MIDIEndpointRef: MIDISourceContext] = [:]
    private var midiContextPointers: [MIDIEndpointRef: UnsafeMutableRawPointer] = [:]
    private var midiParsers: [String: PresentationMIDIByteStreamParser] = [:]
    private var midiRuleEngine = PresentationMIDIRuleEngine()

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
                supportedGamepadControls.contains($0.control) && self.validGamepadID($0.deviceId)
            }
            var seenMIDIRuleKeys = Set<String>()
            self.midiRules = Array(options.midiBindings.prefix(32)).filter {
                self.validMIDIRule($0) && seenMIDIRuleKeys.insert($0.ruleKey).inserted
            }
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
            self.midiRuleEngine.removeAll()
            GCController.controllers().forEach { self.scanGamepad($0, priming: true) }
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
        // Setup callbacks require a provisional active state, but it is never
        // published until every enabled source reports a successful start.
        monitoringActive = true
        let gamepadStarted = !gamepadEnabled || setupGamepads()
        let midiStarted = !midiEnabled || setupMIDI()
        let activation = PresentationHardwareActivationPolicy.evaluate(
            monitoringRequested: monitoringRequested,
            gamepadEnabled: gamepadEnabled,
            gamepadStarted: gamepadStarted,
            midiEnabled: midiEnabled,
            midiStarted: midiStarted
        )
        if !activation.active {
            monitoringActive = false
            deactivate(reason: "stopped", endLearning: true)
        }
        monitoringActive = activation.active
        statusMessage = activation.message
        emitStatus()
    }

    private func deactivate(reason: String, endLearning: Bool) {
        if endLearning { finishLearning(reason: reason, notify: learningSource != nil) }
        teardownGamepads()
        teardownMIDI()
        gamepadLatches.removeAll()
        midiRuleEngine.removeAll()
        monitoringActive = false
    }

    private func setupGamepads() -> Bool {
        guard gamepadObservers.isEmpty else {
            refreshGamepads()
            return true
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
        return true
    }

    private func teardownGamepads() {
        GCController.stopWirelessControllerDiscovery()
        gamepadObservers.forEach(NotificationCenter.default.removeObserver)
        gamepadObservers.removeAll()
        GCController.controllers().forEach(detachGamepad)
        gamepadIds.removeAll()
        gamepadRoutingIds.removeAll()
    }

    private func refreshGamepads() {
        guard monitoringActive, gamepadEnabled else { return }
        for controller in GCController.controllers() {
            attachGamepad(controller)
        }
        emitStatus()
    }

    private func attachGamepad(_ controller: GCController) {
        let objectId = ObjectIdentifier(controller)
        guard gamepadRoutingIds[objectId] == nil else { return }
        _ = gamepadId(for: controller)
        gamepadRoutingIds[objectId] = UUID().uuidString
        if let profile = controller.extendedGamepad {
            profile.valueChangedHandler = { [weak self, weak controller] _, _ in
                guard let controller else { return }
                DispatchQueue.main.async { self?.scanGamepad(controller, priming: false) }
            }
        } else if let profile = controller.microGamepad {
            profile.valueChangedHandler = { [weak self, weak controller] _, _ in
                guard let controller else { return }
                DispatchQueue.main.async { self?.scanGamepad(controller, priming: false) }
            }
        }
        scanGamepad(controller, priming: true)
    }

    private func detachGamepad(_ controller: GCController) {
        controller.extendedGamepad?.valueChangedHandler = nil
        controller.microGamepad?.valueChangedHandler = nil
        let identifier = ObjectIdentifier(controller)
        if let routingKey = gamepadRoutingIds[identifier] {
            gamepadLatches.remove(prefix: "\(routingKey):")
        }
        gamepadIds.removeValue(forKey: identifier)
        gamepadRoutingIds.removeValue(forKey: identifier)
    }

    private func scanGamepad(_ controller: GCController, priming: Bool) {
        guard monitoringActive, gamepadEnabled else { return }
        let deviceId = gamepadId(for: controller)
        let deviceName = gamepadName(controller)
        guard let routingKey = gamepadRoutingIds[ObjectIdentifier(controller)] else { return }
        if let gamepad = controller.extendedGamepad {
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "button_a", value: gamepad.buttonA.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "button_b", value: gamepad.buttonB.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "button_x", value: gamepad.buttonX.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "button_y", value: gamepad.buttonY.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "left_shoulder", value: gamepad.leftShoulder.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "right_shoulder", value: gamepad.rightShoulder.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "left_trigger", value: gamepad.leftTrigger.value, analog: true, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "right_trigger", value: gamepad.rightTrigger.value, analog: true, priming: priming)
            if let button = gamepad.leftThumbstickButton {
                processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "left_thumbstick_button", value: button.value, analog: false, priming: priming)
            }
            if let button = gamepad.rightThumbstickButton {
                processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "right_thumbstick_button", value: button.value, analog: false, priming: priming)
            }
            scanDirectionPad(gamepad.dpad, prefix: "dpad", deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, analog: false, priming: priming)
            scanDirectionPad(gamepad.leftThumbstick, prefix: "left_stick", deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, analog: true, priming: priming)
            scanDirectionPad(gamepad.rightThumbstick, prefix: "right_stick", deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, analog: true, priming: priming)
        } else if let gamepad = controller.microGamepad {
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "button_a", value: gamepad.buttonA.value, analog: false, priming: priming)
            processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "button_x", value: gamepad.buttonX.value, analog: false, priming: priming)
            scanDirectionPad(gamepad.dpad, prefix: "dpad", deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, analog: false, priming: priming)
        }
    }

    private func scanDirectionPad(_ pad: GCControllerDirectionPad, prefix: String, deviceId: String, deviceName: String, routingKey: String, analog: Bool, priming: Bool) {
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "\(prefix)_up", value: max(0, pad.yAxis.value), analog: analog, priming: priming)
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "\(prefix)_down", value: max(0, -pad.yAxis.value), analog: analog, priming: priming)
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "\(prefix)_left", value: max(0, -pad.xAxis.value), analog: analog, priming: priming)
        processGamepadLevel(deviceId: deviceId, deviceName: deviceName, routingKey: routingKey, control: "\(prefix)_right", value: max(0, pad.xAxis.value), analog: analog, priming: priming)
    }

    private func processGamepadLevel(deviceId: String, deviceName: String, routingKey: String, control: String, value: Float, analog: Bool, priming: Bool) {
        guard PresentationHardwareIdentity.isCanonicalGamepadID(deviceId), supportedGamepadControls.contains(control) else { return }
        let key = "\(routingKey):\(control)"
        let pressThreshold: Float = analog ? 0.68 : 0.55
        let releaseThreshold: Float = analog ? 0.42 : 0.35
        if priming {
            gamepadLatches.prime(key: key, value: value, releaseThreshold: releaseThreshold)
            return
        }
        guard gamepadLatches.edge(key: key, value: value, pressThreshold: pressThreshold, releaseThreshold: releaseThreshold) else { return }
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
        let elementNames = controller.physicalInputProfile.elements.keys.sorted().joined(separator: ",")
        let descriptor = "\(controller.vendorName ?? "unknown")|\(controller.productCategory)|\(elementNames)"
        let identifier = PresentationHardwareIdentity.gamepadID(stableIdentifier: nil, descriptor: descriptor)
        gamepadIds[objectId] = identifier
        return identifier
    }

    private func gamepadName(_ controller: GCController) -> String {
        let vendor = controller.vendorName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return vendor?.isEmpty == false ? vendor! : controller.productCategory
    }

    private func setupMIDI() -> Bool {
        guard midiClient == 0, midiPort == 0 else {
            rebuildMIDISources()
            return true
        }
        var client = MIDIClientRef()
        let clientStatus = MIDIClientCreateWithBlock("Tchurch Presentation MIDI" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async { self?.rebuildMIDISources() }
        }
        guard clientStatus == noErr else {
            return false
        }
        midiClient = client
        var port = MIDIPortRef()
        let portStatus = MIDIInputPortCreateWithBlock(client, "Tchurch Presentation Input" as CFString, &port) { [weak self] packetList, sourceRefCon in
            guard let sourceRefCon else { return }
            let context = Unmanaged<MIDISourceContext>.fromOpaque(sourceRefCon).takeUnretainedValue()
            let deviceId = context.deviceId
            let deviceName = context.deviceName
            let routingKey = context.routingKey
            let packets = PresentationMIDIPacketCopier.copy(packetList)
            DispatchQueue.main.async {
                self?.handleMIDIPackets(packets, deviceId: deviceId, deviceName: deviceName, routingKey: routingKey)
            }
        }
        guard portStatus == noErr else {
            MIDIClientDispose(client)
            midiClient = 0
            return false
        }
        midiPort = port
        rebuildMIDISources()
        return true
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
            let info = midiSourceInfo(endpoint: endpoint)
            let context = MIDISourceContext(deviceId: info.id, deviceName: info.name, routingKey: UUID().uuidString)
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
        midiRuleEngine.removeAll()
        emitStatus()
    }

    private func handleMIDIPackets(_ packets: [[UInt8]], deviceId: String, deviceName: String, routingKey: String) {
        guard monitoringActive, midiEnabled else { return }
        var parser = midiParsers[routingKey] ?? PresentationMIDIByteStreamParser()
        for bytes in packets {
            for message in parser.parse(bytes) {
                processMIDIMessage(message, deviceId: deviceId, deviceName: deviceName, routingKey: routingKey)
            }
        }
        midiParsers[routingKey] = parser
    }

    private func processMIDIMessage(_ message: PresentationMIDIChannelMessage, deviceId: String, deviceName: String, routingKey: String) {
        guard PresentationHardwareIdentity.isCanonicalMIDIID(deviceId), (0...15).contains(message.channel), (0...127).contains(message.number), (0...127).contains(message.value) else { return }
        let selectedRuleKey = midiRuleEngine.process(
            message: message,
            deviceId: deviceId,
            routingKey: routingKey,
            rules: midiRules
        )
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
        if let selectedRuleKey {
            emitMIDIInput(message, deviceId: deviceId, deviceName: deviceName, ruleKey: selectedRuleKey)
        }
    }

    private func emitMIDIInput(_ message: PresentationMIDIChannelMessage, deviceId: String, deviceName: String, ruleKey: String) {
        notifyListeners("hardwareInput", data: [
            "source": "midi",
            "deviceId": deviceId,
            "deviceName": deviceName,
            "ruleKey": ruleKey,
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

    private func midiSourceInfo(endpoint: MIDIEndpointRef) -> (id: String, name: String) {
        let name = midiStringProperty(endpoint, kMIDIPropertyDisplayName)
            ?? midiStringProperty(endpoint, kMIDIPropertyName)
            ?? "Fuente MIDI"
        if let uniqueId = midiUniqueId(endpoint) {
            return (PresentationHardwareIdentity.midiID(uniqueID: uniqueId, descriptor: name), name)
        }
        let manufacturer = midiStringProperty(endpoint, kMIDIPropertyManufacturer) ?? "unknown"
        let model = midiStringProperty(endpoint, kMIDIPropertyModel) ?? "unknown"
        var entity = MIDIEntityRef()
        _ = MIDIEndpointGetEntity(endpoint, &entity)
        var device = MIDIDeviceRef()
        if entity != 0 { _ = MIDIEntityGetDevice(entity, &device) }
        let parentIdentity = [midiUniqueId(device), midiUniqueId(entity)]
            .compactMap { $0 }
            .map { String(UInt32(bitPattern: $0)) }
            .joined(separator: "|")
        let descriptor = "\(parentIdentity)|\(manufacturer)|\(model)|\(name)"
        return (PresentationHardwareIdentity.midiID(uniqueID: nil, descriptor: descriptor), name)
    }

    private func midiUniqueId(_ object: MIDIObjectRef) -> Int32? {
        guard object != 0 else { return nil }
        var uniqueId: Int32 = 0
        guard MIDIObjectGetIntegerProperty(object, kMIDIPropertyUniqueID, &uniqueId) == noErr, uniqueId != 0 else { return nil }
        return uniqueId
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

    private func validGamepadID(_ value: String?) -> Bool {
        guard let value else { return true }
        return PresentationHardwareIdentity.isCanonicalGamepadID(value)
    }

    private func validMIDIID(_ value: String?) -> Bool {
        guard let value else { return true }
        return PresentationHardwareIdentity.isCanonicalMIDIID(value)
    }

    private func validMIDIRule(_ rule: PresentationMIDIRule) -> Bool {
        guard rule.ruleKey == rule.canonicalRuleKey, rule.ruleKey.count <= 240, validMIDIID(rule.deviceId), ["note_on", "control_change"].contains(rule.message), (0...127).contains(rule.number), (0...127).contains(rule.threshold), (0...127).contains(rule.releaseThreshold) else { return false }
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
        let gamepads: [JSObject] = gamepadEnabled ? GCController.controllers().compactMap { controller in
            let id = gamepadId(for: controller)
            guard PresentationHardwareIdentity.isCanonicalGamepadID(id) else { return nil }
            return ["id": id, "name": gamepadName(controller)]
        } : []
        let midiSources: [JSObject] = midiEnabled ? midiContexts.values
            .filter { PresentationHardwareIdentity.isCanonicalMIDIID($0.deviceId) }
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

}
