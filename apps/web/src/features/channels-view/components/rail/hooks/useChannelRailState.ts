import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { isMutedItem } from '@entity/utils/notification';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { ChannelsSources } from '../../../queries';
import type {
  ChannelsGroup,
  ChannelsQueryScope,
  ChannelsRailScope,
} from '../../../types';
import {
  domIdForRow,
  rowKeyForChannel,
  rowKeyForSection,
  useChannelsRail,
} from '../ChannelsRailContext';

const LOAD_MORE_THRESHOLD = 300;

export function useChannelRailItemState(
  channelId: Accessor<string>,
  group?: Accessor<ChannelsGroup | undefined>
) {
  const rail = useChannelsRail();
  const notificationSource = useGlobalNotificationSource();

  return createMemo(() => {
    const id = channelId();
    const rowId = rowKeyForChannel(id, group?.());

    return {
      domId: domIdForRow(rail.railId, rowId),
      selected: rail.selectedChannelId() === id,
      focused: rail.list.focus.key() === rowId,
      muted: isMutedItem(notificationSource.mutedEntities(), {
        item_id: id,
        item_type: 'channel',
      }),
      unread: rail.channelActivity.unreadChannelIds().has(id),
      callStatus: rail.channelActivity.callStatuses().get(id),
      incomingCallId: rail.channelActivity.incomingCallIds().get(id),
    };
  });
}

export function useChannelRailScopeState(scope: Accessor<ChannelsQueryScope>) {
  const rail = useChannelsRail();

  return createMemo(() => {
    const currentScope = scope();
    const source = rail.sources[currentScope];
    const items = source.items();
    const focusedRow = rail.list.focus.item();
    const focusedIndex =
      focusedRow?.kind === 'conversation' && focusedRow.scope === currentScope
        ? focusedRow.localIndex
        : -1;
    const targetChannelId =
      currentScope === 'recents'
        ? undefined
        : rail.channelActivity.targetChannelId(currentScope);
    const activityIndex =
      targetChannelId === undefined
        ? -1
        : items.findIndex((item) => item.channelId === targetChannelId);
    const keepMounted = [...new Set([focusedIndex, activityIndex])].filter(
      (index) => index >= 0
    );

    return {
      items,
      source,
      focusedIndex,
      activityIndex,
      keepMounted: keepMounted.length > 0 ? keepMounted : undefined,
    };
  });
}

export function useChannelRailVirtualizer(scope: Accessor<ChannelsRailScope>) {
  const rail = useChannelsRail();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  let unregister: (() => void) | undefined;

  const registerVirtualizer = (handle?: VirtualizerHandle) => {
    unregister?.();
    unregister = undefined;
    setVirtualizer(handle);

    if (handle) {
      unregister = rail.registerVirtualizer(scope(), handle);
    }
  };

  onCleanup(() => unregister?.());

  const loadMoreNearEnd = (offset?: number) => {
    const handle = virtualizer();
    if (!handle) return;

    const currentScope = scope();
    const source = rail.sources[currentScope];
    const distance =
      handle.scrollSize - handle.viewportSize - (offset ?? handle.scrollOffset);
    if (
      distance >= LOAD_MORE_THRESHOLD ||
      source.isLoadingMore() ||
      !source.hasMore()
    ) {
      return;
    }

    void source.loadMore();
  };

  return { registerVirtualizer, loadMoreNearEnd };
}

export function useChannelRailSectionState<Group extends ChannelsGroup>(
  group: Accessor<Group>
) {
  const rail = useChannelsRail();
  const scope = createMemo(() => {
    const currentGroup = group();
    const source: ChannelsSources[Group] = rail.sources[currentGroup];
    const items = source.items();
    const focusedRow = rail.list.focus.item();
    const focusedIndex =
      focusedRow?.kind === 'conversation' && focusedRow.scope === currentGroup
        ? focusedRow.localIndex
        : -1;
    const targetChannelId =
      currentGroup === 'favorites'
        ? undefined
        : rail.channelActivity.targetChannelId(currentGroup);
    const activityIndex =
      targetChannelId === undefined
        ? -1
        : items.findIndex((item) => item.channelId === targetChannelId);
    const keepMounted = [...new Set([focusedIndex, activityIndex])].filter(
      (index) => index >= 0
    );

    return {
      items,
      source,
      focusedIndex,
      activityIndex,
      keepMounted: keepMounted.length > 0 ? keepMounted : undefined,
    };
  });
  const state = createMemo(() => {
    const section = group();
    const rowId = rowKeyForSection(section);
    const targetChannelId = rail.channelActivity.targetChannelId(section);

    return {
      ...scope(),
      open: rail.isGroupOpen(section),
      fillAvailable:
        section === 'direct_messages' &&
        !rail.isGroupOpen('favorites') &&
        !rail.isGroupOpen('channels'),
      focused: rail.list.focus.key() === rowId,
      containsFocus: rail.list.focus.item()?.group === section,
      domId: domIdForRow(rail.railId, rowId),
      unreadCount: rail.channelActivity.unreadCount(section),
      targetId:
        targetChannelId === undefined
          ? undefined
          : domIdForRow(
              rail.railId,
              rowKeyForChannel(targetChannelId, section)
            ),
      label: rail.channelActivity.targetLabel(section),
    };
  });

  const clearVisibleActivity = (visibleTargetId: string) => {
    const section = group();
    const targetChannelId = rail.channelActivity.targetChannelId(section);
    if (
      targetChannelId === undefined ||
      domIdForRow(rail.railId, rowKeyForChannel(targetChannelId, section)) !==
        visibleTargetId
    ) {
      return;
    }

    rail.channelActivity.clearTarget(section, targetChannelId);
  };

  return { state, clearVisibleActivity };
}
