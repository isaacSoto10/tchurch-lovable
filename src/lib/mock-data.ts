// Mock data for local/development use without a backend

export const MOCK_CHURCH = {
  id: "church-1",
  name: "Iglesia Cristiana Esperanza",
  slug: "esperanza",
  role: "ADMIN",
  brandColor: "#6366f1",
  logoUrl: null,
  plan: "allin",
  memberLimit: 999,
  trialEndsAt: null,
  subscriptionStatus: "active",
};

export const MOCK_USER = {
  id: "user-1",
  clerkId: "mock-clerk-id",
  name: "Isaac Soto",
  email: "isaac@tchurchapp.com",
  role: "ADMIN",
};

export const MOCK_CHURCHES = [MOCK_CHURCH];

export const MOCK_MINISTRIES = [
  { id: "min-1", name: "Alabanza", nameEs: "Alabanza", description: "Ministerio de Alabanza y Adoración", color: "#6366f1", churchId: "church-1", _count: { members: 8 } },
  { id: "min-2", name: "Youth", nameEs: "Jóvenes", description: "Ministerio de Jóvenes", color: "#f59e0b", churchId: "church-1", _count: { members: 12 } },
  { id: "min-3", name: "Media", nameEs: "Medios", description: "Ministerio de Medios y Tecnología", color: "#10b981", churchId: "church-1", _count: { members: 5 } },
  { id: "min-4", name: "Kids", nameEs: "Niños", description: "Ministerio de Niños", color: "#ec4899", churchId: "church-1", _count: { members: 6 } },
  { id: "min-5", name: "Ushers", nameEs: "Ujieres", description: "Ministerio de Ujieres", color: "#8b5cf6", churchId: "church-1", _count: { members: 10 } },
];

export const MOCK_MEMBERS = [
  { id: "mem-1", name: "Isaac Soto", email: "isaac@tchurchapp.com", role: "ADMIN", status: "APPROVED" },
  { id: "mem-2", name: "María García", email: "maria@example.com", role: "LEADER", status: "APPROVED" },
  { id: "mem-3", name: "Carlos López", email: "carlos@example.com", role: "MEMBER", status: "APPROVED" },
  { id: "mem-4", name: "Ana Martínez", email: "ana@example.com", role: "MEMBER", status: "APPROVED" },
  { id: "mem-5", name: "José Rodríguez", email: "jose@example.com", role: "MUSICIAN", status: "APPROVED" },
  { id: "mem-6", name: "Laura Hernández", email: "laura@example.com", role: "MEMBER", status: "PENDING" },
];

export const MOCK_SONGS = [
  { id: "song-1", title: "Amazing Grace", author: "John Newton", key: "G", tempo: 72, meter: "3/4", category: "Hymn" },
  { id: "song-2", title: "How Great Thou Art", author: "Stuart Hine", key: "C", tempo: 66, meter: "4/4", category: "Hymn" },
  { id: "song-3", title: "10,000 Reasons", author: "Matt Redman", key: "D", tempo: 80, meter: "4/4", category: "Worship" },
  { id: "song-4", title: "What a Beautiful Name", author: "Hillsong Worship", key: "D", tempo: 68, meter: "4/4", category: "Worship" },
  { id: "song-5", title: "Buenos Días", author: "Marcos Witt", key: "E", tempo: 100, meter: "4/4", category: "Alabanza" },
  { id: "song-6", title: "Eres Todopoderoso", author: "Danilo Montero", key: "A", tempo: 88, meter: "4/4", category: "Alabanza" },
  { id: "song-7", title: "Gracia Sublime Es", author: "John Newton (Esp)", key: "G", tempo: 72, meter: "3/4", category: "Himno" },
  { id: "song-8", title: "Cuán Grande Es Él", author: "Stuart Hine (Esp)", key: "C", tempo: 66, meter: "4/4", category: "Himno" },
];

export const MOCK_SERVICES = [
  {
    id: "svc-1",
    title: "Culto Dominical - Mañana",
    date: new Date(Date.now() + 2 * 86400000).toISOString(),
    type: "DOMINICAL",
    status: "confirmed",
    churchId: "church-1",
    preachingUserId: null,
    worshipLeaderId: null,
    items: [
      { id: "si-1", serviceId: "svc-1", title: "Buenos Días", type: "SONG", position: 1, song: { id: "song-5", title: "Buenos Días", author: "Marcos Witt", key: "E" } },
      { id: "si-2", serviceId: "svc-1", title: "Eres Todopoderoso", type: "SONG", position: 2, song: { id: "song-6", title: "Eres Todopoderoso", author: "Danilo Montero", key: "A" } },
      { id: "si-3", serviceId: "svc-1", title: "Ofrenda", type: "ANNOUNCEMENT", position: 3, song: null },
      { id: "si-4", serviceId: "svc-1", title: "Gracia Sublime Es", type: "SONG", position: 4, song: { id: "song-7", title: "Gracia Sublime Es", author: "John Newton (Esp)", key: "G" } },
      { id: "si-5", serviceId: "svc-1", title: "Sermon: La Fe en Tiempos Difíciles", type: "SERMON", position: 5, song: null },
    ],
    assignments: [
      { id: "sa-1", serviceId: "svc-1", userId: "mem-1", role: "PREACHER", user: { id: "mem-1", name: "Isaac Soto" } },
      { id: "sa-2", serviceId: "svc-1", userId: "mem-2", role: "WORSHIP_LEADER", user: { id: "mem-2", name: "María García" } },
    ],
  },
  {
    id: "svc-2",
    title: "Culto Dominical - Noche",
    date: new Date(Date.now() + 2 * 86400000 + 10 * 3600000).toISOString(),
    type: "DOMINICAL",
    status: "draft",
    churchId: "church-1",
    preachingUserId: null,
    worshipLeaderId: null,
    items: [
      { id: "si-6", serviceId: "svc-2", title: "Cuán Grande Es Él", type: "SONG", position: 1, song: { id: "song-8", title: "Cuán Grande Es Él", author: "Stuart Hine (Esp)", key: "C" } },
      { id: "si-7", serviceId: "svc-2", title: "Amazing Grace", type: "SONG", position: 2, song: { id: "song-1", title: "Amazing Grace", author: "John Newton", key: "G" } },
    ],
    assignments: [],
  },
  {
    id: "svc-3",
    title: "Ensayo de Alabanza",
    date: new Date(Date.now() + 5 * 86400000).toISOString(),
    type: "ENSAYO",
    status: "confirmed",
    churchId: "church-1",
    preachingUserId: null,
    worshipLeaderId: null,
    items: [
      { id: "si-8", serviceId: "svc-3", title: "10,000 Reasons", type: "SONG", position: 1, song: { id: "song-3", title: "10,000 Reasons", author: "Matt Redman", key: "D" } },
      { id: "si-9", serviceId: "svc-3", title: "What a Beautiful Name", type: "SONG", position: 2, song: { id: "song-4", title: "What a Beautiful Name", author: "Hillsong Worship", key: "D" } },
    ],
    assignments: [
      { id: "sa-3", serviceId: "svc-3", userId: "mem-2", role: "WORSHIP_LEADER", user: { id: "mem-2", name: "María García" } },
    ],
  },
];

export const MOCK_EVENTS = [
  {
    id: "evt-1",
    title: "Retiro de Jóvenes 2026",
    description: "Retiro anual de jóvenes con actividades, talleres y tiempos de reflexión.",
    date: new Date(Date.now() + 14 * 86400000).toISOString(),
    endDate: new Date(Date.now() + 16 * 86400000).toISOString(),
    location: "Campamento Monte Sinaí",
    type: "RETREAT",
    churchId: "church-1",
    ministryId: "min-2",
    leaderId: "mem-2",
  },
  {
    id: "evt-2",
    title: "Concierto de Alabanza",
    description: "Noche de alabanza y adoración con la participación de todos los ministerios.",
    date: new Date(Date.now() + 7 * 86400000).toISOString(),
    endDate: null,
    location: "Templo Principal",
    type: "CONCERT",
    churchId: "church-1",
    ministryId: "min-1",
    leaderId: "mem-1",
  },
  {
    id: "evt-3",
    title: "Escuela Bíblica Vacacional",
    description: "EBV para niños de 4-12 años.",
    date: new Date(Date.now() + 21 * 86400000).toISOString(),
    endDate: new Date(Date.now() + 25 * 86400000).toISOString(),
    location: "Salón de Niños",
    type: "CONFERENCE",
    churchId: "church-1",
    ministryId: "min-4",
    leaderId: null,
  },
];

export const MOCK_ANNOUNCEMENTS = [
  { id: "ann-1", title: "Bienvenidos a Tchurch", content: "Estamos emocionados de usar esta nueva plataforma para gestionar nuestra iglesia.", imageUrl: null, createdAt: new Date().toISOString(), churchId: "church-1" },
  { id: "ann-2", title: "Horario de Servicios", content: "Culto dominical a las 10:00 AM y 6:00 PM. Oración miércoles a las 7:00 PM.", imageUrl: null, createdAt: new Date(Date.now() - 86400000).toISOString(), churchId: "church-1" },
  { id: "ann-3", title: "Reunión de Líderes", content: "Este sábado a las 9:00 AM. Todos los líderes de ministerio deben asistir.", imageUrl: null, createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), churchId: "church-1" },
];

export const MOCK_STATS = {
  ministries: 5,
  events: 3,
  songs: 8,
  services: 3,
  teams: 4,
  members: 6,
  announcements: 3,
};

export const MOCK_BLOCKOUT_DATES = [
  { id: "blk-1", userId: "mem-1", startDate: new Date(Date.now() + 3 * 86400000).toISOString(), endDate: new Date(Date.now() + 5 * 86400000).toISOString(), reason: "Viaje familiar" },
];

export const MOCK_TEAMS = [
  { id: "team-1", name: "Equipo de Sonido", description: "Encargados del sonido y proyección", ministryId: "min-3", _count: { members: 4 } },
  { id: "team-2", name: "Equipo de Alabanza A", description: "Equipo principal de alabanza", ministryId: "min-1", _count: { members: 6 } },
  { id: "team-3", name: "Equipo de Alabanza B", description: "Equipo alternativo", ministryId: "min-1", _count: { members: 5 } },
  { id: "team-4", name: "Equipo de Ujieres", description: "Recepción y orden", ministryId: "min-5", _count: { members: 8 } },
];
