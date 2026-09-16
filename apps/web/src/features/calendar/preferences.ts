/**
 * Persisted calendar display preferences, shared by the calendar block (through
 * `CalendarViewContext`) and Settings › Calendar, which renders outside that
 * context. One module-level store so both surfaces read and write the same
 * values and react to each other's changes immediately.
 */

import { isMobile } from '@core/mobile/isMobile';
import { makePersisted } from '@solid-primitives/storage';
import { createStore } from 'solid-js/store';
import type {
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from './types';
import { getDefaultCalendarTimeFormat } from './utils/time-format';

interface CalendarPreferences {
  periodView: CalendarPeriodView;
  /** Calendar sources hidden from the grid; every other source is visible. */
  hiddenSourceIds: string[];
  showWeekends: boolean;
  weekStartsOn: CalendarWeekStart;
  timeFormat: CalendarTimeFormat;
  /**
   * Whether teammates' shared calendars overlay the grid at all. Off by
   * default: like other calendars in Google Calendar, a teammate's calendar
   * is opted into, then individual teammates can be hidden again through
   * `hiddenSourceIds`.
   */
  showTeamCalendars: boolean;
}

/** Storage key for calendar display preferences (also read at copy time by
 * the availability feature, which runs outside the calendar context). */
export const CALENDAR_PREFERENCES_KEY = 'macro:pref:calendar:settings';

const defaultPreferences: CalendarPreferences = {
  periodView: isMobile() ? 'timeGridDay' : 'timeGridWeek',
  hiddenSourceIds: [],
  showWeekends: true,
  weekStartsOn: 0,
  timeFormat: getDefaultCalendarTimeFormat(),
  showTeamCalendars: false,
};

const [preferences, setPreferences] = makePersisted(
  createStore<CalendarPreferences>(defaultPreferences),
  {
    name: CALENDAR_PREFERENCES_KEY,
    // Stored preferences may predate fields added later, so every read is
    // merged over the defaults and a malformed value falls back to them.
    deserialize: (value) => {
      try {
        return {
          ...defaultPreferences,
          ...(JSON.parse(value) as Partial<CalendarPreferences>),
        };
      } catch {
        return defaultPreferences;
      }
    },
  }
);

/** The shared calendar preferences store and its setter. */
export function useCalendarPreferences() {
  const isSourceVisible = (sourceId: string) =>
    !preferences.hiddenSourceIds.includes(sourceId);
  const setSourceVisibility = (sourceId: string, visible: boolean) => {
    setPreferences('hiddenSourceIds', (current) =>
      visible
        ? current.filter((id) => id !== sourceId)
        : current.includes(sourceId)
          ? current
          : [...current, sourceId]
    );
  };

  return {
    preferences,
    setPreferences,
    isSourceVisible,
    setSourceVisibility,
    setPeriodView: (periodView: CalendarPeriodView) =>
      setPreferences('periodView', periodView),
    setShowWeekends: (showWeekends: boolean) =>
      setPreferences('showWeekends', showWeekends),
    setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
      setPreferences('weekStartsOn', weekStartsOn),
    setTimeFormat: (timeFormat: CalendarTimeFormat) =>
      setPreferences('timeFormat', timeFormat),
    setShowTeamCalendars: (showTeamCalendars: boolean) =>
      setPreferences('showTeamCalendars', showTeamCalendars),
  };
}
