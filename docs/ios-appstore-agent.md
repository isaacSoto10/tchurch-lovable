# iOS App Store Agent

This repo includes a daily App Store Connect agent that looks for the latest valid iOS build and promotes it.

## What it does

- Runs every day from GitHub Actions.
- Reads the latest valid, unexpired build from App Store Connect.
- Detects the build marketing version from the build pre-release version.
- Creates the matching iOS App Store version if it does not exist.
- Replaces an older build in the same version when `ASC_REPLACE_IN_REVIEW=true`.
- Assigns the latest build to the App Store version.
- Attempts App Store review submission through the public App Store Connect API.
- Submits the latest build for TestFlight beta review.
- Expires superseded beta builds if Apple blocks beta review because an older build in the same train is already waiting.

## Required GitHub secrets

- `ASC_APP_ID`: App Store Connect app id, for example `6762327867`.
- `ASC_KEY_ID`: App Store Connect API key id.
- `ASC_ISSUER_ID`: App Store Connect issuer id.
- `ASC_PRIVATE_KEY`: The full `.p8` private key text. Store it as a secret with newlines preserved, or escaped as `\n`.

## Optional environment variables

- `ASC_DRY_RUN`: `true` to print planned actions without changing App Store Connect.
- `ASC_SUBMIT_FOR_REVIEW`: `true` to attempt App Store review submission.
- `ASC_BETA_REVIEW`: `true` to submit the newest build for beta review.
- `ASC_REPLACE_IN_REVIEW`: `true` to remove an existing App Store submission before replacing its build.
- `ASC_EXPIRE_SUPERSEDED_BETA_BUILD`: `true` to expire an older beta build when Apple blocks the new beta review.
- `ASC_BUILD_LOOKBACK`: Number of recent builds to inspect. Default is `20`.
- `ASC_TARGET_MARKETING_VERSION`: Optional App Store version filter. The 4.0 workflow sets this to `4.0` so older build trains are not promoted by accident.
- `ASC_TARGET_BUILD_NUMBER`: Optional build-number filter. The 4.0 workflow pins this to `400` so later CI-only builds cannot replace the build that was submitted to review.

## Manual commands

Dry run:

```bash
ASC_APP_ID=6762327867 \
ASC_KEY_ID=... \
ASC_ISSUER_ID=... \
ASC_PRIVATE_KEY_PATH=/path/to/AuthKey_XXXX.p8 \
ASC_DRY_RUN=true \
npm run appstore:ios-agent
```

Real run:

```bash
ASC_APP_ID=6762327867 \
ASC_KEY_ID=... \
ASC_ISSUER_ID=... \
ASC_PRIVATE_KEY_PATH=/path/to/AuthKey_XXXX.p8 \
ASC_DRY_RUN=false \
npm run appstore:ios-agent
```

## Important limitation

Apple sometimes blocks final App Store review submission through the public App Store Connect API even after the build is attached. When that happens, the agent leaves the version attached to the newest build and logs that the final review draft must be submitted in the App Store Connect UI. TestFlight beta review submission is supported through the API.

## iPhone/iPad safety

This agent does not build the app, modify Xcode projects, change device families, or touch iPad layout. It only talks to App Store Connect and moves already-uploaded iOS builds through release state.
