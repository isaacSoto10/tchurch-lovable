import { ClerkProvider as BaseClerkProvider } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import {
  CLERK_PUBLISHABLE_KEY,
  clerkAllowedRedirectOrigins,
  clerkAllowedRedirectProtocols,
  clerkRedirects,
  headlessClerk,
  isStandardBrowserRuntime,
} from "@/lib/clerkClient";

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-950 px-6 text-slate-50">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Clerk setup required</p>
          <h1 className="mt-3 text-2xl font-semibold">Add your Clerk publishable key</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in your local environment before opening the sign-in
            page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BaseClerkProvider
      Clerk={headlessClerk}
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl={clerkRedirects.signInUrl}
      signUpUrl={clerkRedirects.signUpUrl}
      fallbackRedirectUrl={clerkRedirects.postAuthRedirect}
      signInFallbackRedirectUrl={clerkRedirects.postAuthRedirect}
      signUpFallbackRedirectUrl={clerkRedirects.postAuthRedirect}
      signInForceRedirectUrl={clerkRedirects.postAuthRedirect}
      signUpForceRedirectUrl={clerkRedirects.postAuthRedirect}
      standardBrowser={isStandardBrowserRuntime}
      allowedRedirectOrigins={clerkAllowedRedirectOrigins}
      allowedRedirectProtocols={clerkAllowedRedirectProtocols}
    >
      {children}
    </BaseClerkProvider>
  );
}
