import { Capacitor } from "@capacitor/core";

export function getChurchInvitationToken(params: URLSearchParams): string | null {
  for (const key of ["invite", "token"]) {
    const value = params.get(key);
    if (value?.trim()) return value;
  }
  return null;
}

export function getChurchInvitationWebUrl(token: string): string {
  const url = new URL("https://www.tchurchapp.com/join-church");
  url.searchParams.set("invite", token);
  return url.toString();
}

export async function openChurchInvitationInBrowser(token: string): Promise<void> {
  const url = getChurchInvitationWebUrl(token);
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
    return;
  }
  window.location.assign(url);
}
