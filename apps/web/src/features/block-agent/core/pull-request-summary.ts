/**
 * Pure derivation of the header's pull request chip from the session's
 * `pullRequestUrl` and the GitHub webhook entity (when it has synced).
 */

import {
  type PrRef,
  parseGithubPrUrl,
  prDisplayName,
} from '@app/features/block-pr/util/prKey';
import type {
  ForeignEntity,
  GithubPullRequestCheckRun,
} from '@service-storage/generated/schemas';

const GITHUB_PULL_REQUEST_SOURCE = 'github_pull_request';

export type PullRequestChecksState = 'passing' | 'failing' | 'pending';

export type PullRequestSummary = {
  /** `#6303`, or `PR` when the URL isn't a github.com pull request. */
  label: string;
  /** `owner/repo#6303`, or the raw URL when unparseable. */
  fullName: string;
  /** GitHub's state; `unknown` until the webhook entity exists. */
  status: 'open' | 'merged' | 'closed' | 'unknown';
  /** The PR title from the synced entity, when known. */
  title?: string;
  /** Roll-up of the check runs; absent when there are none to roll up. */
  checks?: PullRequestChecksState;
  ref: PrRef | null;
};

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function status(value: unknown): PullRequestSummary['status'] {
  return value === 'open' || value === 'merged' || value === 'closed'
    ? value
    : 'unknown';
}

/**
 * One state for the whole check suite, the way GitHub's merge box rolls it
 * up: any failure wins over runs still going, which win over all-green.
 * Skipped and neutral runs alone don't make a suite "passing".
 */
export function summarizeChecks(
  checks: unknown
): PullRequestChecksState | undefined {
  if (!Array.isArray(checks) || checks.length === 0) return undefined;
  let pending = false;
  let passing = false;
  for (const run of checks as GithubPullRequestCheckRun[]) {
    if (run.status !== 'completed') {
      pending = true;
      continue;
    }
    const conclusion = run.conclusion?.toLowerCase();
    if (
      conclusion === 'failure' ||
      conclusion === 'timed_out' ||
      conclusion === 'cancelled' ||
      conclusion === 'action_required'
    ) {
      return 'failing';
    }
    if (conclusion === 'success') passing = true;
  }
  if (pending) return 'pending';
  return passing ? 'passing' : undefined;
}

export function summarizePullRequest(
  url: string,
  entity: ForeignEntity | null | undefined
): PullRequestSummary {
  const ref = parseGithubPrUrl(url);
  const synced =
    entity && entity.foreignEntitySource === GITHUB_PULL_REQUEST_SOURCE
      ? metadataRecord(entity.metadata)
      : undefined;
  return {
    label: ref ? `#${ref.number}` : 'PR',
    fullName: ref ? prDisplayName(ref) : url,
    status: status(synced?.status),
    title: nonEmptyString(synced?.name),
    checks: synced ? summarizeChecks(synced.checks) : undefined,
    ref,
  };
}
