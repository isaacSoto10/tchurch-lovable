#!/bin/sh

# Xcode Cloud post-clone script
# Runs after the repo is cloned, before the build starts

set -eux

cd "$CI_PRIMARY_REPOSITORY_PATH"

# Install dependencies
npm ci

# Build the web app
npm run build

# Sync Capacitor (copies dist into iOS project)
npx cap sync ios

# Fail early with a clear message if the iOS Capacitor resources are missing.
test -f ios/App/App/config.xml
test -f ios/App/App/capacitor.config.json
test -d ios/App/App/public
