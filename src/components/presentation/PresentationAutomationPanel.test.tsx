import { fireEvent, render, screen } from "@testing-library/react";
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
    trigger: { type: "session_started" as const },
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
});
