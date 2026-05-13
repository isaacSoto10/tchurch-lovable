import { Capacitor } from "@capacitor/core";
import { Clerk as HeadlessClerk } from "@clerk/clerk-js/headless";

export const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  "pk_live_Y2xlcmsudGNodXJjaGFwcC5jb20k";

export const IOS_BUNDLE_ID = "app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch";
export const isNativeClerkRuntime = Capacitor.isNativePlatform();
export const isStandardBrowserRuntime = !isNativeClerkRuntime;

export const clerkRedirects = {
  postAuthRedirect: isNativeClerkRuntime ? "/#/app" : "/app",
  signInUrl: isNativeClerkRuntime ? "/#/login" : "/login",
  signUpUrl: isNativeClerkRuntime ? "/#/signup" : "/signup",
};

export const clerkAllowedRedirectOrigins = isNativeClerkRuntime
  ? ["https://tchurchapp.com", "https://www.tchurchapp.com", "https://accounts.tchurchapp.com"]
  : undefined;

export const clerkAllowedRedirectProtocols = isNativeClerkRuntime
  ? ["https", "tchurchapp", IOS_BUNDLE_ID]
  : undefined;

export const headlessClerk = new HeadlessClerk(CLERK_PUBLISHABLE_KEY);

let loadPromise: Promise<typeof headlessClerk> | null = null;

function getRuntimeDiagnostics() {
  return {
    href: window.location.href,
    origin: window.location.origin,
    platform: Capacitor.getPlatform(),
    standardBrowser: isStandardBrowserRuntime,
  };
}

export async function ensureHeadlessClerkLoaded() {
  if (headlessClerk.loaded) {
    return headlessClerk;
  }

  console.info("[TchurchAuth] Loading Clerk", getRuntimeDiagnostics());

  loadPromise ??= headlessClerk
    .load({
      signInUrl: clerkRedirects.signInUrl,
      signUpUrl: clerkRedirects.signUpUrl,
      fallbackRedirectUrl: clerkRedirects.postAuthRedirect,
      signInFallbackRedirectUrl: clerkRedirects.postAuthRedirect,
      signUpFallbackRedirectUrl: clerkRedirects.postAuthRedirect,
      signInForceRedirectUrl: clerkRedirects.postAuthRedirect,
      signUpForceRedirectUrl: clerkRedirects.postAuthRedirect,
      standardBrowser: isStandardBrowserRuntime,
      allowedRedirectOrigins: clerkAllowedRedirectOrigins,
      allowedRedirectProtocols: clerkAllowedRedirectProtocols,
    })
    .then(() => headlessClerk)
    .catch((error) => {
      console.error("[TchurchAuth] Clerk load failed", { ...getRuntimeDiagnostics(), error });
      loadPromise = null;
      throw error;
    });

  return loadPromise;
}
