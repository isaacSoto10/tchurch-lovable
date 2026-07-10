import { MemoryRouter, useNavigate } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function MediaNavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/app/media?series=fe%20y%20vida")}>Abrir serie por URL</button>
      <button onClick={() => navigate(-1)}>Atrás en historial</button>
      <Media />
    </>
  );
}

describe("Media", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("keeps the sermon screen calm when media routes are unavailable", async () => {
    fetchApiMock.mockRejectedValue(endpointUnavailable());

    render(
      <MemoryRouter>
        <Media />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Aún no hay sermones")).toBeInTheDocument();
      expect(screen.getByText("La configuración de transmisiones todavía no está activa")).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /nuevo/i })).not.toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("syncs the series view with query navigation and preserves browser Back", async () => {
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/live-destinations")) return [];
      return {
        live: [],
        scheduled: [],
        destinations: [],
        generatedAt: "2026-07-10T12:00:00.000Z",
        previous: [{
          id: "sermon-1",
          serviceId: "service-1",
          serviceItemId: null,
          destinationId: null,
          title: "Esperanza viva",
          serviceTitle: "Domingo",
          date: "2026-07-06T12:00:00.000Z",
          type: "video",
          provider: "youtube",
          providerLabel: "YouTube",
          streamStatus: null,
          playbackUrl: "https://youtube.com/watch?v=123",
          livestreamUrl: null,
          videoUrl: "https://youtube.com/watch?v=123",
          audioUrl: null,
          externalUrl: null,
          embedUrl: null,
          hlsUrl: null,
          thumbnailUrl: null,
          speaker: "Ana",
          scripture: "Juan 3",
          series: "Fe y Vida",
          description: null,
          isLive: false,
          isScheduled: false,
        }],
      };
    });

    render(<MemoryRouter initialEntries={["/app/media"]}><MediaNavigationHarness /></MemoryRouter>);
    await screen.findByText("Esperanza viva");

    fireEvent.click(screen.getByRole("button", { name: "Abrir serie por URL" }));
    expect(await screen.findByRole("button", { name: "Todas las series" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Atrás en historial" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Todas las series" })).not.toBeInTheDocument());
    expect(screen.getByText("Fe y Vida")).toBeInTheDocument();
  });
});
