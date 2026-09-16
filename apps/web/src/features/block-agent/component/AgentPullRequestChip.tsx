import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { HoverCard } from '@core/component/HoverCard';
import {
  PullRequestPreviewCard,
  PullRequestStatusIcon,
} from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { openExternalUrl } from '@core/util/url';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { Button, cn } from '@ui';
import { type Accessor, Show } from 'solid-js';
import {
  type PullRequestSummary,
  summarizePullRequest,
} from '../core/pull-request-summary';

export type AgentPullRequestLink = {
  url: Accessor<string | undefined>;
  /** The webhook-synced PR entity; undefined until the sync lands. */
  entity: Accessor<ForeignEntity | undefined>;
  summary: Accessor<PullRequestSummary | undefined>;
  /**
   * Open the PR: its entity split once synced (a new split by default, the
   * same one on shift or from a menu), GitHub in the browser until then.
   */
  open: (event?: MouseEvent | KeyboardEvent) => void;
};

/**
 * Resolve the session's linked pull request into something the header can
 * show and open. Cloud runtimes report the URL before the GitHub webhook has
 * stored the entity; the lookup returns `null` then, and connection gateway
 * pushes the entity and later status changes into the same query.
 */
export function createAgentPullRequestLink(
  url: Accessor<string | undefined>
): AgentPullRequestLink {
  const githubKey = () => {
    const current = url();
    const ref = current ? parseGithubPrUrl(current) : null;
    return ref ? toGithubKey(ref) : undefined;
  };
  const query = usePullRequestByGithubKeyQuery(githubKey);
  const entity = () =>
    query.isSuccess ? (query.data ?? undefined) : undefined;
  const summary = () => {
    const current = url();
    return current ? summarizePullRequest(current, entity()) : undefined;
  };
  const { openWithSplit } = useSplitLayout();

  const open = (event?: MouseEvent | KeyboardEvent) => {
    const current = url();
    if (!current) return;
    const synced = entity();
    if (!synced) {
      openExternalUrl(current);
      return;
    }
    openWithSplit(
      { type: 'pr', id: synced.id },
      {
        preferNewSplit: openInNewSplitForMention(
          event?.shiftKey,
          event != null
        ),
      }
    );
  };

  return { url, entity, summary, open };
}

const CHECKS_DOT_CLASS: Record<PullRequestSummary['checks'] & string, string> =
  {
    passing: 'bg-success',
    failing: 'bg-failure',
    pending: 'bg-ink-placeholder animate-pulse',
  };

const CHECKS_LABEL: Record<PullRequestSummary['checks'] & string, string> = {
  passing: 'checks passing',
  failing: 'checks failing',
  pending: 'checks running',
};

function tooltip(summary: PullRequestSummary, synced: boolean): string {
  const name = summary.title
    ? `${summary.fullName} · ${summary.title}`
    : summary.fullName;
  const checks = summary.checks ? ` · ${CHECKS_LABEL[summary.checks]}` : '';
  const state = summary.status === 'unknown' ? '' : ` · ${summary.status}`;
  return `${name}${state}${checks}${synced ? '' : ' · Open on GitHub'}`;
}

/**
 * The session's pull request as a compact header chip: GitHub's state glyph,
 * `#number`, and a dot rolling up the check runs. Hover shows the mention's
 * preview card once the entity exists; click opens the PR.
 */
export function AgentPullRequestChip(props: { link: AgentPullRequestLink }) {
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    event.stopPropagation();
    props.link.open(event);
  });

  return (
    <Show when={props.link.summary()}>
      {(summary) => (
        <HoverCard
          disabled={!props.link.entity()}
          triggerClass="min-w-0 shrink-0"
          trigger={
            <Button
              variant="outline"
              size="xs"
              class="gap-1.5 px-1.5 font-normal"
              label={`Open pull request ${summary().fullName}`}
              tooltip={tooltip(summary(), Boolean(props.link.entity()))}
              tooltipDisabled={Boolean(props.link.entity())}
              data-agent-pull-request={props.link.url()}
              data-pull-request-status={summary().status}
              {...navHandlers}
            >
              <span class="relative inline-flex size-3.5 shrink-0">
                <PullRequestStatusIcon status={summary().status} />
              </span>
              <span class="font-mono text-ink">{summary().label}</span>
              <Show when={summary().checks}>
                {(checks) => (
                  <span
                    aria-label={CHECKS_LABEL[checks()]}
                    role="img"
                    class={cn(
                      'size-1.5 shrink-0 rounded-full',
                      CHECKS_DOT_CLASS[checks()]
                    )}
                  />
                )}
              </Show>
            </Button>
          }
          content={
            <Show when={props.link.entity()}>
              {(entity) => <PullRequestPreviewCard id={entity().id} />}
            </Show>
          }
        />
      )}
    </Show>
  );
}
