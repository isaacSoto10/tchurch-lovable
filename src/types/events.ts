export type KnownEventType = "service" | "bible_study" | "fellowship" | "youth" | "children" | "special_event";
export type EventType = KnownEventType | (string & {});

export type EventRsvpStatus = "yes" | "no" | "maybe";

export interface EventUser {
  id?: string;
  clerkId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export interface EventAttendee {
  id: string;
  userId?: string | null;
  status: EventRsvpStatus;
  checkedInAt?: string | null;
  user?: EventUser | null;
}

export interface EventRsvpSummary {
  yes: number;
  no: number;
  maybe: number;
}

export interface EventCheckInSummary {
  checkedIn: number;
  total: number;
  pending?: number;
}

export type EventSignupItemType = "food" | "participation" | (string & {});

export interface EventSignupItem {
  id: string;
  eventId?: string;
  type?: EventSignupItemType | null;
  title?: string | null;
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  quantityNeeded?: number | null;
  needed?: number | null;
  claimed?: number | null;
  claimedQuantity?: number | null;
  filled?: number | null;
  remaining?: number | null;
  mySignup?: boolean | null;
  signedUp?: boolean | null;
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  user?: EventUser | null;
  metadata?: Record<string, unknown> | null;
  claims?: Array<{
    id?: string | null;
    registrationId?: string | null;
    userId?: string | null;
    guestName?: string | null;
    quantity?: number | null;
    notes?: string | null;
    contactName?: string | null;
  }> | null;
}

export interface EventSignupItemPayload {
  type: EventSignupItemType;
  title: string;
  description?: string | null;
  quantityNeeded: number;
}

export type EventSignupItemUpdatePayload = Partial<EventSignupItemPayload>;

export interface EventQuestion {
  id: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox";
  required?: boolean;
  options?: string[];
}

export interface EventRegistrationConfig {
  questions: EventQuestion[];
  food?: {
    enabled?: boolean;
    label?: string;
  };
  participation?: {
    enabled?: boolean;
    label?: string;
  };
}

export interface EventReminderConfig {
  enabled: boolean;
  offsets: number[];
  channels: Array<"in_app" | "push" | "whatsapp" | "email">;
}

export interface ChurchEvent {
  id: string;
  title: string;
  description?: string | null;
  date: string;
  endDate?: string | null;
  type?: EventType | null;
  location?: string | null;
  notes?: string | null;
  ministryId?: string | null;
  leaderId?: string | null;
  ministryName?: string | null;
  ministryColor?: string | null;
  leaderFirstName?: string | null;
  leaderLastName?: string | null;
  leaderEmail?: string | null;
  visibility?: "private" | "public" | string | null;
  publicSlug?: string | null;
  publishedAt?: string | null;
  registrationEnabled?: boolean;
  allowGuests?: boolean;
  requiresCheckIn?: boolean;
  capacity?: number | null;
  registrationConfig?: EventRegistrationConfig | null;
  reminderConfig?: EventReminderConfig | null;
  attendees?: EventAttendee[];
  rsvpSummary?: EventRsvpSummary;
  checkInSummary?: EventCheckInSummary;
  signupItems?: EventSignupItem[];
  createdAt?: string;
  updatedAt?: string;
}

export type EventResponse = ChurchEvent & {
  error?: string;
};

export interface EventRsvpResponse {
  id?: string;
  eventId?: string;
  userId?: string;
  status?: EventRsvpStatus | null;
  rsvp?: EventAttendee | null;
  summary?: EventRsvpSummary;
}

export interface EventQrResponse {
  id?: string;
  eventId?: string;
  userId?: string;
  token?: string;
  qrToken?: string;
  qrValue?: string;
  qrSvg?: string;
  qrPng?: string;
  code?: string;
  qrPayload?: string;
  payload?: string;
  value?: string;
  url?: string;
  qrUrl?: string;
  imageUrl?: string;
  dataUrl?: string;
  expiresAt?: string | null;
  checkedInAt?: string | null;
  rsvpStatus?: EventRsvpStatus | null;
  [key: string]: unknown;
}

export interface EventCheckInPayload {
  qrCode?: string;
  qrValue?: string;
  token?: string;
  code?: string;
  scannedValue?: string;
  scannedAt?: string;
  source?: "camera" | "manual" | "offline";
  offlineClientId?: string;
}

export interface EventManualCheckInPayload {
  registrationId?: string;
  userId?: string;
  email?: string;
  name?: string;
  notes?: string;
  checkedInAt?: string;
  offlineClientId?: string;
}

export interface EventCheckInResponse {
  success?: boolean;
  queued?: boolean;
  duplicate?: boolean;
  message?: string;
  checkIn?: {
    id?: string;
    eventId?: string;
    userId?: string;
    checkedInAt?: string;
    [key: string]: unknown;
  };
  attendee?: EventAttendee | null;
  rsvp?: EventAttendee | null;
  [key: string]: unknown;
}

export interface QueuedEventCheckIn {
  id: string;
  eventId: string;
  endpoint: "scan" | "manual";
  payload: EventCheckInPayload | EventManualCheckInPayload;
  createdAt: string;
  attempts: number;
  lastError?: string | null;
}

export const EVENT_TYPE_LABELS: Record<KnownEventType, string> = {
  service: "Service",
  bible_study: "Bible Study",
  fellowship: "Fellowship",
  youth: "Youth",
  children: "Children",
  special_event: "Special Event",
};

export const EVENT_TYPE_OPTIONS: Array<{ value: KnownEventType; title: string; description: string }> = [
  { value: "service", title: "Special Service", description: "A service for worship, prayer, and church-wide connection." },
  { value: "bible_study", title: "Bible Study", description: "A focused time to study Scripture and grow together." },
  { value: "fellowship", title: "Fellowship Gathering", description: "A warm gathering for food, connection, and community." },
  { value: "youth", title: "Youth Night", description: "A night for students to worship and build friendships." },
  { value: "children", title: "Children's Event", description: "A safe and joyful event for children and families." },
  { value: "special_event", title: "Special Event", description: "A church event with clear details for everyone attending." },
];

export function getEventTypeLabel(type?: EventType | null) {
  return type && EVENT_TYPE_LABELS[type as KnownEventType] ? EVENT_TYPE_LABELS[type as KnownEventType] : type || "Event";
}
