import { createAssertedContextProvider } from '@core/context/createContext';
import { batch, createMemo, createSignal } from 'solid-js';
import { isTeamCalendarEvent } from '../hooks/team-calendar-source';
import { useCalendarSources } from '../hooks/use-calendar-sources';
import { useCalendarPreferences } from '../preferences';
import {
  type CalendarEvent,
  type CalendarPeriodView,
  type CalendarTimeFormat,
  type CalendarWeekStart,
  isCalendarEventVisible,
} from '../types';

export { CALENDAR_PREFERENCES_KEY } from '../preferences';

interface CalendarDisplaySettings {
  readonly periodView: CalendarPeriodView;
  readonly showWeekends: boolean;
  readonly weekStartsOn: CalendarWeekStart;
  readonly timeFormat: CalendarTimeFormat;
  /** Whether teammates' shared calendars overlay the grid. */
  readonly showTeamCalendars: boolean;
}

function createCalendarEventSelection() {
  const [event, setEvent] = createSignal<CalendarEvent>();
  const [anchor, setAnchor] = createSignal<HTMLElement>();

  const close = () => {
    batch(() => {
      setEvent(undefined);
      setAnchor(undefined);
    });
  };
  const select = (nextEvent: CalendarEvent, nextAnchor: HTMLElement) => {
    batch(() => {
      setEvent(() => nextEvent);
      setAnchor(nextAnchor);
    });
  };
  const refresh = (nextEvent: CalendarEvent) => {
    if (event()?.id === nextEvent.id) setEvent(nextEvent);
  };

  return { anchor, close, event, refresh, select };
}

export const [CalendarViewContextProvider, useCalendarView] =
  createAssertedContextProvider('CalendarViewContext', () => {
    const { preferences, setPreferences, ...preferenceSetters } =
      useCalendarPreferences();
    const { sources, sourceById } = useCalendarSources();
    // Sources default to visible, so calendars discovered after a
    // preference was saved (or events whose calendar is still loading)
    // never silently disappear.
    const hiddenSourceIds = createMemo(
      () => new Set(preferences.hiddenSourceIds)
    );
    const isSourceVisible = (sourceId: string) =>
      !hiddenSourceIds().has(sourceId);

    const selection = createCalendarEventSelection();
    const displaySettings: CalendarDisplaySettings = {
      get periodView() {
        return preferences.periodView;
      },
      get showWeekends() {
        return preferences.showWeekends;
      },
      get weekStartsOn() {
        return preferences.weekStartsOn;
      },
      get timeFormat() {
        return preferences.timeFormat;
      },
      get showTeamCalendars() {
        return preferences.showTeamCalendars;
      },
    };

    const closeEventDetails = selection.close;

    const setSourceVisibility = (sourceId: string, visible: boolean) => {
      preferenceSetters.setSourceVisibility(sourceId, visible);

      const selected = selection.event();
      if (
        !visible &&
        selected &&
        !isCalendarEventVisible(selected, isSourceVisible)
      ) {
        closeEventDetails();
      }
    };

    return {
      displaySettings,
      sources,
      sourceById,
      isSourceVisible,
      setSourceVisibility,
      selectedEvent: selection.event,
      selectedEventAnchor: selection.anchor,
      setPeriodView: (periodView: CalendarPeriodView) =>
        setPreferences('periodView', periodView),
      setShowWeekends: (showWeekends: boolean) =>
        setPreferences('showWeekends', showWeekends),
      setWeekStartsOn: (weekStartsOn: CalendarWeekStart) =>
        setPreferences('weekStartsOn', weekStartsOn),
      setTimeFormat: (timeFormat: CalendarTimeFormat) =>
        setPreferences('timeFormat', timeFormat),
      setShowTeamCalendars: (showTeamCalendars: boolean) => {
        setPreferences('showTeamCalendars', showTeamCalendars);
        // Hiding the whole overlay hides a selected teammate event too.
        if (!showTeamCalendars) {
          const selected = selection.event();
          if (selected && isTeamCalendarEvent(selected)) closeEventDetails();
        }
      },
      closeEventDetails,
      selectEvent: selection.select,
      refreshSelectedEvent: selection.refresh,
    };
  });
