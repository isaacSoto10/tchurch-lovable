# iOS App Store Agent

This repo includes an App Store Connect agent that looks for the latest valid iOS build. Scheduled runs are read-only; every release action requires an explicit manual dispatch.

## What it can do

- Runs a read-only audit every day from GitHub Actions.
- Reads the latest valid, unexpired build from App Store Connect.
- Detects the build marketing version from the build pre-release version.
- When explicitly enabled, creates the matching iOS App Store version if it does not exist.
- Replaces an older build in the same version only when `ASC_REPLACE_IN_REVIEW=true`.
- Assigns the latest build to the App Store version only when App Store review is enabled.
- Attempts App Store review submission through the public App Store Connect API only when explicitly enabled.
- Submits the latest build for TestFlight beta review only when explicitly enabled.
- Expires superseded beta builds only when explicitly enabled and Apple blocks beta review because an older build in the same train is already waiting.

## Required GitHub secrets

- `ASC_APP_ID`: App Store Connect app id, for example `6762327867`.
- `ASC_KEY_ID`: App Store Connect API key id.
- `ASC_ISSUER_ID`: App Store Connect issuer id for a team API key. Omit it
  for an individual API key; the agent will generate the required `sub=user`
  token instead.
- `ASC_PRIVATE_KEY`: The full `.p8` private key text. Store it as a secret with newlines preserved, or escaped as `\n`.

## Optional environment variables

- `ASC_DRY_RUN`: `true` to print planned actions without changing App Store Connect.
- `ASC_SUBMIT_FOR_REVIEW`: `true` to attempt App Store review submission.
- `ASC_BETA_REVIEW`: `true` to submit the newest build for beta review.
- `ASC_DISTRIBUTE_INTERNAL`: `true` to add the selected build to every existing
  internal TestFlight group. The agent never creates groups or testers.
- `ASC_REPLACE_IN_REVIEW`: `true` to remove an existing App Store submission before replacing its build.
- `ASC_EXPIRE_SUPERSEDED_BETA_BUILD`: `true` to expire an older beta build when Apple blocks the new beta review.
- `ASC_BUILD_LOOKBACK`: Number of recent builds to inspect. Default is `20`.
- `ASC_TARGET_MARKETING_VERSION`: Optional App Store version filter. The current workflow pins this to `4.0.10` so another release train cannot be promoted by accident.
- `ASC_TARGET_BUILD_NUMBER`: Optional build-number filter. The current workflow pins this to `209` so later CI-only builds cannot replace the tested build.

For the `4.0.10` release, Xcode Cloud must run with `CI_BUILD_NUMBER=209`.
`ios/App/ci_scripts/ci_post_clone.sh` intentionally reads that environment
value and applies it to both Xcode projects; the release number is not
hard-coded into the script's logic.

For a manual dispatch, if the workflow's marketing-version pin is stale, the
agent fails over to the newest valid build for the version in `package.json`.
This is intentional because Xcode Cloud owns the uploaded build counter. A
scheduled run with a stale marketing-version pin fails closed instead of
promoting a different release. When `ASC_SUBMIT_FOR_REVIEW=false`, the agent
does not create, attach, replace, or submit an App Store version; TestFlight
beta review remains independently controlled by `ASC_BETA_REVIEW`.

The workflow defaults to `dry_run=true`, with App Store review, external beta
review, replacement, expiration, and internal distribution disabled. To ship
only to existing internal TestFlight groups, first run those defaults as an
audit. Then manually dispatch again with `dry_run=false` and
`distribute_internal=true`, leaving both review inputs disabled.

## Manual commands

Dry run:

```bash
ASC_APP_ID=6762327867 \
ASC_KEY_ID=... \
ASC_ISSUER_ID=... \
ASC_PRIVATE_KEY_PATH=/path/to/AuthKey_XXXX.p8 \
ASC_TARGET_MARKETING_VERSION=4.0.10 \
ASC_TARGET_BUILD_NUMBER=209 \
ASC_DRY_RUN=true \
npm run appstore:ios-agent
```

Internal TestFlight distribution after reviewing the dry run:

```bash
ASC_APP_ID=6762327867 \
ASC_KEY_ID=... \
ASC_ISSUER_ID=... \
ASC_PRIVATE_KEY_PATH=/path/to/AuthKey_XXXX.p8 \
ASC_TARGET_MARKETING_VERSION=4.0.10 \
ASC_TARGET_BUILD_NUMBER=209 \
ASC_DRY_RUN=false \
ASC_SUBMIT_FOR_REVIEW=false \
ASC_BETA_REVIEW=false \
ASC_DISTRIBUTE_INTERNAL=true \
ASC_REPLACE_IN_REVIEW=false \
ASC_EXPIRE_SUPERSEDED_BETA_BUILD=false \
npm run appstore:ios-agent
```

Direct script execution is also read-only by default. App Store review and
external beta review require their corresponding environment variables to be
set explicitly to `true`.

## Important limitation

Apple sometimes blocks final App Store review submission through the public App Store Connect API even after the build is attached. When that happens, the agent leaves the version attached to the newest build and logs that the final review draft must be submitted in the App Store Connect UI. TestFlight beta review submission is supported through the API.

## iPhone/iPad safety

This agent does not build the app, modify Xcode projects, change device families, or touch iPad layout. It only talks to App Store Connect and moves already-uploaded iOS builds through release state.
