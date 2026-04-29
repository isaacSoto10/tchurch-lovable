import { ClerkProvider as BaseClerkProvider } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

const CLERK_PUBLISHABLE_KEY = "pk_live_Y2xlcmsudGNodXJjaGFwcC5jb20k";

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

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
