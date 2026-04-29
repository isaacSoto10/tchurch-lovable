import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useAuth, useSignIn } from "@clerk/clerk-react";
import { isClerkAPIResponseError } from "@clerk/clerk-react/errors";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Step = "email" | "code";
type SupportedFirstFactor = {
  strategy?: string;
  emailAddressId?: string;
  safeIdentifier?: string;
};

function LoginInner() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();
  const isNative = Capacitor.isNativePlatform();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [emailAddressId, setEmailAddressId] = useState("");
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

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !email.trim()) return;

    setLoading(true);
    setError("");

    try {
      const result = await signIn.create({ identifier: email.trim() });
      const emailCodeFactor = (result.supportedFirstFactors as SupportedFirstFactor[] | undefined)?.find(
        (factor) => factor.strategy === "email_code" && factor.emailAddressId,
      );

      if (!emailCodeFactor?.emailAddressId) {
        setError("Clerk didn't return an email address for code verification.");
        return;
      }

      setEmailAddressId(emailCodeFactor.emailAddressId);
      if (emailCodeFactor.safeIdentifier) {
        setEmail(emailCodeFactor.safeIdentifier);
      }

      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: emailCodeFactor.emailAddressId,
      });
      setStep("code");
    } catch (err) {
      if (isClerkAPIResponseError(err)) {
        setError(err.errors[0]?.longMessage || err.errors[0]?.message || "Couldn't send a sign-in code.");
      } else {
        setError("Couldn't send a sign-in code.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !code.trim() || !emailAddressId) return;

    setLoading(true);
    setError("");

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: code.trim(),
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        navigate("/app", { replace: true });
        return;
      }

      setError("Your sign-in is not complete yet. Please try again.");
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
    if (!isLoaded || !signIn || !emailAddressId) return;

    setLoading(true);
    setError("");

    try {
      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId,
      });
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
            {step === "email" ? <Mail className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
          </div>
          <div className="space-y-1">
            <CardTitle>Sign in to tchurch</CardTitle>
            <CardDescription>
              {step === "email"
                ? "We'll email you a one-time sign-in code."
                : `Enter the code we sent to ${email}.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <form className="space-y-4" onSubmit={handleEmailSubmit}>
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
            <form className="space-y-4" onSubmit={handleCodeSubmit}>
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
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
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
                  setEmailAddressId("");
                  setCode("");
                  setError("");
                }}
              >
                Use a different email
              </Button>
            </form>
          )}

          {isNative ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Google sign-in is temporarily disabled in the iOS simulator because the browser redirect is not
              restoring the Clerk session back into the Capacitor webview yet.
            </div>
          ) : null}

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/signup">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Login() {
  return <LoginInner />;
}
