import { useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppAuth } from "@/hooks/useAppAuth";
import { ApiError, apiFetch } from "@/lib/api";
import { clearDeletedAccountData, type AccountDeletionResult } from "@/lib/accountDeletion";
import { clearMobileAuthSession, getMobileAuthPrincipalId, isNativeMobileAuth } from "@/lib/mobileAuth";

type DeletionResponse = { ok: true } | { ok: false; status: "pending" };
type Action = "start" | "confirm";

function deletionError(error: unknown) {
  const apiError = error instanceof ApiError ? error : null;
  const body = apiError?.body;
  const code = body && typeof body === "object" && "code" in body ? body.code : null;
  if (apiError?.status === 401) return "Tu sesión venció. Vuelve a iniciar sesión para continuar.";
  if (code === "INVALID_CODE") return "El código es incorrecto o caducó. Revísalo o solicita uno nuevo.";
  if (code === "VERIFIED_EMAIL_REQUIRED") return "Verifica el correo principal de tu cuenta para poder eliminarla.";
  if (apiError?.status === 429) return "Ya hiciste varios intentos. Espera un momento antes de volver a intentar.";
  if (apiError?.status === 0) return "No pudimos conectar con Tchurch. Revisa tu conexión y vuelve a intentar.";
  return "No pudimos confirmar el resultado. Intenta de nuevo en un momento.";
}

export function AccountDeletion() {
  const { getToken, signOut, userId } = useAppAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Action | "signOut" | null>(null);
  const [error, setError] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const operation = useRef(false);
  const codeId = useId();
  const codeField = useRef<HTMLInputElement>(null);

  function changeOpen(next: boolean) {
    if (operation.current) return;
    setOpen(next);
    if (next) return;
    setCodeSent(false);
    setCode("");
    setError("");
    setNeedsSignIn(false);
  }

  async function finish(accountId: string, accountDeletion: AccountDeletionResult) {
    const isCurrentAccount = !isNativeMobileAuth || getMobileAuthPrincipalId() === accountId;
    const cleanup = clearDeletedAccountData(accountId, isCurrentAccount);
    if (isCurrentAccount) {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    const localCleanupFailed = !(await cleanup);
    if (!isCurrentAccount) return;
    if (isNativeMobileAuth) {
      if (getMobileAuthPrincipalId() !== accountId) return;
      const clearedSession = await clearMobileAuthSession();
      navigate("/login", { replace: true, state: { accountDeletion, localCleanupFailed: localCleanupFailed || clearedSession === false } });
    } else {
      await signOut("/login");
    }
  }

  async function request(action: Action) {
    if (operation.current || !userId) return;
    operation.current = true;
    setBusy(action);
    setError("");
    try {
      const token = await getToken();
      if (!token) throw new ApiError("", 401, null);
      const result = await apiFetch<DeletionResponse>(`/account/deletion/${action}`, {
        method: "POST",
        churchId: null,
        timeoutMs: 60_000,
        sensitiveBody: true,
        body: JSON.stringify(action === "confirm" ? { code } : {}),
      }, token);
      if (result?.ok === false && result.status === "pending") {
        await finish(userId, "pending");
        return;
      }
      if (result?.ok !== true) throw new Error("Unexpected response");
      if (action === "confirm") {
        await finish(userId, "completed");
        return;
      }
      setCode("");
      setCodeSent(true);
      requestAnimationFrame(() => codeField.current?.focus());
    } catch (error) {
      setError(deletionError(error));
      setNeedsSignIn(error instanceof ApiError && error.status === 401);
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  async function signInAgain() {
    if (operation.current) return;
    operation.current = true;
    setBusy("signOut");
    try {
      await signOut("/login");
    } catch {
      setError("No pudimos cerrar la sesión. Intenta de nuevo.");
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length === 6 && !needsSignIn) void request("confirm");
  }

  return (
    <Card className="app-card border-destructive/30">
      <CardHeader>
        <CardTitle>Cuenta</CardTitle>
        <CardDescription>Elimina tu cuenta personal de Tchurch de forma permanente.</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={open} onOpenChange={changeOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" className="min-h-11 border-destructive/40 text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200">
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Eliminar mi cuenta
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-h-[min(90dvh,36rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-5">
            <div className="space-y-2">
              <AlertDialogTitle>{codeSent ? "Confirma la eliminación" : "¿Eliminar tu cuenta de Tchurch?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {codeSent
                  ? "Enviamos un código de seis dígitos al correo verificado de tu cuenta."
                  : "Se eliminarán tu perfil y tus datos personales, y perderás acceso a tus iglesias en Tchurch. La eliminación es permanente."}
              </AlertDialogDescription>
            </div>
            {!codeSent && (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Tu iglesia puede conservar registros y contenido compartido con atribución anónima.</p>
                <p>Se detendrán las donaciones recurrentes gestionadas por Tchurch. Las donaciones externas se administran con su proveedor.</p>
              </div>
            )}
            <form onSubmit={confirm} className="grid gap-4" aria-busy={!!busy}>
              {codeSent && (
                <div className="grid gap-2">
                  <Label htmlFor={codeId}>Código de verificación</Label>
                  <Input
                    ref={codeField}
                    id={codeId}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoCorrect="off"
                    disabled={!!busy || needsSignIn}
                    className="min-h-11 text-base"
                  />
                </div>
              )}
              {error && <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>}
              {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {busy === "start" ? "Enviando código…" : busy === "confirm" ? "Procesando la eliminación…" : "Cerrando sesión…"}
              </p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <AlertDialogCancel type="button" className="mt-0 min-h-11" disabled={!!busy}>Cancelar</AlertDialogCancel>
                {needsSignIn ? (
                  <Button type="button" className="min-h-11" disabled={!!busy} onClick={() => void signInAgain()}>Iniciar sesión</Button>
                ) : codeSent ? (
                  <Button type="submit" variant="destructive" className="min-h-11 bg-red-700 text-white hover:bg-red-800" disabled={!!busy || code.length !== 6}>
                    Eliminar permanentemente
                  </Button>
                ) : (
                  <Button type="button" className="min-h-11" disabled={!!busy} onClick={() => void request("start")}>Enviar código</Button>
                )}
              </div>
              {codeSent && !needsSignIn && (
                <Button type="button" variant="ghost" className="min-h-11 justify-self-center" disabled={!!busy} onClick={() => void request("start")}>
                  Solicitar otro código
                </Button>
              )}
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
