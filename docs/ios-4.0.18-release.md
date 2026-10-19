# ChordPro release train

Release candidate: `4.0.18 (243)`.

Final verified status: `WAITING_FOR_REVIEW`, submitted to Apple on October 19, 2026 at `19:04:42.382Z`.

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

App Store version `4.0.18` is now `WAITING_FOR_REVIEW`, ID `fcd46dd4-3ef4-40f9-bb60-a09a3c6c3ec2`, with build 243 attached and independently verified. The release type is `AFTER_APPROVAL`.

The draft preserves the approved description, keywords, support/marketing URLs, copyright, review-contact information and existing complete screenshots (four iPhone 6.5-inch screenshots and one iPad 12.9-inch screenshot). Inherited demo-account credential presence was checked as booleans only; no credential values were logged or stored. Approved What's New notes were saved to the new `es-MX` and `en-US` localizations and read back to verify an exact match.

## Public submission confirmed

After the user confirmed the Account Holder action, the native Developer account UI showed the Program License Agreement accepted and membership active. No agreement was accepted by automation.

The older `/appStoreVersionSubmissions` resource rejected a normal submission attempt with 403 because it no longer allows `CREATE`. The normal App Store Connect UI then added the exact 4.0.18/243 version for review. A fresh read verified one review submission with one item and the intended version/build. One [documented Modify a Review Submission](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_) request set `submitted=true` on that submission.

Independent readback at `2026-10-19T19:05:19.552Z` confirmed:

- App Store version `fcd46dd4-3ef4-40f9-bb60-a09a3c6c3ec2`: `WAITING_FOR_REVIEW`, still attached to reviewed build 243 (`dde1ffac-dada-4a9d-b386-5ae26d9350d4`).
- Review submission `d7a72fa4-bad2-4dd7-b79a-e6daac39f9f7`: `WAITING_FOR_REVIEW`.
- Submitted date: `2026-10-19T19:04:42.382Z`.
- Review submission target remains the exact 4.0.18 App Store version; it contains one review item.

Build 244 also exists because Xcode Cloud automatically built release commit `cda27df0ca5b582b91efc18b27212a0851fb28a2`. A direct CI-run-to-build API read confirmed this provenance; it is the same feature/version source as the reviewed 243 candidate. The review deliberately retained build 243. No build replacement, deletion, expiration, external beta review, DSA trader-status or territory-availability change was performed.

Submission is complete; App Store approval and public availability remain pending Apple's review.

Sanitized live evidence is saved under `/Users/isaacsoto/Tchurch/output/chordpro-2026-10-19/`, including `ios-4.0.18-243-asc.json`, `ios-4.0.18-243-review-readiness.json`, `ios-4.0.18-243-modern-submission-receipt.json`, `ios-4.0.18-243-modern-review-state.json` and `ios-244-ci-build-link.json`.
