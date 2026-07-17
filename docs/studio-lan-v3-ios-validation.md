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

## P1 reconnect and privacy follow-up

Validated on 2026-07-16 and revalidated on 2026-07-17 from the isolated worktree
`/Users/isaacsoto/Tchurch/.codex-local/ios-p1`. This follow-up branch is
`codex/lan-v3-p1-fixes-ios`, based on exact commit
`7639c792310c4de699f70b521b834cefd57ebc6e`. The canonical iOS checkout was
not modified and no branch was pushed.

The reconnect path now carries the concrete Network.framework error through
waiting, timeout, send, receive, EOF, and cancellation. Ordinary Wi-Fi loss,
unreachable service, timeout, EOF, cancellation, and generic TLS handshake
failure preserve the PSK, stable client identity, replay state, verified asset
cache, and Range checkpoint. Retry delay is capped at 16 seconds. A successful
authenticated session remains known across later pre-grant attempts and the
transport never uses those attempts as a legacy downgrade signal.

A local Network.framework PSK probe showed that a wrong secret can currently
surface as the broad `errSSLHandshakeFail` (`-9858`). That value is therefore
not deterministic enough to erase credentials. Only the explicit
`errSSLUnknownPSKIdentity` alert triggers automatic PSK rejection cleanup.
Generic handshake failure keeps the pairing and gives the operator explicit
Forget guidance if the Studio QR was actually rotated. Authenticated invalid
grant, invalid signed data, or protocol compromise still fails closed and
purges private LAN state. Local Keychain persistence failure is retained and
retried; it is never translated into peer compromise or credential deletion.

Account and church isolation is coordinated through one serialized privacy
boundary. The native client persists only SHA-256 principal/scope fingerprints
in a dedicated Keychain record. A principal or church change, authoritative
membership revocation, explicit Forget, or logout writes an atomic checked
tombstone before deleting any pairing, cache, checkpoint, or client identity.
Completion atomically replaces that tombstone. A failed begin write deletes
nothing and blocks access; a failed delete or completion write leaves the
tombstone durable so cold start remains blocked and retries. Temporary token,
Internet, or membership-fetch failure does not purge the last authorized LAN
scope. The same cached principal may therefore resume offline, while a
different account purges before its membership request. Pending manual church
switches and stale account responses cannot publish after a newer principal
transition.

The 2026-07-17 revalidation closes the interrupted-asset reconnect gap without
weakening replay protection. After an automatic reconnect, the client may use
the exact latest previously accepted envelope once per new PSK-authenticated
automatic connection to rebuild immutable image download intents and resume a
durable Range checkpoint. This eligibility exists only while that exact
envelope still has an unresolved image. It rearms after another transport loss
but disappears as soon as every image resolves. The client retains only the
encoded byte count and SHA-256 digest, not another Stage payload copy; both must
match alongside authority, signing key, sequence, revision, and payload
checksum. The envelope is not republished and does not advance replay state. A
second copy on the same connection, a byte-different encoding, equivocation,
stale state, another authority, or a fresh/manual disconnect or connect remains
rejected. Manual boundaries clear the evidence completely, so their later
automatic retry cannot revive an envelope from the prior session.

Replay re-registration is silent: it does not emit a new initial loading event
or rewrite the authorization manifest. Asset UI state is deduplicated by
object and presentation generation; loading progress can only increase and a
terminal ready/unavailable event can publish only once. A new progress offset
or the first ready event still publishes because the UI needs that actual
transition and local file URL.

The same integrated reconnect test exposed and closed a subscription-version
bug: after a modern subscription selected payload v3, reconnect incorrectly
used `3` as the subscription request schema even though only schemas 1 and 2
exist. Subscription schema is now independent of payload schema. Modern
sessions keep schema 2 for payload v1, v2, or v3; only the explicit
authenticated legacy-fallback path can use schema 1. The loopback tests prove
three successive TLS-PSK sessions resume offsets 65,536 and 131,072 after two
transport losses, preserve one monotonic asset UI sequence and one envelope UI
publication, do not rewrite authorization bookkeeping, and do not enter the
fail-closed purge path. A separate real-network scenario proves manual reset
blocks both the fresh connection and its subsequent automatic retry from using
the old replay evidence.

Final automated validation after these changes:

- `npm test`: 74 files, 567 tests, 0 failures.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build`: passed.
- `npx cap sync ios`: passed with six plugins and no generated drift.
- A fresh build and sync retained the embedded public-tree SHA-256 previously
  proven identical across two consecutive runs:
  `90d6e6d71c958030bac6fffcfd36a6b65958e6c277e22380350920271bc7f4cc`.
- Signed iPhone 17 Pro native suite on iOS 26.5: 48 tests, 0 failures, 0
  skipped. Result bundle:
  `/tmp/tchurch-ios-p1-final-review2-full-derived/Logs/Test/Test-Tchurch-2026.07.17_06-36-36--0500.xcresult`.
- Debug iPhone 17 Pro and iPad Pro 13-inch (M5) builds on iOS 26.5: passed.
- The v3 and retained v1 fixture hashes remain
  `a6b746d3ae32daca97e2e6653f7e2db52f0edd3618a89338dc0fd7a73a4f75e8`
  and `802f14639b751073beb86a5547ceb48ab2c18ed201eab77ad561d6241bcea011`.

The final builds were installed on both simulator form factors, terminated,
and opened cold through
`tchurchapp://tchurchapp.com/#/app/studio-stage`. The direct route rendered the
read-only Stage/Audience surface, discovery-empty/retry state, pairing entry,
safe areas, and the fail-closed `Verificando el acceso local...` state without
overlap or clipping. Evidence screenshots are
`/tmp/tchurch-ios-p1-final2-iphone-cold-deeplink.png` and
`/tmp/tchurch-ios-p1-final2-ipad-cold-deeplink.png`.

The Mac remained locked, and Computer Use explicitly reported that automatic
unlock was unavailable. Pointer-driven back navigation, bottom tabs, manual
scrolling, selector taps, and orientation changes could not be repeated on the
final binary. Those routes/states retain automated component coverage, but the
gesture evidence must be completed after unlocking the Mac. Physical release
still requires an actual Studio peer, camera QR flow, real access-point
multicast/client-isolation behavior, actual Wi-Fi interruption during transfer,
background/foreground, and wrong-key alert classification on shipping devices.

## Local-only Stage follower and heartbeat follow-up

This follow-up was completed in the isolated worktree
`/Users/isaacsoto/Tchurch/.codex-local/ios-studio-lan-follower` on branch
`codex/studio-lan-follower-ios`. The completed follow-up is commit
`e7bbe9e6ac0aea8a2bfe5106bb8d3ba117a4a134`, pushed to
`origin/codex/lan-v3-release-integration-ios`; the canonical
`/Users/isaacsoto/Tchurch-app` checkout was not modified.

The native launch path now stays behind a local loading gate until Capacitor's
initial `getLaunchUrl()` request settles. A deferred-launch integration test
starts from `#/`, holds that request pending, and proves that Clerk,
`ChurchProvider`, analytics, preloads, application warmups, and `fetch` all
remain at zero before resolution. Resolving the launch URL to
`#/app/studio-stage` renders the local route while those Cloud counters remain
at zero. The exact Studio route is separated before Cloud providers mount.

Cloud work already in flight is bounded as well: native warmups and church
selection calls receive `AbortSignal`s and are aborted during route/account
transitions. User-action transport can be suspended without discarding its
queue and resumes after leaving the local privacy boundary. The Stage follower
keeps its last verified update or image during reconnecting and suspended
states, ignores new frames unless the transport is connected, and clears the
retained frame on failed/manual connect, disconnect, or forget.

The native TLS-PSK client now sends an authenticated heartbeat after 10 seconds
of idle time and requires the exact nonce-bearing pong within 25 seconds. A
silent peer, wrong pong, unsolicited pong, or timeout closes only that
transport and reconnects; it does not delete the PSK, purge the last verified
frame, or write a privacy tombstone. Four loopback integration tests cover
those cases, including proving that a stale timer from a previous transport
cannot close its replacement. The three heartbeat failures are normalized to
the fixed, non-sensitive `SAFE_MESSAGES` strings in the JavaScript bridge.

Final automated validation after the complete follow-up:

- Focused web tests: 9 files, 49 tests, 0 failures.
- Full web suite: 78 files, 584 tests, 0 failures.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npm run build`: passed.
- `npx cap sync ios`: passed with six plugins.
- Two consecutive fresh build/sync runs produced the same embedded public-tree
  SHA-256:
  `aec3529c2fd0c95f93f0bf8487939eaff02d016b6e91230b06a4899cd045e564`.
- Signed iPhone 17 Pro native suite on iOS Simulator 26.5: 52 tests, 0
  failures, 0 skipped. Result bundle:
  `/tmp/tchurch-ios-lan-follower-native-final2.xcresult`; derived data:
  `/tmp/tchurch-ios-lan-follower-native-derived-final2`.
- Dedicated signed iPhone and iPad builds passed. Derived data:
  `/tmp/tchurch-ios-lan-follower-iphone-build-final2` and
  `/tmp/tchurch-ios-lan-follower-ipad-build-final2`.

The final embedded binary was exercised on both simulator form factors. On
iPhone, a clean reinstall followed by a terminated cold deep link opened the
local Stage route directly in its fail-closed authorization state. The
Stage/Audience selector, scrolled setup state, return to the top, and local back
button were exercised; the back button mounted Cloud login only after leaving
the LAN route. On iPad, the terminated cold deep link was exercised in both
landscape and portrait, then backgrounded to the Home screen and resumed back
to Studio without losing state or clipping. Returning to `/app/services`
restored the signed-in Cloud Services surface with its bottom navigation and
loaded data.

Simulator evidence:

- `/tmp/tchurch-ios-lan-follower-iphone-final2-cold.png`
- `/tmp/tchurch-ios-lan-follower-iphone-final2-scrolled.png`
- `/tmp/tchurch-ios-lan-follower-ipad-final2-landscape-upright.png`
- `/tmp/tchurch-ios-lan-follower-ipad-final2-portrait-upright.png`
- `/tmp/tchurch-ios-lan-follower-ipad-final2-background-resume.png`
- `/tmp/tchurch-ios-lan-follower-ipad-final2-cloud-return.png`

These simulator checks supersede the locked-Mac limitation recorded in the
previous section. System-wide networking was not disabled during this run; the
deferred-launch integration with rejecting/mocked Cloud transports is the
evidence that the Studio cold path makes zero Cloud attempts. Physical release
still requires an actual Studio peer, camera pairing, multicast/client-isolation
checks on real access points, an actual Wi-Fi interruption, and wrong-key alert
classification on shipping devices.
