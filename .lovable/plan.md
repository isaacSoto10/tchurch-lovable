# Tchurch — Web App + Capacitor Native + Payments

## Summary

Build an app of your tchurch church management WEBSITE in this Lovable project, set it up for native mobile deployment via Capacitor, and add a donations/payments system. The GitHub repo is public here: [https://github.com/isaacSoto10/Tchurch](https://github.com/isaacSoto10/Tchurch) REVIEW IT BEFORE REVIEWIG THIS DOCUMENT and also work from the website at tchurchapp.com to match design and features.

## What I Saw on tchurchapp.com

- **Branding**: Purple accent color, clean white/light gray background, cross-styled "t" logo, bilingual (EN/ES)
- **Features**: Dashboard, Songs (with chords/ChordPro/PDF export), Services (drag-and-drop flow editor), Announcements, Ministries, Events, Teams
- **Billing**: Stripe-based, free tier for small churches, 90-day trial, role-based access

## Phase 1 — Landing Page + Core Layout

Build the public-facing landing page matching tchurch's branding (purple theme, bilingual toggle, hero section, feature showcase, CTA). Set up the app shell with sidebar navigation (Dashboard, Songs, Services, Announcements, Ministries, Events, Teams).

**Pages**: Landing page, Login/Signup (placeholder), App shell with sidebar

## Phase 2 — Capacitor Setup

Install and configure Capacitor so you can build native iOS/Android apps:

- Install `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`
- Initialize with `npx cap init` using your app ID and preview URL for hot-reload
- You'll then export to GitHub, run `npx cap add ios/android`, and open in Xcode/Android Studio

## Phase 3 — Payments & Donations

Since the project doesn't have product content yet, I need to know more before enabling payments:

- **What are you selling?** Subscription plans for the tchurch platform (free/pro/premium tiers)? Or donation collection for churches using the app? Or both?
- **Donations**: Do church members donate to their church through your app, or do churches pay you a subscription fee to use tchurch?

Once clarified, I'll enable the appropriate built-in payment provider (Stripe or Paddle) and set up:

- Product/pricing configuration
- Checkout flow
- Webhook handling for subscription management

## Phase 4 — Core App Features (follow-up)

After the foundation is set, we can incrementally build out:

- Dashboard with stats
- Songs library with chord display
- Service flow planner
- Announcements, Events, Ministries, Teams management

These will require a backend (Lovable Cloud / Supabase) for data storage and auth.

## Technical Details

- **Stack**: React + Tailwind + TypeScript (existing), Capacitor for native
- **Design tokens**: Purple primary (~#6C5CE7 or similar from site), white/light gray backgrounds, clean card-based UI
- **Backend**: Lovable Cloud (Supabase) for auth, database, edge functions
- **Payments**: Built-in Lovable payments (Stripe or Paddle depending on use case)
- **i18n**: Will need a translation system for EN/ES support

## Questions Before Starting

I need clarity on the payments/donations model before enabling a provider. I'll ask you about this when we begin implementation.