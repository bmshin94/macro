import { WebsocketEvent } from '@macro-inc/collaboration/websocket';
import {
  createConnectionWebsocketEffect,
  ws,
} from '@service-connection/websocket';
import { onCleanup } from 'solid-js';
import { invalidateHarnesses } from './harnesses';

/** Subscribe to presence changes, including changes missed while disconnected. */
export function createHarnessPresenceSync() {
  const refresh = () => {
    void invalidateHarnesses();
  };
  ws.addEventListener(WebsocketEvent.Open, refresh);
  onCleanup(() => ws.removeEventListener(WebsocketEvent.Open, refresh));
  createConnectionWebsocketEffect((message) => {
    if (message.type === 'harnesses_invalidation') refresh();
  });
}
