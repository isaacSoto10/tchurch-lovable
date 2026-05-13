export const WEB_SIGNUP_URL = "https://tchurchapp.com/sign-up";

export async function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openSignupInBrowser() {
  return openExternalUrl(WEB_SIGNUP_URL);
}
