import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Music,
  ListChecks,
  Megaphone,
  Users,
  CalendarDays,
  Globe,
  FileText,
  Clock,
  Shield,
} from "lucide-react";

const features = [
  {
    icon: Music,
    title: "Worship Planning",
    desc: "Plan services with drag & drop, manage songs with chords, organize teams and schedule your worship ministry.",
  },
  {
    icon: Users,
    title: "Ministries & Groups",
    desc: "Organize your community with ministries, subgroups, events and announcements all in one place.",
  },
  {
    icon: Globe,
    title: "Bilingual",
    desc: "Full support in English and Spanish. Switch languages instantly across the entire platform.",
  },
  {
    icon: FileText,
    title: "Chords & PDF",
    desc: "300+ worship songs with ChordPro support. Transpose keys, preview chords and export professional PDFs.",
  },
  {
    icon: Clock,
    title: "Smart Scheduling",
    desc: "Schedule team members with availability tracking, blackout dates and conflict detection.",
  },
  {
    icon: Shield,
    title: "Billing & Roles",
    desc: "Role-based access control, Stripe billing with 90-day trials and member limits per plan. Free for small churches.",
  },
];

const showcaseItems = [
  { label: "Song Library", icon: Music },
  { label: "Service Flow Editor", icon: ListChecks },
  { label: "Announcements", icon: Megaphone },
  { label: "Dashboard", icon: CalendarDays },
];

export default function Landing() {
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
              <Link to="/pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">Get Started Free</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1]"
          >
            Manage your church.
            <br />
            <span className="text-primary">All in one place.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto"
          >
            Worship planning, ministries, events, announcements and teams. Built
            for Hispanic churches, available in English and Spanish.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <Button size="lg" className="px-8 text-base" asChild>
              <Link to="/signup">Get Started Free</Link>
            </Button>
            <Button size="lg" variant="outline" className="px-8 text-base" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* App Preview Mock */}
      <section className="px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="max-w-5xl mx-auto"
        >
          <Card className="overflow-hidden shadow-2xl border-0 bg-card">
            <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/40">
              <div className="w-3 h-3 rounded-full bg-destructive/60" />
              <div className="w-3 h-3 rounded-full bg-accent" />
              <div className="w-3 h-3 rounded-full bg-primary/40" />
              <span className="ml-auto text-xs text-muted-foreground">tchurchapp.com</span>
            </div>
            <div className="flex min-h-[340px]">
              {/* Sidebar mock */}
              <div className="w-48 border-r bg-muted/20 p-4 hidden md:block">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">T</div>
                  <span className="font-semibold text-sm">Tchurch</span>
                </div>
                {["Dashboard", "Songs", "Services", "Announcements", "Ministries", "Events", "Teams"].map((item, i) => (
                  <div
                    key={item}
                    className={`text-sm py-2 px-3 rounded-md mb-1 ${i === 0 ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground"}`}
                  >
                    {item}
                  </div>
                ))}
              </div>
              {/* Content mock */}
              <div className="flex-1 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold">Dashboard</h3>
                  <span className="text-xs font-medium bg-accent text-accent-foreground px-2 py-1 rounded">FREE</span>
                </div>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: "This Week", value: "3 Services", color: "bg-primary" },
                    { label: "Songs", value: "303", color: "bg-blue-500" },
                    { label: "Members", value: "8", color: "bg-orange-500" },
                  ].map((s) => (
                    <div key={s.label} className="bg-muted/40 rounded-lg p-3">
                      <div className={`w-8 h-1 ${s.color} rounded mb-2`} />
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-sm font-semibold">{s.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs font-medium text-muted-foreground mb-3">THIS WEEK</p>
                {[
                  { name: "Sunday Worship", time: "Sun, Apr 13 · 10:00 AM" },
                  { name: "Wednesday Bible Study", time: "Wed, Apr 16 · 7:00 PM" },
                  { name: "Youth Service", time: "Fri, Apr 18 · 7:30 PM" },
                ].map((svc) => (
                  <div key={svc.name} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="w-1 h-8 rounded bg-primary" />
                    <div>
                      <p className="text-sm font-medium">{svc.name}</p>
                      <p className="text-xs text-muted-foreground">{svc.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>
      </section>

      {/* Features */}
      <section className="px-6 pb-24">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-4">
            Everything your church needs
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            From Sunday service planning to weekday ministry management, Tchurch covers it all.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
              >
                <Card className="h-full hover:shadow-lg transition-shadow border-border/50">
                  <CardContent className="p-6">
                    <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center mb-4">
                      <f.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{f.title}</h3>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-24">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">
            Ready to simplify your church management?
          </h2>
          <p className="text-muted-foreground mb-8">
            Join the churches already using Tchurch to plan worship, manage ministries and grow their community.
          </p>
          <Button size="lg" className="px-10 text-base" asChild>
            <Link to="/signup">Get Started Free</Link>
          </Button>
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
