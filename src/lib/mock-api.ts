import {
  MOCK_CHURCHES, MOCK_CHURCH, MOCK_STATS, MOCK_SERVICES,
  MOCK_EVENTS, MOCK_SONGS, MOCK_MINISTRIES, MOCK_MEMBERS,
  MOCK_ANNOUNCEMENTS, MOCK_TEAMS, MOCK_BLOCKOUT_DATES
} from "./mock-data";

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// Simulate API responses based on path
export async function mockFetch<T = any>(path: string, _options?: RequestInit, _token?: string | null): Promise<T> {
  await delay(100); // small delay to feel realistic

  // Dashboard stats
  if (path === "/dashboard/stats") return MOCK_STATS as T;

  // Churches
  if (path === "/churches/mine") return { churches: MOCK_CHURCHES } as T;
  if (path.startsWith("/churches/") && !path.includes("/members")) return MOCK_CHURCH as T;

  // Services
  if (path === "/services") return MOCK_SERVICES as T;
  const svcMatch = path.match(/^\/services\/([^/]+)$/);
  if (svcMatch) {
    const svc = MOCK_SERVICES.find(s => s.id === svcMatch[1]);
    return (svc || null) as T;
  }

  // Events
  if (path === "/events") return MOCK_EVENTS as T;
  const evtMatch = path.match(/^\/events\/([^/]+)$/);
  if (evtMatch) {
    const evt = MOCK_EVENTS.find(e => e.id === evtMatch[1]);
    return (evt || null) as T;
  }

  // Songs
  if (path === "/songs") return MOCK_SONGS as T;
  const songMatch = path.match(/^\/songs\/([^/]+)$/);
  if (songMatch) {
    const song = MOCK_SONGS.find(s => s.id === songMatch[1]);
    return (song || null) as T;
  }
  // Song arrangements (mock empty)
  if (path.match(/^\/songs\/([^/]+)\/arrangements$/)) return [] as T;

  // Ministries
  if (path === "/ministries") return MOCK_MINISTRIES as T;
  const minMatch = path.match(/^\/ministries\/([^/]+)$/);
  if (minMatch) {
    const min = MOCK_MINISTRIES.find(m => m.id === minMatch[1]);
    return (min || null) as T;
  }
  // Ministry members
  if (path.match(/^\/ministries\/([^/]+)\/members$/)) return MOCK_MEMBERS as T;

  // Announcements
  if (path === "/announcements") return MOCK_ANNOUNCEMENTS as T;

  // Teams
  if (path === "/teams") return MOCK_TEAMS as T;

  // Blockout dates
  if (path === "/blockout-dates") return MOCK_BLOCKOUT_DATES as T;

  // Users / members
  if (path === "/users" || path === "/churches/current/members") return MOCK_MEMBERS as T;

  // Default
  console.warn("[mockApi] Unhandled path:", path);
  return [] as T;
}
