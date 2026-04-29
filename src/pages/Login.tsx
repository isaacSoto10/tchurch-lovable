import { SignIn } from "@clerk/clerk-react";
import { useAuth } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

function LoginInner() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isSignedIn) {
      navigate("/app");
    }
  }, [isSignedIn, navigate]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4">
      <div className="w-full max-w-md">
        <SignIn
          routing="virtual"
          appearance={{
            elements: {
              socialButtonsBlockButton: { display: "none" },
              dividerLine: { display: "none" },
              dividerText: { display: "none" },
              formFieldLabel: { fontSize: "14px" },
            },
          }}
        />
      </div>
    </div>
  );
}

export default function Login() {
  return <LoginInner />;
}
