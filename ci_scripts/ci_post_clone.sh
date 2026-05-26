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

# Compatibility guard for Xcode Cloud/export.
# Some archived build metadata can still resolve Capacitor Swift packages from
# node_modules/@capacitor. We vendor the native packages under ios/App, so expose
# lightweight symlinks before SwiftPM resolves packages.
mkdir -p node_modules/@capacitor
ln -sfn ../../ios/App/CapacitorFilesystem node_modules/@capacitor/filesystem
ln -sfn ../../ios/App/CapacitorPushNotifications node_modules/@capacitor/push-notifications
ln -sfn ../../ios/App/CapacitorShare node_modules/@capacitor/share

echo "Xcode Cloud post-clone context:"
echo "  repo: $REPO_ROOT"
echo "  commit: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
ls -la node_modules/@capacitor

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
    echo "Warning: $PROJECT_FILE still references node_modules Capacitor packages; compatibility symlinks were created."
  fi
  grep -q 'relativePath = "CapApp-SPM";' "$PROJECT_FILE"
done

test -f ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
test -f ios/App/Tchurch.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
