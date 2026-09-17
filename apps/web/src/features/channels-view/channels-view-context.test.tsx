import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelsViewContext,
  ChannelsViewProvider,
  useChannelsView,
} from './channels-view-context';

const entry = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  captors: new Map<string, () => unknown>(),
}));
const touch = vi.hoisted(() => ({ value: false }));
const guard = vi.hoisted(() => ({
  selections: [] as unknown[],
  allow: true,
}));

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'alice' }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.value,
}));
vi.mock('@components/app/createPreviewSelectionGuard', () => ({
  createPreviewSelectionGuard: () => (selection: unknown) => {
    guard.selections.push(selection);
    return selection === undefined || guard.allow;
  },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => entry.state,
      registerEntryStateCaptor: (key: string, capture: () => unknown) => {
        entry.captors.set(key, capture);
        return () => entry.captors.delete(key);
      },
    },
  }),
}));

function mountProvider() {
  let context!: ChannelsViewContext;
  function ReadContext() {
    context = useChannelsView();
    return null;
  }
  const view = render(() => (
    <ChannelsViewProvider>
      <ReadContext />
    </ChannelsViewProvider>
  ));
  return { ...view, context };
}

beforeEach(() => {
  localStorage.clear();
  entry.state = {};
  entry.captors.clear();
  touch.value = false;
  guard.selections = [];
  guard.allow = true;
});
afterEach(cleanup);

describe('ChannelsViewProvider preview selection', () => {
  it('claims the selected channel as an inline preview on desktop', () => {
    guard.allow = false;
    const { context } = mountProvider();

    context.setSelectedChannelId('c1');

    expect(guard.selections.at(-1)).toEqual({ type: 'channel', id: 'c1' });
    expect(context.state.selectedChannelId).toBeUndefined();
  });

  it('keeps touch selections out of the preview registry', () => {
    touch.value = true;
    guard.allow = false;
    const { context } = mountProvider();

    context.setSelectedChannelId('c1');

    expect(context.mobileLayout()).toBe(true);
    expect(guard.selections.at(-1)).toBeUndefined();
    expect(context.state.selectedChannelId).toBe('c1');
  });
});
