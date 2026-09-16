import type { ForeignEntity } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';
import { summarizeChecks, summarizePullRequest } from './pull-request-summary';

const URL = 'https://github.com/macro-inc/macro/pull/6303';

function entity(metadata: Record<string, unknown>): ForeignEntity {
  return {
    id: '019f0000-0000-7000-8000-000000000001',
    foreignEntityId: 'macro-inc/macro/pull/6303',
    foreignEntitySource: 'github_pull_request',
    metadata,
    storedForId: 'macro|wolf@macro.com',
    storedForAuthEntity: 'user',
    createdAt: '2026-09-11T00:00:00Z',
    updatedAt: '2026-09-11T00:00:00Z',
  };
}

const completed = (name: string, conclusion: string | null) => ({
  id: name.length,
  name,
  status: 'completed',
  conclusion,
});

describe('summarizePullRequest', () => {
  it('describes the PR from the URL alone before the webhook has synced it', () => {
    expect(summarizePullRequest(URL, null)).toEqual({
      label: '#6303',
      fullName: 'macro-inc/macro#6303',
      status: 'unknown',
      title: undefined,
      checks: undefined,
      ref: { owner: 'macro-inc', repo: 'macro', number: 6303 },
    });
  });

  it('falls back to a generic label for a non-GitHub URL', () => {
    const url = 'https://gitlab.com/macro/macro/-/merge_requests/12';
    expect(summarizePullRequest(url, undefined)).toMatchObject({
      label: 'PR',
      fullName: url,
      status: 'unknown',
      ref: null,
    });
  });

  it('takes status, title, and checks from the synced entity', () => {
    const summary = summarizePullRequest(
      URL,
      entity({
        status: 'merged',
        name: 'feat(agents): PR chip',
        checks: [completed('lint', 'success'), completed('test', 'success')],
      })
    );
    expect(summary).toMatchObject({
      label: '#6303',
      status: 'merged',
      title: 'feat(agents): PR chip',
      checks: 'passing',
    });
  });

  it('treats an unexpected status as unknown rather than trusting it', () => {
    expect(summarizePullRequest(URL, entity({ status: 'draft' })).status).toBe(
      'unknown'
    );
    expect(summarizePullRequest(URL, entity({ status: '' })).title).toBe(
      undefined
    );
  });

  it('ignores a foreign entity that is not a GitHub pull request', () => {
    const other = {
      ...entity({ status: 'open' }),
      foreignEntitySource: 'jira',
    };
    expect(summarizePullRequest(URL, other).status).toBe('unknown');
  });
});

describe('summarizeChecks', () => {
  it('is absent with no runs to roll up', () => {
    expect(summarizeChecks(undefined)).toBeUndefined();
    expect(summarizeChecks([])).toBeUndefined();
    expect(summarizeChecks('nope')).toBeUndefined();
  });

  it('is passing only when a run actually succeeded', () => {
    expect(summarizeChecks([completed('a', 'success')])).toBe('passing');
    expect(
      summarizeChecks([completed('a', 'skipped'), completed('b', 'neutral')])
    ).toBeUndefined();
    expect(
      summarizeChecks([completed('a', 'skipped'), completed('b', 'success')])
    ).toBe('passing');
  });

  it('is pending while any run is still going', () => {
    expect(
      summarizeChecks([
        completed('a', 'success'),
        { id: 2, name: 'b', status: 'in_progress' },
      ])
    ).toBe('pending');
  });

  it('lets a failure win over runs still going and over successes', () => {
    expect(
      summarizeChecks([
        { id: 1, name: 'a', status: 'queued' },
        completed('b', 'success'),
        completed('c', 'FAILURE'),
      ])
    ).toBe('failing');
    for (const conclusion of ['timed_out', 'cancelled', 'action_required']) {
      expect(summarizeChecks([completed('x', conclusion)])).toBe('failing');
    }
  });
});
