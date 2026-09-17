# Tchurch iOS workspace

## Release automation

This repository does not use GitHub Actions. Do not add workflow files under `.github/workflows`.

Production iOS releases use the direct Xcode archive and App Store Connect upload path from this workspace. Check signing and provisioning through Xcode or `xcodebuild` without printing credentials, private keys, or other secret values.
