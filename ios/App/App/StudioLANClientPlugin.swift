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
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forgetPairing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
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
        installLifecycleObservers()
    }

    deinit {
        lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
        client?.disconnect()
        client?.stopDiscovery()
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
        guard !serviceID.isEmpty,
              let channel = TchurchStudioLANChannel(rawValue: channelValue),
              channel.isReadOnlyOutput else {
            call.reject("Selecciona un Studio y una salida válida.", "INVALID_CONFIGURATION")
            return
        }
        client.connect(
            serviceID: serviceID,
            channel: channel,
            pairingCode: call.getString("pairingCode")
        )
        call.resolve(["accepted": true])
    }

    @objc public func disconnect(_ call: CAPPluginCall) {
        client?.disconnect()
        call.resolve(["accepted": true])
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
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return call.reject("Bridge no disponible.", "UNAVAILABLE") }
            call.resolve(self.statusPayload(self.latestStatus))
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

    private func statusPayload(_ status: TchurchStudioLANClientStatus) -> [String: Any] {
        [
            "supported": true,
            "phase": status.phase.rawValue,
            "services": status.services.map { ["id": $0.id, "name": $0.name] },
            "selectedServiceId": status.selectedServiceID ?? NSNull(),
            "channel": status.channel?.rawValue ?? NSNull(),
            "paired": status.paired,
            "message": status.message ?? NSNull(),
        ]
    }

    private func envelopePayload(_ envelope: TchurchStudioLANSignedEnvelope) -> [String: Any] {
        let audience = envelope.payload.audience
        let snapshot = audience.snapshot
        var result: [String: Any] = [
            "channel": envelope.channel.rawValue,
            "sequence": String(envelope.sequence),
            "revision": String(envelope.revision),
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
                "timers": stage.timers.map(timerPayload),
                "message": stage.message ?? NSNull(),
            ]
        } else {
            result["stage"] = NSNull()
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
