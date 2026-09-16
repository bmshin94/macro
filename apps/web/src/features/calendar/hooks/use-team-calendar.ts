import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { useTeamCalendarQuery } from '@queries/calendar/team';
import type { TeamCalendarMemberItem } from '@service-storage/generated/schemas/teamCalendarMemberItem';
import type { TeamCalendarOccurrenceItem } from '@service-storage/generated/schemas/teamCalendarOccurrenceItem';
import { TeamCalendarSharing } from '@service-storage/generated/schemas/teamCalendarSharing';
import { type Accessor, createMemo } from 'solid-js';
import type { CalendarEvent, CalendarSource } from '../types';
import { isCalendarRangeSupported } from '../utils/calendar-supported-range';
import {
  teamCalendarColor,
  teamCalendarSourceId,
} from './team-calendar-source';
import { useCalendarTeamSharingFlag } from './use-calendar-ui-flag';

const BUSY_TITLE = 'Busy';
const FALLBACK_NAME = 'Teammate';

/** The display name of a teammate, resolved reactively from the shared cache. */
function teammateName(ownerId: string): string {
  return getDisplayName(tryMacroId(ownerId)) || FALLBACK_NAME;
}

/** A teammate's shared calendar as a visibility source for pickers. */
function teamCalendarSource(ownerId: string): CalendarSource {
  return {
    id: teamCalendarSourceId(ownerId),
    name: teammateName(ownerId),
    color: teamCalendarColor(ownerId),
  };
}

/** A teammate as the side panel and settings list them. */
export interface TeamCalendarMember {
  userId: string;
  /** Display name, resolved reactively from the shared cache. */
  name: string;
  sharing: TeamCalendarSharing;
  hasCalendar: boolean;
  /** Whether anything from this teammate can ever appear on the grid. */
  isShareable: boolean;
  source: CalendarSource;
}

export function toTeamCalendarMember(
  member: TeamCalendarMemberItem
): TeamCalendarMember {
  return {
    userId: member.userId,
    name: teammateName(member.userId),
    sharing: member.sharing,
    hasCalendar: member.hasCalendar,
    isShareable:
      member.hasCalendar && member.sharing !== TeamCalendarSharing.none,
    source: teamCalendarSource(member.userId),
  };
}

function mapTeamCalendarItem(item: TeamCalendarOccurrenceItem): CalendarEvent {
  const time = item.time;
  const range =
    time.kind === 'timed'
      ? { allDay: false, start: time.startsAt, end: time.endsAt }
      : { allDay: true, start: time.startDate, end: time.endDate };
  const name = teammateName(item.ownerId);
  const details = item.details;
  const title = details?.title ?? BUSY_TITLE;
  const calendar = teamCalendarSource(item.ownerId);

  return {
    ...range,
    id: JSON.stringify([item.eventId, item.occurrenceKey]),
    eventId: item.eventId,
    occurrenceKey: item.occurrenceKey,
    isCancelled: false,
    isReadOnly: true,
    attendees: details?.attendees ?? [],
    recurrenceLines: [],
    sourceCalendarIds: [calendar.id],
    eventType: item.eventType,
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    title: `${name}: ${title}`,
    calendar,
    visibleCalendars: [calendar],
    location: details?.location ?? undefined,
    description: details?.description ?? undefined,
    conferenceUrl: details?.conferenceUrl ?? undefined,
    organizerName: details?.organizerName ?? undefined,
    organizerEmail: details?.organizerEmail ?? undefined,
  };
}

export interface TeamCalendarEventData {
  /** Every teammate occurrence in the viewport, whether or not shown. */
  events: Accessor<CalendarEvent[]>;
  /** The occurrences whose teammate is shown, empty while the overlay is off. */
  visibleEvents: Accessor<CalendarEvent[]>;
  eventsById: Accessor<Map<string, CalendarEvent>>;
  /** The team roster, empty until the first viewport loads. */
  members: Accessor<TeamCalendarMember[]>;
}

export interface TeamCalendarEventOptions {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  /** Whether the whole overlay is on; nothing is fetched while it is off. */
  showTeamCalendars: Accessor<boolean>;
  /** Per-teammate visibility, keyed by `teamCalendarSourceId`. */
  isSourceVisible: (sourceId: string) => boolean;
  refetchOnWindowFocus?: Accessor<boolean>;
}

/**
 * Query-backed teammate calendar events overlaid on the calendar: one source
 * per teammate, each toggled like a calendar, under one master switch.
 */
export function useTeamCalendarEvents(
  options: TeamCalendarEventOptions
): TeamCalendarEventData {
  const userId = useUserId();
  const teamSharingEnabled = useCalendarTeamSharingFlag();
  const isRangeSupported = createMemo(() => {
    const range = options.range();
    return range !== undefined && isCalendarRangeSupported(range);
  });
  const isOverlayOn = () => teamSharingEnabled() && options.showTeamCalendars();
  const query = useTeamCalendarQuery(
    () => ({ userId: userId(), range: options.range() }),
    () => ({
      enabled: isRangeSupported() && isOverlayOn(),
      refetchOnWindowFocus: options.refetchOnWindowFocus?.(),
    })
  );
  // Read data only on success: a failed overlay fetch degrades to no events
  // since the grid's own state is driven by the occurrences query, and gating
  // on success keeps this off the pending/errored resource read that suspends.
  const response = () =>
    isOverlayOn() && isRangeSupported() && query.isSuccess
      ? query.data
      : undefined;
  const events = createMemo(
    () => response()?.items.map(mapTeamCalendarItem) ?? []
  );
  const members = createMemo(
    () => response()?.members.map(toTeamCalendarMember) ?? []
  );
  const visibleEvents = createMemo(() =>
    isOverlayOn()
      ? events().filter((event) => options.isSourceVisible(event.calendar.id))
      : []
  );
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );

  return { events, visibleEvents, eventsById, members };
}
