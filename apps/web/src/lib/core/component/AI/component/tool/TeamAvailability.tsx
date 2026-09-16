import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import CalendarCheck from '@phosphor-icons/core/regular/calendar-check.svg';
import Clock from '@phosphor-icons/core/regular/clock.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { format, isSameDay } from 'date-fns';
import { For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type GetTeamAvailabilityResponse = NamedTool<
  'GetTeamAvailability',
  'response'
>['data'];

type MemberAvailability = GetTeamAvailabilityResponse['members'][number];
type FreeWindow = GetTeamAvailabilityResponse['freeWindows'][number];

const FREE_WINDOWS_SHOWN_MAX = 8;

const formatWindow = (start: string, end: string): string => {
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (isSameDay(startsAt, endsAt)) {
    return `${format(startsAt, 'EEE MMM d, h:mm a')} – ${format(endsAt, 'h:mm a')}`;
  }
  return `${format(startsAt, 'EEE MMM d, h:mm a')} – ${format(endsAt, 'EEE MMM d, h:mm a')}`;
};

const memberStatus = (member: MemberAvailability): string => {
  if (member.sharing === 'none') return 'Not shared';
  if (!member.hasCalendar) return 'No calendar';
  const count = member.busy.length;
  if (count === 0) return 'Free';
  const label = count === 1 ? '1 busy block' : `${count} busy blocks`;
  return member.busyTruncated ? `${label}+` : label;
};

function MemberRow(props: { member: MemberAvailability }) {
  const name = () =>
    getDisplayName(tryMacroId(props.member.userId)) || props.member.userId;

  return (
    <Tool.ListItem
      icon={<UserIcon id={props.member.userId} isDeleted={false} size="sm" />}
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span class="truncate text-xs text-ink">{name()}</span>
        <span class="shrink-0 text-xs text-ink-extra-muted">
          {memberStatus(props.member)}
        </span>
      </div>
    </Tool.ListItem>
  );
}

function FreeWindowRow(props: { window: FreeWindow }) {
  return (
    <Tool.ListItem icon={<Clock class="size-4" />}>
      <span class="truncate text-xs text-ink">
        {formatWindow(props.window.start, props.window.end)}
      </span>
    </Tool.ListItem>
  );
}

function TeamAvailabilityResponse(props: {
  response: GetTeamAvailabilityResponse;
}) {
  const shown = () =>
    props.response.freeWindows.slice(0, FREE_WINDOWS_SHOWN_MAX);
  const hidden = () => props.response.freeWindows.length - shown().length;

  return (
    <Tool.List>
      <For each={props.response.members}>
        {(member) => <MemberRow member={member} />}
      </For>
      <Show when={props.response.members.length === 0}>
        <Tool.ListItem>No teammates to check.</Tool.ListItem>
      </Show>
      <Show when={shown().length > 0}>
        <Tool.ListItem>
          <span class="text-xs text-ink-extra-muted">Everyone is free</span>
        </Tool.ListItem>
        <For each={shown()}>
          {(window) => <FreeWindowRow window={window} />}
        </For>
        <Show when={hidden() > 0}>
          <Tool.ListItem>
            <span class="text-xs text-ink-extra-muted">
              +{hidden()} more free {hidden() === 1 ? 'window' : 'windows'}
            </span>
          </Tool.ListItem>
        </Show>
      </Show>
    </Tool.List>
  );
}

export const getTeamAvailabilityHandler = createToolRenderer({
  name: 'GetTeamAvailability',
  render: (ctx) => {
    const response = () => ctx.response?.data;
    const statusText = () => {
      const data = response();
      if (!data) return undefined;
      const counted = data.members.filter(
        (member) => member.sharing !== 'none' && member.hasCalendar
      ).length;
      const windows = data.freeWindows.length;
      const windowLabel =
        windows === 1 ? '1 free window' : `${windows} free windows`;
      const memberLabel = counted === 1 ? '1 teammate' : `${counted} teammates`;
      return counted === 0 ? memberLabel : `${memberLabel}, ${windowLabel}`;
    };

    return (
      <BaseTool
        icon={CalendarCheck}
        renderContext={ctx.renderContext}
        type="call"
        response={
          response() ? (
            <TeamAvailabilityResponse response={response()!} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">Check team availability</span>
          <Show when={statusText()}>
            {(text) => (
              <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
                {text()}
              </span>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});
