# ChordPro release train

Release candidate: `4.0.18 (243)`.

This release carries the ChordPro/presentation changes already committed and verified in the 4.0.17 (242) candidate. There are no new feature changes in this version update.

## Why the version changed

Before this upload, read-only App Store Connect verification on October 19, 2026 confirmed the public App Store version was `4.0.17` (`READY_FOR_SALE`) and the newest valid uploaded build was 241. The normal Xcode Organizer upload authenticated successfully, but Apple rejected candidate 242 because its `CFBundleShortVersionString` was not higher than the approved 4.0.17 (error 90062), and the 4.0.17 train is closed (90186). Candidate 242 was not successfully uploaded.

Marketing version 4.0.18 and build 243 move the same verified code to a new release train. No 4.0.18 version or build 243 was observed before preparing this candidate.

## Validation and distribution

- Prior functional validation remains recorded in `docs/ios-4.0.17-release.md`: 90 test files / 690 tests, TypeScript, atomic chord/lyric wrapping, actual paired-PDF geometry and visual checks, and native scenario results/blockers.
- Both Xcode projects, package metadata, release checker and current manual release command examples use 4.0.18 (243).
- Production web assets are regenerated through Vite and Capacitor, with portable Swift package paths restored.
- Vite, Capacitor sync, TypeScript and release consistency checks passed. The signed Xcode Release archive succeeded at `/tmp/tchurch-ios-release/Tchurch-4.0.18-243.xcarchive`.

## Confirmed upload and TestFlight

The normal Xcode Organizer App Store Connect flow displayed a successful upload receipt for `4.0.18 (243)`. Independent App Store Connect API reads subsequently confirmed:

- Build ID: `dde1ffac-dada-4a9d-b386-5ae26d9350d4`.
- Processing state: `VALID`; expired: `false`.
- Uploaded date: `2026-10-19T06:55:42-07:00`.
- Internal TestFlight state: `IN_BETA_TESTING`, available to the existing 1/1 internal group with no additional group changes or tester invitations.
- External TestFlight state: `READY_FOR_BETA_SUBMISSION`; external beta review was not submitted.
- `usesNonExemptEncryption=false`, matching the archived `ITSAppUsesNonExemptEncryption=false` declaration. No new export-compliance declaration was made.

The exact 4.0.18/243 promotion plan was inspected in dry-run mode before preparing the public draft.

## Prepared public draft

App Store version `4.0.18` exists as `PREPARE_FOR_SUBMISSION`, ID `fcd46dd4-3ef4-40f9-bb60-a09a3c6c3ec2`, with build 243 attached and independently verified. The release type is `AFTER_APPROVAL`.

The draft preserves the approved description, keywords, support/marketing URLs, copyright, review-contact information and existing complete screenshots (four iPhone 6.5-inch screenshots and one iPad 12.9-inch screenshot). Inherited demo-account credential presence was checked as booleans only; no credential values were logged or stored. Approved What's New notes were saved to the new `es-MX` and `en-US` localizations and read back to verify an exact match.

## Remaining Account Holder action

The live App Store Connect UI displayed an updated Apple Developer Program License Agreement requiring review and acceptance by the Account Holder before apps can be updated or submitted. The human Account Holder was asked to review and accept it.

No final public review submission was attempted, and no agreement was accepted by automation. The draft remains prepared while this legal gate is pending. External beta review, DSA trader status and territory availability were not changed.

Sanitized live evidence is saved under `/Users/isaacsoto/Tchurch/output/chordpro-2026-10-19/` in `ios-4.0.18-243-asc.json` and `ios-4.0.18-243-review-readiness.json`. The final receipt was checked at `2026-10-19T14:02:48.727Z`.
