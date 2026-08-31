# iOS 4.0.15 historical release evidence (closed)

Historical candidate: `4.0.15 (226)` — App Store Connect closed this version;
build 226 was not accepted for this train.

The candidate was prepared after build 225, but Apple returned errors 90062 and
90186 because the 4.0.15 version was closed. The release train was moved to
`4.0.16`; build 226 is retained for that new version. Do not present this file
as evidence that 4.0.15 accepts build 226.

## Internal release notes

- Replaces the black Sermons library and detail surfaces with clean white
  backgrounds on iPhone and iPad.
- Keeps Tchurch purple and red accents, with readable dark text and a dark
  canvas only where video playback needs it.
- Covers sermon cards, search, notes, related content, and loading, empty, and
  error states without changing the rest of the application theme.

## Release gates

- `npm run check:ios-release`, the complete test suite, TypeScript, web build,
  Capacitor sync, and the iOS build must pass for this exact candidate.
- Verify Sermons on an authenticated iPhone and iPad, including the library,
  detail, back navigation, bottom tabs, loading/error states, and a scrolled
  state. Record any authentication or simulator automation blocker exactly.
- Archive/upload processing for 4.0.15 was not completed because the version
  was closed. Use [the 4.0.16 candidate](ios-4.0.16-release.md) for the active
  release train.

## Preparation evidence

Validated locally on 2026-07-22 from an isolated release worktree:

- The complete web test suite passed: 81 files and 624 tests.
- TypeScript, Vite build, Capacitor iOS sync, and an Xcode Debug Simulator build
  passed.
- An authenticated iPhone reproduced the former black Sermons background and
  verified the final white library, white detail/error state, retained purple
  actions, readable text, safe areas, and bottom navigation.
- The authenticated simulator could not be transferred to iPad, so iPad content
  validation was blocked by login. WKWebView automation also could not perform
  the final tap/scroll path; route/history tests cover those transitions.

The Release archive, App Store Connect upload, and processing confirmation are
recorded separately when those gates run. The repository workflow currently
requires App Store Connect secrets before it can inspect or promote a build.
