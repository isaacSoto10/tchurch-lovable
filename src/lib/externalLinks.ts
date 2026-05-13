import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

export const WEB_SIGNUP_URL = "https://tchurchapp.com/sign-up";

export async function openExternalUrl(url: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({ url });
      return;
    } catch (error) {
      console.warn("[externalLinks] Capacitor Browser failed, falling back to window.open", error);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
  }

  window.location.assign(url);
}

export function openSignupInBrowser() {
  return openExternalUrl(WEB_SIGNUP_URL);
}
