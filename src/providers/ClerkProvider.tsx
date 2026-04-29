import { ClerkProvider as BaseClerkProvider } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const isDev = import.meta.env.DEV;

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

  if (isDev && CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-slate-950 px-6 text-slate-50">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Local auth is blocked</p>
          <h1 className="mt-3 text-2xl font-semibold">Your simulator is using a production Clerk key</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            Clerk production keys only work on your configured production domain. This local app is running from{" "}
            <code>{window.location.origin}</code>, so the embedded sign-in flow will fail.
          </p>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Use a <code>pk_test_...</code> key in <code>VITE_CLERK_PUBLISHABLE_KEY</code> for local simulator
            testing, or test against your real production domain instead.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BaseClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      fallbackRedirectUrl="/"
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
    >
      {children}
    </BaseClerkProvider>
  );
}
