import Capacitor
import Foundation
import UIKit

@objc(StudioLANClientPlugin)
public final class StudioLANClientPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "StudioLANClientPlugin"
    public let jsName = "StudioLANClient"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendRemoteCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendOperatorTimerCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(
            name: "sendLocalBroadcastLowerThirdCommand",
            returnType: CAPPluginReturnPromise
        ),
        CAPPluginMethod(name: "sendLocalOBSSceneCommand", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestDeviceReapproval", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forgetPairing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purgePrivateState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "synchronizePrivacyContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDisplayAwake", returnType: CAPPluginReturnPromise),
    ]

    private let client: TchurchStudioLANClient?
    private var latestStatus = TchurchStudioLANClientStatus(
        phase: .idle,
        services: [],
        selectedServiceID: nil,
        channel: nil,
        paired: false,
        message: nil
    )
    private var lifecycleObservers: [NSObjectProtocol] = []
    private var displayAwake = false

    override public init() {
        client = try? TchurchStudioLANClient()
        super.init()
    }

    @objc override public func load() {
        client?.statusHandler = { [weak self] status in
            DispatchQueue.main.async { self?.publish(status) }
        }
        client?.envelopeHandler = { [weak self] envelope in
            DispatchQueue.main.async { self?.publish(envelope) }
        }
        client?.imageAssetHandler = { [weak self] status in
            DispatchQueue.main.async { self?.publish(status) }
        }
        client?.remoteFeedbackHandler = { [weak self] feedback in
            DispatchQueue.main.async { self?.publish(feedback) }
        }
        client?.operatorTimerFeedbackHandler = { [weak self] feedback in
            DispatchQueue.main.async { self?.publish(feedback) }
        }
        client?.localBroadcastLowerThirdFeedbackHandler = { [weak self] feedback in
            DispatchQueue.main.async { self?.publish(feedback) }
        }
        client?.localOBSSceneFeedbackHandler = { [weak self] feedback in
            DispatchQueue.main.async { self?.publish(feedback) }
        }
        client?.cueCatalogHandler = { [weak self] status in
            DispatchQueue.main.async { self?.publish(status) }
        }
        installLifecycleObservers()
        client?.resumePendingPrivacyPurge()
    }

    deinit {
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        client?.disconnect()
        client?.stopDiscovery()
        if displayAwake {
            DispatchQueue.main.async {
                UIApplication.shared.isIdleTimerDisabled = false
            }
        }
    }

    @objc public func startDiscovery(_ call: CAPPluginCall) {
        guard let client = client else {
            call.reject("La conexión LAN no está disponible.", "UNAVAILABLE")
            return
        }
        client.startDiscovery()
        call.resolve(["accepted": true])
    }

    @objc public func stopDiscovery(_ call: CAPPluginCall) {
        client?.stopDiscovery()
        call.resolve(["accepted": true])
    }

    @objc public func connect(_ call: CAPPluginCall) {
        guard let client = client else {
            call.reject("La conexión LAN no está disponible.", "UNAVAILABLE")
            return
        }
        let serviceID = call.getString("serviceId")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let channelValue = call.getString("channel") ?? "stage"
        let roleValue = call.getString("requestedRole") ?? {
            switch channelValue {
            case "audience": "audience"
            case "control": "production"
            default: "musicians"
            }
        }()
        guard !serviceID.isEmpty,
              let channel = TchurchStudioLANChannel(rawValue: channelValue),
              channel.isSupportedSubscription,
              let role = StudioLANDeviceRole(rawValue: roleValue),
              role.channel == channel,
              channel != .control || role == .production else {
            call.reject("Selecciona un Studio y una salida válida.", "INVALID_CONFIGURATION")
            return
        }
        client.connect(
            serviceID: serviceID,
            channel: channel,
            pairingCode: call.getString("pairingCode"),
            requestedRole: role
        )
        call.resolve(["accepted": true])
    }

    @objc public func sendRemoteCommand(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("El control LAN no está disponible.", "UNAVAILABLE")
            return
        }
        let cueID = call.getString("cueId")
        let enabled = call.getBool("enabled")
        let action: TchurchStudioLANRemoteAction
        switch call.getString("kind").flatMap(TchurchStudioLANRemoteActionKind.init(rawValue:)) {
        case .next where cueID == nil && enabled == nil:
            action = .next
        case .previous where cueID == nil && enabled == nil:
            action = .previous
        case .jump where enabled == nil:
            guard let cueID else {
                call.reject("Selecciona una diapositiva válida.", "INVALID_ACTION")
                return
            }
            action = .jump(cueID: cueID)
        case .setBlackout where cueID == nil:
            guard let enabled else {
                call.reject("Selecciona el estado de blackout.", "INVALID_ACTION")
                return
            }
            action = .setBlackout(enabled)
        default:
            call.reject("Este control no está permitido.", "INVALID_ACTION")
            return
        }
        guard action.isValid else {
            call.reject("Este control no está permitido.", "INVALID_ACTION")
            return
        }
        client.sendRemoteCommand(action: action) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let commandID):
                    call.resolve([
                        "accepted": true,
                        "commandId": commandID.uuidString.lowercased(),
                    ])
                case .failure(TchurchStudioLANRemoteControlError.commandInFlight):
                    call.reject("Espera la confirmación del control anterior.", "COMMAND_IN_FLIGHT")
                case .failure(TchurchStudioLANRemoteControlError.invalidAction):
                    call.reject("Este control no está permitido.", "INVALID_ACTION")
                case .failure(TchurchStudioLANRemoteControlError.unauthorized):
                    call.reject("Studio todavía no autorizó este control.", "UNAUTHORIZED")
                case .failure:
                    call.reject("El control LAN no está disponible.", "UNAVAILABLE")
                }
            }
        }
    }

    @objc public func sendOperatorTimerCommand(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("El control LAN no está disponible.", "UNAVAILABLE")
            return
        }
        guard let scope = call.getString("scope")
                .flatMap(TchurchStudioLANOperatorTimerScope.init(rawValue:)),
              let operation = call.getString("operation")
                .flatMap(TchurchStudioLANOperatorTimerOperation.init(rawValue:)) else {
            call.reject("Este timer de Producción no está permitido.", "INVALID_ACTION")
            return
        }
        let action = TchurchStudioLANOperatorTimerAction.set(
            scope: scope,
            operation: operation
        )
        client.sendOperatorTimerCommand(action: action) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let commandID):
                    call.resolve([
                        "accepted": true,
                        "commandId": commandID.uuidString.lowercased(),
                    ])
                case .failure(TchurchStudioLANRemoteControlError.commandInFlight):
                    call.reject(
                        "Espera la confirmación del control anterior.",
                        "COMMAND_IN_FLIGHT"
                    )
                case .failure(TchurchStudioLANRemoteControlError.invalidAction):
                    call.reject(
                        "Este timer de Producción no está permitido.",
                        "INVALID_ACTION"
                    )
                case .failure(TchurchStudioLANRemoteControlError.unauthorized):
                    call.reject("Studio todavía no autorizó este timer.", "UNAUTHORIZED")
                case .failure:
                    call.reject("El control LAN no está disponible.", "UNAVAILABLE")
                }
            }
        }
    }

    @objc public func sendLocalBroadcastLowerThirdCommand(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("El control LAN no está disponible.", "UNAVAILABLE")
            return
        }
        guard call.getString("kind") ==
                TchurchStudioLANLocalBroadcastLowerThirdActionKind
                    .localBroadcastLowerThird.rawValue,
              let operation = call.getString("operation").flatMap(
                TchurchStudioLANLocalBroadcastLowerThirdOperation.init(rawValue:)
              ) else {
            call.reject("Este lower third local no está permitido.", "INVALID_ACTION")
            return
        }
        let title = call.getString("title")
        let subtitle = call.getString("subtitle")
        let action: TchurchStudioLANLocalBroadcastLowerThirdAction
        switch operation {
        case .show:
            guard let title else {
                call.reject("Escribe un título válido.", "INVALID_ACTION")
                return
            }
            action = .show(title: title, subtitle: subtitle)
        case .hide:
            guard title == nil, subtitle == nil else {
                call.reject("Este lower third local no está permitido.", "INVALID_ACTION")
                return
            }
            action = .hide
        }
        guard action.isValid else {
            call.reject("Este lower third local no está permitido.", "INVALID_ACTION")
            return
        }
        client.sendLocalBroadcastLowerThirdCommand(action: action) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let commandID):
                    call.resolve([
                        "accepted": true,
                        "commandId": commandID.uuidString.lowercased(),
                    ])
                case .failure(TchurchStudioLANRemoteControlError.commandInFlight):
                    call.reject(
                        "Espera la confirmación del control anterior.",
                        "COMMAND_IN_FLIGHT"
                    )
                case .failure(TchurchStudioLANRemoteControlError.invalidAction):
                    call.reject(
                        "Este lower third local no está permitido.",
                        "INVALID_ACTION"
                    )
                case .failure(TchurchStudioLANRemoteControlError.unauthorized):
                    call.reject(
                        "Studio todavía no autorizó este lower third.",
                        "UNAUTHORIZED"
                    )
                case .failure:
                    call.reject("El control LAN no está disponible.", "UNAVAILABLE")
                }
            }
        }
    }

    @objc public func sendLocalOBSSceneCommand(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("El control OBS local no está disponible.", "UNAVAILABLE")
            return
        }
        guard call.getString("kind") ==
                TchurchStudioLANLocalOBSSceneActionKind.selectLocalOBSScene.rawValue,
              let sceneID = call.getString("sceneId") else {
            call.reject("Selecciona una escena OBS firmada.", "INVALID_ACTION")
            return
        }
        let action = TchurchStudioLANLocalOBSSceneAction.select(sceneID: sceneID)
        guard action.isValid else {
            call.reject("Selecciona una escena OBS firmada.", "INVALID_ACTION")
            return
        }
        client.sendLocalOBSSceneCommand(action: action) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let commandID):
                    call.resolve([
                        "accepted": true,
                        "commandId": commandID.uuidString.lowercased(),
                    ])
                case .failure(TchurchStudioLANRemoteControlError.commandInFlight):
                    call.reject(
                        "Espera la confirmación del control anterior.",
                        "COMMAND_IN_FLIGHT"
                    )
                case .failure(TchurchStudioLANRemoteControlError.invalidAction):
                    call.reject("Selecciona una escena OBS firmada.", "INVALID_ACTION")
                case .failure(TchurchStudioLANRemoteControlError.unauthorized):
                    call.reject(
                        "Studio todavía no autorizó el control OBS local.",
                        "UNAUTHORIZED"
                    )
                case .failure:
                    call.reject("El control OBS local no está disponible.", "UNAVAILABLE")
                }
            }
        }
    }

    @objc public func disconnect(_ call: CAPPluginCall) {
        client?.disconnect()
        call.resolve(["accepted": true])
    }

    @objc public func requestDeviceReapproval(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("La conexión LAN no está disponible.", "UNAVAILABLE")
            return
        }
        client.requestDeviceReapproval { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let deviceID):
                    call.resolve([
                        "accepted": true,
                        "deviceId": deviceID.uuidString.lowercased(),
                    ])
                case .failure:
                    call.reject(
                        "No se pudo crear una identidad nueva para aprobación.",
                        "REAPPROVAL_FAILED"
                    )
                }
            }
        }
    }

    @objc public func forgetPairing(_ call: CAPPluginCall) {
        let serviceID = call.getString("serviceId")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !serviceID.isEmpty else {
            call.reject("Selecciona un Studio.", "INVALID_CONFIGURATION")
            return
        }
        client?.forgetPairing(serviceID: serviceID)
        call.resolve(["accepted": true])
    }

    @objc public func getStatus(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("Bridge no disponible.", "UNAVAILABLE")
            return
        }
        client.currentStatus { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return call.reject("Bridge no disponible.", "UNAVAILABLE") }
                self.latestStatus = status
                call.resolve(self.statusPayload(status))
            }
        }
    }

    @objc public func purgePrivateState(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("La conexión LAN no está disponible.", "UNAVAILABLE")
            return
        }
        client.purgePrivateState { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    call.resolve(["accepted": true])
                case .failure:
                    call.reject("No se pudo borrar el estado privado de Studio.", "PURGE_FAILED")
                }
            }
        }
    }

    @objc public func synchronizePrivacyContext(_ call: CAPPluginCall) {
        guard let client else {
            call.reject("La conexión LAN no está disponible.", "UNAVAILABLE")
            return
        }
        guard let accessValue = call.getString("access"),
              let access = TchurchStudioLANPrivacyAccess(rawValue: accessValue) else {
            call.reject("El contexto privado no es válido.", "INVALID_CONFIGURATION")
            return
        }
        client.synchronizePrivacyContext(
            access: access,
            principalID: call.getString("principalId"),
            churchID: call.getString("churchId")
        ) { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    call.resolve(["accepted": true])
                case .failure:
                    call.reject("No se pudo proteger el estado privado de Studio.", "PRIVACY_SYNC_FAILED")
                }
            }
        }
    }

    @objc public func setDisplayAwake(_ call: CAPPluginCall) {
        let active = call.getBool("active") ?? false
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.reject("Bridge no disponible.", "UNAVAILABLE")
                return
            }
            self.displayAwake = active
            UIApplication.shared.isIdleTimerDisabled = active
            call.resolve(["accepted": true])
        }
    }

    private func installLifecycleObservers() {
        guard lifecycleObservers.isEmpty else { return }
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.client?.suspend() })
        lifecycleObservers.append(NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in self?.client?.resume() })
    }

    private func publish(_ status: TchurchStudioLANClientStatus) {
        latestStatus = status
        notifyListeners("studioLANStatus", data: statusPayload(status))
    }

    private func publish(_ envelope: TchurchStudioLANSignedEnvelope) {
        notifyListeners("studioLANUpdate", data: envelopePayload(envelope))
    }

    private func publish(_ status: TchurchStudioLANImageAssetStatus) {
        let portableURL = status.fileURL
            .flatMap { bridge?.portablePath(fromLocalURL: $0) }
            .map(\.absoluteString)
        notifyListeners("studioLANImageAsset", data: [
            "cueId": status.cueID,
            "objectId": status.objectID,
            "phase": status.phase.rawValue,
            "receivedBytes": String(status.receivedBytes),
            "totalBytes": String(status.totalBytes),
            "imageFit": status.imageFit.rawValue,
            "localUrl": portableURL ?? NSNull(),
            "message": status.message ?? NSNull(),
        ])
    }

    private func publish(_ feedback: TchurchStudioLANRemoteFeedback) {
        notifyListeners("studioLANRemoteFeedback", data: [
            "commandId": feedback.commandID.uuidString.lowercased(),
            "kind": feedback.action.kind.rawValue,
            "cueId": feedback.action.cueID ?? NSNull(),
            "enabled": feedback.action.enabled ?? NSNull(),
            "state": feedback.state.rawValue,
            "rejection": feedback.rejection?.rawValue ?? NSNull(),
            "revision": feedback.revision.map(String.init) ?? NSNull(),
            "wasIdempotentReplay": feedback.wasIdempotentReplay,
        ])
    }

    private func publish(_ feedback: TchurchStudioLANOperatorTimerFeedback) {
        notifyListeners("studioLANOperatorTimerFeedback", data: [
            "commandId": feedback.commandID.uuidString.lowercased(),
            "kind": feedback.action.kind.rawValue,
            "scope": feedback.action.scope.rawValue,
            "operation": feedback.action.operation.rawValue,
            "state": feedback.state.rawValue,
            "rejection": feedback.rejection?.rawValue ?? NSNull(),
            "timerRevision": feedback.timerRevision.map(String.init) ?? NSNull(),
            "wasIdempotentReplay": feedback.wasIdempotentReplay,
        ])
    }

    private func publish(_ feedback: TchurchStudioLANLocalBroadcastLowerThirdFeedback) {
        notifyListeners("studioLANLocalBroadcastLowerThirdFeedback", data: [
            "commandId": feedback.commandID.uuidString.lowercased(),
            "kind": feedback.action.kind.rawValue,
            "operation": feedback.action.operation.rawValue,
            "title": feedback.action.title ?? NSNull(),
            "subtitle": feedback.action.subtitle ?? NSNull(),
            "state": feedback.state.rawValue,
            "rejection": feedback.rejection?.rawValue ?? NSNull(),
            "lowerThirdRevision": feedback.lowerThirdRevision.map(String.init) ?? NSNull(),
            "wasIdempotentReplay": feedback.wasIdempotentReplay,
        ])
    }

    private func publish(_ feedback: TchurchStudioLANLocalOBSSceneFeedback) {
        notifyListeners("studioLANLocalOBSSceneFeedback", data: [
            "commandId": feedback.commandID.uuidString.lowercased(),
            "kind": feedback.action.kind.rawValue,
            "sceneId": feedback.action.sceneID,
            "state": feedback.state.rawValue,
            "rejection": feedback.rejection?.rawValue ?? NSNull(),
            "uncertaintyReason": feedback.uncertaintyReason?.rawValue ?? NSNull(),
            "obsRevision": feedback.obsRevision.map(String.init) ?? NSNull(),
        ])
    }

    private func publish(_ status: TchurchStudioLANCueCatalogStatus) {
        notifyListeners("studioLANCueCatalog", data: [
            "phase": status.phase.rawValue,
            "catalogId": status.catalogID ?? NSNull(),
            "routeEpoch": status.routeEpoch.map(String.init) ?? NSNull(),
            "totalCount": status.totalCount,
            "receivedCount": status.receivedCount,
            "cues": status.phase == .ready
                ? (status.cues ?? []).map { ["cueId": $0.cueID, "title": $0.title] }
                : NSNull(),
            "message": status.message ?? NSNull(),
        ])
    }

    private func statusPayload(_ status: TchurchStudioLANClientStatus) -> [String: Any] {
        [
            "supported": true,
            "phase": status.phase.rawValue,
            "services": status.services.map {
                ["id": $0.id, "name": $0.name, "protocolFloor": $0.protocolFloor] as [String: Any]
            },
            "selectedServiceId": status.selectedServiceID ?? NSNull(),
            "channel": status.channel?.rawValue ?? NSNull(),
            "paired": status.paired,
            "message": status.message ?? NSNull(),
            "enrollmentState": status.enrollmentState.rawValue,
            "protocolFloor": status.protocolFloor,
            "role": status.role?.rawValue ?? NSNull(),
            "permissions": status.permissions.map(\.rawValue),
            "permissionRevision": String(status.permissionRevision),
            "revocationGeneration": String(status.revocationGeneration),
            "studioId": status.studioID?.uuidString.lowercased() ?? NSNull(),
            "remoteControlAvailable": status.remoteControlAvailable,
            "remoteCommandInFlight": status.remoteCommandInFlight,
            "operatorTimerControlAvailable": status.operatorTimerControlAvailable,
            "operatorTimerCommandInFlight": status.operatorTimerCommandInFlight,
            "localBroadcastLowerThirdControlAvailable":
                status.localBroadcastLowerThirdControlAvailable,
            "localBroadcastLowerThirdCommandInFlight":
                status.localBroadcastLowerThirdCommandInFlight,
            "localOBSSceneControlAvailable": status.localOBSSceneControlAvailable,
            "localOBSSceneCommandInFlight": status.localOBSSceneCommandInFlight,
        ]
    }

    private func envelopePayload(_ envelope: TchurchStudioLANSignedEnvelope) -> [String: Any] {
        let audience = envelope.payload.audience
        let snapshot = audience.snapshot
        var result: [String: Any] = [
            "channel": envelope.channel.rawValue,
            "payloadVersion": envelope.schemaVersion,
            "sequence": String(envelope.sequence),
            "revision": String(envelope.revision),
            "issuedAtMs": envelope.issuedAtMilliseconds,
            "receivedAtMs": TchurchStudioLANTime.nowMilliseconds(),
            "authority": [
                "runId": envelope.authority.runID.uuidString.lowercased(),
                "authorityEpoch": String(envelope.authority.authorityEpoch),
                "packageId": envelope.authority.packageID,
                "serviceVersion": envelope.authority.serviceVersion,
            ],
            "audience": [
                "currentCueId": snapshot.currentCueID ?? NSNull(),
                "currentCueIndex": snapshot.currentCueIndex ?? NSNull(),
                "cueCount": snapshot.cueCount,
                "isBlackout": snapshot.isBlackout,
                "countdown": countdownPayload(snapshot.countdown),
                "cue": cuePayload(audience.cue),
            ],
        ]
        if let stage = envelope.payload.stage {
            result["stage"] = [
                "nextCue": cuePayload(stage.nextCue),
                "chordLines": stage.chordLines,
                "currentChordSlide": chordSlidePayload(stage.currentChordSlide),
                "timers": stage.timers.map(timerPayload),
                "message": stage.message ?? NSNull(),
            ]
        } else {
            result["stage"] = NSNull()
        }
        if let control = envelope.payload.control {
            var controlPayload: [String: Any] = [
                "chordsVisible": control.chordsVisible,
                "lightingArmed": control.lightingArmed,
                "healthyOutputCount": control.healthyOutputCount,
                "expectedOutputCount": control.expectedOutputCount,
                "routeEpoch": control.routeEpoch.map(String.init) ?? NSNull(),
                "cueCatalog": control.cueCatalog?.map {
                    ["cueId": $0.cueID, "title": $0.title]
                } ?? NSNull(),
            ]
            controlPayload["routing"] = control.routing.map {
                [
                    "schemaVersion": $0.schemaVersion,
                    "localAudience": $0.localAudience,
                    "localBroadcast": $0.localBroadcast,
                    "stageAndMusicians": $0.stageAndMusicians,
                    "lanRemoteControl": $0.lanRemoteControl,
                    "lightingAndMIDI": $0.lightingAndMIDI,
                    "tchurchCloudProgram": $0.tchurchCloudProgram,
                ] as [String: Any]
            } ?? NSNull()
            controlPayload["cueCatalogManifest"] = control.cueCatalogManifest.map {
                [
                    "schemaVersion": $0.schemaVersion,
                    "catalogId": $0.catalogID,
                    "totalCount": $0.totalCount,
                    "pageSize": $0.pageSize,
                ] as [String: Any]
            } ?? NSNull()
            controlPayload["operatorTimers"] = control.operatorTimers.map {
                [
                    "schemaVersion": $0.schemaVersion,
                    "revision": String($0.revision),
                    "timers": $0.timers.map { timer in
                        [
                            "scope": timer.scope.rawValue,
                            "anchorTimestampMilliseconds": timer.anchorTimestampMilliseconds,
                            "anchorValueMilliseconds": timer.anchorValueMilliseconds,
                            "isRunning": timer.isRunning,
                        ] as [String: Any]
                    },
                ] as [String: Any]
            } ?? NSNull()
            controlPayload["localBroadcastLowerThird"] =
                control.localBroadcastLowerThird.map {
                    var payload: [String: Any] = [
                        "schemaVersion": $0.schemaVersion,
                        "revision": String($0.revision),
                        "target": $0.target.rawValue,
                        "visible": $0.visible,
                    ]
                    if let title = $0.title { payload["title"] = title }
                    if let subtitle = $0.subtitle { payload["subtitle"] = subtitle }
                    return payload
                } ?? NSNull()
            controlPayload["localOBS"] = control.localOBS.map {
                var payload: [String: Any] = [
                    "schemaVersion": $0.schemaVersion,
                    "revision": String($0.revision),
                    "connectionId": $0.connectionID,
                    "availability": $0.availability.rawValue,
                    "scenes": $0.scenes.map { scene in
                        ["sceneId": scene.sceneID, "title": scene.title]
                    },
                ]
                if let currentSceneID = $0.currentSceneID {
                    payload["currentSceneId"] = currentSceneID
                }
                return payload
            } ?? NSNull()
            result["control"] = controlPayload
        } else {
            result["control"] = NSNull()
        }
        return result
    }

    private func cuePayload(_ cue: TchurchStudioLANPublicCue?) -> Any {
        guard let cue = cue else { return NSNull() }
        return [
            "cueId": cue.cueID,
            "title": cue.title ?? NSNull(),
            "lines": cue.lines,
            "mediaAssetId": cue.mediaAssetID ?? NSNull(),
            "imageAsset": imageAssetPayload(cue.imageAsset),
        ] as [String: Any]
    }

    private func imageAssetPayload(_ descriptor: TchurchStudioLANImageAssetDescriptor?) -> Any {
        guard let descriptor else { return NSNull() }
        return [
            "schemaVersion": descriptor.schemaVersion,
            "referenceId": descriptor.referenceID,
            "objectId": descriptor.objectID,
            "kind": descriptor.kind.rawValue,
            "mimeType": descriptor.mimeType,
            "byteSize": String(descriptor.byteSize),
            "required": descriptor.required,
            "imageFit": descriptor.imageFit.rawValue,
        ] as [String: Any]
    }

    private func countdownPayload(_ countdown: TchurchStudioLANCountdown?) -> Any {
        guard let countdown = countdown else { return NSNull() }
        return [
            "id": countdown.id,
            "label": countdown.label,
            "targetAtMs": milliseconds(countdown.targetDate),
        ] as [String: Any]
    }

    private func chordSlidePayload(_ slide: TchurchStudioLANChordSlide?) -> Any {
        guard let slide else { return NSNull() }
        return [
            "cueId": slide.cueID,
            "key": slide.key ?? NSNull(),
            "lines": slide.lines.map { line in
                [
                    "text": line.text,
                    "chords": line.chords.map { token in
                        [
                            "value": token.value,
                            "offsetUtf16": token.offsetUtf16,
                        ] as [String: Any]
                    },
                ] as [String: Any]
            },
        ] as [String: Any]
    }

    private func timerPayload(_ timer: TchurchStudioLANTimer) -> [String: Any] {
        [
            "id": timer.id,
            "label": timer.label,
            "mode": timer.mode.rawValue,
            "anchorAtMs": milliseconds(timer.anchorDate),
            "anchorValueMs": timer.anchorValueMilliseconds,
            "durationMs": timer.durationMilliseconds ?? NSNull(),
            "isRunning": timer.isRunning,
        ]
    }

    private func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1_000).rounded(.down))
    }
}
