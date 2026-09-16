import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../types';
import {
  isTeamCalendarEvent,
  teamCalendarColor,
  teamCalendarSourceId,
} from './team-calendar-source';

const event = (sourceCalendarIds: string[]): CalendarEvent =>
  ({ sourceCalendarIds }) as unknown as CalendarEvent;

describe('team calendar sources', () => {
  it('derives one stable source id per teammate', () => {
    expect(teamCalendarSourceId('macro|alex@example.com')).toBe(
      'team-calendar:macro|alex@example.com'
    );
    expect(teamCalendarSourceId('a')).not.toBe(teamCalendarSourceId('b'));
  });

  it('recognizes overlay events by their source id', () => {
    expect(
      isTeamCalendarEvent(
        event([teamCalendarSourceId('macro|alex@example.com')])
      )
    ).toBe(true);
    expect(isTeamCalendarEvent(event(['team-ooo']))).toBe(false);
    expect(isTeamCalendarEvent(event([]))).toBe(false);
  });

  it('keeps a teammate on the same color across calls', () => {
    const first = teamCalendarColor('macro|alex@example.com');
    expect(teamCalendarColor('macro|alex@example.com')).toBe(first);
    expect(first).toMatch(/^oklch\(/);
  });
});
