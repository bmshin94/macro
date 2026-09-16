import type { FoldedMessage } from '@service-agent-fold/generated/types';

export function transcriptMessageKey(
  message: Pick<FoldedMessage, 'agentSessionId' | 'turn' | 'author'>
): string {
  return `${message.agentSessionId}:${message.turn}:${message.author.kind}`;
}

/**
 * The message that should sit at the top of the viewport when the transcript
 * is pinned to the end: the user prompt of the latest turn, or the first
 * message of that turn when the prompt has not landed yet.
 */
export function lastTurnStartKey(
  messages: readonly FoldedMessage[]
): string | undefined {
  const last = messages.at(-1);
  if (!last) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.turn !== last.turn)
      return transcriptMessageKey(messages[i + 1]);
    if (message.author.kind === 'user') return transcriptMessageKey(message);
  }
  return transcriptMessageKey(messages[0]);
}
