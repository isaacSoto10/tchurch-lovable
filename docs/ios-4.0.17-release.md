# ChordPro release candidate

Release candidate: `4.0.17 (242)`.

The chart now transposes chord roots and slash basses together, handles Spanish/lowercase/Unicode notes and grouped or labelled progressions, repairs imported text encoding/HTML, and preserves chord/lyric columns. The full chart is available in song/service viewers, PDF export and presentation sheet mode. Presentation arrows work without a live session and after a transport-button click; Up/Down scroll the sheet, while Space retains focused-button activation.

## Verification

- Full Vitest run: 89 files, 686 tests passed before the final small regression additions; the final focused results are recorded in the task report.
- TypeScript app check passed.
- Vite production build and Capacitor sync passed. Generated production assets contain no QA fixture or mocked routes.
- Xcode Debug simulator build passed on the current SDK.
- iPhone 17 Pro iOS 26.5 retained an authenticated session after the updated native install. Native direct entry to `/app/songs` loaded the real library and safe-area bottom navigation. Existing service/detail and Giving tabs were exercised before update.
- Direct entry to the user's current web service presentation failed with `Service not found` in this simulator's selected church. This is an account/church/data blocker to exercising that exact full-song presentation, its scroll-to-end and its keyboard actions against production data. No production data was created or modified for QA.
- iPhone SongDetail: existing `Al Rey` opened, the lyrics editor and read-only `Vista` chart both loaded. The chart visibly preserves aligned chord/lyric columns; bottom navigation remains at the safe-area bottom. Full scroll-to-end and back-button attempts did not produce a verified transition through the current Simulator computer-use input mapping, so those checks remain unverified.
- iPhone alternate existing service: the listed May 24 service with five elements also returned `Servicio no encontrado`. Cached song/service lists remain visible while the shell reports `Configura tu iglesia`. No selected-church or authentication changes were made.
- iPad Pro 11-inch (M5), iOS 26.5: updated app installed and direct songs entry reached the sign-in screen. No retained authenticated session exists, blocking song/presentation, bottom-tab and scroll scenario checks. Portrait and rotated-device evidence were captured; the rotated capture retained portrait-oriented sign-in content.
- Evidence: `/tmp/tchurch-chordpro-ios-evidence/iphone-song-chart.png`, `iphone-existing-service-not-found.png`, `iphone-presentation-service-not-found.png`, `ipad-sign-in-required-landscape.png`.

## Release status

Read-only App Store Connect verification found latest valid build `4.0.17 (241)` (uploaded September 27, 2026). Candidate 242 follows that live build; repository build 235 was stale. Upload and downstream processing remain separate release gates.


## Archive and delivery

The signed Xcode Release archive succeeded: `/tmp/tchurch-ios-release/Tchurch-4.0.17-242.xcarchive`.

The normal Xcode account-based upload failed with `exportArchive App Store Connect Credentials Error`. The available individual API key successfully reads App Store Connect over REST, but installed Xcode requires the key path, key ID and issuer ID for API-key export authentication. No issuer is configured. A read-only `altool --list-providers` attempt with the individual key and subject `user` failed because it requires issuer/key or username/app-password/provider credentials.

Build 242 is archived locally and has not been verified in App Store Connect. The latest observed App Store Connect build remains 241. Upload is blocked on resolving the Xcode App Store Connect account/provider or supplying the complete team API-key issuer through the existing secure configuration.

## Atomic wrapping follow-up

A dense chart could place the old arbitrary wrap boundary inside `Em/C` and `Dios`. Presentation and compact/full-height preview now search the whole earlier range for a shared safe boundary, then search forward if a word/chord overlap is indivisible. Oversized native rows remain reachable with horizontal scrolling. No padding is inserted into the stored words.

Both single-song and service PDF exports use the same paired rows. Exceptionally wide indivisible pairs scale both Courier chord and lyric fonts together to fit the page.

Final validation: 90 Vitest files / 690 tests passed, including exact chord and lyric token preservation across widths 8–64, dense phone/tablet presentation and compact/full-height previews. TypeScript passed. Actual production PDF functions generated both synthetic exports, and Poppler renders were visually reviewed. PDF text geometry confirms intact `Em/C` aligns with `Dios,` at the same x coordinate and all text remains within the page, including an indivisible 126-character word. Evidence: `/tmp/tchurch-chordpro-ios-evidence/paired-wrapping-qa.pdf`, `paired-wrapping-qa.png`, `paired-service-qa-acordes.pdf`, `paired-service-qa.png`.

The 242 Release archive was regenerated after this follow-up. The earlier archive is retained as `Tchurch-4.0.17-242-before-wrap.xcarchive`. The established App Store Connect upload credential blocker remains unchanged; no additional upload attempt was made.

## Superseded release train

After the user signed in to Xcode, the normal Organizer upload authenticated successfully. Apple then rejected candidate 242 because 4.0.17 is already approved (90062) and its train is closed (90186). Candidate 242 was never successfully uploaded. Its verified code is carried forward as `4.0.18 (243)`; see `docs/ios-4.0.18-release.md`. The earlier CLI provider error and archive remain historical evidence, not the current release target.
