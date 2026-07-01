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

PACKAGE_VERSION="$(awk -F '"' '/^[[:space:]]*"version"[[:space:]]*:/ { print $4; exit }' package.json)"
RELEASE_VERSION="${TCURCH_RELEASE_VERSION:-}"
if [ -z "$RELEASE_VERSION" ] && [ -n "$PACKAGE_VERSION" ]; then
  RELEASE_VERSION="$PACKAGE_VERSION"
elif [ -z "$RELEASE_VERSION" ]; then
  RELEASE_VERSION="${CI_MARKETING_VERSION:-}"
fi

case "$RELEASE_VERSION" in
  ""|*[!0-9.]*|.*|*..*|*.)
    echo "Release marketing version must be numeric, for example 4.0.1: $RELEASE_VERSION" >&2
    exit 1
    ;;
  *)
    export RELEASE_VERSION
    perl -0pi -e 's/MARKETING_VERSION = [0-9]+(?:\.[0-9]+)*;/MARKETING_VERSION = $ENV{RELEASE_VERSION};/g' \
      ios/App/App.xcodeproj/project.pbxproj \
      ios/App/Tchurch.xcodeproj/project.pbxproj
    ;;
esac

BUILD_NUMBER="${CI_BUILD_NUMBER:-${XCODE_CLOUD_BUILD_NUMBER:-}}"
if [ -n "$BUILD_NUMBER" ]; then
  case "$BUILD_NUMBER" in
    *[!0-9]*)
      echo "Xcode Cloud build number must be numeric: $BUILD_NUMBER" >&2
      exit 1
      ;;
    *)
      perl -0pi -e "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" \
        ios/App/App.xcodeproj/project.pbxproj \
        ios/App/Tchurch.xcodeproj/project.pbxproj
      ;;
  esac
fi

test -f ios/App/App/config.xml
test -f ios/App/App/capacitor.config.json
test -d ios/App/App/public
test -f ios/App/CapacitorApp/Package.swift
test -d ios/App/CapacitorApp/ios/Sources/AppPlugin
test -f ios/App/CapacitorBarcodeScanner/Package.swift
test -d ios/App/CapacitorBarcodeScanner/ios/Sources/CapacitorBarcodeScannerPlugin
test -f ios/App/CapacitorBrowser/Package.swift
test -d ios/App/CapacitorBrowser/ios/Sources/BrowserPlugin
test -f ios/App/CapacitorFilesystem/Package.swift
test -d ios/App/CapacitorFilesystem/ios/Sources/FilesystemPlugin
test -f ios/App/CapacitorPushNotifications/Package.swift
test -d ios/App/CapacitorPushNotifications/ios/Sources/PushNotificationsPlugin
test -f ios/App/CapacitorShare/Package.swift
test -d ios/App/CapacitorShare/ios/Sources/SharePlugin

perl -0pi -e '
  s#path: "[^"]*node_modules/\@capacitor/app"#path: "../CapacitorApp"#g;
  s#path: "[^"]*node_modules/\@capacitor/barcode-scanner"#path: "../CapacitorBarcodeScanner"#g;
  s#path: "[^"]*node_modules/\@capacitor/browser"#path: "../CapacitorBrowser"#g;
  s#path: "[^"]*node_modules/\@capacitor/filesystem"#path: "../CapacitorFilesystem"#g;
  s#path: "[^"]*node_modules/\@capacitor/push-notifications"#path: "../CapacitorPushNotifications"#g;
  s#path: "[^"]*node_modules/\@capacitor/share"#path: "../CapacitorShare"#g;
' \
  ios/App/CapApp-SPM/Package.swift

if grep -q "node_modules/@capacitor" ios/App/CapApp-SPM/Package.swift; then
  echo "CapApp-SPM must use committed vendored Capacitor packages, not node_modules." >&2
  exit 1
fi
