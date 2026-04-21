import { SignIn } from "@clerk/clerk-react";

export default function Login() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <SignIn
        routing="virtual"
        signUpUrl="/signup"
        afterSignInUrl="/app"
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
