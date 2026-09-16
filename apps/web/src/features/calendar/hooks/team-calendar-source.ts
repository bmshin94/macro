import type { CalendarEvent } from '../types';

/** Prefix of every per-teammate calendar visibility-source id. */
const TEAM_CALENDAR_SOURCE_PREFIX = 'team-calendar:';

/** Visibility-source id for one teammate's shared calendar. */
export function teamCalendarSourceId(ownerId: string) {
  return `${TEAM_CALENDAR_SOURCE_PREFIX}${ownerId}`;
}

/** Whether a rendered event came from the teammate calendar overlay. */
export function isTeamCalendarEvent(event: CalendarEvent): boolean {
  return event.sourceCalendarIds.some((id) =>
    id.startsWith(TEAM_CALENDAR_SOURCE_PREFIX)
  );
}

/**
 * Distinct, theme-safe colors for teammates' calendars, picked
 * deterministically from the teammate id so a teammate keeps their color
 * across sessions and pages. Muted chroma keeps them secondary to the
 * viewer's own calendars.
 */
const TEAM_CALENDAR_COLORS = [
  'oklch(0.62 0.13 250)',
  'oklch(0.62 0.13 150)',
  'oklch(0.62 0.13 40)',
  'oklch(0.62 0.13 310)',
  'oklch(0.62 0.13 200)',
  'oklch(0.62 0.13 90)',
  'oklch(0.62 0.13 350)',
  'oklch(0.62 0.13 120)',
] as const;

/** The overlay color for a teammate, stable per teammate id. */
export function teamCalendarColor(ownerId: string): string {
  let hash = 0;
  for (const char of ownerId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return TEAM_CALENDAR_COLORS[hash % TEAM_CALENDAR_COLORS.length];
}
