import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Check } from "lucide-react";
import { useUser } from "@clerk/clerk-react";
import { useToast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";

const PLANS = [
  {
    name: "Basic",
    description: "For growing churches ready to move online",
    monthlyPrice: 35,
    clerkPlanId: "cplan_3CbQdCc2S6mCUEPDxANSmjuxdkR",
    features: [
      "Up to 20 members",
      "Ministry teams",
      "Events & RSVPs",
      "Calendar & scheduling",
      "Song library",
      "Blockout dates",
      "Service scheduling",
    ],
    cta: "Subscribe",
    highlighted: true,
  },
  {
    name: "All In",
    description: "For large churches needing advanced features",
    monthlyPrice: 50,
    clerkPlanId: "cplan_3CbQpDJmKLjjrRJkxVYSrYMXagk",
    features: [
      "Unlimited members",
      "Everything in Basic",
      "AI image generation",
      "Priority support",
      "Advanced features",
    ],
    cta: "Subscribe",
    highlighted: false,
  },
];

interface CheckoutResponse {
  url: string;
}

export default function Pricing() {
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const { user } = useUser();
  const { toast } = useToast();

  const handleSubscribe = async (plan: typeof PLANS[0]) => {
    if (!plan.clerkPlanId) return;

    setLoadingPlanId(plan.clerkPlanId);

    try {
      const email = user?.primaryEmailAddress?.emailAddress;
      const params = new URLSearchParams({
        planId: plan.clerkPlanId,
        ...(email && { email }),
      });

      const data = await apiFetch<CheckoutResponse>(
        `/billing/checkout?${params}`,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (data.url) {
        window.open(data.url, "_blank");
      } else {
        throw new Error("No checkout URL received");
      }
    } catch (error) {
      console.error("[Pricing] Checkout error:", error);
      toast({
        title: "Failed to open checkout",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    } finally {
      setLoadingPlanId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-background/80 backdrop-blur-md border-b">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <Link to="/" className="flex items-center gap-1">
            <span className="text-2xl font-extrabold tracking-tight text-primary">†</span>
            <span className="text-xl font-bold tracking-tight text-foreground">church</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Pricing Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
              Simple, transparent pricing
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
              Start free and upgrade as your church grows.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-3 bg-muted rounded-full p-1">
              <button
                className="px-4 py-2 rounded-full text-sm font-medium transition-colors bg-primary text-primary-foreground"
              >
                Monthly
              </button>
              <button
                disabled
                className="px-4 py-2 rounded-full text-sm font-medium transition-colors text-muted-foreground cursor-not-allowed opacity-60"
              >
                Yearly
                <span className="ml-1.5 text-xs opacity-80">Coming soon</span>
              </button>
            </div>
          </motion.div>

          {/* Plan Cards */}
          <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
            {PLANS.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Card
                  className={`h-full flex flex-col ${
                    plan.highlighted
                      ? "border-primary shadow-lg shadow-primary/10 relative"
                      : "border-border/50"
                  }`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
                        Most Popular
                      </span>
                    </div>
                  )}
                  <CardHeader className="pb-4">
                    <h3 className="text-lg font-bold">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                    <div className="mt-4">
                      <span className="text-4xl font-extrabold">${plan.monthlyPrice}</span>
                      <span className="text-muted-foreground ml-1">/mo</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col">
                    <ul className="space-y-3 flex-1">
                      {plan.features.map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full mt-6"
                      variant={plan.highlighted ? "default" : "outline"}
                      onClick={() => handleSubscribe(plan)}
                      disabled={loadingPlanId !== null}
                    >
                      {loadingPlanId === plan.clerkPlanId ? (
                        <span className="flex items-center gap-2">
                          <svg
                            className="animate-spin h-4 w-4"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          Loading...
                        </span>
                      ) : (
                        plan.cta
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <span className="text-primary font-bold">†</span>
            <span className="font-semibold text-foreground">church</span>
          </div>
          <p>© {new Date().getFullYear()} Tchurch. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
