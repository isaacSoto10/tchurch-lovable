import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearMobileAuthSession,
  getMobileAuthSession,
  isNativeMobileAuth,
  onMobileAuthChange,
  type MobileAuthSession,
} from "@/lib/mobileAuth";
import { studioLANPrivacyCoordinator } from "@/lib/studioLANPrivacyCoordinator";

function mobileUser(session: MobileAuthSession | null) {
  if (!session) return null;

  const name = [session.user.firstName, session.user.lastName].filter(Boolean).join(" ").trim();

  return {
    id: session.user.id,
    firstName: session.user.firstName ?? null,
    lastName: session.user.lastName ?? null,
    fullName: name || session.user.email,
    imageUrl: session.user.imageUrl ?? null,
    primaryEmailAddress: {
      emailAddress: session.user.email,
    },
  };
}

export function useNativeAppAuth() {
  const [mobileSession, setMobileSession] = useState<MobileAuthSession | null>(() => getMobileAuthSession());

  useEffect(() => {
    return onMobileAuthChange(() => setMobileSession(getMobileAuthSession()));
  }, []);

  const mobileGetToken = useCallback(async () => mobileSession?.token ?? null, [mobileSession?.token]);
  const mobileSignOut = useCallback(async (redirectUrl = "/") => {
    await studioLANPrivacyCoordinator.signedOut();
    clearMobileAuthSession();
    window.location.hash = redirectUrl === "/" ? "#/" : `#${redirectUrl}`;
  }, []);
  const mobileAuth = useMemo(
    () => ({
      isLoaded: true,
      isSignedIn: Boolean(mobileSession),
      userId: mobileSession?.user.id ?? null,
      user: mobileUser(mobileSession),
      getToken: mobileGetToken,
      signOut: mobileSignOut,
    }),
    [mobileGetToken, mobileSession, mobileSignOut],
  );
  return mobileAuth;
}

export function useClerkAppAuth() {
  const clerkAuth = useAuth();
  const clerk = useClerk();
  const { user: clerkUser } = useUser();
  const clerkSignOut = useCallback(
    async (redirectUrl = "/") => {
      await studioLANPrivacyCoordinator.signedOut();
      await clerk.signOut({ redirectUrl });
    },
    [clerk],
  );
  const clerkAppAuth = useMemo(
    () => ({
      isLoaded: clerkAuth.isLoaded,
      isSignedIn: clerkAuth.isSignedIn,
      userId: clerkAuth.userId,
      user: clerkUser,
      getToken: clerkAuth.getToken,
      signOut: clerkSignOut,
    }),
    [clerkAuth.getToken, clerkAuth.isLoaded, clerkAuth.isSignedIn, clerkAuth.userId, clerkSignOut, clerkUser],
  );

  return clerkAppAuth;
}

// The runtime is fixed for the lifetime of the bundle. Native sessions do not
// subscribe to Clerk, so Clerk finishing its lifecycle cannot restart API effects.
export const useAppAuth = isNativeMobileAuth ? useNativeAppAuth : useClerkAppAuth;
