# Secure church invitation handoff

Release candidate: `4.0.19 (246)`.

Secure email invitations use `/join-church?invite=...`; the previous native screen ignored that parameter and showed an empty church-code form. The native screen now recognizes canonical `invite` and legacy `token` parameters and offers the existing verified-email web acceptance flow through Capacitor Browser at the fixed canonical HTTPS origin.

No invitation is accepted by the native client. Invitation values are preserved exactly, encoded into the trusted destination URL, and excluded from rendered text, links and diagnostics. Ordinary code joining keeps its existing request contract and UI.

After browser use, signed-out users return to login. Signed-in users first refresh `/churches/mine` without cache; failure remains visible with retry, and success reloads the provider's server-authoritative membership/role state. Pending work is ignored after account changes, invitation changes or unmount. No role is inferred from an invitation or supplied by the client.

## Scope and checks

- Changed client: `src/pages/app/JoinChurch.tsx` wrapper, shared `ChurchInvitationHandoff` component/helper, and focused tests/deep-link cases.
- iOS already sends `cache: no-store` for church selection; no API-client or backend contract changes were needed.
- Final focused run: 25 tests passed. TypeScript passed.
- Initial broader run: 700 passed and four existing tests timed out while native compilation contended for resources. All four affected files passed when rerun with two workers (52 tests). No broad repeat was needed solely for an all-green aggregate.
- Final Vite, Capacitor sync, TypeScript and release-consistency checks passed. Native Debug build and the signed Release archive both succeeded. Archive signature verification passed; all 181 committed public asset files match the archived files, with no extra archived public files.

## Native Simulator evidence

Devices were initially shut down and were booted only for this task. App/account state was preserved. Only synthetic invalid invitations were opened; no real email was sent, no invitation was accepted, and no account, membership or role was created or changed.

- iPhone 17 Pro, iOS 26.5: reproduced the original secure-link failure before edits (empty code form), then verified the new handoff renders after installation. Further coordinate interactions repeatedly failed with CUA `noWindowsAvailable`, including an exclusive CUA period after rebinding and centering. A read-only direct `/app` entry rendered the signed-in shell with its bottom navigation pinned above the safe area, while the current session showed no selected church. The signed-in browser-return path, phone scrolling and bottom-tab interactions are explicitly unverified in native UI; focused tests cover the return and scope guards.
- iPad Pro 11-inch (M5), iOS 26.5: direct secure-link entry rendered the handoff; its primary action opened the canonical Tchurch page in native SFSafariViewController; the server rejected the synthetic invalid invitation; closing the browser returned to the app; the signed-out return action opened login. Legacy token entry, ordinary code-form fallback and portrait/landscape layout were verified. No production join/OTP request was submitted. iPad account-only bottom-tab scenarios require an authenticated session and were not exercised.
- Initial browser/native loading states were observed. Browser-open failure, refresh rejection/retry, pending return state and account/invitation/unmount races were checked with focused mocks. Full native error/scrolled scenarios were not claimed from those mocks.
- The handoff is outside the authenticated app shell and changes no global bottom-nav layout. Its 44px-or-larger controls and shared safe-area variables were checked in the source and native screenshots.

Evidence folder: `/tmp/tchurch-admin-invite-ios-evidence/`. Key files: `iphone-secure-invite-before.png`, `iphone-secure-invite-after.png`, `iphone-main-direct-entry.png`, `ipad-native-browser-invalid-invite.png`, `ipad-return-login.png`, `ipad-invite-landscape.png`, focused/type/build logs and the current App Store receipt.

## Release plan

Read-only App Store Connect inspection on October 21, 2026 confirmed the prior 4.0.18 (243) release is `READY_FOR_SALE`, its review is complete/approved, and the newest uploaded build is 4.0.18 (245). Marketing version 4.0.19 did not exist, and an exact all-state query confirmed build 246 was absent before this candidate was prepared.

Prepare and review the signed archive at `/tmp/tchurch-ios-release/Tchurch-4.0.19-246.xcarchive` before publishing main. Main publication can trigger Xcode Cloud. If it produces this version/build from the exact reviewed source, verify that provenance and do not perform a duplicate manual upload. Approved 4.0.18/243 is left unchanged. No review cancellation, replacement, new testers, external beta review or legal agreement action is included.

## Archive receipt

The signed candidate archive is `/tmp/tchurch-ios-release/Tchurch-4.0.19-246.xcarchive`. Its built Info.plist confirms marketing version 4.0.19 and build 246. `codesign --verify --deep --strict` passed. The sanitized local artifact receipt is `/tmp/tchurch-admin-invite-ios-evidence/archive-receipt.json`. No candidate upload or App Store review change was performed during preparation.
