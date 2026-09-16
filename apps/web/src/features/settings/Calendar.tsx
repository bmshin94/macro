import {
  teamCalendarSharingLabel,
  teamCalendarUnavailableLabel,
} from '@app/features/calendar/components/TeamCalendarControls';
import { TurnOffCalendarDialog } from '@app/features/calendar/components/TurnOffCalendarDialog';
import {
  type CalendarAccount,
  useCalendarAccounts,
} from '@app/features/calendar/hooks/use-calendar-accounts';
import { useCalendarSources } from '@app/features/calendar/hooks/use-calendar-sources';
import { useCalendarTeamSharingFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import {
  type TeamCalendarMember,
  toTeamCalendarMember,
} from '@app/features/calendar/hooks/use-team-calendar';
import { useHasTeammates } from '@app/features/calendar/hooks/use-team-ooo';
import { useCalendarPreferences } from '@app/features/calendar/preferences';
import type {
  CalendarPeriodView,
  CalendarTimeFormat,
  CalendarWeekStart,
} from '@app/features/calendar/types';
import { groupCalendarSourcesByAccount } from '@app/features/calendar/utils/calendar-source-groups';
import { openAddInboxDialog } from '@app/features/inbox/AddInboxDialog';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { UserIcon } from '@core/component/UserIcon';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import RssIcon from '@phosphor/rss.svg';
import WarningIcon from '@phosphor/warning.svg';
import CalendarSlashIcon from '@phosphor-icons/core/regular/calendar-slash.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import {
  useSetTeamCalendarSharingMutation,
  useTeamCalendarMembersQuery,
  useTeamCalendarSharingQuery,
} from '@queries/calendar/team';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { TeamCalendarSharing } from '@service-storage/generated/schemas/teamCalendarSharing';
import { Button, SegmentedControl, ToggleSwitch, Tooltip } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import { StatusDot } from './integration-ui';
import {
  ChoiceRow,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

const WEEK_START_OPTIONS: Array<{ value: CalendarWeekStart; label: string }> = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
];

const TIME_FORMAT_OPTIONS: Array<{ value: CalendarTimeFormat; label: string }> =
  [
    { value: '12-hour', label: '12-hour' },
    { value: '24-hour', label: '24-hour' },
  ];

const PERIOD_VIEW_OPTIONS: Array<{ value: CalendarPeriodView; label: string }> =
  [
    { value: 'timeGridDay', label: 'Day' },
    { value: 'timeGridWeek', label: 'Week' },
    { value: 'dayGridMonth', label: 'Month' },
  ];

/** The three sharing policies, in the order the page offers them. */
const SHARING_CHOICES: Array<{
  value: TeamCalendarSharing;
  title: string;
  description: string;
}> = [
  {
    value: TeamCalendarSharing.all,
    title: 'Everything',
    description:
      'Teammates see your event titles, guests, locations, and descriptions. Events you mark private still show as busy only.',
  },
  {
    value: TeamCalendarSharing.busy_only,
    title: 'Busy blocks only',
    description:
      "Teammates see when you're busy, not what you're doing or who you're with.",
  },
  {
    value: TeamCalendarSharing.none,
    title: 'Nothing',
    description:
      'Your calendar is hidden from teammates, including the team out-of-office list.',
  },
];

/**
 * Settings › Calendar: the calendar accounts and calendars Macro syncs, how the
 * calendar is displayed, and what the team can see of it. Connection controls
 * repeat what Settings › Connections offers for an inbox, scoped to calendar.
 */
export function Calendar() {
  const teamSharingEnabled = useCalendarTeamSharingFlag();

  return (
    <SettingsPage
      title="Calendar"
      description="Manage the calendars Macro syncs, how they're displayed, and what your team can see."
    >
      <AccountsSection />
      <CalendarsSection />
      <DisplaySection />
      <Show when={teamSharingEnabled()}>
        <TeamSharingSection />
        <TeamCalendarsSection />
      </Show>
    </SettingsPage>
  );
}

function AccountsSection() {
  const accounts = useCalendarAccounts();
  const startAddInbox = useAddInboxFlow();
  const multiInboxFlag = useFeatureFlag(enableMultiInbox);
  const [turnOffTarget, setTurnOffTarget] = createSignal<{
    linkId: string;
    emailAddress: string;
  } | null>(null);

  return (
    <SettingsSection
      title="Accounts"
      description="Calendar syncs from the Google accounts you've connected to Macro."
    >
      <SettingsCard>
        <Show
          when={accounts().length > 0}
          fallback={
            <SettingsRow
              label="No connected accounts"
              description="Connect a Google account to sync its calendar."
            >
              <Button
                variant="accent"
                size="sm"
                depth={3}
                onClick={() => void startAddInbox({ scopes: 'calendar' })}
              >
                Connect calendar
              </Button>
            </SettingsRow>
          }
        >
          <For each={accounts()}>
            {(account) => (
              <AccountRow
                account={account}
                onEnable={() => void startAddInbox({ scopes: 'calendar' })}
                onTurnOff={() =>
                  setTurnOffTarget({
                    linkId: account.linkId,
                    emailAddress: account.emailAddress,
                  })
                }
              />
            )}
          </For>
        </Show>
        <Show when={multiInboxFlag().enabled && accounts().length > 0}>
          <SettingsRow
            label="Connect another account"
            description="Sync calendars from more Google accounts."
          >
            <Tooltip label="Connect account">
              <Button
                variant="outline"
                size="icon-sm"
                depth={3}
                aria-label="Connect another account"
                onClick={openAddInboxDialog}
              >
                <PlusIcon class="size-4" />
              </Button>
            </Tooltip>
          </SettingsRow>
        </Show>
      </SettingsCard>
      <TurnOffCalendarDialog
        target={turnOffTarget()}
        onClose={() => setTurnOffTarget(null)}
      />
    </SettingsSection>
  );
}

function AccountRow(props: {
  account: CalendarAccount;
  onEnable: () => void;
  onTurnOff: () => void;
}) {
  const isOn = () => props.account.action === 'turnOff';
  return (
    <SettingsRow
      label={
        <span class="flex items-center gap-2 min-w-0">
          <span class="ph-no-capture truncate">
            {props.account.emailAddress}
          </span>
          <StatusDot
            state={isOn() ? 'connected' : 'disconnected'}
            label={isOn() ? 'Calendar on' : 'Calendar off'}
          />
        </span>
      }
      description={
        isOn()
          ? 'Calendar syncing'
          : 'Calendar off — grant calendar access to sync it'
      }
    >
      <Show
        when={isOn()}
        fallback={
          <Button
            variant="accent"
            size="sm"
            depth={3}
            onClick={props.onEnable}
            aria-label={`Enable calendar for ${props.account.emailAddress}`}
          >
            Enable calendar
          </Button>
        }
      >
        <Tooltip label="Turn off calendar">
          <Button
            variant="outline"
            size="icon-sm"
            depth={3}
            onClick={props.onTurnOff}
            aria-label={`Turn off calendar for ${props.account.emailAddress}`}
          >
            <CalendarSlashIcon class="size-4" />
          </Button>
        </Tooltip>
      </Show>
    </SettingsRow>
  );
}

function CalendarsSection() {
  const { sources, calendarsQuery } = useCalendarSources();
  const { isSourceVisible, setSourceVisibility } = useCalendarPreferences();
  const groups = createMemo(() =>
    queryReadyGate(calendarsQuery) && (calendarsQuery.data?.length ?? 0) > 0
      ? groupCalendarSourcesByAccount(sources())
      : []
  );

  return (
    <Show when={groups().length > 0}>
      <SettingsSection
        title="Calendars"
        description="Choose which synced calendars appear on your calendar."
      >
        <For each={groups()}>
          {(group) => (
            <SettingsCard>
              <SettingsRow
                label={
                  <span class="ph-no-capture font-medium">
                    {group.emailAddress}
                  </span>
                }
              />
              <For each={group.calendars}>
                {(source) => (
                  <SettingsRow
                    label={
                      <span class="flex items-center gap-2 min-w-0">
                        <span
                          aria-hidden="true"
                          class="size-2.5 shrink-0 rounded-sm"
                          style={{ 'background-color': source.color }}
                        />
                        <span class="truncate">{source.name}</span>
                        <Show when={source.isSubscription}>
                          <span
                            title="Subscription calendar"
                            class="flex shrink-0 text-ink-muted"
                          >
                            <RssIcon
                              class="size-3"
                              aria-label="Subscription calendar"
                            />
                          </span>
                        </Show>
                        <Show when={source.syncError}>
                          {(error) => (
                            <span
                              title={`Sync failed: ${error()}`}
                              class="flex shrink-0 text-alert-ink"
                            >
                              <WarningIcon
                                class="size-3"
                                aria-label={`Sync failed: ${error()}`}
                              />
                            </span>
                          )}
                        </Show>
                      </span>
                    }
                    description={
                      source.isPrimary ? 'Primary calendar' : undefined
                    }
                  >
                    <ToggleSwitch
                      size="md"
                      checked={isSourceVisible(source.id)}
                      onChange={(visible) =>
                        setSourceVisibility(source.id, visible)
                      }
                      aria-label={`Show ${source.name} on the calendar`}
                    />
                  </SettingsRow>
                )}
              </For>
            </SettingsCard>
          )}
        </For>
      </SettingsSection>
    </Show>
  );
}

function DisplaySection() {
  const {
    preferences,
    setPeriodView,
    setShowWeekends,
    setTimeFormat,
    setWeekStartsOn,
  } = useCalendarPreferences();

  return (
    <SettingsSection title="Display">
      <SettingsCard>
        <SettingsRow
          label="Default view"
          description="The view the calendar opens in."
        >
          <SegmentedControl
            size="sm"
            value={preferences.periodView}
            options={PERIOD_VIEW_OPTIONS}
            onChange={setPeriodView}
            aria-label="Default view"
          />
        </SettingsRow>
        <SettingsRow label="Week starts on">
          <SegmentedControl
            size="sm"
            value={preferences.weekStartsOn}
            options={WEEK_START_OPTIONS}
            onChange={setWeekStartsOn}
            aria-label="Week starts on"
          />
        </SettingsRow>
        <SettingsRow label="Time format">
          <SegmentedControl
            size="sm"
            value={preferences.timeFormat}
            options={TIME_FORMAT_OPTIONS}
            onChange={setTimeFormat}
            aria-label="Time format"
          />
        </SettingsRow>
        <SettingsRow
          label="Show weekends"
          description="Include Saturday and Sunday in week and month views."
        >
          <ToggleSwitch
            size="md"
            checked={preferences.showWeekends}
            onChange={setShowWeekends}
            aria-label="Show weekends"
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function TeamSharingSection() {
  const teamQuery = useCurrentTeamQuery();
  const hasTeam = () => queryReadyGate(teamQuery) && teamQuery.data !== null;
  const sharingQuery = useTeamCalendarSharingQuery(hasTeam);
  const setSharing = useSetTeamCalendarSharingMutation({
    onError: () => toast.failure('Could not update calendar sharing'),
  });
  const currentSharing = () =>
    !sharingQuery.isError && queryReadyGate(sharingQuery)
      ? sharingQuery.data
      : undefined;
  const disabled = () => currentSharing() === undefined || setSharing.isPending;

  return (
    <SettingsSection
      title="Team sharing"
      description="What your teammates see when they look at your calendar or ask Macro AI when you're free."
    >
      <SettingsCard>
        <Show
          when={hasTeam()}
          fallback={
            <SettingsRow
              label="Join a team to share your calendar"
              description="Team calendar sharing is available once you're a member of a team."
            />
          }
        >
          <div class="flex flex-col gap-2 px-6 py-4">
            <For each={SHARING_CHOICES}>
              {(choice) => (
                <ChoiceRow
                  name="calendar-team-sharing"
                  value={choice.value}
                  title={choice.title}
                  description={choice.description}
                  checked={currentSharing() === choice.value}
                  disabled={disabled()}
                  onChange={() => setSharing.mutate(choice.value)}
                />
              )}
            </For>
            <Show when={sharingQuery.isError}>
              <span class="text-xs text-failure">
                Couldn't load your sharing setting.
              </span>
            </Show>
          </div>
        </Show>
      </SettingsCard>
    </SettingsSection>
  );
}

function TeamCalendarsSection() {
  const hasTeammates = useHasTeammates();
  const {
    preferences,
    setShowTeamCalendars,
    isSourceVisible,
    setSourceVisibility,
  } = useCalendarPreferences();
  const membersQuery = useTeamCalendarMembersQuery(hasTeammates);
  const members = createMemo<TeamCalendarMember[]>(() =>
    membersQuery.isSuccess ? membersQuery.data.map(toTeamCalendarMember) : []
  );

  return (
    <Show when={hasTeammates()}>
      <SettingsSection
        title="Team calendars"
        description="Overlay teammates' shared calendars on yours to see when they're free."
      >
        <SettingsCard>
          <SettingsRow
            label="Show team calendars"
            description="Teammates' events appear on your calendar, in each teammate's color."
          >
            <ToggleSwitch
              size="md"
              checked={preferences.showTeamCalendars}
              onChange={setShowTeamCalendars}
              aria-label="Show team calendars"
            />
          </SettingsRow>
          <Switch>
            <Match when={membersQuery.isPending}>
              <SettingsRow label="Loading your team…" />
            </Match>
            <Match when={membersQuery.isError}>
              <SettingsRow label="Couldn't load your team" />
            </Match>
            <Match when={membersQuery.isSuccess}>
              <For each={members()}>
                {(member) => {
                  const unavailable = () =>
                    teamCalendarUnavailableLabel(member);
                  return (
                    <SettingsRow
                      label={
                        <span class="flex items-center gap-2 min-w-0">
                          <span
                            aria-hidden="true"
                            class="size-2.5 shrink-0 rounded-sm"
                            style={{ 'background-color': member.source.color }}
                          />
                          <UserIcon
                            id={member.userId}
                            isDeleted={false}
                            size="sm"
                          />
                          <span class="truncate">{member.name}</span>
                        </span>
                      }
                      description={
                        unavailable() ??
                        `Shares ${teamCalendarSharingLabel(member.sharing).toLowerCase()}`
                      }
                    >
                      <ToggleSwitch
                        size="md"
                        checked={
                          unavailable() === undefined &&
                          isSourceVisible(member.source.id)
                        }
                        disabled={
                          !preferences.showTeamCalendars ||
                          unavailable() !== undefined
                        }
                        onChange={(visible) =>
                          setSourceVisibility(member.source.id, visible)
                        }
                        aria-label={`Show ${member.name}'s calendar`}
                      />
                    </SettingsRow>
                  );
                }}
              </For>
            </Match>
          </Switch>
        </SettingsCard>
      </SettingsSection>
    </Show>
  );
}
