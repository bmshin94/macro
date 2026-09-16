import { QueryClient } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoupAstItemsData } from '../items';

vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));

import {
  GRAPHQL_SOUP_DELETE_MUTATION_KEY,
  usePendingGraphqlSoupDeleteIds,
  withoutPendingGraphqlSoupDeletes,
  withoutPendingSoupEntities,
} from './optimistic-deletions';

let client: QueryClient;
let dispose: (() => void) | undefined;
beforeEach(() => {
  client = new QueryClient();
});
afterEach(() => {
  dispose?.();
  client.clear();
});

function data(): SoupAstItemsData {
  return {
    entities: ['a', 'b', 'c'].map(
      (id) => ({ id, type: 'document' }) as SoupAstItemsData['entities'][number]
    ),
    groups: [
      {
        key: 'one',
        label: 'One',
        displayOrder: 0,
        totalCount: 10,
        itemIds: ['a', 'b'],
        nextCursor: 'next',
      },
      {
        key: 'two',
        label: 'Two',
        displayOrder: 1,
        totalCount: 1,
        itemIds: ['c'],
        nextCursor: null,
      },
    ],
    itemsById: Object.fromEntries(
      ['a', 'b', 'c'].map((id) => [id, { tag: 'document', data: { id } }])
    ) as SoupAstItemsData['itemsById'],
    oldestFetchedTimestamp: 123,
  };
}

describe('GraphQL Soup pending delete projection', () => {
  it('preserves unchanged data identity', () => {
    const original = data();
    expect(withoutPendingGraphqlSoupDeletes(original, new Set())).toBe(
      original
    );
    expect(withoutPendingGraphqlSoupDeletes(original, new Set(['other']))).toBe(
      original
    );
    expect(
      withoutPendingGraphqlSoupDeletes(undefined, new Set(['a']))
    ).toBeUndefined();
  });

  it('filters grouped membership, row pools, and known counts without changing cursors or source data', () => {
    const original = data();
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['a', 'b'])
    )!;
    expect(filtered.entities).toEqual([original.entities[2]]);
    expect(filtered.groups?.[0]).toEqual({
      ...original.groups![0],
      itemIds: [],
      totalCount: 8,
    });
    expect(filtered.groups?.[1]).toBe(original.groups?.[1]);
    expect(Object.keys(filtered.itemsById!)).toEqual(['c']);
    expect(filtered.oldestFetchedTimestamp).toBe(123);
    expect(original.entities).toHaveLength(3);
    expect(original.groups?.[0].itemIds).toEqual(['a', 'b']);
    expect(Object.keys(original.itemsById!)).toEqual(['a', 'b', 'c']);
    expect(withoutPendingGraphqlSoupDeletes(original, new Set())).toBe(
      original
    );
  });

  it('filters flat/local-reconciled rows while preserving unrelated rows and metadata', () => {
    const original = {
      ...data(),
      groups: undefined,
      itemsById: undefined,
      cachedMail: true,
    };
    const filtered = withoutPendingGraphqlSoupDeletes(
      original,
      new Set(['b'])
    )!;
    expect(filtered.entities).toEqual([
      original.entities[0],
      original.entities[2],
    ]);
    expect(filtered.entities[0]).toBe(original.entities[0]);
    expect(filtered.cachedMail).toBe(true);
    expect(filtered.oldestFetchedTimestamp).toBe(123);
    expect(withoutPendingSoupEntities(original.entities, new Set())).toBe(
      original.entities
    );
  });

  it('keeps overlapping deletes hidden until each mutation settles', async () => {
    const ids = createRoot((cleanup) => {
      dispose = cleanup;
      return usePendingGraphqlSoupDeleteIds();
    });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = client
      .getMutationCache()
      .build(client, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({ graphqlDeletedIds: ['a', 'b'] }),
        mutationFn: () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      })
      .execute(undefined);
    const second = client
      .getMutationCache()
      .build(client, {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        onMutate: () => ({ graphqlDeletedIds: ['b', 'c'] }),
        mutationFn: () =>
          new Promise<void>((resolve) => {
            releaseSecond = resolve;
          }),
      })
      .execute(undefined);
    await vi.waitFor(() => expect([...ids()]).toEqual(['a', 'b', 'c']));
    releaseFirst();
    await first;
    await vi.waitFor(() => expect([...ids()]).toEqual(['b', 'c']));
    releaseSecond();
    await second;
    await vi.waitFor(() => expect(ids().size).toBe(0));
  });
});
