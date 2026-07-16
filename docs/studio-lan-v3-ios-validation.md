# Studio LAN v3 iOS release validation

Validated on 2026-07-16 from the isolated worktree
`/Users/isaacsoto/Tchurch/.codex-local/i3`. The canonical checkout at
`/Users/isaacsoto/Tchurch-app` was not modified.

## Integration lineage

- Branch: `codex/lan-v3-release-integration-ios`
- Base: iOS `origin/main` at `78580b2085e2b8a100dc8f90e7173e9a42459bf4`
- Integrated source: exact commit
  `c925f33ad9d2ee167c0e84dac7cd325129348648`
- No remote branch was pushed as part of this validation.

The merge retains the exact source commit as a parent. Release hardening adds
same-revision equivocation rejection and makes logout remove the in-process
replay state, persistent LAN client identity, every pairing secret, and the
private asset cache.

## Cross-repository contract

The fixture in this repository and the fixture on current Tchurch Studio
`origin/main` (`a0b7758c2964c87b16131c4e0ba8afa9cc62e80a`) are byte-for-byte identical:

- iOS: `ios/App/TchurchNativeTests/Fixtures/studio_lan_v3_asset_fixture.json`
- Studio: `TchurchStudioTests/Fixtures/studio_lan_v3_asset_fixture.json`
- SHA-256: `a6b746d3ae32daca97e2e6653f7e2db52f0edd3618a89338dc0fd7a73a4f75e8`
- Git blob: `b766f521544a6c26503d0cf22c43c419ee926c6f`

The retained v1 compatibility fixture has SHA-256
`802f14639b751073beb86a5547ceb48ab2c18ed201eab77ad561d6241bcea011`.

## Automated validation

All final commands passed after the hardening changes:

- `npm test`: 72 files, 556 tests, 0 failures.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build`: passed.
- `npx cap sync ios`: passed with six plugins and no generated drift.
- Signed iOS Simulator native suite: 35 tests, 0 failures, 0 skipped.
- Debug iPhone 17 Pro build on iOS 26.5: passed.
- Debug iPad Pro 13-inch (M5) build on iOS 26.5: passed.

The signed native result bundle is
`/tmp/tchurch-i3-final-native-20260716-1243.xcresult`. Signing is required for
the real Simulator Keychain read/write/delete test; the complete final suite
was therefore run with normal Simulator signing.

Coverage includes:

- QR payload parsing, manual pairing handoff, and secret non-rendering.
- Real local TLS-PSK negotiation with a matching secret and fail-closed
  behavior for a wrong secret.
- Real DNS-SD/Bonjour advertisement and discovery for
  `_tchurch-show._tcp`.
- Version negotiation, exact fixture decoding, authenticated legacy fallback,
  and downgrade prevention.
- Signed envelope integrity, channel binding, stale revision, replay,
  same-revision equivocation, signing-key rotation, authority epoch rotation,
  and authenticated server-run rotation.
- Bounded framing, Range checkpoints, interrupted-download resume, chunk hash,
  full-object hash and magic validation, corrupt checkpoint recovery,
  concurrent promotion, symlink rejection, disk reserve, quota, purge, and
  request watchdog behavior.
- Logout ordering and deletion of Keychain pairing data, replay state, cached
  private assets, and the persistent LAN client identifier.
- Discovery timeout/retry, read-only Stage/Audience output, blackout,
  sanitized live data, chord offsets, image placeholder/ready/stale behavior,
  and scrollable content.

`npm ci` completed successfully. The existing lockfile audit reports 40
third-party dependency advisories (2 low, 20 moderate, 16 high, 2 critical);
no automatic dependency rewrite was made in this integration.

## Simulator scenarios

Final signed builds were installed and launched through the direct/deep link
`tchurchapp://tchurchapp.com/#/app/studio-stage`.

- iPhone portrait: direct entry, discovery timeout/error, retry action,
  Stage/Audience selector, QR entry point, manual pairing form, and safe-area
  layout were visually present without clipping.
- iPad landscape: the same route and states rendered full-screen without
  overlap or clipping.
- iPad portrait/resizable: the route remained intact without overlap or
  clipping.
- Stage and Audience live-output states, blackout, verified-image readiness,
  stale-image rejection, and scroll overflow are covered by component tests.

The Mac GUI was locked during final validation, so pointer-driven simulator
gestures for bottom navigation, back navigation, selector taps, and manual
scrolling could not be repeated against the final build. This is a UI-gesture
evidence limitation, not a build or automated-test failure.

## Physical release gate

Before production release, run one physical iPhone and one physical iPad on
the same LAN as the current Tchurch Studio build and record:

1. Camera scan of a newly generated QR code and successful Stage pairing.
2. Manual-code pairing, including wrong-code rejection without fallback.
3. Stage and Audience updates, blackout, current-image download, and a cue
   change while an older image is still loading.
4. Wi-Fi interruption during a ranged asset transfer, reconnect, resume, and
   offline reuse of the verified cache.
5. Studio restart, signing-key rotation, authority-epoch rotation, and stale
   or replayed packet rejection.
6. App background/foreground, logout, and confirmation that the previous
   pairing and private cache cannot be reused.
7. Bottom tabs, card/detail navigation, back buttons, direct/deep-linked
   entry, loading/error states, and at least one scrolled state on each form
   factor.

Simulator tests prove the local protocol and security mechanisms, but cannot
substitute for the physical camera, multicast behavior through the actual
access point, Wi-Fi client-isolation behavior, or real network interruption.
