import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceMediaEntry, ServiceMediaResponse } from "@/lib/media";
import MediaDetail from "./MediaDetail";

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
  useChurch: () => ({ selectedChurch: { id: "church-1", name: "Grace", role: "MEMBER" } }),
}));

vi.mock("@/lib/appRoutePreloaders", () => ({
  preloadAppRoute: vi.fn(),
}));

function endpointUnavailable() {
  return Object.assign(new Error("No se pudo completar la solicitud (404)."), { status: 404 });
}

function entry(overrides: Partial<ServiceMediaEntry>): ServiceMediaEntry {
  return {
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
    playbackUrl: "https://youtube.com/watch?v=abc123",
    livestreamUrl: null,
    videoUrl: "https://youtube.com/watch?v=abc123",
    audioUrl: null,
    externalUrl: null,
    embedUrl: null,
    hlsUrl: null,
    thumbnailUrl: null,
    speaker: "Ana",
    scripture: "Juan 3:16",
    series: "Fe y Vida",
    description: "Notas del mensaje para acompañar la enseñanza.",
    isLive: false,
    isScheduled: false,
    ...overrides,
  };
}

function response(previous: ServiceMediaEntry[]): ServiceMediaResponse {
  return {
    live: [],
    scheduled: [],
    previous,
    destinations: [],
    generatedAt: "2026-07-10T12:00:00.000Z",
  };
}

function renderDetail(id = "sermon-1") {
  return render(
    <MemoryRouter initialEntries={[`/app/media/${id}`]}>
      <Routes>
        <Route path="/app/media/:id" element={<MediaDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MediaDetail", () => {
  afterEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("shows the normal missing-service state when Media routes are not deployed yet", async () => {
    fetchApiMock.mockRejectedValue(endpointUnavailable());

    renderDetail("missing-service");

    await waitFor(() => expect(screen.getByText("No se encontró este sermón")).toBeInTheDocument());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("keeps the player flow and shows notes plus related messages from the same series", async () => {
    const current = entry({ id: "sermon-1" });
    const related = entry({ id: "sermon-2", title: "Fe que permanece", series: "FÉ Y VIDA", date: "2026-06-29T12:00:00.000Z" });
    const unrelated = entry({ id: "sermon-3", title: "Otro mensaje", series: "Otra serie", date: "2026-07-01T12:00:00.000Z" });
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path === "/service-media/sermon-1") return { entry: current };
      return response([current, unrelated, related]);
    });

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Esperanza viva" })).toBeInTheDocument();
    expect(screen.getByTitle("Esperanza viva")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notas" })).toBeInTheDocument();
    expect(screen.getByText("Notas del mensaje para acompañar la enseñanza.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Más de Fe y Vida" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fe que permanece" })).toBeInTheDocument();
    expect(screen.queryByText("Otro mensaje")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Sermones/ }).some((link) => link.getAttribute("href") === "/app/media")).toBe(true);
  });

  it("renders the authoritative detail without waiting for the related library", async () => {
    const current = entry({ id: "sermon-1" });
    let resolveLibrary: (value: ServiceMediaResponse) => void = () => undefined;
    const pendingLibrary = new Promise<ServiceMediaResponse>((resolve) => {
      resolveLibrary = resolve;
    });
    fetchApiMock.mockImplementation((path: string) => {
      if (path === "/service-media/sermon-1") return Promise.resolve({ entry: current });
      return pendingLibrary;
    });

    renderDetail();

    expect(await screen.findByRole("heading", { name: "Esperanza viva" })).toBeInTheDocument();
    await act(async () => {
      resolveLibrary(response([current]));
      await Promise.resolve();
    });
  });

  it("returns to the exact library history entry when opened from a series", async () => {
    const current = entry({ id: "sermon-1" });
    fetchApiMock.mockImplementation(async (path: string) => {
      if (path === "/service-media/sermon-1") return { entry: current };
      return response([current]);
    });

    render(
      <MemoryRouter
        initialEntries={["/app/media?series=fe%20y%20vida", "/app/media/sermon-1"]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/app/media" element={<p>Biblioteca de la serie restaurada</p>} />
          <Route path="/app/media/:id" element={<MediaDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Esperanza viva" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sermones" }));
    expect(await screen.findByText("Biblioteca de la serie restaurada")).toBeInTheDocument();
  });
});
