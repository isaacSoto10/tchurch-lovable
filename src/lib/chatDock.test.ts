import { beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_CHAT_DOCK_EVENT, chatDockStorageKey, getChatDockBottomCss, openChatDock, readChatDockPreference, writeChatDockPreference } from "./chatDock";

describe("chat dock preferences", () => {
  beforeEach(() => localStorage.clear());

  it("keeps open state and selected channel isolated by church", () => {
    writeChatDockPreference("church-1", { open: true, channelId: "channel-1" });
    expect(readChatDockPreference("church-1")).toEqual({ open: true, channelId: "channel-1" });
    expect(readChatDockPreference("church-2")).toEqual({ open: false, channelId: null });
    expect(chatDockStorageKey("church-1")).not.toBe(chatDockStorageKey("church-2"));
  });

  it("emits an app-wide request to open a ministry channel", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_CHAT_DOCK_EVENT, listener);
    openChatDock({ ministryId: "ministry-1" });
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ ministryId: "ministry-1" });
    window.removeEventListener(OPEN_CHAT_DOCK_EVENT, listener);
  });

  it("stays above the bottom nav and moves to the keyboard safe area", () => {
    expect(getChatDockBottomCss({ keyboardOpen: false, hasBottomNav: true })).toContain("--tchurch-mobile-nav-height");
    expect(getChatDockBottomCss({ keyboardOpen: false, hasBottomNav: true })).toContain("--app-safe-area-bottom");
    expect(getChatDockBottomCss({ keyboardOpen: true, hasBottomNav: true })).toContain("--app-safe-area-bottom");
    expect(getChatDockBottomCss({ keyboardOpen: false, hasBottomNav: false })).toBe("1.25rem");
  });
});
