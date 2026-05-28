#!/bin/sh

# Xcode Cloud looks for ci_scripts next to the selected .xcodeproj/.xcworkspace.
# This validates committed Capacitor assets and the vendored native Swift packages.

set -eux

if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
fi

cd "$REPO_ROOT"

test -f ios/App/App/config.xml
test -f ios/App/App/capacitor.config.json
test -d ios/App/App/public
test -f ios/App/CapacitorFilesystem/Package.swift
test -d ios/App/CapacitorFilesystem/ios/Sources/FilesystemPlugin
test -f ios/App/CapacitorPushNotifications/Package.swift
test -d ios/App/CapacitorPushNotifications/ios/Sources/PushNotificationsPlugin
test -f ios/App/CapacitorShare/Package.swift
test -d ios/App/CapacitorShare/ios/Sources/SharePlugin

if grep -q "node_modules/@capacitor" ios/App/CapApp-SPM/Package.swift; then
  echo "CapApp-SPM must use committed vendored Capacitor packages, not node_modules." >&2
  exit 1
fi
