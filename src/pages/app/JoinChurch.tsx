import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, Mail, ShieldCheck, XCircle } from "lucide-react";
import { TchurchLogo } from "@/components/TchurchLogo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch, setChurchId } from "@/lib/api";
import { useAppAuth } from "@/hooks/useAppAuth";
import {
  isNativeMobileAuth,
  requestMobileJoinAuthCode,
  verifyMobileJoinAuthCode,
  type MobileJoinChurch,
} from "@/lib/mobileAuth";

type JoinStep = "details" | "verify";
type PreviewState = "idle" | "checking" | "valid" | "invalid";

type JoinCodePreview = {
  valid: boolean;
  church?: MobileJoinChurch;
  error?: string;
};

type JoinResponse = {
  status?: "APPROVED" | "PENDING";
  church?: MobileJoinChurch;
  error?: string;
};

function normalizeJoinCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

function getFriendlyError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export default function JoinChurch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isLoaded, isSignedIn } = useAppAuth();
  const urlCode = useMemo(
    () => normalizeJoinCode(searchParams.get("code") || searchParams.get("joinCode") || ""),
    [searchParams],
  );
  const [step, setStep] = useState<JoinStep>("details");
  const [joinCode, setJoinCode] = useState(urlCode);
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [church, setChurch] = useState<MobileJoinChurch | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(urlCode.length === 8 ? "checking" : "idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const processedSignedInCodeRef = useRef("");

  useEffect(() => {
    if (urlCode) {
      setJoinCode(urlCode);
    }
  }, [urlCode]);

  useEffect(() => {
    let cancelled = false;
    const cleanCode = normalizeJoinCode(joinCode);

    if (cleanCode.length !== 8) {
      setChurch(null);
      setPreviewState("idle");
      return undefined;
    }

    setPreviewState("checking");
    apiFetch<JoinCodePreview>(`/churches/join-code?code=${encodeURIComponent(cleanCode)}`)
      .then((data) => {
        if (cancelled) return;
        if (data.valid && data.church) {
          setChurch(data.church);
          setPreviewState("valid");
          setError("");
          return;
        }
        setChurch(null);
        setPreviewState("invalid");
        setError(data.error || "No encontramos una iglesia con ese código.");
      })
      .catch((err) => {
        if (cancelled) return;
        setChurch(null);
        setPreviewState("invalid");
        setError(getFriendlyError(err, "No pudimos validar el código. Intenta de nuevo."));
      });

    return () => {
      cancelled = true;
    };
  }, [joinCode]);

  const finishJoin = useCallback(async (nextChurch?: MobileJoinChurch | null) => {
    if (nextChurch?.id) {
      setChurchId(nextChurch.id);
    }

    setSuccessMessage(`Listo. Ya tienes acceso a ${nextChurch?.name || "tu iglesia"}.`);
    window.setTimeout(() => {
      navigate("/app", { replace: true });
      window.location.reload();
    }, 750);
  }, [navigate]);

  const joinSignedIn = useCallback(async (inputCode = joinCode) => {
    const cleanCode = normalizeJoinCode(inputCode);
    if (cleanCode.length !== 8) return;

    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<JoinResponse>("/churches/join", {
        method: "POST",
        body: JSON.stringify({ code: cleanCode }),
      });

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.status === "PENDING") {
        setError("Tu solicitud quedó pendiente. Pide a un administrador que revise tu acceso.");
        return;
      }

      await finishJoin(data.church || church);
    } catch (err) {
      setError(getFriendlyError(err, "No pudimos unirte a la iglesia. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  }, [church, finishJoin, joinCode]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || urlCode.length !== 8 || previewState !== "valid") return;
    if (processedSignedInCodeRef.current === urlCode) return;

    processedSignedInCodeRef.current = urlCode;
    void joinSignedIn(urlCode);
  }, [isLoaded, isSignedIn, joinSignedIn, previewState, urlCode]);

  async function handleMobileJoinStart(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = normalizeJoinCode(joinCode);
    const cleanEmail = email.trim().toLowerCase();

    if (cleanCode.length !== 8) {
      setError("Ingresa el código de 8 caracteres de tu iglesia.");
      return;
    }

    if (!cleanEmail) {
      setError("Ingresa tu correo electrónico.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await requestMobileJoinAuthCode(cleanEmail, cleanCode);
      setEmail(result.email);
      setChurch(result.church);
      setStep("verify");
    } catch (err) {
      setError(getFriendlyError(err, "No pudimos enviar el código de verificación."));
    } finally {
      setLoading(false);
    }
  }

  async function handleMobileJoinVerify(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = normalizeJoinCode(joinCode);
    const cleanVerification = verificationCode.replace(/\D/g, "").slice(0, 6);

    if (cleanVerification.length !== 6) return;

    setLoading(true);
    setError("");
    try {
      const session = await verifyMobileJoinAuthCode(email, cleanCode, cleanVerification);
      await finishJoin(session.church);
    } catch (err) {
      setError(getFriendlyError(err, "Ese código no funcionó. Intenta de nuevo."));
    } finally {
      setLoading(false);
    }
  }

  const codeIsComplete = joinCode.length === 8;
  const canSubmitMobileStart = codeIsComplete && Boolean(email.trim()) && !loading;
  const showChurchSummary = church && previewState === "valid";

  if (!isLoaded) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-zinc-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-svh flex-col bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-4 py-6">
      <div className="mx-auto flex w-full max-w-md items-center justify-between pt-[env(safe-area-inset-top)]">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-700 shadow-sm"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <TchurchLogo size="xs" wordPurple />
        <div className="h-10 w-10" />
      </div>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <div className="mb-6 text-center">
          <TchurchLogo variant="mark" size="hero" className="mx-auto mb-4" />
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Únete a tu iglesia</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Usa el código o enlace que te compartieron. Crear iglesias se hace desde la web.
          </p>
        </div>

        <Card className="border-slate-200 shadow-xl shadow-indigo-100/60">
          <CardHeader className="space-y-2 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {step === "details" ? <Mail className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <CardTitle>{successMessage ? "Acceso confirmado" : step === "details" ? "Entra directo" : "Verifica tu correo"}</CardTitle>
            <CardDescription>
              {successMessage
                ? successMessage
                : step === "details"
                  ? "Confirma tu iglesia y correo para crear tu acceso."
                  : `Ingresa el código que enviamos a ${email}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {successMessage ? (
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-center text-sm text-emerald-800">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6" />
                Abriendo Tchurch...
              </div>
            ) : null}

            {!successMessage && isSignedIn ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void joinSignedIn();
                }}
              >
                <JoinCodeField
                  joinCode={joinCode}
                  loading={loading}
                  previewState={previewState}
                  setJoinCode={(value) => {
                    setJoinCode(value);
                    setError("");
                  }}
                />
                {showChurchSummary ? <ChurchSummary church={church} /> : null}
                <ErrorMessage message={error} />
                <Button className="h-12 w-full" disabled={loading || joinCode.length !== 8 || previewState === "invalid"} type="submit">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unirme a esta iglesia"}
                </Button>
              </form>
            ) : null}

            {!successMessage && !isSignedIn && isNativeMobileAuth && step === "details" ? (
              <form className="space-y-4" noValidate onSubmit={handleMobileJoinStart}>
                <JoinCodeField
                  joinCode={joinCode}
                  loading={loading}
                  previewState={previewState}
                  setJoinCode={(value) => {
                    setJoinCode(value);
                    setError("");
                  }}
                />
                {showChurchSummary ? <ChurchSummary church={church} /> : null}
                <div className="space-y-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    inputMode="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError("");
                    }}
                    placeholder="name@example.com"
                    disabled={loading}
                  />
                </div>
                <ErrorMessage message={error} />
                <Button className="h-12 w-full" disabled={!canSubmitMobileStart} type="submit">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando código...
                    </>
                  ) : (
                    "Crear acceso y unirme"
                  )}
                </Button>
              </form>
            ) : null}

            {!successMessage && !isSignedIn && isNativeMobileAuth && step === "verify" ? (
              <form className="space-y-4" noValidate onSubmit={handleMobileJoinVerify}>
                {church ? <ChurchSummary church={church} /> : null}
                <div className="space-y-2">
                  <Label htmlFor="verification-code">Código de verificación</Label>
                  <Input
                    id="verification-code"
                    type="text"
                    inputMode="numeric"
                    value={verificationCode}
                    onChange={(e) => {
                      setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      setError("");
                    }}
                    placeholder="123456"
                    disabled={loading}
                  />
                </div>
                <ErrorMessage message={error} />
                <Button className="h-12 w-full" disabled={loading || verificationCode.length !== 6} type="submit">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    "Entrar a mi iglesia"
                  )}
                </Button>
                <Button
                  className="w-full"
                  variant="ghost"
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setStep("details");
                    setVerificationCode("");
                    setError("");
                  }}
                >
                  Cambiar correo o código
                </Button>
              </form>
            ) : null}

            {!successMessage && !isSignedIn && !isNativeMobileAuth ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-slate-600">Primero crea o inicia sesión para unirte a esta iglesia.</p>
                <Button className="h-11 w-full" asChild>
                  <Link to="/signup">Crear cuenta</Link>
                </Button>
                <Button className="h-11 w-full" variant="outline" asChild>
                  <Link to="/login">Iniciar sesión</Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function JoinCodeField({
  joinCode,
  loading,
  previewState,
  setJoinCode,
}: {
  joinCode: string;
  loading: boolean;
  previewState: PreviewState;
  setJoinCode: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="join-code" className="text-center">
        Código de iglesia
      </Label>
      <div className="relative">
        <Input
          id="join-code"
          value={joinCode}
          onChange={(e) => setJoinCode(normalizeJoinCode(e.target.value))}
          placeholder="ABC12345"
          className="h-14 rounded-2xl text-center font-mono text-xl font-bold uppercase tracking-[0.24em] placeholder:tracking-normal"
          maxLength={8}
          autoCapitalize="characters"
          autoCorrect="off"
          disabled={loading}
        />
        {previewState === "checking" ? (
          <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        ) : null}
      </div>
      <p className="text-center text-xs text-slate-400">{joinCode.length}/8 caracteres</p>
    </div>
  );
}

function ChurchSummary({ church }: { church: MobileJoinChurch }) {
  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
      <p className="text-xs font-medium text-indigo-700">Te estás uniendo a</p>
      <p className="mt-0.5 font-semibold">{church.name}</p>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="flex items-start gap-2 rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
