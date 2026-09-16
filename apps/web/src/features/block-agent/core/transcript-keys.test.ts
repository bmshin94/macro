import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import { lastTurnStartKey, transcriptMessageKey } from './transcript-keys';

const message = (
  turn: number,
  author: FoldedMessage['author']
): FoldedMessage =>
  ({
    agentSessionId: 'session',
    turn,
    author,
    parts: [{ kind: 'text', text: 'hello' }],
    stop: null,
  }) as FoldedMessage;

describe('transcript keys', () => {
  it('returns nothing for an empty transcript', () => {
    expect(lastTurnStartKey([])).toBeUndefined();
  });

  it('pins an agent-only first turn from its first message', () => {
    const first = message(0, { kind: 'agent' });
    expect(lastTurnStartKey([first])).toBe(transcriptMessageKey(first));
  });

  it('pins from the user prompt when the latest turn has both sides', () => {
    const user = message(1, { kind: 'user', userId: 'owner' });
    const agent = message(1, { kind: 'agent' });
    expect(
      lastTurnStartKey([
        message(0, { kind: 'user', userId: 'owner' }),
        message(0, { kind: 'agent' }),
        user,
        agent,
      ])
    ).toBe(transcriptMessageKey(user));
  });

  it('pins a just-sent prompt before the agent message exists', () => {
    const user = message(2, { kind: 'user', userId: 'owner' });
    expect(
      lastTurnStartKey([
        message(1, { kind: 'user', userId: 'owner' }),
        message(1, { kind: 'agent' }),
        user,
      ])
    ).toBe(transcriptMessageKey(user));
  });
});
