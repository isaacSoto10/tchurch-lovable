import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SongLyricsProposals from "./SongLyricsProposals";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  apiFetch: vi.fn(),
  decide: vi.fn(),
  toast: vi.fn(),
  getToken: vi.fn().mockResolvedValue("token"),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ userId: "clerk-user", getToken: mocks.getToken }),
}));
vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({ selectedChurch: { id: "church-1" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: mocks.apiFetch,
}));
vi.mock("@/lib/songLyricsProposalOutbox", () => ({
  songLyricsProposalOutboxScope: vi.fn().mockResolvedValue({ churchId: "church-1", ownerHash: "owner" }),
  decideSongLyricsProposalDurably: mocks.decide,
}));
vi.mock("@/lib/songLyricsProposals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/songLyricsProposals")>()),
  listSongLyricsProposals: mocks.list,
  getSongLyricsProposal: mocks.get,
  buildSongLyricsProposalDecision: vi.fn().mockResolvedValue({ status: "ACCEPTED" }),
}));

const summary = {
  id: "66666666-6666-4666-8666-666666666666",
  status: "PENDING" as const,
  target: { type: "SONG" as const, song: { id: "song-1", title: "Gracia" }, arrangement: null },
  source: { type: "IOS" as const, ref: null },
  format: "CHORDPRO" as const,
  checksum: `sha256:${"a".repeat(64)}`,
  baseChecksum: `sha256:${"b".repeat(64)}`,
  version: 1,
  submittedBy: { id: "44444444-4444-4444-8444-444444444444", displayName: "Ana" },
  reviewedBy: null,
  decisionReason: null,
  acceptedTargetUpdatedAt: null,
  submittedAt: "2026-07-12T23:00:00.000Z",
  reviewedAt: null,
  createdAt: "2026-07-12T23:00:00.000Z",
  updatedAt: "2026-07-12T23:00:00.000Z",
};

function envelopes(canManage: boolean) {
  return {
    list: { schemaVersion: 1, proposals: [summary], pagination: { nextCursor: null, hasMore: false }, permissions: { canManageLyrics: canManage } },
    detail: { schemaVersion: 1, proposal: { ...summary, lyrics: "<img src=x onerror=alert(1)>\n[C]Texto" }, permissions: { canManageLyrics: canManage } },
  };
}

describe("SongLyricsProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockResolvedValue({ lyrics: "[C]Versión actual" });
  });

  it("renders long/private proposal text as escaped text and lets an authorized manager accept", async () => {
    const data = envelopes(true);
    mocks.list.mockResolvedValue(data.list);
    mocks.get.mockResolvedValue(data.detail);
    mocks.decide.mockResolvedValue({ queued: false, envelope: data.detail });
    render(<SongLyricsProposals />);

    expect(await screen.findByText("Gracia", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByRole("button", { name: "Rechazar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y publicar" }));
    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText(/pantallas en vivo/i)).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Aceptar y publicar" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(1));
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Propuesta aceptada" }));
  });

  it("never shows decision controls when the API denies management permission", async () => {
    const data = envelopes(false);
    mocks.list.mockResolvedValue(data.list);
    mocks.get.mockResolvedValue(data.detail);
    render(<SongLyricsProposals />);

    expect(await screen.findByText("Gracia", { selector: "h2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar y publicar" })).not.toBeInTheDocument();
    expect(screen.getByText("Sigue el estado de tus cambios.")).toBeInTheDocument();
  });

  it("keeps an offline acceptance visibly pending instead of presenting it as applied", async () => {
    const data = envelopes(true);
    mocks.list.mockResolvedValue(data.list);
    mocks.get.mockResolvedValue(data.detail);
    mocks.decide.mockResolvedValue({ queued: true, envelope: null });
    render(<SongLyricsProposals />);

    await screen.findByText("Gracia", { selector: "h2" });
    fireEvent.click(screen.getByRole("button", { name: "Aceptar y publicar" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Aceptar y publicar" }));

    expect(await screen.findByText(/aún no se aplicó/i)).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Decisión pendiente de sincronización" }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Propuesta aceptada" }));
  });
});
