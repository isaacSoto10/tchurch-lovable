#!/bin/sh

# Xcode Cloud post-clone script
# Runs after the repo is cloned, before the build starts

set -e

cd "$CI_PRIMARY_REPOSITORY_PATH"

# Install dependencies
npm install

# Build the web app
npm run build

# Sync Capacitor (copies dist into iOS project)
npx cap sync ios
