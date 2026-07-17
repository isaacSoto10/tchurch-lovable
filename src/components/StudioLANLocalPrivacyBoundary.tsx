import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { getMobileAuthPrincipalId, onMobileAuthChange } from "@/lib/mobileAuth";
import { studioLANPrivacyCoordinator } from "@/lib/studioLANPrivacyCoordinator";
import { setUserActionLoggingSuspended } from "@/lib/userActionLogger";

type PrivacyState = "checking" | "ready" | "failed";

export function StudioLANLocalPrivacyBoundary({ children }: { children: ReactNode }) {
  const [privacyState, setPrivacyState] = useState<PrivacyState>("checking");
  const [retry, setRetry] = useState(0);

  useLayoutEffect(() => {
    setUserActionLoggingSuspended(true);
    return () => setUserActionLoggingSuspended(false);
  }, []);

  useEffect(() => {
    let active = true;
    let revision = 0;

    const synchronize = () => {
      const currentRevision = ++revision;
      setPrivacyState("checking");
      const principalId = getMobileAuthPrincipalId();
      const operation = principalId
        ? studioLANPrivacyCoordinator.principal(principalId)
        : studioLANPrivacyCoordinator.signedOut();

      void operation.then(() => {
        if (active && revision === currentRevision) setPrivacyState("ready");
      }).catch(() => {
        if (active && revision === currentRevision) setPrivacyState("failed");
      });
    };

    synchronize();
    const unsubscribe = onMobileAuthChange(synchronize);
    return () => {
      active = false;
      revision += 1;
      unsubscribe();
    };
  }, [retry]);

  if (privacyState === "ready") return <>{children}</>;

  return (
    <main className="flex min-h-svh items-center justify-center bg-slate-950 px-6 text-slate-50">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.05] p-6 text-center shadow-2xl" role={privacyState === "failed" ? "alert" : "status"}>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Studio LAN privado</p>
        <h1 className="mt-3 text-2xl font-black">
          {privacyState === "failed" ? "No se pudo proteger esta pantalla" : "Verificando el acceso local…"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          {privacyState === "failed"
            ? "La salida permanece cerrada. Intenta de nuevo antes de emparejar con Studio."
            : "Esta comprobación usa solo el dispositivo y no consulta servicios en Internet."}
        </p>
        {privacyState === "failed" ? (
          <button type="button" className="mt-5 min-h-11 rounded-2xl bg-emerald-400 px-5 font-bold text-slate-950" onClick={() => setRetry((value) => value + 1)}>
            Intentar de nuevo
          </button>
        ) : null}
      </section>
    </main>
  );
}
