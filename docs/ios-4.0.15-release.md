# iOS 4.0.15 release candidate

Release candidate: `4.0.15 (215)`.

Build `215` is the repository candidate after `4.0.14 (214)`. It is reserved
by both Xcode projects, the package metadata, the release consistency check,
and the App Store agent workflow. No local or fetched Git ref uses `4.0.15`
or build `215`, but App Store Connect could not be queried during preparation
because no App Store Connect credentials are available in this worktree.
Reconfirm that `215` is unused immediately before archive/upload; if it is
already occupied, increment every release pin together and rerun
`npm run check:ios-release`.

## Internal release notes

- Expands the authenticated local Studio control surface with the paged v5
  control catalog and signed, revision-bound command handling.
- Adds v6 operator timer controls and signed feedback so service timers remain
  synchronized without requiring an Internet round trip.
- Adds v7 local OBS lower-third control while preserving the operator's
  stage-isolation routing choices.
- Adds v8 local OBS scene selection with deterministic cross-platform signed
  fixtures, strict scene identifiers, replay protection, and fail-closed
  command and receipt validation. OBS reconciliation floors are scoped to the
  signed connection so a restarted OBS instance can safely begin at revision
  one without inheriting an older instance's floor.
- Keeps disconnected LAN state usable without a cloud connection and avoids
  sending local-only changes to musicians or the Internet when that routing is
  disabled.

## Release gates

- `npm run check:ios-release`, metadata tests, TypeScript, web build, Capacitor
  sync, and the signed native suite must pass for this exact release candidate.
- Before shipment, verify the Studio LAN production flow against the matching
  Tchurch Studio build on a physical iPhone and iPad, including v5 pagination,
  v6 timers, v7 lower thirds, v8 OBS scenes, reconnect, background/foreground,
  logout, and trust/cache invalidation.
- Archive and upload through Xcode with valid App Store Connect provider
  credentials. Confirm `4.0.15 (215)` reaches a valid processing state before
  any TestFlight distribution or App Store promotion.

## Preparation evidence

Validated locally on 2026-07-19 from the isolated LAN v8 iOS worktree:

- `npm run check:ios-release`: passed with every release pin at
  `4.0.15 (215)`.
- Xcode build settings for Debug and Release in both `App.xcodeproj` and
  `Tchurch.xcodeproj` resolve to `MARKETING_VERSION=4.0.15` and
  `CURRENT_PROJECT_VERSION=215`.
- `npm test`: 80 files, 620 tests, 0 failures.
- The focused Studio LAN bridge suite passed 34 tests and the focused native
  LAN v8 class passed 39 tests after requiring a current scene in every
  connected OBS state and covering both high-to-low connection replacement and
  a delayed receipt from the replaced connection.
- `npx tsc -p tsconfig.app.json --noEmit`: passed.
- `npm run build` and `npx cap sync ios`: passed; a second build/sync produced
  no tracked Capacitor asset drift.
- The deterministic native CI suite passed 110 tests with 0 failures and 0
  skips on an iPhone 15 Pro simulator running iOS 17.2. The interactive
  Bonjour test remains excluded, matching CI. Result bundle:
  `/tmp/tchurch-ios-4.0.15-215-native-final-20260719-1235.xcresult`.
- A Release simulator build succeeded and its embedded app reports
  `CFBundleShortVersionString=4.0.15` and `CFBundleVersion=215`.

No archive, App Store Connect upload, TestFlight distribution, or App Store
promotion occurred. The read-only App Store Connect check could not start
because this worktree does not have `ASC_APP_ID`; therefore build `215` is
unreferenced in local/fetched Git history but still must be confirmed unused
in App Store Connect immediately before archive/upload. Physical iPhone/iPad
testing against a real Studio peer also remains open.
