import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Songs from "./Songs";

const { fetchApiMock, toastMock } = vi.hoisted(() => ({
  fetchApiMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/useApi", () => ({
  useApi: () => ({ fetchApi: fetchApiMock }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({ selectedChurch: { role: "ADMIN" } }),
}));

const songs = [
  { id: "song-1", title: "Al Rey", author: "Tchurch", key: "A" },
  { id: "song-2", title: "Santo", author: "Equipo", key: "G" },
];

async function flushTimers(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function lastSongRequest() {
  return String(fetchApiMock.mock.calls.at(-1)?.[0] || "");
}

describe("Songs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchApiMock.mockResolvedValue(songs);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("waits for a meaningful debounced search before filtering or reloading songs", async () => {
    render(<Songs />);

    await flushTimers();
    expect(fetchApiMock).toHaveBeenCalledTimes(1);
    expect(lastSongRequest()).toContain("limit=400");
    expect(lastSongRequest()).not.toContain("q=");

    const input = screen.getByPlaceholderText("Buscar por título, artista o tonalidad...");
    fireEvent.change(input, { target: { value: "R" } });

    await flushTimers(700);
    expect(fetchApiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Al Rey")).toBeInTheDocument();
    expect(screen.getByText("Santo")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Re" } });
    await flushTimers(649);
    expect(fetchApiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Santo")).toBeInTheDocument();

    await flushTimers(1);
    expect(fetchApiMock).toHaveBeenCalledTimes(2);
    expect(lastSongRequest()).toContain("limit=150");
    expect(lastSongRequest()).toContain("q=Re");
  });
});
