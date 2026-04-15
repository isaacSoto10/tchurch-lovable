# Fix Test Mode Banner + App Store Plan

## Issue 1: Giant Yellow Banner

The `PaymentTestModeBanner` is placed inside `SidebarProvider` but **outside** the flex layout, so it takes up the full viewport width/height and pushes everything down. The banner itself is fine — it's the **placement** that's wrong. It's also inside the `SidebarProvider` which causes layout issues.

**Fix:** Move `<PaymentTestModeBanner />` inside the flex column layout, right above the header, so it renders as a slim bar at the top of the content area — not as a full-screen block.

```
AppLayout change:
- Remove PaymentTestModeBanner from outside the flex div
- Place it inside the flex-1 column, above the header
```

## Issue 2: Getting on the App Store (iPhone)

Your project already has **Capacitor** configured. To get the app on the Apple App Store, you need to follow these steps **outside of Lovable** (this cannot be done from within Lovable):

1. **Apple Developer Account** — Enroll in the Apple Developer Program ($99/year) at developer.apple.com
2. **Connect to GitHub** — Connect this Lovable project to GitHub (Settings → GitHub)
3. **Clone & build locally** — On a Mac with Xcode:
  - `git clone` the repo
  - `npm install`
  - `npx cap add ios`
  - `npm run build && npx cap sync`
  - `npx cap open ios` → opens Xcode
4. **Configure in Xcode** — Set your Team, Bundle ID, signing certificates
5. **Archive & Upload** — Product → Archive → Distribute App → App Store Connect
6. **Submit for Review** — In App Store Connect, fill out app metadata, screenshots, and submit

For a detailed walkthrough, see the [Lovable mobile app guide](https://docs.lovable.dev/tips-tricks/native-mobile-apps).

## Technical Details

**Files changed:** `src/layouts/AppLayout.tsx` — move banner placement inside the content column.  
  
Make the first page more simple where the user is only able to login/sign in signup and the suscription button takes them to the online website