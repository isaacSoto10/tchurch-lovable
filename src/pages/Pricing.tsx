import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Check } from "lucide-react";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { useUser } from "@clerk/clerk-react";

const plans = [
  {
    name: "Free",
    description: "For small churches getting started",
    monthlyPrice: 0,
    yearlyPrice: 0,
    priceIdMonthly: null,
    priceIdYearly: null,
    features: [
      "Up to 10 members",
      "Basic dashboard",
      "Song library (up to 50 songs)",
      "1 service per week",
      "Community support",
    ],
    cta: "Get Started Free",
    highlighted: false,
  },
  {
    name: "Pro",
    description: "For growing churches",
    monthlyPrice: 14.99,
    yearlyPrice: 149.90,
    priceIdMonthly: "pro_monthly",
    priceIdYearly: "pro_yearly",
    features: [
      "Up to 100 members",
      "Full dashboard & analytics",
      "Unlimited songs with ChordPro",
      "PDF export",
      "Unlimited services",
      "Advanced scheduling",
      "Ministries & teams",
      "Email support",
    ],
    cta: "Start Pro",
    highlighted: true,
  },
  {
    name: "Premium",
    description: "For large churches",
    monthlyPrice: 29.99,
    yearlyPrice: 299.90,
    priceIdMonthly: "premium_monthly",
    priceIdYearly: "premium_yearly",
    features: [
      "Unlimited members",
      "Everything in Pro",
      "Advanced analytics",
      "Priority support",
      "Custom branding",
      "API access",
      "Multi-campus support",
      "Dedicated account manager",
    ],
    cta: "Start Premium",
    highlighted: false,
  },
];

export default function Pricing() {
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const { openCheckout, loading } = usePaddleCheckout();
  const { user } = useUser();

  const handleSubscribe = (plan: typeof plans[0]) => {
    const priceId = billingInterval === "monthly" ? plan.priceIdMonthly : plan.priceIdYearly;
    if (!priceId) return;

    openCheckout({
      priceId,
      successUrl: `${window.location.origin}/app?checkout=success`,
      customerEmail: user?.primaryEmailAddress?.emailAddress,
      customData: { userId: user?.id || "" },
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <PaymentTestModeBanner />

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
              Start free and upgrade as your church grows. All plans include a 90-day free trial.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-3 bg-muted rounded-full p-1">
              <button
                onClick={() => setBillingInterval("monthly")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  billingInterval === "monthly"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingInterval("yearly")}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  billingInterval === "yearly"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Yearly
                <span className="ml-1.5 text-xs opacity-80">Save 2 months</span>
              </button>
            </div>
          </motion.div>

          {/* Plan Cards */}
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan, i) => (
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
                      <span className="text-4xl font-extrabold">
                        ${billingInterval === "monthly" ? plan.monthlyPrice : plan.yearlyPrice}
                      </span>
                      {plan.monthlyPrice > 0 && (
                        <span className="text-muted-foreground ml-1">
                          /{billingInterval === "monthly" ? "mo" : "yr"}
                        </span>
                      )}
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
                      onClick={() => plan.priceIdMonthly ? handleSubscribe(plan) : undefined}
                      disabled={loading}
                      asChild={!plan.priceIdMonthly}
                    >
                      {plan.priceIdMonthly ? (
                        <span>{plan.cta}</span>
                      ) : (
                        <Link to="/signup">{plan.cta}</Link>
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
