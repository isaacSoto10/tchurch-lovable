import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth, useSignIn } from "@clerk/clerk-react";
import { ArrowLeft, Loader2, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getClerkErrorMessage } from "@/lib/clerkErrors";

type Step = "email" | "code";
type SupportedFirstFactor = {
  strategy?: string;
  emailAddressId?: string;
  safeIdentifier?: string;
};

function LoginInner() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { signIn, setActive } = useSignIn();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [emailAddressId, setEmailAddressId] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const signInRef = useRef(signIn);
  const setActiveRef = useRef(setActive);

  useEffect(() => {
    signInRef.current = signIn;
    setActiveRef.current = setActive;
  }, [setActive, signIn]);

  useEffect(() => {
    if (isSignedIn) {
      navigate("/app");
    }
  }, [isSignedIn, navigate]);

  if (authLoaded && isSignedIn) {
    return <Navigate to="/app" replace />;
  }

  async function waitForSignInClient() {
    const getClient = () =>
      signInRef.current && setActiveRef.current
        ? { signIn: signInRef.current, setActive: setActiveRef.current }
        : null;
    const readyClient = getClient();
    if (readyClient) return readyClient;

    return new Promise<ReturnType<typeof getClient>>((resolve) => {
      const deadline = Date.now() + 8000;
      const interval = window.setInterval(() => {
        const client = getClient();
        if (client || Date.now() > deadline) {
          window.clearInterval(interval);
          resolve(client);
        }
      }, 100);
    });
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError("");

    try {
      const client = await waitForSignInClient();
      if (!client) {
        setError("Sign-in is unavailable. Please close and reopen the app, then try again.");
        return;
      }

      const result = await client.signIn.create({ identifier: email.trim() });
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

      await client.signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: emailCodeFactor.emailAddressId,
      });
      setStep("code");
    } catch (err) {
      setError(getClerkErrorMessage(err, "Couldn't send a sign-in code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    if (!emailAddressId) {
      setError("Please request a new verification code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const client = await waitForSignInClient();
      if (!client) {
        setError("Sign-in is unavailable. Please close and reopen the app, then try again.");
        return;
      }

      const result = await client.signIn.attemptFirstFactor({
        strategy: "email_code",
        code: code.trim(),
      });

      if (result.status === "complete" && result.createdSessionId) {
        await client.setActive({ session: result.createdSessionId });
        navigate("/app", { replace: true });
        return;
      }

      setError("Your sign-in is not complete yet. Please try again.");
    } catch (err) {
      setError(getClerkErrorMessage(err, "That code didn't work. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    if (!emailAddressId) {
      setError("Please request a new verification code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const client = await waitForSignInClient();
      if (!client) {
        setError("Sign-in is unavailable. Please close and reopen the app, then try again.");
        return;
      }

      await client.signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId,
      });
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
            <form className="space-y-4" noValidate onSubmit={handleEmailSubmit}>
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
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
              <Button className="h-11 w-full" disabled={loading || !email.trim()} type="submit">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" noValidate onSubmit={handleCodeSubmit}>
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
                    Signing in...
                  </>
                ) : (
                  "Sign In"
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
                  setEmailAddressId("");
                  setCode("");
                  setError("");
                }}
              >
                Use a different email
              </Button>
            </form>
          )}

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
