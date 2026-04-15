

# Sharing a Backend Between This Lovable App and Your Tchurch Next.js App

## The Challenge

Your existing Tchurch app uses **InsForge (PostgreSQL)** + **Clerk auth** + **Next.js API routes**, while this Lovable app uses **Lovable Cloud (Supabase)** + **Paddle payments**. These are two completely different backend stacks — they can't natively share a database.

## Your Options

### Option A: Use Your Next.js API as the Single Source of Truth (Recommended)

Keep InsForge + Clerk as your main backend. Have this Lovable app call your Next.js API routes instead of using Lovable Cloud for data.

**How it works:**
- Your Next.js app at `tchurchapp.com/api/*` remains the authoritative backend
- This Lovable app calls those API endpoints via edge functions or directly from the client
- Auth tokens from Clerk are used in both apps
- Paddle webhook data gets forwarded to your Next.js API or written to InsForge

**Pros:** Single database, no data sync issues, existing logic reused
**Cons:** Requires your Next.js app to be deployed and available; Lovable Cloud features (RLS, realtime) won't apply to your main data

### Option B: Migrate Everything to Lovable Cloud

Move your InsForge data and Clerk auth into Lovable Cloud (Supabase). Update your Next.js app to also use Supabase.

**Pros:** Unified backend, RLS, realtime, everything in one place
**Cons:** Significant migration effort — schema, auth, API routes all need rewriting in both apps

### Option C: Two-Way Sync Between Databases

Keep both backends but sync data between InsForge and Supabase.

**Pros:** Each app keeps its native stack
**Cons:** Complex, error-prone, eventual consistency issues

## Recommendation

**Option A** is the most practical path. Your Next.js app already has working API routes. We would:

1. **Set up Clerk auth in this Lovable app** — install `@clerk/clerk-react`, configure sign-in/sign-up to match your existing Clerk instance
2. **Replace Supabase data calls with API calls** to your Next.js endpoints (songs, services, announcements, etc.)
3. **Keep Paddle in Lovable Cloud** for payment processing, but forward subscription data to your Next.js API so it's stored in InsForge alongside everything else
4. **Create a thin edge function** that proxies or forwards webhook data to your existing backend

This means both apps share the same users (Clerk) and the same data (InsForge), with payments handled by Paddle and synced to your main database.

## What I Need From You

- Your deployed Next.js app URL (the base URL for API calls)
- Your Clerk publishable key (so this app can authenticate against the same Clerk instance)
- Confirmation of which API routes exist in your Next.js app (e.g., `/api/songs`, `/api/services`, etc.)

