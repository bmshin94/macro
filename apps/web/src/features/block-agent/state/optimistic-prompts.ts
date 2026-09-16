/**
 * Client-side user prompts that must appear in the transcript before the
 * fold has them.
 *
 * A prompt POST can sit in the harness for the whole sandbox boot — Cursor
 * especially — and the session log stays empty until the runtime is live.
 * The composer therefore echoes the text immediately; this module is the
 * merge/dedupe so the echo drops the moment the fold reports the same
 * prompt, and a second send of the same words is not stolen by the first.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { lastTurnMessage } from './control-message';

export type OptimisticPrompt = {
  /** Stable client id, used as `requestId` until the control POST returns. */
  clientId: string;
  text: string;
  /** The control action id, once the service accepted the prompt. */
  requestId?: string;
};

function userText(message: FoldedMessage): string {
  return message.parts
    .filter(
      (
        part
      ): part is Extract<(typeof message.parts)[number], { kind: 'text' }> =>
        part.kind === 'text'
    )
    .map((part) => part.text)
    .join('');
}

/**
 * Echoes the fold has not claimed yet. Each folded user message claims at
 * most one echo: first by the control `requestId`, then by matching text,
 * so a repeated prompt does not hide the one still on the wire.
 */
export function unmatchedOptimistic(
  prompts: readonly OptimisticPrompt[],
  folded: readonly FoldedMessage[]
): OptimisticPrompt[] {
  const remaining = [...prompts];
  for (const message of folded) {
    if (message.author.kind !== 'user') continue;
    const byId = remaining.findIndex(
      (prompt) =>
        prompt.requestId !== undefined && prompt.requestId === message.requestId
    );
    if (byId >= 0) {
      remaining.splice(byId, 1);
      continue;
    }
    const text = userText(message);
    const byText = remaining.findIndex((prompt) => prompt.text === text);
    if (byText >= 0) remaining.splice(byText, 1);
  }
  return remaining;
}

/** The turn the next echoed prompt should occupy. */
export function nextOptimisticTurn(folded: readonly FoldedMessage[]): number {
  const last = lastTurnMessage(folded);
  return last === undefined ? 0 : last.turn + 1;
}

export function optimisticUserMessage(
  prompt: OptimisticPrompt,
  sessionId: string,
  turn: number
): FoldedMessage {
  return {
    agentSessionId: sessionId,
    turn,
    author: { kind: 'user', userId: null },
    requestId: prompt.requestId ?? prompt.clientId,
    parts: [{ kind: 'text', text: prompt.text }],
    stop: null,
  };
}

/** Folded messages plus any echoes the fold has not yet reported. */
export function messagesWithOptimistic(
  folded: readonly FoldedMessage[],
  prompts: readonly OptimisticPrompt[],
  sessionId: string
): FoldedMessage[] {
  const pending = unmatchedOptimistic(prompts, folded);
  if (pending.length === 0) return folded as FoldedMessage[];
  let turn = nextOptimisticTurn(folded);
  const extra = pending.map((prompt) => {
    const message = optimisticUserMessage(prompt, sessionId, turn);
    turn += 1;
    return message;
  });
  return [...folded, ...extra];
}
