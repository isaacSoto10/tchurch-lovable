#!/bin/sh

# Xcode Cloud post-clone script.
# Runs after the repo is cloned, before Swift Package Manager resolves packages.
# The iOS archive uses committed Capacitor web assets and vendored Swift packages
# so Xcode Cloud does not need Node/npm during archive.

set -eux

if [ -n "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  REPO_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
else
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

cd "$REPO_ROOT"

# Fail early with a clear message if Capacitor did not generate what Xcode needs.
test -f ios/App/App/config.xml
test -f ios/App/App/capacitor.config.json
test -d ios/App/App/public
test -f ios/App/CapApp-SPM/Package.swift
test -f ios/App/CapacitorFilesystem/Package.swift
test -d ios/App/CapacitorFilesystem/ios/Sources/FilesystemPlugin
test -f ios/App/CapacitorPushNotifications/Package.swift
test -d ios/App/CapacitorPushNotifications/ios/Sources/PushNotificationsPlugin
test -f ios/App/CapacitorShare/Package.swift
test -d ios/App/CapacitorShare/ios/Sources/SharePlugin

for PROJECT_FILE in ios/App/App.xcodeproj/project.pbxproj ios/App/Tchurch.xcodeproj/project.pbxproj; do
  test -f "$PROJECT_FILE"
  if grep -q "node_modules/@capacitor" "$PROJECT_FILE"; then
    echo "Xcode project references node_modules Capacitor packages. Use the committed ios/App/CapApp-SPM package instead."
    exit 1
  fi
  grep -q 'relativePath = "CapApp-SPM";' "$PROJECT_FILE"
done

test -f ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
test -f ios/App/Tchurch.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
