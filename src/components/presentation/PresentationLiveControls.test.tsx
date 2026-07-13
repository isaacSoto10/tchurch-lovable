import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LiveConnectionBadge,
  PresentationLiveNotice,
  PresentationOwnershipControls,
  PresentationRemoteIntentStatus,
  PresentationRemoteSurface,
  PresentationStageMessages,
  type PresentationLiveCommandSender,
} from "./PresentationLiveControls";
import type { PresentationLiveSnapshot, PresentationOfflineStep, PresentationTiming } from "@/lib/presentationLive";
import type { PresentationRemoteIntentSender, PresentationRemoteIntentUiState } from "@/lib/presentationRemoteIntents";
import type { PresentationRunStep } from "@/lib/servicePresentation";

const timing: PresentationTiming = {
  service: {
    status: "running",
    plannedSeconds: 3_600,
    elapsedSeconds: 3_700,
    remainingSeconds: 0,
    overrunSeconds: 100,
    projectedEndAt: "2026-07-11T19:10:00.000Z",
    startedAt: "2026-07-11T18:00:00.000Z",
    pausedAt: null,
    accumulatedPausedMs: 0,
  },
  item: {
    itemId: "item-1",
    status: "running",
    plannedSeconds: 300,
    elapsedSeconds: 180,
    overrunSeconds: 0,
    startedAt: "2026-07-11T18:58:00.000Z",
    pausedAt: null,
    accumulatedPausedMs: 0,
  },
  countdown: { durationSeconds: 60, targetAt: "2026-07-11T19:01:00.000Z", remainingSeconds: 8 },
};

const steps: PresentationRunStep[] = [
  { id: "render-a-1", kind: "song-section", slideIndex: 0, itemId: "item-1", title: "Digno", sectionAnchorId: "verse", sectionSequenceId: "step-a", sectionLabel: "Verso", page: 1, totalPages: 2 },
  { id: "render-a-2", kind: "song-section", slideIndex: 1, itemId: "item-1", title: "Digno", sectionAnchorId: "verse", sectionSequenceId: "step-a", sectionLabel: "Verso", page: 2, totalPages: 2 },
  { id: "cue-1", kind: "cue", slideIndex: 2, itemId: "item-2", title: "Oración", sectionAnchorId: null, sectionSequenceId: null, sectionLabel: null, page: 1, totalPages: 1 },
];

const liveSteps: PresentationOfflineStep[] = [
  { itemId: "item-1", stepId: "step-a", partIndex: 0, sectionAnchorId: "verse" },
  { itemId: "item-1", stepId: "step-a", partIndex: 1, sectionAnchorId: "verse" },
  { itemId: "item-2", stepId: null, partIndex: 0, sectionAnchorId: null },
];

function snapshot(owned = true): PresentationLiveSnapshot {
  return {
    schemaVersion: 2,
    serviceId: "service-1",
    serviceVersion: "svc-v2",
    viewerVersion: "sha256:viewer-operator",
    controllerVersion: "sha256:controller-present",
    serverNow: "2026-07-11T19:00:00.000Z",
    receivedAtMs: Date.parse("2026-07-11T19:00:00.000Z"),
    viewer: { view: "operator", roles: ["operator"], canEdit: true, canStart: true, canControl: true, canForceTakeover: true },
    viewerLayout: null,
    session: {
      id: "session-1",
      mode: "live",
      status: "live",
      revision: 14,
      startedAt: "2026-07-11T18:00:00.000Z",
      endedAt: null,
      controller: { clientId: owned ? "this-client" : "other-client", displayName: owned ? "Booth iPad" : "Sanctuary Mac", leaseExpiresAt: "2026-07-11T19:01:00.000Z", ownedByViewer: owned },
      presence: owned ? [{ clientId: "pastor-phone", displayName: "Pastor iPhone", view: "remote", lastSeenAt: "2026-07-11T18:59:59.000Z", controlRequestedAt: "2026-07-11T18:59:58.000Z" }] : [],
      cursor: { itemId: "item-1", itemIndex: 0, stepId: "step-a", stepIndex: 0, partIndex: 0, sectionAnchorId: "verse" },
      display: { blackout: false, chordsVisible: true, broadcastVisible: true },
      playback: null,
      timing,
      messages: [],
      lastCommand: null,
    },
  };
}

function renderRemote(overrides: { owned?: boolean; blackout?: boolean; chordsVisible?: boolean } = {}) {
  const onCommand = vi.fn(async () => undefined) as unknown as PresentationLiveCommandSender;
  render(
    <PresentationRemoteSurface
      snapshot={snapshot(overrides.owned ?? true)}
      activeView="operator"
      controllerLeaseActive
      timing={timing}
      steps={steps}
      liveSteps={liveSteps}
      activeIndex={0}
      nextLabel="Verso · página 2"
      blackout={overrides.blackout ?? false}
      chordsVisible={overrides.chordsVisible ?? true}
      pending={false}
      onCommand={onCommand}
    />,
  );
  return onCommand;
}

describe("Tchurch Live controls", () => {
  it("keeps mobile blackout and chord controls visibly distinct, stateful and at least 44px tall", () => {
    const onCommand = renderRemote();
    const blackout = screen.getByRole("button", { name: "Poner salida de presentación en negro" });
    const chords = screen.getByRole("button", { name: "Ocultar acordes" });

    expect(blackout).toHaveTextContent("Salida en negro");
    expect(blackout).toHaveAttribute("aria-pressed", "false");
    expect(blackout.className).toContain("h-14");
    expect(chords).toHaveTextContent("Acordes sí");
    expect(chords).toHaveAttribute("aria-pressed", "true");
    expect(chords.className).toContain("h-14");

    fireEvent.click(blackout);
    fireEvent.click(chords);
    expect(onCommand).toHaveBeenCalledWith("set_blackout", { blackout: true });
    expect(onCommand).toHaveBeenCalledWith("set_chords", { chordsVisible: false });
  });

  it("labels restoration explicitly while blackout is active", () => {
    renderRemote({ blackout: true });
    expect(screen.getByRole("button", { name: "Restaurar salida de presentación" })).toHaveTextContent("Restaurar salida");
  });

  it("uses exact partIndex jumps for adjacent pages and null cue step IDs", () => {
    const onCommand = renderRemote();
    fireEvent.click(screen.getByRole("button", { name: "Programa siguiente" }));
    expect(onCommand).toHaveBeenCalledWith("jump", { itemId: "item-1", stepId: "step-a", partIndex: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Orden" }));
    fireEvent.click(screen.getByRole("button", { name: /Oración/ }));
    expect(onCommand).toHaveBeenCalledWith("jump", { itemId: "item-2", stepId: null, partIndex: 0 });
  });

  it("surfaces control contention and supports request or forced takeover", () => {
    const onCommand = renderRemote({ owned: false });
    expect(screen.getByText(/Control:/)).toHaveTextContent("Sanctuary Mac");
    fireEvent.click(screen.getByRole("button", { name: "Solicitar" }));
    fireEvent.click(screen.getByRole("button", { name: "Forzar" }));
    expect(onCommand).toHaveBeenCalledWith("request_control", {});
    expect(onCommand).toHaveBeenCalledWith("claim_control", { force: true });
  });

  it("maps all seven observer controls to remote intents without claiming control", () => {
    const onCommand = vi.fn(async () => undefined) as unknown as PresentationLiveCommandSender;
    const remoteMock = vi.fn(async () => ({ phase: "applied", intentId: "intent", type: "take", message: "Aplicado" }));
    const onRemoteIntent = remoteMock as unknown as PresentationRemoteIntentSender;
    render(
      <PresentationRemoteSurface
        snapshot={snapshot(false)}
        activeView="operator"
        controllerLeaseActive
        timing={timing}
        steps={steps}
        liveSteps={liveSteps}
        activeIndex={1}
        nextLabel="Oración"
        blackout={false}
        chordsVisible
        pending={false}
        remoteAvailable
        remotePending={false}
        remoteStatus={{ phase: "idle", intentId: null, type: null, message: null }}
        onCommand={onCommand}
        onRemoteIntent={onRemoteIntent}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Vista previa anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Vista previa siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Pasar a Programa" }));
    fireEvent.click(screen.getByRole("button", { name: "Programa anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Programa siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Poner salida de presentación en negro" }));
    fireEvent.click(screen.getByRole("button", { name: "Ocultar acordes" }));

    expect(remoteMock.mock.calls).toEqual([
      ["preview_previous", {}],
      ["preview_next", {}],
      ["take", {}],
      ["program_previous", {}],
      ["program_next", {}],
      ["set_blackout", { enabled: true }],
      ["set_chords", { visible: false }],
    ]);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["sending", "Enviando al controlador en vivo…"],
    ["applied", "Aplicado por el controlador en vivo."],
    ["rejected", "El controlador rechazó la acción."],
    ["expired", "La acción expiró antes de aplicarse."],
    ["error", "El controlador no pudo aplicar la acción."],
  ] as const)("announces the remote UI state %s without treating pending as success", (phase, message) => {
    const status: PresentationRemoteIntentUiState = { phase, intentId: "intent-1", type: "take", message };
    const view = render(<PresentationRemoteIntentStatus status={status} />);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    if (phase !== "applied") expect(screen.queryByText("Aplicado por el controlador en vivo.")).not.toBeInTheDocument();
    view.unmount();
  });

  it("offers a requested handoff target and exposes overrun/countdown clocks", () => {
    const onCommand = renderRemote();
    expect(screen.getByText("Pastor iPhone")).toBeInTheDocument();
    expect(screen.getByText("Solicita")).toBeInTheDocument();
    expect(screen.getByText("+1:40")).toBeInTheDocument();
    expect(screen.getByText("0:08")).toBeInTheDocument();
    const handoff = screen.getByRole("button", { name: "Entregar" });
    expect(handoff.className).toContain("min-h-11");
    fireEvent.click(handoff);
    expect(onCommand).toHaveBeenCalledWith("handoff_control", { targetClientId: "pastor-phone" });
  });

  it("announces urgent private messages and never requires a dismiss control for followers", () => {
    const onCommand = vi.fn(async () => undefined) as unknown as PresentationLiveCommandSender;
    render(<PresentationStageMessages messages={[{ id: "urgent-1", body: "Puente ahora", tone: "urgent", roles: ["band"], sentAt: "2026-07-11T19:00:00.000Z", expiresAt: "2026-07-11T19:00:30.000Z" }]} canDismiss={false} onCommand={onCommand} />);
    expect(screen.getByText("Puente ahora")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descartar mensaje" })).not.toBeInTheDocument();
  });

  it("labels offline drafts and blocks conflict resolution behind an explicit server choice", () => {
    const reconcile = vi.fn(async () => undefined);
    const discard = vi.fn(async () => undefined);
    const { rerender } = render(<LiveConnectionBadge networkState="offline" queueCount={3} />);
    expect(screen.getByLabelText("Modo local, 3 cambios pendientes")).toHaveTextContent("Local · 3");
    rerender(<PresentationLiveNotice notice="Cambios locales pendientes." networkState="offline" queueCount={3} onClose={() => undefined} onReconcile={reconcile} onDiscard={discard} />);
    expect(screen.getByRole("button", { name: "Reintentar" }).className).toContain("min-h-11");
    rerender(<PresentationLiveNotice notice="La sesión cambió en otro dispositivo." networkState="diverged" queueCount={3} onClose={() => undefined} onReconcile={reconcile} onDiscard={discard} />);
    const useServer = screen.getByRole("button", { name: "Usar servidor" });
    expect(useServer.className).toContain("min-h-11");
    fireEvent.click(useServer);
    expect(discard).toHaveBeenCalledOnce();
  });

  it("keeps compact ownership and workspace notice actions at least 44px tall", () => {
    const idle = { ...snapshot(), session: null };
    const onCommand = vi.fn(async () => undefined) as unknown as PresentationLiveCommandSender;
    render(<PresentationOwnershipControls snapshot={idle} controllerLeaseActive={false} pending={false} onCommand={onCommand} compact />);
    expect(screen.getByRole("button", { name: "Iniciar sesión" }).className).toContain("h-11");

    const source = readFileSync(`${process.cwd()}/src/pages/app/ServicePresentation.tsx`, "utf8");
    expect(source).toContain('className="min-h-11 shrink-0 rounded-xl px-3 font-black"');
    expect(source.indexOf("if (runtime.error || loadError)")).toBeLessThan(source.indexOf("if (loading || runtime.loading || workspaceScopeMismatch)"));
  });
});
