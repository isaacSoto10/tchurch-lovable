

# Build Ministries, Events & Teams Pages

All three routes currently point to a generic `Placeholder.tsx`. Since your API at tchurchapp.com already has endpoints for these, we'll create real pages that fetch and display data, matching the style of the existing Songs/Services/Announcements pages.

## Pages to Create

### 1. Ministries (`src/pages/app/Ministries.tsx`)
- Fetch from `/ministries`
- Card-based list showing ministry name and description
- "New Ministry" button (placeholder action for now)
- Search/filter by name

### 2. Events (`src/pages/app/Events.tsx`)
- Fetch from `/events`
- Card list with event name, date, time, and location
- Date formatting matching the Services page style
- "New Event" button

### 3. Teams (`src/pages/app/Teams.tsx`)
- Fetch from `/teams`
- Card list with team name, description, and member count if available
- "New Team" button

## Shared Approach
- Use `useApi()` hook + `fetchApi()` like all existing pages
- Same loading spinner pattern
- Same card layout with hover effects
- Register new components in `App.tsx` routes (replacing `Placeholder` imports)

## Files Changed
- **Create**: `src/pages/app/Ministries.tsx`, `src/pages/app/Events.tsx`, `src/pages/app/Teams.tsx`
- **Edit**: `src/App.tsx` — import and wire up the three new page components

