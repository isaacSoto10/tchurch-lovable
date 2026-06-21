import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TchurchLogo } from "@/components/TchurchLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/hooks/useAppAuth";
import { ensureHeadlessClerkLoaded } from "@/lib/clerkClient";
import { getClerkErrorMessage } from "@/lib/clerkErrors";
import { isNativeMobileAuth, requestMobileAuthCode, verifyMobileAuthCode } from "@/lib/mobileAuth";
import { logUserAction } from "@/lib/userActionLogger";

type Step = "email" | "code";

function SignupInner() {
  const { isLoaded: authLoaded, isSignedIn } = useAppAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

  if (isNativeMobileAuth) {
    return <Navigate to={`/join-church${location.search}`} replace />;
  }

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (!isNativeMobileAuth && password.length < 8) {
      setError("Ingresa una contraseña de al menos 8 caracteres.");
      return;
    }
    if (!isNativeMobileAuth && password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (isNativeMobileAuth) {
        const result = await requestMobileAuthCode(email.trim());
        setEmail(result.email);
        setStep("code");
        logUserAction("auth.code_requested", { flow: "sign_up", provider: "mobile_auth" });
        return;
      }

      const clerk = await ensureHeadlessClerkLoaded();
      const signUp = clerk.client?.signUp;

      if (!signUp) {
        setError("No pudimos conectar el registro. Cierra y vuelve a abrir la app, e intenta de nuevo.");
        return;
      }

      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareVerification({ strategy: "email_code" });
      setStep("code");
      logUserAction("auth.code_requested", { flow: "sign_up", provider: "clerk_email_code" });
    } catch (err) {
      logUserAction("auth.code_request_failed", {
        flow: "sign_up",
        provider: isNativeMobileAuth ? "mobile_auth" : "clerk_email_code",
      });
      setError(isNativeMobileAuth && err instanceof Error ? err.message : getClerkErrorMessage(err, "No pudimos iniciar el registro. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setError("");

    try {
      if (isNativeMobileAuth) {
        await verifyMobileAuthCode(email, code.trim());
        logUserAction("auth.sign_up_completed", { provider: "mobile_auth" }, { immediate: true });
        navigate("/app", { replace: true });
        return;
      }

      const clerk = await ensureHeadlessClerkLoaded();
      const signUp = clerk.client?.signUp;

      if (!signUp) {
        setError("No pudimos conectar el registro. Cierra y vuelve a abrir la app, e intenta de nuevo.");
        return;
      }

      const result = await signUp.attemptVerification({
        strategy: "email_code",
        code: code.trim(),
      });

      if (result.status === "complete" && result.createdSessionId) {
        await clerk.setActive({ session: result.createdSessionId });
        logUserAction("auth.sign_up_completed", { provider: "clerk_email_code" }, { immediate: true });
        navigate("/app", { replace: true });
        return;
      }

      setError("Tu registro todavía no está completo. Intenta de nuevo.");
    } catch (err) {
      logUserAction("auth.verification_failed", {
        flow: "sign_up",
        provider: isNativeMobileAuth ? "mobile_auth" : "clerk_email_code",
      });
      setError(isNativeMobileAuth && err instanceof Error ? err.message : getClerkErrorMessage(err, "Ese código no funcionó. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setLoading(true);
    setError("");

    try {
      if (isNativeMobileAuth) {
        await requestMobileAuthCode(email.trim());
        logUserAction("auth.code_resent", { flow: "sign_up", provider: "mobile_auth" });
        return;
      }

      const clerk = await ensureHeadlessClerkLoaded();
      const signUp = clerk.client?.signUp;

      if (!signUp) {
        setError("No pudimos conectar el registro. Cierra y vuelve a abrir la app, e intenta de nuevo.");
        return;
      }

      await signUp.prepareVerification({ strategy: "email_code" });
      logUserAction("auth.code_resent", { flow: "sign_up", provider: "clerk_email_code" });
    } catch (err) {
      logUserAction("auth.code_resend_failed", {
        flow: "sign_up",
        provider: isNativeMobileAuth ? "mobile_auth" : "clerk_email_code",
      });
      setError(isNativeMobileAuth && err instanceof Error ? err.message : getClerkErrorMessage(err, "No pudimos reenviar el código. Intenta de nuevo."));
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
        Inicio
      </Link>
      <Card className="w-full max-w-md border-slate-200 shadow-xl shadow-indigo-100/50">
        <CardHeader className="space-y-3 text-center">
          <TchurchLogo variant="stacked" size="sm" wordPurple className="mx-auto" />
          <div className="space-y-1">
            <CardTitle>Crea tu cuenta de Tchurch</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Crea tu cuenta y verifica tu correo con un código."
                : `Ingresa el código que enviamos a ${email}.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <form className="space-y-4" noValidate onSubmit={handleSignupSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="email">
                  Correo electrónico
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
              {!isNativeMobileAuth ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor="password">
                      Contraseña
                    </label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Al menos 8 caracteres"
                      disabled={loading}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">
                      Confirmar contraseña
                    </label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Vuelve a escribir tu contraseña"
                      disabled={loading}
                    />
                  </div>
                </>
              ) : null}
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                className="h-11 w-full"
                disabled={loading || !email.trim() || (!isNativeMobileAuth && (!password || !confirmPassword))}
                type="submit"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando código...
                  </>
                ) : (
                  "Continuar"
                )}
              </Button>
            </form>
          ) : (
            <form className="space-y-4" noValidate onSubmit={handleVerifySubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="code">
                  Código de verificación
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
                    Verificando...
                  </>
                ) : (
                  "Verificar correo"
                )}
              </Button>
              <Button
                className="w-full"
                variant="outline"
                type="button"
                disabled={loading}
                onClick={handleResendCode}
              >
                Reenviar código
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
                Usar otro correo
              </Button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/login">
              Iniciar sesión
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
