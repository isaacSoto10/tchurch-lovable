

# Set Up Subscription Payments for Tchurch

## Overview

Enable Lovable's built-in payment integration for subscription billing (free/pro/premium tiers for churches using the Tchurch platform).

## Steps

### 1. Enable Lovable Cloud
Payments require Lovable Cloud (Supabase backend). This will be enabled first if not already active.

### 2. Enable Payment Provider
Based on the eligibility check, **Paddle** is recommended (handles global taxes and compliance automatically at 5% + 50¢). Alternatively, **built-in Stripe** is available if you prefer more control.

Both are fully built-in — no external account needed to start. A test environment is created immediately so you can test without real money. Going live requires verification later.

### 3. Create Subscription Products
Define your pricing tiers. Based on what I saw on tchurchapp.com:
- **Free** — Small churches, limited members
- **Pro** — More members, full features
- **Premium** — Unlimited, priority support

These will be created as subscription products with monthly/yearly intervals.

### 4. Implement Checkout Flow
- Add a pricing page with tier comparison
- Add checkout buttons that open the payment flow
- Handle webhooks for subscription status changes
- Gate features based on active subscription tier

## Technical Details
- Payment provider SDK and webhook handler will be auto-configured on enable
- Subscription status stored in Supabase, checked via RLS or client queries
- Pricing page added at `/pricing` or integrated into the landing page

