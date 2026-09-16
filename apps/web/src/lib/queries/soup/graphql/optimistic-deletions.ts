import { useMutationState } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { queryClient } from '../../client';
import type { SoupAstItemsData } from '../items';

export const GRAPHQL_SOUP_DELETE_MUTATION_KEY = [
  'graphql-soup',
  'delete',
] as const;

/** Only GraphQL-enabled bulk deletes opt into the display overlay. */
export type GraphqlSoupDeleteContext = {
  graphqlDeletedIds?: readonly string[];
};

/** Reflect pending REST deletions in GraphQL views without rewriting cache data.
 * Failed deletes roll back naturally when the mutation leaves pending. Successful
 * deletes stay hidden until mutation-driven network revalidation finishes.
 */
export function usePendingGraphqlSoupDeleteIds() {
  const pending = useMutationState(
    () => ({
      filters: {
        mutationKey: GRAPHQL_SOUP_DELETE_MUTATION_KEY,
        exact: true,
        status: 'pending' as const,
      },
      select: (mutation) =>
        (mutation.state.context as GraphqlSoupDeleteContext | undefined)
          ?.graphqlDeletedIds,
    }),
    () => queryClient
  );
  return createMemo<ReadonlySet<string>>(
    () => new Set(pending().flatMap((ids) => ids ?? []))
  );
}

/** Preserve unaffected rows and array identity, including when no delete is pending. */
export function withoutPendingSoupEntities<T extends { id: string }>(
  entities: T[],
  deletedIds: ReadonlySet<string>
): T[] {
  if (
    deletedIds.size === 0 ||
    !entities.some((entity) => deletedIds.has(entity.id))
  )
    return entities;
  return entities.filter((entity) => !deletedIds.has(entity.id));
}

/** Applies only at the GraphQL display boundary, after local/server reconciliation. */
export function withoutPendingGraphqlSoupDeletes(
  data: SoupAstItemsData | undefined,
  deletedIds: ReadonlySet<string>
): SoupAstItemsData | undefined {
  if (!data || deletedIds.size === 0) return data;
  const entities = withoutPendingSoupEntities(data.entities, deletedIds);
  const groups = data.groups?.map((group) => {
    const itemIds = group.itemIds.filter((id) => !deletedIds.has(id));
    const removed = group.itemIds.length - itemIds.length;
    return removed === 0
      ? group
      : {
          ...group,
          itemIds,
          totalCount: Math.max(0, group.totalCount - removed),
        };
  });
  const itemsById = data.itemsById;
  const removedItemIds = itemsById
    ? Object.keys(itemsById).filter((id) => deletedIds.has(id))
    : [];
  if (
    entities === data.entities &&
    groups?.every((group, index) => group === data.groups?.[index]) !== false &&
    removedItemIds.length === 0
  ) {
    return data;
  }
  const remainingItems =
    removedItemIds.length > 0 ? { ...itemsById } : itemsById;
  if (remainingItems && removedItemIds.length > 0) {
    for (const id of removedItemIds) delete remainingItems[id];
  }
  return { ...data, entities, groups, itemsById: remainingItems };
}
