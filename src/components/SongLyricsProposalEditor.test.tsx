import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { SongLyricsProposalEditor } from "./SongLyricsProposalEditor";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  submit: vi.fn(),
  listOutbox: vi.fn(),
  toast: vi.fn(),
  getToken: vi.fn().mockResolvedValue("token"),
  removeOutbox: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ userId: "clerk-user", getToken: mocks.getToken }),
}));
vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({ selectedChurch: { id: "church-1", role: "ADMIN" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/songLyricsProposalOutbox", () => ({
  songLyricsProposalOutboxScope: vi.fn().mockResolvedValue({ churchId: "church-1", ownerHash: "owner" }),
  listSongLyricsProposalOutbox: mocks.listOutbox,
  removeSongLyricsProposalOutboxRecord: mocks.removeOutbox,
  submitSongLyricsProposalDurably: mocks.submit,
}));
vi.mock("@/lib/songLyricsProposals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/songLyricsProposals")>();
  return { ...actual, listSongLyricsProposals: mocks.list };
});

const target = [{
  type: "SONG" as const,
  songId: "song-1",
  arrangementId: null,
  label: "Canción principal",
  lyrics: "[C]Original",
}];

describe("SongLyricsProposalEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOutbox.mockResolvedValue([]);
    mocks.submit.mockResolvedValue({ queued: false, envelope: { proposal: { id: "proposal-1" } } });
  });

  it("uses API permissions instead of the local ADMIN role and submits a proposal", async () => {
    mocks.list.mockResolvedValue({ permissions: { canManageLyrics: false }, proposals: [] });
    const directSave = vi.fn();
    render(<SongLyricsProposalEditor targets={target} onCanManageChange={vi.fn()} onDirectSave={directSave} onRefreshTarget={vi.fn()} />);

    expect(await screen.findByText("Tus cambios se enviarán para aprobación.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ChordPro"), { target: { value: "[C]Original y nuevo" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar propuesta" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
    expect(directSave).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Propuesta enviada" }));
    expect(screen.getByLabelText("ChordPro")).toHaveValue("[C]Original y nuevo");
    expect(screen.getByRole("button", { name: "Enviar propuesta" })).toBeDisabled();
    expect(screen.getByText(/Tu base original se conserva/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ChordPro"), { target: { value: "[C]Una segunda edición" } });
    expect(screen.getByRole("button", { name: "Enviar propuesta" })).not.toBeDisabled();
  });

  it("allows direct save only when permissions.canManageLyrics is true", async () => {
    mocks.list.mockResolvedValue({ permissions: { canManageLyrics: true }, proposals: [] });
    const directSave = vi.fn().mockResolvedValue(undefined);
    render(<SongLyricsProposalEditor targets={target} onCanManageChange={vi.fn()} onDirectSave={directSave} onRefreshTarget={vi.fn()} />);

    expect(await screen.findByText("Puedes guardar directamente y revisar propuestas.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ChordPro"), { target: { value: "[D]Versión aprobada" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar directamente" }));
    await waitFor(() => expect(directSave).toHaveBeenCalledWith(expect.objectContaining({ type: "SONG" }), "[D]Versión aprobada"));
  });

  it("preserves the draft and rebases without deleting sibling stale records", async () => {
    mocks.list.mockResolvedValue({ permissions: { canManageLyrics: false }, proposals: [] });
    mocks.submit.mockRejectedValue(new ApiError("stale", 409, { code: "LYRICS_BASE_STALE" }));
    const refreshTarget = vi.fn().mockResolvedValue("[C]Actual del servidor");
    render(<SongLyricsProposalEditor targets={target} onCanManageChange={vi.fn()} onDirectSave={vi.fn()} onRefreshTarget={refreshTarget} />);

    await screen.findByText("Tus cambios se enviarán para aprobación.");
    const editor = screen.getByLabelText("ChordPro") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "[G]Mi borrador intacto" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar propuesta" }));

    expect(await screen.findByText(/Tu borrador sigue intacto/i)).toBeInTheDocument();
    expect(editor.value).toBe("[G]Mi borrador intacto");
    fireEvent.click(screen.getByRole("button", { name: "Cargar versión actual" }));
    await waitFor(() => expect(refreshTarget).toHaveBeenCalled());
    expect(editor.value).toBe("[G]Mi borrador intacto");
    expect(mocks.removeOutbox).not.toHaveBeenCalled();
  });

  it("exposes a stranded local draft for explicit restore or discard", async () => {
    mocks.list.mockResolvedValue({ permissions: { canManageLyrics: false }, proposals: [] });
    mocks.listOutbox.mockResolvedValue([{
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", churchId: "church-1", ownerHash: "owner",
      kind: "submission", proposalId: null, state: "needs_review", attempts: 1,
      createdAt: "2026-07-12T23:00:00.000Z", expiresAt: "2026-07-19T23:00:00.000Z", nextAttemptAt: "2026-07-12T23:00:00.000Z",
      lastErrorCode: "LYRICS_BASE_STALE", lastErrorMessage: "stale",
      body: {
        schemaVersion: 1, target: { type: "SONG", songId: "song-1", arrangementId: null }, source: { type: "IOS", ref: null },
        format: "CHORDPRO", lyrics: "[G]Borrador recuperado", checksum: `sha256:${"a".repeat(64)}`,
        baseChecksum: `sha256:${"b".repeat(64)}`, idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", requestChecksum: `sha256:${"c".repeat(64)}`,
      },
    }]);
    const refreshTarget = vi.fn().mockResolvedValue("[C]Versión actual");
    render(<SongLyricsProposalEditor targets={target} onCanManageChange={vi.fn()} onDirectSave={vi.fn()} onRefreshTarget={refreshTarget} />);

    expect(await screen.findByText("Necesita una base nueva")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar borrador" }));
    await waitFor(() => expect(mocks.removeOutbox).toHaveBeenCalledWith("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
    expect(screen.getByLabelText("ChordPro")).toHaveValue("[G]Borrador recuperado");
  });
});
