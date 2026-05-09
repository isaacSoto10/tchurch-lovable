# Tchurch App Parity Audit

This app is a Vite/Capacitor client that consumes the Tchurch website API. The website has moved ahead in several areas, so the app needs to stay aligned with the API contracts and newer UX.

## Implemented in this pass

- API client: automatically resolves a Clerk token when pages call `apiFetch` directly, supports `FormData` uploads, preserves the selected church header, and removes noisy request logs.
- Church context: exposes `switchChurch` for existing settings code and removes noisy debug logs.
- Sidebar: ministry shortcuts now deep-link to the ministry detail page, and pending member count uses the current `/churches/:id/members` API shape.
- Announcements: rebuilt the app page with church-wide vs ministry audience, admin approval review, AI image generation, image preview, EN/ES prompt mode, published/rejected sections, and delete support.
- Events: rebuilt event listing and creation/editing to match the website API, including organizer ministry or leader, location, notes, start/end time, quick templates, type filtering, and improved upcoming/past grouping.
- Event detail: fixes RSVP payloads to use `status`, loads RSVP rows from the API, and shows ministry, leader, location, description, and special notes.
- Ministry resources: enables listing, uploading, opening, downloading, and deleting ministry attachments, with backend email notifications handled by the website API.
- Service assignments: app users can accept or deny assignments from the service detail page, and "My Assignments" now separates pending, accepted, and declined responses.

## Still needs deeper parity work

- Services: the app service planner is still older than the website planning workspace. It needs the full flow builder polish, template application UX, song chart preview, and arrangement picker parity.
- Songs: the app has song and arrangement editing, but the website has a richer bilingual worship workspace with chart preview, snippets, slides, YouTube/CCLI metadata, and default arrangements.
- Ministries: the detail page now has resources, but should still gain the website's richer leader dashboard cards, health overview, and ministry-specific announcement creation with AI directly inside the ministry view.
- Settings/Members: endpoints were corrected for pending member review, but the settings UI still needs the newer website polish and complete admin controls.
- Calendar/Dashboard/Reports/Training/Messages/Prayer: these exist in the app, but they have not yet been deeply compared against the latest website pages in this pass.
