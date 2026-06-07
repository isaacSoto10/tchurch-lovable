import { motion } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { Navigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TchurchLogo } from "@/components/TchurchLogo";
import { useAppAuth } from "@/hooks/useAppAuth";

export default function Landing() {
  const { isLoaded, isSignedIn } = useAppAuth();
  const isNativePlatform = Capacitor.isNativePlatform();

  if (isLoaded && isSignedIn) {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      {/* Logo & Branding */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-10"
      >
        <TchurchLogo variant="stacked" size="lg" className="mb-5" />
        <p className="text-muted-foreground text-base max-w-xs md:max-w-xl mx-auto">
          Gestión de iglesia hecha simple. Planifica la alabanza, administra ministerios y fortalece tu comunidad.
        </p>
      </motion.div>

      {/* Action Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex flex-col gap-3 w-full max-w-xs md:max-w-sm"
      >
        {isNativePlatform ? (
          <>
            <Button size="lg" className="w-full text-base" asChild>
              <Link to="/join-church">Unirme a mi iglesia</Link>
            </Button>
            <Button size="lg" variant="outline" className="w-full text-base" asChild>
              <Link to="/login">Ya tengo cuenta</Link>
            </Button>
          </>
        ) : (
          <Button size="lg" className="w-full text-base" asChild>
            <Link to="/signup">Crear cuenta</Link>
          </Button>
        )}
        {!isNativePlatform && (
          <Button size="lg" variant="outline" className="w-full text-base" asChild>
            <Link to="/login">Iniciar sesión</Link>
          </Button>
        )}
        {isNativePlatform && (
          <p className="text-center text-sm text-muted-foreground">
            En la app solo puedes unirte a una iglesia existente. Para crear una iglesia, entra desde la web.
          </p>
        )}
      </motion.div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-12 text-xs text-muted-foreground"
      >
        © {new Date().getFullYear()} Tchurch. Todos los derechos reservados.
      </motion.p>
    </div>
  );
}
