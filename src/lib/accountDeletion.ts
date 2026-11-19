import { setChurchId } from "@/lib/api";
import { purgeAccountEventCheckIns } from "@/lib/eventCheckInQueue";
import { clearMediaSnapshots } from "@/lib/media";
import { clearNativeApiCache } from "@/lib/nativeApiCache";
import { purgeAccountPresentationCache } from "@/lib/presentationLive";
import { purgeAccountRemoteIntentReceipts } from "@/lib/presentationRemoteIntentReceiver";
import { purgeAccountSongLyricsProposals } from "@/lib/songLyricsProposalOutbox";
import { studioLANPrivacyCoordinator } from "@/lib/studioLANPrivacyCoordinator";

export type AccountDeletionResult = "completed" | "pending";

export async function clearDeletedAccountData(accountId: string, clearActiveSessionData: boolean) {
  const removeStorage = async () => {
    const messagePrefix = `tchurch-message-reading-v1/${encodeURIComponent(accountId)}/`;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(messagePrefix)) localStorage.removeItem(key);
    }
    if (localStorage.getItem("tchurch_push_token")?.split(":")[2] === accountId) {
      localStorage.removeItem("tchurch_push_token");
    }
    purgeAccountRemoteIntentReceipts(accountId);
    if (!clearActiveSessionData) return;
    setChurchId(null);
    clearNativeApiCache();
    clearMediaSnapshots();
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key && /^tchurch_ios_\w+_snapshot_v\d+:/.test(key)) sessionStorage.removeItem(key);
    }
    sessionStorage.removeItem("tchurch_action_log_session_id");
  };

  const cleanup = [
    removeStorage(),
    purgeAccountPresentationCache(accountId),
    purgeAccountEventCheckIns(accountId),
    purgeAccountSongLyricsProposals(accountId),
  ];
  if (clearActiveSessionData) cleanup.push(studioLANPrivacyCoordinator.signedOut());
  const results = await Promise.allSettled(cleanup);
  return results.every((result) => result.status === "fulfilled");
}
