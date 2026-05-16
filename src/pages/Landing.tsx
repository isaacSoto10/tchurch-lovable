import { motion } from "framer-motion";
import { Capacitor } from "@capacitor/core";
import { Navigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
        <div className="flex items-center justify-center gap-1 mb-4">
          <span className="text-5xl font-extrabold tracking-tight text-primary">†</span>
          <span className="text-4xl font-bold tracking-tight text-foreground">church</span>
        </div>
        <p className="text-muted-foreground text-base max-w-xs mx-auto">
          Gestión de iglesia hecha simple. Planifica la alabanza, administra ministerios y fortalece tu comunidad.
        </p>
      </motion.div>

      {/* Action Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex flex-col gap-3 w-full max-w-xs"
      >
        {isNativePlatform ? (
          <Button size="lg" className="w-full text-base" asChild>
            <Link to="/login">Iniciar sesión</Link>
          </Button>
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
            El acceso móvil de Tchurch es para cuentas existentes de iglesias. Si necesitas acceso, contacta al administrador de tu iglesia.
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
