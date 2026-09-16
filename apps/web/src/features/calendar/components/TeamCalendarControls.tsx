import { UserIcon } from '@core/component/UserIcon';
import { TeamCalendarSharing } from '@service-storage/generated/schemas/teamCalendarSharing';
import { Checkbox, cn } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { TeamCalendarMember } from '../hooks/use-team-calendar';

interface TeamCalendarControlsProps {
  members: TeamCalendarMember[];
  /** Whether the overlay is on; teammates read as inert while it is off. */
  enabled: boolean;
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
}

/** Why a teammate's calendar cannot be shown, when it cannot. */
export function teamCalendarUnavailableLabel(
  member: TeamCalendarMember
): string | undefined {
  if (member.sharing === TeamCalendarSharing.none) return 'Not shared';
  if (!member.hasCalendar) return 'No calendar';
  return undefined;
}

/** A short label of what a shareable teammate lets the team see. */
export function teamCalendarSharingLabel(sharing: TeamCalendarSharing): string {
  return match(sharing)
    .with(TeamCalendarSharing.all, () => 'Details')
    .with(TeamCalendarSharing.busy_only, () => 'Busy only')
    .with(TeamCalendarSharing.none, () => 'Not shared')
    .exhaustive();
}

/**
 * One checkbox row per teammate, like the calendar picker: a color swatch,
 * the teammate, and what they share. Teammates who share nothing or have no
 * calendar connected are listed but cannot be toggled, so the roster reads
 * the same whichever way the team is configured.
 */
export function TeamCalendarControls(props: TeamCalendarControlsProps) {
  return (
    <div class="flex flex-col gap-0.5">
      <Show when={props.members.length === 0}>
        <span class="px-2 py-1 text-xs text-ink-muted">
          No teammates to show
        </span>
      </Show>
      <For each={props.members}>
        {(member) => {
          const unavailable = () => teamCalendarUnavailableLabel(member);
          const disabled = () => !props.enabled || unavailable() !== undefined;
          return (
            <Checkbox
              checked={
                unavailable() === undefined && props.isVisible(member.source.id)
              }
              disabled={disabled()}
              onChange={(checked) =>
                props.onVisibilityChange(member.source.id, checked)
              }
              class={cn(
                'flex w-full items-center rounded-lg py-1.5 pr-2 pl-2 text-xs text-ink hover:bg-hover',
                disabled() && 'opacity-60'
              )}
            >
              <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden="true"
                  class="size-2.5 shrink-0 rounded-sm"
                  style={{ 'background-color': member.source.color }}
                />
                <UserIcon id={member.userId} isDeleted={false} size="sm" />
                <span class="min-w-0 flex-1 truncate">{member.name}</span>
                <span class="shrink-0 text-ink-muted">
                  {unavailable() ?? teamCalendarSharingLabel(member.sharing)}
                </span>
              </Checkbox.Label>
              <Checkbox.Control />
            </Checkbox>
          );
        }}
      </For>
    </div>
  );
}
