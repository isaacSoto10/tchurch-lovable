import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAutomations: vi.fn(),
  updateAutomations: vi.fn(),
  dispatchAutomation: vi.fn(),
}));

vi.mock("@/lib/presentationProduction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentationProduction")>();
  return {
    ...actual,
    fetchPresentationAutomations: mocks.fetchAutomations,
    updatePresentationAutomations: mocks.updateAutomations,
    dispatchPresentationAutomation: mocks.dispatchAutomation,
  };
});

import { PresentationAutomationPanel } from "./PresentationAutomationPanel";

const envelope = {
  schemaVersion: 4 as const,
  serviceId: "service-1",
  revision: 1,
  rules: [{
    id: "rule-1",
    name: "Aviso al coro",
    enabled: true,
    modes: { live: true, rehearsal: true },
    priority: 10,
    trigger: { type: "slide_entered" as const, slideKinds: ["lyrics" as const] },
    actions: [{ type: "stage_message" as const, body: "Listos", tone: "info" as const, roles: ["all" as const], lifetimeSeconds: 20 }],
    version: 1,
    updatedAt: "2026-07-12T13:00:00.000Z",
  }],
};

describe("PresentationAutomationPanel", () => {
  beforeEach(() => {
    mocks.fetchAutomations.mockReset();
    mocks.updateAutomations.mockReset();
    mocks.dispatchAutomation.mockReset();
    mocks.fetchAutomations.mockResolvedValue(envelope);
    mocks.updateAutomations.mockResolvedValue(envelope);
  });

  it("caps the stage-message editor at the canonical 120 seconds", async () => {
    render(<PresentationAutomationPanel
      serviceId="service-1"
      mode="live"
      canEdit
      controllerOwned
      snapshot={null}
      clientId="11111111-1111-4111-8111-111111111111"
      runtimeState={{ phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null }}
    />);

    await screen.findByText("Aviso al coro");
    fireEvent.click(screen.getByRole("button", { name: "Editar regla" }));
    const lifetime = screen.getByLabelText("Duración del mensaje") as HTMLInputElement;
    expect(lifetime).toHaveAttribute("min", "5");
    expect(lifetime).toHaveAttribute("max", "120");

    fireEvent.change(lifetime, { target: { value: "600" } });
    expect(lifetime).toHaveValue(120);
  });

  it("edits priority, all nine slide kinds, and all eight stage roles without collapsing selections", async () => {
    render(<PresentationAutomationPanel
      serviceId="service-1"
      mode="live"
      canEdit
      controllerOwned
      snapshot={null}
      clientId="11111111-1111-4111-8111-111111111111"
      runtimeState={{ phase: "idle", notice: null, queuedEvents: 0, lastAppliedAt: null }}
    />);

    await screen.findByText("Aviso al coro");
    fireEvent.click(screen.getByRole("button", { name: "Editar regla" }));

    const slideKinds = screen.getByRole("group", { name: /Tipos de slide/i });
    const stageRoles = screen.getByRole("group", { name: /Roles del escenario/i });
    expect(within(slideKinds).getAllByRole("checkbox")).toHaveLength(9);
    expect(within(stageRoles).getAllByRole("checkbox")).toHaveLength(8);

    fireEvent.click(within(slideKinds).getByRole("checkbox", { name: "Biblia" }));
    fireEvent.click(within(stageRoles).getByRole("checkbox", { name: "A/V" }));
    fireEvent.click(within(stageRoles).getByRole("checkbox", { name: "Banda" }));
    fireEvent.change(screen.getByLabelText("Prioridad de automatización"), { target: { value: "5000" } });
    expect(screen.getByLabelText("Prioridad de automatización")).toHaveValue(1000);
    expect(screen.getByRole("button", { name: "Eliminar acción" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Guardar/i }));
    await waitFor(() => expect(mocks.updateAutomations).toHaveBeenCalledOnce());
    const saved = mocks.updateAutomations.mock.calls[0][1];
    expect(saved.rules[0]).toMatchObject({
      priority: 1000,
      trigger: { type: "slide_entered", slideKinds: ["lyrics", "scripture"] },
      actions: [{ type: "stage_message", roles: ["av", "band"] }],
    });
  });
});
