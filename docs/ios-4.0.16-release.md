# iOS 4.0.16 release candidate

Release candidate: `4.0.16 (227)`.

Build 227 is the next candidate for the new App Store version after App Store Connect
closed 4.0.15 with errors 90062 and 90186. This document is the active release
record; [the 4.0.15 document](ios-4.0.15-release.md) is historical evidence
only and must not be used as an active release instruction.

## Previous build 226 (historical)

Build 226 was consumed by an App Store Connect upload that failed because
inherited framework signatures were invalid. Apple left the failed
`BuildUpload` in place and rejected deletion with HTTP 409 invalid state. Do
not reuse build 226; this candidate advances to 227.

## Release gates

- `npm run check:ios-release` must report `4.0.16 (227)`.
- Run the complete web test suite, `npm run build`, and `npx cap sync ios`.
- Archive the `Tchurch` Release scheme as `4.0.16 (227)` using automatic
  signing. A locally signed development archive is acceptable for the archive
  gate; App Store distribution requires the separate Apple re-sign/upload path.
- Confirm that the archive's bundle identifier remains
  `app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch` and that its committed
  Capacitor assets match the generated build.
- App Store Connect must accept build 227 under version 4.0.16 before any
  public App Store or external TestFlight promotion.

## Verification record

The API configuration is locked to the canonical Tchurch production backend;
no staging or direct database endpoint is permitted. The 4.0.15/226 candidate
was not accepted because that App Store version was closed and its upload also
failed on inherited framework signatures, so this new train must be validated
independently before TestFlight distribution.

## TestFlight evidence — 2026-08-31

- Source commits `61a23267` (single-backend enforcement) through `fbe81092`
  (4.0.16 build 227) are on `origin/main`.
- The signed source archive is
  `/tmp/tchurch-ios-release/Tchurch-4.0.16-227.xcarchive`.
- The App Store IPA is
  `/tmp/tchurch-ios-appstore-227.JpBvqA/Tchurch.ipa`, SHA-256
  `a036bb1eb18c75e8c999ddb148ea4ad783a6718aa0855da36cc4afe41d48ec0e`.
- The app plus Capacitor and Cordova frameworks are signed with Apple
  Distribution. The final app has `get-task-allow=false`, production APNs,
  `beta-reports-active=true`, arm64 only, and exact metadata `4.0.16 (227)`.
- The embedded web bundle contains `https://www.tchurchapp.com/api` and no
  localhost, retired staging-project, or direct InsForge endpoint.
- Apple's Build Upload API accepted the complete IPA in one chunk, returned no
  file errors or warnings, and App Store Connect subsequently reported the
  build as valid.
- TestFlight reports build 227 available to all existing internal groups
  (`1/1`). Public App Store submission, external TestFlight beta review, and
  superseded-build expiration were intentionally not requested.
