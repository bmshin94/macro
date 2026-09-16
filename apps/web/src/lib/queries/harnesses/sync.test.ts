import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock('./harnesses', () => ({ invalidateHarnesses: mocks.invalidate }));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: mocks.add, removeEventListener: mocks.remove },
  createConnectionWebsocketEffect: mocks.subscribe,
}));

import { createHarnessPresenceSync } from './sync';

beforeEach(() => vi.clearAllMocks());

it('refreshes on presence events, not unrelated messages', () => {
  let receive!: (message: { type: string }) => void;
  mocks.subscribe.mockImplementation((callback) => {
    receive = callback;
  });
  const dispose = createRoot((dispose) => {
    createHarnessPresenceSync();
    return dispose;
  });
  receive({ type: 'comms_message' });
  expect(mocks.invalidate).not.toHaveBeenCalled();
  receive({ type: 'harnesses_invalidation' });
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  dispose();
});

it('refreshes on socket open to recover missed events and cleans up', () => {
  const dispose = createRoot((dispose) => {
    createHarnessPresenceSync();
    return dispose;
  });
  expect(mocks.add).toHaveBeenCalledWith(
    WebsocketEvent.Open,
    expect.any(Function)
  );
  const refresh = mocks.add.mock.calls[0][1];
  refresh();
  expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  dispose();
  expect(mocks.remove).toHaveBeenCalledWith(WebsocketEvent.Open, refresh);
});
