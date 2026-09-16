/** @vitest-environment jsdom */
import { queryClient } from '@queries/client';
import { handlePullRequestUpdated } from '@queries/storage/pr-mention-sync';
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { type JSX, Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AgentPullRequestChip,
  createAgentPullRequestLink,
} from './AgentPullRequestChip';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getForeignEntityBySource: vi.fn() },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element; content: JSX.Element }) => (
    <>
      {props.trigger}
      <div data-testid="hover-content">{props.content}</div>
    </>
  ),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/PullRequestMention',
  () => ({
    PullRequestStatusIcon: (props: { status: string }) => (
      <svg data-status-icon={props.status} />
    ),
    PullRequestPreviewCard: (props: { id: string }) => (
      <div data-testid="preview">{props.id}</div>
    ),
  })
);

const URL = 'https://github.com/macro-inc/macro/pull/6303';
const metadata = {
  status: 'open',
  name: 'feat(agents): PR chip',
  checks: [{ id: 1, name: 'lint', status: 'completed', conclusion: 'failure' }],
};
const entity: ForeignEntity = {
  id: '019f0000-0000-7000-8000-000000000001',
  foreignEntityId: 'macro-inc/macro/pull/6303',
  foreignEntitySource: 'github_pull_request',
  metadata,
  storedForId: 'macro|wolf@macro.com',
  storedForAuthEntity: 'user',
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
};

type Lookup = ReturnType<typeof storageServiceClient.getForeignEntityBySource>;
const lookup = vi.mocked(storageServiceClient.getForeignEntityBySource);
const notSynced = () =>
  lookup.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Not synced' }]) as Awaited<Lookup>
  );

function Chip(props: { url: string | undefined }) {
  const link = createAgentPullRequestLink(() => props.url);
  return <AgentPullRequestChip link={link} />;
}

function mount(url: string | undefined) {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<span>Loading header</span>}>
        <Chip url={url} />
      </Suspense>
    </QueryClientProvider>
  ));
}

const chip = () => screen.getByRole('button', { name: /Open pull request/ });
const flush = () => new Promise((done) => setTimeout(done, 0));

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

it('renders nothing for a session without a pull request', () => {
  mount(undefined);
  expect(screen.queryByRole('button')).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
});

it('links straight to GitHub until the webhook entity exists, without suspending', async () => {
  notSynced();
  mount(URL);
  expect(screen.queryByText('Loading header')).toBeNull();
  expect(chip().textContent).toContain('#6303');
  expect(chip().getAttribute('data-pull-request-status')).toBe('unknown');
  await flush();
  expect(chip().getAttribute('data-pull-request-status')).toBe('unknown');
  expect(screen.queryByTestId('preview')).toBeNull();

  fireEvent.click(chip());
  expect(mocks.openExternalUrl).toHaveBeenCalledWith(URL);
  expect(mocks.openWithSplit).not.toHaveBeenCalled();
});

it('shows GitHub state and checks for a synced PR and opens its entity', async () => {
  lookup.mockResolvedValue(ok(entity) as Awaited<Lookup>);
  mount(URL);
  await flush();

  expect(chip().getAttribute('data-pull-request-status')).toBe('open');
  expect(chip().getAttribute('aria-label')).toBe(
    'Open pull request macro-inc/macro#6303'
  );
  expect(screen.getByRole('img', { name: 'checks failing' })).toBeTruthy();
  expect(screen.getByTestId('preview').textContent).toBe(entity.id);

  fireEvent.click(chip());
  expect(mocks.openExternalUrl).not.toHaveBeenCalled();
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    { type: 'pr', id: entity.id },
    { preferNewSplit: true }
  );
});

it('follows the PR through sync and merge pushed over connection gateway', async () => {
  notSynced();
  mount(URL);
  await flush();
  expect(chip().getAttribute('data-pull-request-status')).toBe('unknown');

  await handlePullRequestUpdated(entity);
  await flush();
  expect(chip().getAttribute('data-pull-request-status')).toBe('open');

  await handlePullRequestUpdated({
    ...entity,
    metadata: { ...metadata, status: 'merged' },
    updatedAt: '2026-09-11T00:01:00Z',
  });
  await flush();
  expect(chip().getAttribute('data-pull-request-status')).toBe('merged');
  expect(lookup).toHaveBeenCalledTimes(1);
});
