# iOS Services refresh release notes

## Internal release notes

- Refines the Services library with a compact planning header, date markers, clearer search/filter controls, a loading skeleton, and explicit 44px actions.
- Adds interruptible disclosure motion for service previews and song actions, with a reduced-motion fallback.
- Refines ServiceDetail context, tabs, loading state, item feedback, and empty-note handling without changing API contracts.
- Removes the iOS GitHub Actions workflows. Release automation is handled through direct Xcode archive/export and App Store Connect processing.

## QA evidence

- Temporary browser fixture outside the repository mounted the real `Services.tsx` and `ServiceDetail.tsx` with local mock providers and API responses.
- Phone and tablet layouts were checked for search/clear, disclosure expansion, detail navigation, tabs, song disclosure, loading skeleton, not-found state, and a scrolled detail list.
- Native Simulator launch and deep-link entry were checked on iPhone 17 Pro and iPad Pro 13-inch M5. Authenticated service traversal remains blocked by the absence of a simulator session.

## Release candidate

- The local baseline archive/export was prepared as `4.0.16 (227)` at `/tmp/tchurch-ios-services-20260917/release`.
- The next App Store version and build number must be confirmed in App Store Connect before changing project metadata. Do not assume `4.0.17 (228)` is available until Apple confirms it.
