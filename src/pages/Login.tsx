import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { TchurchLogo } from "@/components/TchurchLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAppAuth } from "@/hooks/useAppAuth";
import { ensureHeadlessClerkLoaded } from "@/lib/clerkClient";
import { getClerkErrorMessage } from "@/lib/clerkErrors";
import { logUserAction } from "@/lib/userActionLogger";
import {
  isNativeMobileAuth,
  MobileAuthApiError,
  requestMobileAuthCode,
  verifyMobileAuthCode,
} from "@/lib/mobileAuth";

type Step = "email" | "code";
type SupportedFirstFactor = {
  strategy?: string;
  emailAddressId?: string;
  safeIdentifier?: string;
};

function getNativeMobileAuthError(err: unknown) {
  if (err instanceof MobileAuthApiError) {
    return err.message;
  }

  return err instanceof Error ? err.message : "No pudimos enviar el código. Intenta de nuevo.";
}

function authFailureMetadata(err: unknown) {
  if (err instanceof MobileAuthApiError) {
    return { status: err.status, code: err.code || null };
  }

  return { status: "unknown" };
}

function LoginInner() {
  const { isLoaded: authLoaded, isSignedIn } = useAppAuth();
  const navigate = useNavigate();
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
    if (!email.trim()) return;

    setLoading(true);
    setError("");

    try {
      if (isNativeMobileAuth) {
        const result = await requestMobileAuthCode(email.trim());
        setEmail(result.email);
        setEmailAddressId("mobile");
        setStep("code");
        logUserAction("auth.code_requested", { flow: "sign_in", provider: "mobile_auth" });
        return;
      }

      const clerk = await ensureHeadlessClerkLoaded();
      const signIn = clerk.client?.signIn;

      if (!signIn) {
        setError("No pudimos conectar el inicio de sesión. Cierra y vuelve a abrir la app, e intenta de nuevo.");
        return;
      }

      const result = await signIn.create({ identifier: email.trim() });
      const emailCodeFactor = (result.supportedFirstFactors as SupportedFirstFactor[] | undefined)?.find(
        (factor) => factor.strategy === "email_code" && factor.emailAddressId,
      );

      if (!emailCodeFactor?.emailAddressId) {
        setError("Clerk no devolvió un correo para verificar el código.");
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
      logUserAction("auth.code_requested", { flow: "sign_in", provider: "clerk_email_code" });
    } catch (err) {
      logUserAction("auth.code_request_failed", {
        flow: "sign_in",
        provider: isNativeMobileAuth ? "mobile_auth" : "clerk_email_code",
        ...authFailureMetadata(err),
      });
      setError(isNativeMobileAuth ? getNativeMobileAuthError(err) : getClerkErrorMessage(err, "No pudimos enviar el código. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;

    if (!emailAddressId) {
      setError("Solicita un nuevo código de verificación.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (isNativeMobileAuth) {
        await verifyMobileAuthCode(email, code.trim());
        logUserAction("auth.sign_in_completed", { provider: "mobile_auth" }, { immediate: true });
        navigate("/app", { replace: true });
        return;
      }

      const clerk = await ensureHeadlessClerkLoaded();
      const signIn = clerk.client?.signIn;

      if (!signIn) {
        setError("No pudimos conectar el inicio de sesión. Cierra y vuelve a abrir la app, e intenta de nuevo.");
        return;
      }

      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: code.trim(),
      });

      if (result.status === "complete" && result.createdSessionId) {
        await clerk.setActive({ session: result.createdSessionId });
        logUserAction("auth.sign_in_completed", { provider: "clerk_email_code" }, { immediate: true });
        navigate("/app", { replace: true });
        return;
      }

      setError("Tu inicio de sesión todavía no está completo. Intenta de nuevo.");
    } catch (err) {
      logUserAction("auth.verification_failed", {
        flow: "sign_in",
        provider: isNativeMobileAuth ? "mobile_auth" : "clerk_email_code",
        ...authFailureMetadata(err),
      });
      setError(isNativeMobileAuth ? getNativeMobileAuthError(err) : getClerkErrorMessage(err, "Ese código no funcionó. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    if (!emailAddressId) {
      setError("Solicita un nuevo código de verificación.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      if (isNativeMobileAuth) {
        await requestMobileAuthCode(email.trim());
        logUserAction("auth.code_resent", { flow: "sign_in", provider: "mobile_auth" });
        return;
      }

      const clerk = await ensureHeadlessClerkLoaded();
      const signIn = clerk.client?.signIn;

      if (!signIn) {
        setError("No pudimos conectar el inicio de sesión. Cierra y vuelve a abrir la app, e intenta de nuevo.");
        return;
      }

      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId,
      });
      logUserAction("auth.code_resent", { flow: "sign_in", provider: "clerk_email_code" });
    } catch (err) {
      logUserAction("auth.code_resend_failed", {
        flow: "sign_in",
        provider: isNativeMobileAuth ? "mobile_auth" : "clerk_email_code",
        ...authFailureMetadata(err),
      });
      setError(isNativeMobileAuth ? getNativeMobileAuthError(err) : getClerkErrorMessage(err, "No pudimos reenviar el código. Intenta de nuevo."));
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
            <CardTitle>Inicia sesión en Tchurch</CardTitle>
            <CardDescription>
              {step === "email"
                ? "Te enviaremos un código de acceso por correo."
                : `Ingresa el código que enviamos a ${email}.`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "email" ? (
            <form className="space-y-4" noValidate onSubmit={handleEmailSubmit}>
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
              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}
              <Button className="h-11 w-full" disabled={loading || !email.trim()} type="submit">
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
            <form className="space-y-4" noValidate onSubmit={handleCodeSubmit}>
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
                    Iniciando sesión...
                  </>
                ) : (
                  "Iniciar sesión"
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
                  setEmailAddressId("");
                  setCode("");
                  setError("");
                }}
              >
                Usar otro correo
              </Button>
            </form>
          )}

          {isNativeMobileAuth ? (
            <p className="text-center text-sm text-muted-foreground">
              ¿No tienes acceso?{" "}
              <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/join-church">
                Únete a tu iglesia
              </Link>
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              ¿No tienes cuenta?{" "}
              <Link className="font-medium text-primary underline-offset-4 hover:underline" to="/signup">
                Crear cuenta
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Login() {
  return <LoginInner />;
}
