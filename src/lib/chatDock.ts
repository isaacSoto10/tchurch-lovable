export const OPEN_CHAT_DOCK_EVENT = "tchurch:open-chat-dock";

export type OpenChatDockDetail = {
  channelId?: string | null;
  ministryId?: string | null;
};

export function openChatDock(detail: OpenChatDockDetail = {}) {
  window.dispatchEvent(new CustomEvent<OpenChatDockDetail>(OPEN_CHAT_DOCK_EVENT, { detail }));
}

export function chatDockStorageKey(churchId?: string | null) {
  return `tchurch_chat_dock_v1:${churchId || "none"}`;
}

export function readChatDockPreference(churchId?: string | null): { open: boolean; channelId: string | null } {
  try {
    const raw = localStorage.getItem(chatDockStorageKey(churchId));
    if (!raw) return { open: false, channelId: null };
    const value = JSON.parse(raw) as { open?: unknown; channelId?: unknown };
    return {
      open: value.open === true,
      channelId: typeof value.channelId === "string" && value.channelId ? value.channelId : null,
    };
  } catch {
    return { open: false, channelId: null };
  }
}

export function writeChatDockPreference(churchId: string | null | undefined, value: { open: boolean; channelId: string | null }) {
  try {
    localStorage.setItem(chatDockStorageKey(churchId), JSON.stringify(value));
  } catch {
    // The dock remains usable when storage is unavailable.
  }
}

export function getChatDockBottomCss(options: { keyboardOpen: boolean; hasBottomNav: boolean }) {
  if (options.keyboardOpen) return "max(0.5rem, var(--app-safe-area-bottom, 0px))";
  if (options.hasBottomNav) {
    return "calc(var(--tchurch-mobile-nav-height, 4.5rem) + var(--app-safe-area-bottom, 1.375rem) + 0.75rem)";
  }
  return "1.25rem";
}
