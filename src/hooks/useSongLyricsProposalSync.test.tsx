import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSongLyricsProposalSync } from "./useSongLyricsProposalSync";

const mocks = vi.hoisted(() => ({
  auth: { isLoaded: false, isSignedIn: false, userId: null as string | null },
  purge: vi.fn(),
}));

vi.mock("@/hooks/useAppAuth", () => ({
  useAppAuth: () => ({ ...mocks.auth, getToken: vi.fn().mockResolvedValue(null) }),
}));
vi.mock("@/providers/ChurchProvider", () => ({
  useChurch: () => ({ selectedChurch: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/songLyricsProposalOutbox", () => ({
  purgeSongLyricsProposalOutbox: mocks.purge,
  flushSongLyricsProposalOutbox: vi.fn(),
  songLyricsProposalOutboxScope: vi.fn(),
}));

describe("useSongLyricsProposalSync", () => {
  beforeEach(() => {
    mocks.purge.mockReset().mockResolvedValue(undefined);
    mocks.auth.isLoaded = false;
    mocks.auth.isSignedIn = false;
    mocks.auth.userId = null;
  });

  it("does not purge drafts while Clerk is still resolving the initial session", async () => {
    const hook = renderHook(() => useSongLyricsProposalSync());
    await Promise.resolve();
    expect(mocks.purge).not.toHaveBeenCalled();

    mocks.auth.isLoaded = true;
    hook.rerender();
    await waitFor(() => expect(mocks.purge).toHaveBeenCalledTimes(1));
  });
});
