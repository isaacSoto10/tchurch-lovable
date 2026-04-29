import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSignUp } from "@clerk/clerk-react";
import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";
import { Loader2, MailPlus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Step = "email" | "code";

function SignupInner() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signUp, setActive } = useSignUp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isSignedIn) {
      navigate("/app");
    }
  }, [isSignedIn, navigate]);

  if (authLoaded && isSignedIn) {
    return <Navigate to="/app" replace />;
  }

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !email.trim()) return;

    setLoading(true);
    setError("");

    try {
      await signUp.create({ emailAddress: email.trim() });
      await signUp.prepareVerification({ strategy: "email_code" });
      setStep("code");
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        setError(err.errors[0]?.longMessage || err.errors[0]?.message || "Couldn't start sign up.");
      } else {
        setError("Couldn't start sign up.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !code.trim()) return;

    setLoading(true);
    setError("");

    try {
      const result = await signUp.attemptVerification({
        strategy: "email_code",
        code: code.trim(),
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        navigate("/app", { replace: true });
        return;
      }

      setError("Your sign up is not complete yet. Please try again.");
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        setError(err.errors[0]?.longMessage || err.errors[0]?.message || "That code didn't work.");
      } else {
        setError("That code didn't work.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    if (!isLoaded || !signUp) return;

    setLoading(true);
    setError("");

    try {
      await signUp.prepareVerification({ strategy: "email_code" });
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        setError(err.errors[0]?.longMessage || err.errors[0]?.message || "Couldn't resend the code.");
      } else {
        setError("Couldn't resend the code.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4">
      <Card className="w-full max-w-md border-slate-200 shadow-xl shadow-indigo-100/50">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {step === "email" ? <MailPlus className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          </div>
          <div className="space-y-1">
            <CardTitle>Create your tchurch account</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Start with your email and we'll send a verification code."
                : `Enter the code we sent to ${email}.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <form className="space-y-4" onSubmit={handleSignupSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="email">
                  Email address
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  disabled={loading}
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button className="w-full" disabled={!isLoaded || loading || !email.trim()} type="submit">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleVerifySubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="code">
                  Verification code
                </label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  disabled={loading}
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button className="w-full" disabled={!isLoaded || loading || code.length < 6} type="submit">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify Email"}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                disabled={loading || !isLoaded}
                onClick={handleResendCode}
              >
                Resend code
              </Button>
              <Button
                className="w-full"
                variant="ghost"
                type="button"
                disabled={loading}
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError("");
                }}
              >
                Use a different email
              </Button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/login">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Signup() {
  return <SignupInner />;
}
