import { MemoryRouter, useNavigate } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceMediaEntry, ServiceMediaResponse } from "@/lib/media";
import Media from "./Media";

const { fetchApiMock, toastMock, selectedChurchMock } = vi.hoisted(() => ({
  fetchApiMock: vi.fn(),
  toastMock: vi.fn(),
  selectedChurchMock: {
    current: {
      id: "church-1",
      name: "Grace en español",
      role: "ADMIN",
    },
  },
}));

vi.mock("@/hooks/useApi", () => ({
  useApi: () => ({ fetchApi: fetchApiMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({ selectedChurch: selectedChurchMock.current }),
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

function entry(overrides: Partial<ServiceMediaEntry>): ServiceMediaEntry {
  return {
    id: "sermon",
    serviceId: "service",
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
    ...overrides,
  };
}

function response(overrides: Partial<ServiceMediaResponse> = {}): ServiceMediaResponse {
  return {
    live: [],
    scheduled: [],
    previous: [],
    destinations: [],
    generatedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
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
    selectedChurchMock.current = { id: "church-1", name: "Grace en español", role: "ADMIN" };
  });

  it("keeps the sermon screen calm when media routes are unavailable", async () => {
    fetchApiMock.mockRejectedValue(endpointUnavailable());

    render(<MemoryRouter><Media /></MemoryRouter>);

    expect(await screen.findByText("Aún no hay sermones")).toBeInTheDocument();
    expect(toastMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Configuración de transmisión" }));
    expect(await screen.findByText("La configuración de transmisiones todavía no está activa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nuevo/i })).not.toBeInTheDocument();
  });

  it("uses the live sermon as hero and replaces curation with unified search results", async () => {
    const live = entry({ id: "live", title: "En vivo ahora", isLive: true, series: null });
    const recent = entry({ id: "recent", title: "Vida en Romanos", scripture: "Romanos 8" });
    const scheduled = entry({ id: "scheduled", title: "Próximo encuentro", isScheduled: true, date: "2026-07-20T12:00:00.000Z", series: null });
    fetchApiMock.mockResolvedValue(response({ live: [live], scheduled: [scheduled], previous: [recent] }));

    render(<MemoryRouter><Media /></MemoryRouter>);

    const hero = await screen.findByRole("region", { name: "Sermón destacado" });
    expect(within(hero).getByRole("heading", { name: "En vivo ahora" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "En vivo y próximamente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mensajes recientes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Series" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Buscar sermones" }), { target: { value: "romanos" } });

    expect(await screen.findByRole("heading", { name: "Resultados para “romanos”" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vida en Romanos" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sermón destacado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Mensajes recientes" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getByRole("region", { name: "Sermón destacado" })).toBeInTheDocument();
  });

  it("syncs a series deep link with browser Back", async () => {
    fetchApiMock.mockResolvedValue(response({ previous: [entry({ id: "sermon-1" })] }));

    render(<MemoryRouter initialEntries={["/app/media"]}><MediaNavigationHarness /></MemoryRouter>);
    await screen.findAllByText("Esperanza viva");

    fireEvent.click(screen.getByRole("button", { name: "Abrir serie por URL" }));
    expect(await screen.findByRole("button", { name: "Todas las series" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fe y Vida" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Atrás en historial" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Todas las series" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Series" })).toBeInTheDocument();
  });

  it("only exposes transmission settings to admins and planners", async () => {
    selectedChurchMock.current = { id: "church-1", name: "Grace en español", role: "MEMBER" };
    fetchApiMock.mockResolvedValue(response());

    render(<MemoryRouter><Media /></MemoryRouter>);

    expect(await screen.findByText("Aún no hay sermones")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Configuración de transmisión" })).not.toBeInTheDocument();
  });
});
