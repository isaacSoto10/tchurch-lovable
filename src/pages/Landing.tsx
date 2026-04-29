import { motion } from "framer-motion";
import { useAuth } from "@clerk/clerk-react";
import { Navigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const { isLoaded, isSignedIn } = useAuth();

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
          Church management made simple. Plan worship, manage ministries and grow your community.
        </p>
      </motion.div>

      {/* Action Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex flex-col gap-3 w-full max-w-xs"
      >
        <Button size="lg" className="w-full text-base" asChild>
          <Link to="/signup">Get Started Free</Link>
        </Button>
        <Button size="lg" variant="outline" className="w-full text-base" asChild>
          <Link to="/login">Sign In</Link>
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="w-full text-base text-muted-foreground"
          asChild
        >
          <a href="https://tchurchapp.com/pricing" target="_blank" rel="noopener noreferrer">
            View Plans & Pricing
          </a>
        </Button>
      </motion.div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-12 text-xs text-muted-foreground"
      >
        © {new Date().getFullYear()} Tchurch. All rights reserved.
      </motion.p>
    </div>
  );
}
