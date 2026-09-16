import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import type { TeamCalendarSharing } from '@service-email/generated/schemas/teamCalendarSharing';
import type { TeamCalendarSharingBody } from '@service-email/generated/schemas/teamCalendarSharingBody';
import { storageServiceClient } from '@service-storage/client';
import type { TeamCalendarResponse } from '@service-storage/generated/schemas/teamCalendarResponse';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { type CalendarOccurrenceQueryRange, calendarKeys } from './keys';
import { createCalendarOccurrenceQueryRange } from './occurrences';

const TEAM_CALENDAR_PAGE_SIZE = 2000;
const TEAM_CALENDAR_STALE_TIME = 60_000;
const TEAM_SHARING_STALE_TIME = 5 * 60_000;

export interface TeamCalendarQueryInput {
  userId: string | undefined;
  range: CalendarOccurrenceQueryRange | undefined;
}

export interface TeamCalendarQueryOptions {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
}

/** Fetches teammates' shared occurrences, and the team roster, for a viewport. */
export async function fetchTeamCalendar(
  range: CalendarOccurrenceQueryRange,
  signal?: AbortSignal
): Promise<TeamCalendarResponse> {
  return throwOnErr(() =>
    storageServiceClient.listTeamCalendar({
      ...range,
      limit: TEAM_CALENDAR_PAGE_SIZE,
      signal,
    })
  );
}

/**
 * Teammates' shared calendar occurrences in one viewport, with each
 * teammate's sharing policy already applied by the backend.
 */
export function useTeamCalendarQuery(
  input: Accessor<TeamCalendarQueryInput>,
  options?: Accessor<TeamCalendarQueryOptions>
) {
  return useQuery(() => {
    const { userId, range } = input();

    return {
      queryKey: calendarKeys.teamCalendar(userId ?? '', range).queryKey,
      queryFn: ({ signal }: { signal?: AbortSignal }) => {
        if (!range) {
          throw new Error('Team calendar range is unavailable');
        }

        return fetchTeamCalendar(range, signal);
      },
      enabled:
        Boolean(userId) && range !== undefined && options?.().enabled !== false,
      staleTime: TEAM_CALENDAR_STALE_TIME,
      placeholderData: (p: TeamCalendarResponse | undefined) => p,
      refetchOnWindowFocus: options?.().refetchOnWindowFocus ?? true,
    };
  });
}

/**
 * The team roster with each teammate's sharing policy and whether they have a
 * calendar connected, for surfaces that list teammates without a viewport
 * (Settings › Calendar, the side panel). Reads the smallest possible viewport
 * of the team endpoint, which carries the roster regardless of occurrences.
 */
export function useTeamCalendarMembersQuery(enabled?: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: calendarKeys.teamCalendarMembers.queryKey,
    queryFn: async ({ signal }) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const response = await throwOnErr(() =>
        storageServiceClient.listTeamCalendar({
          ...createCalendarOccurrenceQueryRange(start, end),
          limit: 1,
          signal,
        })
      );
      return response.members;
    },
    staleTime: TEAM_CALENDAR_STALE_TIME,
    enabled: enabled?.() ?? true,
  }));
}

export function invalidateTeamCalendar() {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: calendarKeys.teamCalendar._def,
    }),
    queryClient.invalidateQueries({
      queryKey: calendarKeys.teamCalendarMembers.queryKey,
    }),
  ]);
}

/** How much of the viewer's own calendar their teammates may see. */
export function useTeamCalendarSharingQuery(enabled?: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: calendarKeys.teamSharing.queryKey,
    queryFn: async () =>
      (await throwOnErr(() => emailClient.getTeamCalendarSharing())).sharing,
    staleTime: TEAM_SHARING_STALE_TIME,
    enabled: enabled?.() ?? true,
  }));
}

interface SharingMutationContext {
  previous: TeamCalendarSharing | undefined;
}

/**
 * Sets the viewer's team sharing policy, applying it to the cached value
 * immediately and rolling back if the server rejects it.
 */
export function useSetTeamCalendarSharingMutation(
  callbacks?: MutationCallbacks<
    TeamCalendarSharingBody,
    Error,
    TeamCalendarSharing,
    SharingMutationContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (sharing: TeamCalendarSharing) =>
      throwOnErr(() => emailClient.setTeamCalendarSharing({ sharing })),
    ...withCallbacks<
      TeamCalendarSharingBody,
      Error,
      TeamCalendarSharing,
      SharingMutationContext
    >(
      {
        onMutate: async (sharing) => {
          await queryClient.cancelQueries({
            queryKey: calendarKeys.teamSharing.queryKey,
          });
          const previous = queryClient.getQueryData<TeamCalendarSharing>(
            calendarKeys.teamSharing.queryKey
          );
          queryClient.setQueryData(calendarKeys.teamSharing.queryKey, sharing);
          return { previous };
        },
        onSuccess: (body) => {
          queryClient.setQueryData(
            calendarKeys.teamSharing.queryKey,
            body.sharing
          );
        },
        onError: (_error, _sharing, context) => {
          if (context?.previous === undefined) {
            void queryClient.invalidateQueries({
              queryKey: calendarKeys.teamSharing.queryKey,
            });
            return;
          }
          queryClient.setQueryData(
            calendarKeys.teamSharing.queryKey,
            context.previous
          );
        },
      },
      callbacks
    ),
  }));
}
