import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSignUp } from "@clerk/clerk-react";
import { ArrowLeft, Loader2, MailPlus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClerkErrorMessage } from "@/lib/clerkErrors";

type Step = "email" | "code";

function SignupInner() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signUp, setActive } = useSignUp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const authReady = isLoaded && Boolean(signUp);

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
    if (!email.trim()) return;
    if (password.length < 8) {
      setError("Please enter a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!authReady || !signUp) {
      setError("Secure sign-up is still loading. Please try again in a moment.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareVerification({ strategy: "email_code" });
      setStep("code");
    } catch (err) {
      setError(getClerkErrorMessage(err, "Couldn't start sign up. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    if (!authReady || !signUp) {
      setError("Secure sign-up is still loading. Please try again in a moment.");
      return;
    }

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
      setError(getClerkErrorMessage(err, "That code didn't work. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    if (!authReady || !signUp) {
      setError("Secure sign-up is still loading. Please try again in a moment.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await signUp.prepareVerification({ strategy: "email_code" });
    } catch (err) {
      setError(getClerkErrorMessage(err, "Couldn't resend the code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4">
      <Link
        className="absolute left-4 top-[calc(env(safe-area-inset-top)+1rem)] inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm shadow-indigo-100/60 backdrop-blur transition-colors hover:bg-white"
        to="/"
      >
        <ArrowLeft className="h-4 w-4" />
        Home
      </Link>
      <Card className="w-full max-w-md border-slate-200 shadow-xl shadow-indigo-100/50">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {step === "email" ? <MailPlus className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          </div>
          <div className="space-y-1">
            <CardTitle>Create your tchurch account</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Create your account, then verify your email with a one-time code."
                : `Enter the code we sent to ${email}.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <form className="space-y-4" noValidate onSubmit={handleSignupSubmit}>
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
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="password">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">
                  Confirm password
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  disabled={loading}
                />
              </div>
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : !authReady ? (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  Preparing secure sign-up...
                </p>
              ) : null}
              <Button
                className="h-11 w-full"
                disabled={loading || !email.trim() || !password || !confirmPassword}
                type="submit"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : authReady ? (
                  "Continue"
                ) : (
                  "Preparing sign-up..."
                )}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" noValidate onSubmit={handleVerifySubmit}>
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
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
              <Button className="h-11 w-full" disabled={loading || code.length < 6} type="submit">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify Email"
                )}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                disabled={loading}
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
