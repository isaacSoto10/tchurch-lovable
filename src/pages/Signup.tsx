import { SignUp, useAuth } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

export default function Signup() {
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && isSignedIn) {
      navigate("/app", { replace: true });
    }
  }, [isLoaded, isSignedIn, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <SignUp
        routing="virtual"
        signInUrl="/login"
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "shadow-xl",
            socialButtonsBlockButton: "hidden",
            socialButtonsBlockButtonText: "hidden",
            dividerRow: "hidden",
            dividerText: "hidden",
          },
        }}
      />
    </div>
  );
}
