import { ClerkProvider as BaseClerkProvider } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

const CLERK_PUBLISHABLE_KEY = "pk_test_cHJlY2lzZS1tYW1tYWwtODguY2xlcmsuYWNjb3VudHMuZGV2JA";

const FALLBACK_REDIRECT_URL = "https://e5ddf50f-f80d-4eb7-a86a-937f7a9f8a62.lovableproject.com/";

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();

  return (
    <BaseClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      fallbackRedirectUrl={FALLBACK_REDIRECT_URL}
    >
      {children}
    </BaseClerkProvider>
  );
}
