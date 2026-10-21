import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TchurchLogo } from "@/components/TchurchLogo";
import { useAppAuth } from "@/hooks/useAppAuth";
import { fetchUserChurchSelection } from "@/lib/api";
import { openChurchInvitationInBrowser } from "@/lib/churchInvitationHandoff";

export function ChurchInvitationHandoff({ token }: { token: string }) {
  const navigate = useNavigate();
  const { isLoaded, isSignedIn, userId, getToken } = useAppAuth();
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const operationRef = useRef(0);
  const mountedRef = useRef(true);
  const latestScopeRef = useRef({ userId, token });
  latestScopeRef.current = { userId, token };
  const [error, setError] = useState("");
  const returnPath = isSignedIn ? "/app" : "/login";

  useEffect(() => {
    mountedRef.current = true;
    operationRef.current += 1;
    setOpening(false);
    setOpened(false);
    setRefreshing(false);
    setError("");
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, [token, userId]);

  function isCurrent(operation: number, scope: { userId: string | null | undefined; token: string }) {
    return mountedRef.current && operationRef.current === operation
      && latestScopeRef.current.userId === scope.userId && latestScopeRef.current.token === scope.token;
  }

  async function continueInvitation() {
    const operation = ++operationRef.current;
    const scope = { userId, token };
    setOpening(true);
    setError("");
    try {
      await openChurchInvitationInBrowser(token);
      if (isCurrent(operation, scope)) setOpened(true);
    } catch {
      if (isCurrent(operation, scope)) setError("No pudimos abrir la invitación. Intenta de nuevo.");
    } finally {
      if (isCurrent(operation, scope)) setOpening(false);
    }
  }

  async function returnToApp() {
    if (!isSignedIn) {
      navigate("/login", { replace: true });
      return;
    }
    const operation = ++operationRef.current;
    const scope = { userId, token };
    setRefreshing(true);
    setError("");
    try {
      const authToken = await getToken();
      if (!isCurrent(operation, scope)) return;
      if (!authToken) throw new Error("Session unavailable");
      await fetchUserChurchSelection(authToken);
      if (!isCurrent(operation, scope)) return;
      // Membership may have changed in the browser. Refresh authority before
      // returning, then let the provider apply the server's current selection.
      navigate("/app", { replace: true });
      window.location.reload();
    } catch {
      if (isCurrent(operation, scope)) setError("No pudimos actualizar tu acceso. Revisa tu conexión e intenta de nuevo.");
    } finally {
      if (isCurrent(operation, scope)) setRefreshing(false);
    }
  }

  return (
    <div
      className="flex min-h-svh flex-col bg-zinc-50 px-4"
      style={{
        paddingTop: "max(1.5rem, var(--app-safe-area-top, env(safe-area-inset-top)))",
        paddingBottom: "calc(1.5rem + var(--app-safe-area-bottom, env(safe-area-inset-bottom)))",
      }}
    >
      <div className="mx-auto w-full max-w-md">
        <Button asChild variant="outline" className="h-11 w-11 rounded-full p-0">
          <Link to={returnPath} aria-label="Volver"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
      </div>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-8">
        <TchurchLogo variant="stacked" size="lg" className="mx-auto" />
        <Card>
          <CardHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Mail className="h-5 w-5" /></div>
            <CardTitle>Acepta tu invitación</CardTitle>
            <CardDescription>Completa la invitación en el navegador con el correo al que fue enviada. Después puedes entrar a la app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">Si el enlace expiró o fue cancelado, pide una nueva invitación al administrador de tu iglesia.</p>
            {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {opened && <p role="status" className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">Completa la invitación en el navegador y luego vuelve aquí. La app consultará tu acceso al entrar.</p>}
            <Button className="h-12 w-full" disabled={opening || refreshing} onClick={() => void continueInvitation()}>
              {opening ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Abriendo invitación...</> : <><ExternalLink className="mr-2 h-4 w-4" />Continuar con la invitación</>}
            </Button>
            {opened && <Button variant="outline" className="h-12 w-full" disabled={!isLoaded || opening || refreshing} onClick={() => void returnToApp()}>{refreshing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Actualizando acceso...</> : "Ya terminé en el navegador"}</Button>}
            <Button asChild variant="ghost" className="h-11 w-full"><Link to="/join-church">Usar código de iglesia</Link></Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
