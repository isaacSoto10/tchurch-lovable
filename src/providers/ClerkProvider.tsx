import { ClerkProvider as BaseClerkProvider, useClerk } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

const CLERK_PUBLISHABLE_KEY = "pk_test_cHJlY2lzZS1tYW1tYWwtODguY2xlcmsuYWNjb3VudHMuZGV2JA";

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <BaseClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      fallbackRedirectUrl="/"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignInUrl="/app"
      afterSignUpUrl="/app"
      clerkJSVersion="5"
    >
      {children}
    </BaseClerkProvider>
  );
}
