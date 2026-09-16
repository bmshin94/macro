import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { describe, expect, it } from 'vitest';
import {
  messagesWithOptimistic,
  nextOptimisticTurn,
  unmatchedOptimistic,
} from './optimistic-prompts';

function user(
  text: string,
  requestId: string | null = null,
  turn = 0
): FoldedMessage {
  return {
    agentSessionId: 'session',
    turn,
    author: { kind: 'user', userId: null },
    requestId,
    parts: [{ kind: 'text', text }],
    stop: null,
  };
}

function agent(text: string, turn = 0): FoldedMessage {
  return {
    agentSessionId: 'session',
    turn,
    author: { kind: 'agent' },
    requestId: null,
    parts: [{ kind: 'text', text }],
    stop: { kind: 'end_turn' },
  };
}

describe('unmatchedOptimistic', () => {
  it('keeps an echo until the fold reports it', () => {
    expect(
      unmatchedOptimistic([{ clientId: 'c1', text: 'hello' }], [])
    ).toEqual([{ clientId: 'c1', text: 'hello' }]);
  });

  it('drops an echo once the fold has the same request id', () => {
    expect(
      unmatchedOptimistic(
        [{ clientId: 'c1', text: 'hello', requestId: 'action-1' }],
        [user('hello', 'action-1')]
      )
    ).toEqual([]);
  });

  it('drops an echo whose text the fold already shows', () => {
    expect(
      unmatchedOptimistic([{ clientId: 'c1', text: 'hello' }], [user('hello')])
    ).toEqual([]);
  });

  it('lets a second send of the same words stay until its own fold row arrives', () => {
    expect(
      unmatchedOptimistic(
        [
          { clientId: 'c1', text: 'hi', requestId: 'a1' },
          { clientId: 'c2', text: 'hi' },
        ],
        [user('hi', 'a1')]
      )
    ).toEqual([{ clientId: 'c2', text: 'hi' }]);
  });
});

describe('messagesWithOptimistic', () => {
  it('appends an echo after the last real turn', () => {
    const messages = messagesWithOptimistic(
      [user('first', 'a0', 0), agent('ok', 0)],
      [{ clientId: 'c1', text: 'next' }],
      'session'
    );
    expect(nextOptimisticTurn([user('first', 'a0', 0), agent('ok', 0)])).toBe(
      1
    );
    expect(messages.at(-1)).toMatchObject({
      turn: 1,
      author: { kind: 'user' },
      requestId: 'c1',
      parts: [{ kind: 'text', text: 'next' }],
    });
  });

  it('uses turn 0 when the transcript is empty', () => {
    expect(
      messagesWithOptimistic([], [{ clientId: 'c1', text: 'boot' }], 'pending')
    ).toMatchObject([
      {
        agentSessionId: 'pending',
        turn: 0,
        requestId: 'c1',
        parts: [{ kind: 'text', text: 'boot' }],
      },
    ]);
  });
});
