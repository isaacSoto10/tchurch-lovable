import { ClerkProvider as BaseClerkProvider } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

const CLERK_PUBLISHABLE_KEY = "pk_test_cHJlY2lzZS1tYW1tYWwtODguY2xlcmsuYWNjb3VudHMuZGV2JA";

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <BaseClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => {
        // Use full navigation for post-auth redirects to ensure
        // session is fully loaded before RequireAuth checks
        if (to === "/app" || to.startsWith("/app/")) {
          window.location.href = to;
        } else {
          navigate(to);
        }
      }}
      routerReplace={(to) => {
        if (to === "/app" || to.startsWith("/app/")) {
          window.location.replace(to);
        } else {
          navigate(to, { replace: true });
        }
      }}
      fallbackRedirectUrl="/"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignInUrl="/app"
      afterSignUpUrl="/app"
    >
      {children}
    </BaseClerkProvider>
  );
}
