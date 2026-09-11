import type { ListDataSource } from '@app/components/list';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { compareDateDesc } from '@core/util/date';
import { type ChannelEntity, type EntityData, isChannelEntity } from '@entity';
import { useFavoritesQuery } from '@queries/favorites/favorites';
import {
  type SoupAstItemsQueryArgs,
  type SoupAstParams,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { ListFavoritesParams } from '@service-storage/generated/schemas/listFavoritesParams';
import { type Accessor, createMemo } from 'solid-js';
import type { ChannelsQueryScope, ChannelsRailScope } from './types';
import { channelHasMessages, isDirectMessage } from './utils';

const CHANNELS_QUERY_PARAMS = {
  limit: 100,
} satisfies SoupAstParams;

type ChannelsQueryDefinition = {
  params: SoupAstParams;
  filters: ReturnType<typeof defineQueryFilters>;
  matches: (channel: ChannelEntity) => boolean;
};

export type ChannelSourceItem = {
  kind: 'channel';
  channelId: string;
  channel: ChannelEntity;
};

export type FavoriteSourceItem = {
  kind: 'favorite';
  channelId: string;
  favorite: Favorite;
};

export type ChannelsSourceItem = ChannelSourceItem | FavoriteSourceItem;

export type ChannelsDataSource<
  TItem extends ChannelsSourceItem = ChannelsSourceItem,
> = ListDataSource<TItem>;

export type ChannelsSources = {
  favorites: ChannelsDataSource<FavoriteSourceItem>;
  channels: ChannelsDataSource<ChannelSourceItem>;
  direct_messages: ChannelsDataSource<ChannelSourceItem>;
  recents: ChannelsDataSource<ChannelSourceItem>;
};

const CHANNEL_FAVORITES_PARAMS = {
  entityType: ['channel'],
} satisfies ListFavoritesParams;

export const CHANNELS_QUERY_DEFINITIONS = {
  recents: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'updated_at' },
    filters: defineQueryFilters({
      include: {
        channelImportance: true,
        channelIsParticipant: [true],
      },
    }),
    matches: channelHasMessages,
  },
  channels: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'created_at' },
    filters: defineQueryFilters({
      include: { channelIsParticipant: [true] },
      exclude: { channelType: ['direct_message'] },
    }),
    matches: (channel) => !isDirectMessage(channel),
  },
  direct_messages: {
    params: { ...CHANNELS_QUERY_PARAMS, sort_method: 'updated_at' },
    filters: defineQueryFilters({
      include: {
        channelType: ['direct_message'],
        channelIsParticipant: [true],
      },
    }),
    matches: isDirectMessage,
  },
} satisfies Record<ChannelsQueryScope, ChannelsQueryDefinition>;

export function channelsQueryArgs(
  scope: ChannelsQueryScope
): SoupAstItemsQueryArgs {
  const definition = CHANNELS_QUERY_DEFINITIONS[scope];

  return {
    params: definition.params,
    body: compileToAst(queryStateFrom(definition.filters)),
  };
}

export function filterChannelsForScope(
  scope: ChannelsQueryScope,
  channels: readonly ChannelEntity[]
): ChannelEntity[] {
  return channels.filter(CHANNELS_QUERY_DEFINITIONS[scope].matches);
}

export function channelByIdQueryArgs(channelId: string): SoupAstItemsQueryArgs {
  return {
    params: {
      ...CHANNELS_QUERY_PARAMS,
      limit: 1,
      sort_method: 'created_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({
          include: { channelId: [channelId] },
        })
      )
    ),
  };
}

export function deduplicateChannelItems(
  collections: readonly (readonly ChannelSourceItem[])[]
): ChannelSourceItem[] {
  const itemsByChannelId = new Map<string, ChannelSourceItem>();

  for (const items of collections) {
    for (const item of items) {
      if (!itemsByChannelId.has(item.channelId)) {
        itemsByChannelId.set(item.channelId, item);
      }
    }
  }

  return [...itemsByChannelId.values()];
}

export function resolveSelectedChannel(
  selectedChannelId: string | undefined,
  loadedItems: readonly ChannelSourceItem[],
  fallbackEntities: readonly EntityData[] = []
): ChannelEntity | undefined {
  if (selectedChannelId === undefined) return;

  return (
    loadedItems.find((item) => item.channelId === selectedChannelId)?.channel ??
    fallbackEntities.find(
      (entity): entity is ChannelEntity =>
        isChannelEntity(entity) && entity.id === selectedChannelId
    )
  );
}

function useChannelsDataSource(
  scope: ChannelsQueryScope,
  enabled: Accessor<boolean>
): ChannelsDataSource<ChannelSourceItem> {
  const query = useSoupAstItemsQuery(
    () => channelsQueryArgs(scope),
    () => ({ enabled: enabled(), staleTime: 30_000 })
  );
  const items = createMemo<ChannelSourceItem[]>((previous) => {
    if (!query.isEnabled || query.isLoading) return previous;

    const channels = filterChannelsForScope(
      scope,
      (query.data?.entities ?? []).filter(isChannelEntity)
    );

    const orderedChannels =
      scope === 'direct_messages'
        ? channels
            .slice()
            .sort((left, right) =>
              compareDateDesc(left.updatedAt, right.updatedAt)
            )
        : channels;

    return orderedChannels.map((channel) => ({
      kind: 'channel',
      channelId: channel.id,
      channel,
    }));
  }, []);

  return {
    items,
    isLoading: () => query.isEnabled && query.isLoading && items().length === 0,
    isFetching: () => query.isEnabled && query.isFetching,
    error: () => (query.isEnabled ? (query.error ?? undefined) : undefined),
    hasMore: () => query.isEnabled && query.hasNextPage,
    isLoadingMore: () => query.isEnabled && query.isFetchingNextPage,
    loadMore: async () => {
      if (!query.isEnabled || query.isFetchingNextPage || !query.hasNextPage) {
        return;
      }

      await query.fetchNextPage();
    },
    refresh: async () => {
      if (!query.isEnabled) return;
      await query.refresh();
    },
  };
}

function useFavoritesDataSource(
  enabled: Accessor<boolean>
): ChannelsDataSource<FavoriteSourceItem> {
  const query = useFavoritesQuery(CHANNEL_FAVORITES_PARAMS, { enabled });
  const items = createMemo<FavoriteSourceItem[]>((previous) => {
    if (!query.isSuccess) return previous;
    return query.data.favorites.map((favorite) => ({
      kind: 'favorite',
      channelId: favorite.entityId,
      favorite,
    }));
  }, []);

  return {
    items,
    isLoading: () => enabled() && query.isLoading && items().length === 0,
    isFetching: () => enabled() && query.isFetching,
    error: () => (enabled() ? (query.error ?? undefined) : undefined),
    hasMore: () => false,
    isLoadingMore: () => false,
    loadMore: () => Promise.resolve(),
    refresh: async () => {
      if (enabled()) await query.refetch();
    },
  };
}

export function useChannelsSources(
  enabled: (scope: ChannelsRailScope) => boolean
): ChannelsSources {
  return {
    favorites: useFavoritesDataSource(() => enabled('favorites')),
    channels: useChannelsDataSource('channels', () => enabled('channels')),
    direct_messages: useChannelsDataSource('direct_messages', () =>
      enabled('direct_messages')
    ),
    recents: useChannelsDataSource('recents', () => enabled('recents')),
  };
}

export function useChannelByIdQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useSoupAstItemsQuery(
    () => channelByIdQueryArgs(channelId() ?? ''),
    () => ({ enabled: enabled(), staleTime: 30_000 })
  );
}
