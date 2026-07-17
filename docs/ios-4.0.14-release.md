# iOS 4.0.14 release candidate

Release candidate: `4.0.14 (214)`.

Build `214` is the next repository build after `origin/main` build `213`.
It is reserved by both Xcode projects, the package metadata, the release
consistency check, and the App Store agent workflow. App Store Connect could
not be queried during preparation because the local API keys require their
missing issuer/provider context and the GitHub workflow has no App Store
Connect secrets configured. Reconfirm that `214` is unused immediately before
archive/upload; if it is already occupied, increment every release pin
together and rerun `npm run check:ios-release`.

## Internal release notes

- Adds the read-only Tchurch Studio LAN follower for Stage and Audience output
  on iPhone and iPad.
- Keeps a cold Studio LAN launch local: Cloud providers, analytics, warmups,
  and Internet fetches remain unmounted until the operator leaves the LAN
  surface.
- Uses authenticated local pairing, signed/replay-protected updates, verified
  image caching, resumable transfers, blackout and chord state, and bounded
  heartbeat/reconnect behavior.
- Preserves the last verified local frame through ordinary Wi-Fi interruption
  while failing closed for authorization or integrity failures.

## Release gates

- `npm test`, TypeScript, web build, Capacitor sync, the signed native test
  suite, and iPhone/iPad Simulator scenarios must pass for this exact release
  candidate.
- Before shipment, validate camera and manual pairing against the current
  Tchurch Studio build on one physical iPhone and one physical iPad, including
  multicast discovery, blackout, image resume after real Wi-Fi interruption,
  background/foreground, logout, and pairing/cache invalidation.
- Archive and upload through Xcode with App Store Connect provider credentials,
  then confirm `4.0.14 (214)` reaches a valid processing state before any
  TestFlight or App Store promotion.

## Preparation evidence

Validated locally on 2026-07-17 from the isolated release worktree:

- `npm run check:ios-release`: passed with every release pin at `4.0.14 (214)`.
- `npm test`: 78 files, 584 tests, 0 failures.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build` and `npx cap sync ios`: passed; the native sync produced no
  tracked asset drift.
- Signed iPhone 17 Pro native suite on iOS Simulator 26.5: 52 tests, 0
  failures, 0 skipped. Result bundle:
  `/tmp/tchurch-ios-4.0.14-214-native-retry.xcresult`.
- Dedicated iPhone and iPad Simulator builds passed and both embedded
  `CFBundleShortVersionString=4.0.14` and `CFBundleVersion=214`.
- A clean iPhone deep link exercised the local authorization/error state,
  Stage/Audience selection, manual-pairing scrolled state, and local back
  navigation into Cloud login. iPad exercised Stage/Audience in portrait and
  landscape plus background/foreground resume without clipping or state loss.
- Release archive succeeded at `/tmp/Tchurch-4.0.14-214.xcarchive`; its app
  signature verifies strictly, it contains the dSYM, and its embedded version
  is `4.0.14 (214)`.

No App Store Connect query, upload, TestFlight distribution, or App Store
promotion occurred. The local API keys were rejected without issuer/provider
context, and the GitHub workflow currently reports its App Store Connect
secrets missing. Physical iPhone/iPad testing against a real Studio peer also
remains open.
