import type { EntityData } from '@entity';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphqlEnabled: vi.fn(() => true),
  deleteItem: vi.fn(),
  removeSoup: vi.fn(),
  removeSearch: vi.fn(),
  rollbackSoup: vi.fn(),
  rollbackSearch: vi.fn(),
  refresh: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/component/FileList/itemOperations', () => ({
  deleteItem: mocks.deleteItem,
  copyItem: vi.fn(),
  moveToFolder: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: mocks.graphqlEnabled,
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@queries/agent-session/entity-mutations', () => ({
  deleteAgentSession: vi.fn(),
}));
vi.mock('@queries/soup/cache', () => ({
  removeSoupEntities: mocks.removeSoup,
  removeSearchEntities: mocks.removeSearch,
}));
vi.mock('@queries/soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));
vi.mock('@service-call/client', () => ({ callServiceClient: {} }));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {},
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));

import {
  GRAPHQL_SOUP_DELETE_MUTATION_KEY,
  GRAPHQL_SOUP_DELETE_RETENTION_MS,
  type GraphqlSoupDeleteContext,
  usePendingGraphqlSoupDeleteIds,
} from '@queries/soup/graphql/optimistic-deletions';
import { createBulkDeleteDssItemsMutation } from './dss';

let client: QueryClient;
let dispose: (() => void) | undefined;
const entity = (id: string, type: EntityData['type'] = 'document') =>
  ({ id, type }) as EntityData;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount() {
  let result!: {
    mutation: ReturnType<typeof createBulkDeleteDssItemsMutation>;
    pendingIds: ReturnType<typeof usePendingGraphqlSoupDeleteIds>;
  };
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          result = {
            mutation: createBulkDeleteDssItemsMutation(),
            pendingIds: usePendingGraphqlSoupDeleteIds(),
          };
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphqlEnabled.mockReturnValue(true);
  mocks.removeSoup.mockReturnValue({ rollback: mocks.rollbackSoup });
  mocks.removeSearch.mockReturnValue({ rollback: mocks.rollbackSearch });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.deleteItem.mockResolvedValue(true);
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(() => {
  for (const mutation of client.getMutationCache().getAll()) {
    (
      mutation.state.context as GraphqlSoupDeleteContext | undefined
    )?.graphqlDeletion?.release();
  }
  dispose?.();
  client.clear();
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('bulk delete GraphQL optimism', () => {
  it('hides only deletable ids until deletion and GraphQL refresh both finish', async () => {
    const network = deferred<boolean>();
    const refreshed = deferred<void>();
    mocks.deleteItem.mockReturnValue(network.promise);
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    const result = mutation.mutateAsync([
      entity('task-1'),
      entity('task-2'),
      entity('channel', 'channel'),
    ]);
    await vi.waitFor(() =>
      expect([...pendingIds()]).toEqual(['task-1', 'task-2'])
    );
    expect(mocks.deleteItem).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    network.resolve(true);
    await expect(result).resolves.toEqual([true, true]);
    await vi.waitFor(() => expect(mutation.isPending).toBe(false));
    expect(mocks.refresh).toHaveBeenCalledWith({ throwOnError: true });
    expect([...pendingIds()]).toEqual(['task-1', 'task-2']);
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it('restores failed deletions even while revalidation is still pending', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const network = deferred<boolean>();
    const refreshed = deferred<void>();
    mocks.deleteItem.mockReturnValue(network.promise);
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    const error = new Error('delete failed');
    const result = expect(
      mutation.mutateAsync([entity('task')])
    ).rejects.toThrow(error);
    await vi.waitFor(() => expect(pendingIds().has('task')).toBe(true));
    network.reject(error);
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.rollbackSoup).toHaveBeenCalledOnce();
    expect(mocks.rollbackSearch).toHaveBeenCalledOnce();
    expect(mocks.failure).toHaveBeenCalledWith('Failed to delete items');
    expect(pendingIds().has('task')).toBe(false);
    await result;
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it('revalidates partial boolean failures without treating every item as deleted', async () => {
    mocks.deleteItem.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const refreshed = deferred<void>();
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    await expect(
      mutation.mutateAsync([entity('deleted'), entity('retained')])
    ).resolves.toEqual([true, false]);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect([...pendingIds()]).toEqual(['deleted']);
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it.each([true, false])(
    'latches the GraphQL flag at creation (initially %s)',
    async (enabled) => {
      mocks.graphqlEnabled.mockReturnValue(enabled);
      const network = deferred<boolean>();
      const refreshed = deferred<void>();
      mocks.deleteItem.mockReturnValue(network.promise);
      mocks.refresh.mockReturnValue(refreshed.promise);
      const { mutation, pendingIds } = mount();
      mocks.graphqlEnabled.mockReturnValue(!enabled);
      const result = mutation.mutateAsync([entity('task')]);
      await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledOnce());
      expect(pendingIds().has('task')).toBe(enabled);
      const cached = client.getMutationCache().getAll()[0];
      expect(cached.options.mutationKey).toEqual(
        enabled ? GRAPHQL_SOUP_DELETE_MUTATION_KEY : undefined
      );
      expect(
        Boolean(
          (cached.state.context as GraphqlSoupDeleteContext).graphqlDeletion
        )
      ).toBe(enabled);
      mocks.graphqlEnabled.mockReturnValue(enabled);
      network.resolve(true);
      await result;
      expect(mocks.refresh).toHaveBeenCalledTimes(enabled ? 1 : 0);
      expect(mocks.graphqlEnabled).toHaveBeenCalledTimes(1);
      refreshed.resolve();
      await vi.waitFor(() => expect(pendingIds().size).toBe(0));
    }
  );

  it('does not recreate deletion state after the client is cleared during an API request', async () => {
    const network = deferred<boolean>();
    mocks.deleteItem.mockReturnValue(network.promise);
    const { mutation } = mount();
    const result = mutation.mutateAsync([entity('task')]);
    await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledOnce());
    client.clear();
    network.resolve(true);
    await result;
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it('retains successful deletes after a refresh error and clears them on retry success', async () => {
    vi.useFakeTimers();
    mocks.refresh
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { mutation, pendingIds } = mount();
    await mutation.mutateAsync([entity('task')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mutation.isPending).toBe(false);
    expect([...pendingIds()]).toEqual(['task']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(pendingIds().size).toBe(0);
    await vi.advanceTimersByTimeAsync(GRAPHQL_SOUP_DELETE_RETENTION_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it('retains the successful siblings when another delete throws, waiting for every outcome', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const slowSuccess = deferred<boolean>();
    const refreshed = deferred<void>();
    mocks.deleteItem
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockReturnValueOnce(slowSuccess.promise);
    mocks.refresh.mockReturnValue(refreshed.promise);
    const { mutation, pendingIds } = mount();
    const result = expect(
      mutation.mutateAsync([entity('failed'), entity('deleted')])
    ).rejects.toThrow('delete failed');
    await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledTimes(2));
    expect(mocks.refresh).not.toHaveBeenCalled();
    slowSuccess.resolve(true);
    await result;
    expect([...pendingIds()]).toEqual(['deleted']);
    refreshed.resolve();
    await vi.waitFor(() => expect(pendingIds().size).toBe(0));
  });

  it.each([false, true])(
    'preserves disabled-path behavior (failure: %s)',
    async (fails) => {
      mocks.graphqlEnabled.mockReturnValue(false);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const network = deferred<boolean>();
      mocks.deleteItem.mockReturnValue(network.promise);
      const { mutation, pendingIds } = mount();
      const result = mutation.mutateAsync([entity('task')]);
      const settled = fails
        ? expect(result).rejects.toThrow('delete failed')
        : expect(result).resolves.toEqual([true]);
      await vi.waitFor(() => expect(mocks.deleteItem).toHaveBeenCalledOnce());
      expect(mocks.removeSoup).toHaveBeenCalledWith(new Set(['task']));
      expect(mocks.removeSearch).toHaveBeenCalledWith(new Set(['task']));
      expect(pendingIds().size).toBe(0);
      expect(
        client.getMutationCache().getAll()[0].options.mutationKey
      ).toBeUndefined();
      expect(
        client.getMutationCache().getAll()[0].options.onSettled
      ).toBeUndefined();
      if (fails) network.reject(new Error('delete failed'));
      else network.resolve(true);
      await settled;
      expect(mocks.refresh).not.toHaveBeenCalled();
      expect(mocks.rollbackSoup).toHaveBeenCalledTimes(fails ? 1 : 0);
      expect(mocks.rollbackSearch).toHaveBeenCalledTimes(fails ? 1 : 0);
    }
  );
});
