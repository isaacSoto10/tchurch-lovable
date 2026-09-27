# iOS 4.0.17 (235): service read-after-write consistency

This release targets the existing Tchurch App Store application, ID `6762327867`,
bundle `app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch`. It does not replace,
delete, or modify the separate Swift native work.

## Reproduced defects

- A completed assignment POST followed by a service GET could reuse a GET
  initiated before the write, displaying the old assignment collection.
- A pending song GET could repopulate the device cache after a successful edit
  had cleared it.
- A pre-write request failing offline or with HTTP 5xx could still return its
  captured stale snapshot after another request had committed an edit.
- A delayed service refresh could overwrite a more recent foreground response.
- A rejected service-song tone write left its optimistic tone displayed as if
  saved. The client now rolls back only the still-current rejected edit and
  reloads the service after success. Both clients use `details.serviceKey` in
  the canonical service-item PUT; existing notes are preserved.

Behavioral transport and rendered-page tests reproduced the stale results before
the fixes. Reads now carry a mutation generation, old responses cannot repopulate
the cache after a write, and the service page admits only its latest refresh.
Assignment and song-detail saves reload authoritative service data; a failed
refresh produces a visible warning rather than claiming verified updated state.
Service reads explicitly retain the selected church scope. Settings now displays
the native version and build from Capacitor rather than a hardcoded `1.0.0`.

These reproduce real client defects. They do not, by themselves, establish why
the originally reported phone action differed from a browser observation.
Incident verification must compare the same actor, church, service, and operation.

## Verification

- Full test suite: 86 files, 665 tests passed. After adding both failing-fallback
  cases and tone-save scenarios, the focused transport/privacy/page suite passed
  all 16 tests.
- TypeScript, Vite production build, Capacitor iOS sync, and Xcode simulator build passed.
- Signed iPhone 17 Pro and iPad Pro 13-inch simulator builds authenticated through
  the normal production email-code flow and read GraciaSoberana's September 27
  service: five song items, zero assignments, matching the production database.
- Tablet portrait/landscape, agenda navigation, service deep entry and back to
  the service list were exercised. The bottom navigation remained pinned.
- Simulator mouse-wheel/drag input did not move the WebView scroll position;
  this does not establish a successful scrolled-content scenario.
- No real member assignment or notification was created by these simulator checks.

Use normal simulator signing. `CODE_SIGNING_ALLOWED=NO` prevents the local Studio
LAN Keychain context from initializing, which can stop church hydration before
its network read and misleadingly show an empty church. Rebuilding with normal
simulator signing restored the existing authenticated session and church data.

## Delivery

Both Xcode projects and the package metadata target `4.0.17 (235)`. The binary
must be archived/uploaded with Xcode and verified in the existing public App
Store application. Local build success is not delivery. The obsolete GitHub
release workflow was removed from main on September 17 and is not recreated.

Archive, upload, processing, review, and public availability are pending until
recorded from their respective downstream surfaces.
