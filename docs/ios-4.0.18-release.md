# ChordPro release train

Release candidate: `4.0.18 (243)`.

This release carries the ChordPro/presentation changes already committed and verified in the 4.0.17 (242) candidate. There are no new feature changes in this version update.

## Why the version changed

Read-only App Store Connect verification on October 19, 2026 confirmed the current public App Store version is `4.0.17` (`READY_FOR_SALE`) and the newest valid uploaded build is 241. The normal Xcode Organizer upload authenticated successfully, but Apple rejected candidate 242 because its `CFBundleShortVersionString` was not higher than the approved 4.0.17 (error 90062), and the 4.0.17 train is closed (90186). Candidate 242 was not successfully uploaded.

Marketing version 4.0.18 and build 243 move the same verified code to a new release train. No 4.0.18 version or build 243 was observed before preparing this candidate.

## Validation and distribution

- Prior functional validation remains recorded in `docs/ios-4.0.17-release.md`: 90 test files / 690 tests, TypeScript, atomic chord/lyric wrapping, actual paired-PDF geometry and visual checks, and native scenario results/blockers.
- Both Xcode projects, package metadata, release checker and current manual release command examples use 4.0.18 (243).
- Production web assets are regenerated through Vite and Capacitor, with portable Swift package paths restored.
- Vite, Capacitor sync, TypeScript and release consistency checks passed. The signed Xcode Release archive succeeded at `/tmp/tchurch-ios-release/Tchurch-4.0.18-243.xcarchive`.
- Parent release operator owns the normal Xcode Organizer upload. A visible progress sheet alone does not establish delivery; verify App Store Connect build 243 processing and availability independently.
- App Store public review and TestFlight distribution are separate from binary upload. Existing promotion tooling must first run in read-only/dry-run mode against the exact 4.0.18/243 target.
