import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Media from "./Media";

const { fetchApiMock, toastMock } = vi.hoisted(() => ({
  fetchApiMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  useApi: () => ({ fetchApi: fetchApiMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({
    selectedChurch: {
      id: "church-1",
      name: "Grace en espanol",
      role: "ADMIN",
    },
  }),
}));

vi.mock("@/lib/appRoutePreloaders", () => ({
  preloadAppRoute: vi.fn(),
}));

function endpointUnavailable() {
  return Object.assign(new Error("Livestream destinations are not configured yet."), {
    status: 503,
    body: { code: "live_destinations_unavailable" },
  });
}

describe("Media", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("keeps the Media screen calm when preview routes are not deployed yet", async () => {
    fetchApiMock.mockRejectedValue(endpointUnavailable());

    render(
      <MemoryRouter>
        <Media />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Aún no hay servicios anteriores con media")).toBeInTheDocument();
      expect(screen.getByText("La configuración de transmisiones todavía no está activa")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /nuevo/i })).not.toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });
});
