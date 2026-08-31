# iOS 4.0.16 release candidate

Release candidate: `4.0.16 (226)`.

Build 226 is retained for the new App Store version after App Store Connect
closed 4.0.15 with errors 90062 and 90186. This document is the active release
record; [the 4.0.15 document](ios-4.0.15-release.md) is historical evidence
only and must not be used as an active release instruction.

## Release gates

- `npm run check:ios-release` must report `4.0.16 (226)`.
- Run the complete web test suite, `npm run build`, and `npx cap sync ios`.
- Archive the `Tchurch` Release scheme as `4.0.16 (226)` using automatic
  signing. A locally signed development archive is acceptable for the archive
  gate; App Store distribution requires the separate Apple re-sign/upload path.
- Confirm that the archive's bundle identifier remains
  `app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch` and that its committed
  Capacitor assets match the generated build.
- Do not upload or promote until App Store Connect accepts build 226 under
  version 4.0.16.

## Verification record

The API configuration is locked to the canonical Tchurch production backend;
no staging or direct database endpoint is permitted. The 4.0.15/226 candidate
was not accepted because that App Store version was closed, so this new train
must be validated independently before TestFlight distribution.
