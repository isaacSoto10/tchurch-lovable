import { SignUp } from "@clerk/clerk-react";

export default function Signup() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <SignUp
        routing="virtual"
        signInUrl="/login"
        afterSignUpUrl="/app"
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
