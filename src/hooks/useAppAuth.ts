import { useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { useEffect, useMemo, useState } from "react";
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

export function useAppAuth() {
  const clerkAuth = useAuth();
  const clerk = useClerk();
  const { user: clerkUser } = useUser();
  const [mobileSession, setMobileSession] = useState<MobileAuthSession | null>(() => getMobileAuthSession());

  useEffect(() => {
    if (!isNativeMobileAuth) return undefined;
    return onMobileAuthChange(() => setMobileSession(getMobileAuthSession()));
  }, []);

  return useMemo(() => {
    if (!isNativeMobileAuth) {
      return {
        isLoaded: clerkAuth.isLoaded,
        isSignedIn: clerkAuth.isSignedIn,
        userId: clerkAuth.userId,
        user: clerkUser,
        getToken: clerkAuth.getToken,
        signOut: async (redirectUrl = "/") => {
          await studioLANPrivacyCoordinator.signedOut();
          await clerk.signOut({ redirectUrl });
        },
      };
    }

    return {
      isLoaded: true,
      isSignedIn: Boolean(mobileSession),
      userId: mobileSession?.user.id ?? null,
      user: mobileUser(mobileSession),
      getToken: async () => mobileSession?.token ?? null,
      signOut: async (redirectUrl = "/") => {
        await studioLANPrivacyCoordinator.signedOut();
        clearMobileAuthSession();
        window.location.hash = redirectUrl === "/" ? "#/" : `#${redirectUrl}`;
      },
    };
  }, [clerk, clerkAuth.getToken, clerkAuth.isLoaded, clerkAuth.isSignedIn, clerkAuth.userId, clerkUser, mobileSession]);
}
