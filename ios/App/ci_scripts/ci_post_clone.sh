#!/bin/sh

# Xcode Cloud looks for ci_scripts next to the selected .xcodeproj/.xcworkspace.
# This wrapper jumps back to the repository root and runs the same Capacitor setup.

set -eux

if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
fi

cd "$REPO_ROOT"

npm ci
npm run build
npx cap sync ios

test -f ios/App/App/config.xml
test -f ios/App/App/capacitor.config.json
test -d ios/App/App/public
test -d node_modules/@capacitor/browser
