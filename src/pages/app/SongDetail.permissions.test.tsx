import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SongDetail from "./SongDetail";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), list: vi.fn(), navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "song-1" }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/songLyricsProposals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/songLyricsProposals")>()),
  listSongLyricsProposals: mocks.list,
}));
vi.mock("@/components/SongLyricsProposalEditor", () => ({
  SongLyricsProposalEditor: ({ onDirectSave }: { onDirectSave: (target: unknown, lyrics: string) => Promise<void> }) => (
    <button type="button" onClick={() => void onDirectSave({ type: "SONG", songId: "song-1", arrangementId: null }, "[C]Letra privada")}>Mock direct lyrics save</button>
  ),
}));

const song = {
  id: "song-1", title: "Gracia", author: "Equipo", bpm: 120, meter: "4/4", key: "C", notes: null,
  ccliNumber: null, copyright: null, tags: null, scriptureRef: null, lyrics: "[C]Gracia", youtubeUrl: null,
  createdAt: "2026-07-12T23:00:00.000Z",
};

describe("SongDetail proposal permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockImplementation((path: string) => Promise.resolve(path.endsWith("/arrangements") ? [] : song));
  });

  it("keeps metadata and destructive controls read-only when the API denies lyrics management", async () => {
    mocks.list.mockResolvedValue({ permissions: { canManageLyrics: false }, proposals: [] });
    render(<SongDetail />);

    const title = await screen.findByDisplayValue("Gracia");
    await waitFor(() => expect(title).toBeDisabled());
    expect(screen.queryByRole("button", { name: "Eliminar canción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar arreglo/i })).not.toBeInTheDocument();
  });

  it("sends BPM as an integer when authoritative permission allows editing", async () => {
    mocks.list.mockResolvedValue({ permissions: { canManageLyrics: true }, proposals: [] });
    render(<SongDetail />);

    const bpm = await screen.findByDisplayValue("120");
    await waitFor(() => expect(bpm).not.toBeDisabled());
    fireEvent.change(bpm, { target: { value: "132" } });
    fireEvent.blur(bpm);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith("/songs/song-1", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ bpm: 132 }),
    })));
  });

});
