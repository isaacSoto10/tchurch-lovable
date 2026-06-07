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

sed -i '' \
  -e 's#path: "../../../node_modules/@capacitor/filesystem"#path: "../CapacitorFilesystem"#' \
  -e 's#path: "../../../node_modules/@capacitor/push-notifications"#path: "../CapacitorPushNotifications"#' \
  -e 's#path: "../../../node_modules/@capacitor/share"#path: "../CapacitorShare"#' \
  ios/App/CapApp-SPM/Package.swift

if grep -q "node_modules/@capacitor" ios/App/CapApp-SPM/Package.swift; then
  echo "CapApp-SPM must use committed vendored Capacitor packages, not node_modules." >&2
  exit 1
fi
