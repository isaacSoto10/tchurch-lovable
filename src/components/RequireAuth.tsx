import { useAuth } from "@clerk/clerk-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useEffect } from "react";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();

  // When auth finishes loading and user is signed in, navigate to /app
  // This handles the case where Clerk signs in via virtual routing
  // and the URL hasn't changed yet
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      // Check if we're not already on an /app route
      if (!window.location.pathname.startsWith("/app")) {
        navigate("/app", { replace: true });
      }
    }
  }, [isLoaded, isSignedIn, navigate]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
