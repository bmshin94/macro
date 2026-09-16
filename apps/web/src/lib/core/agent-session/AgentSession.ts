/**
 * One live agent session: the fold machine, the realtime rows that feed it,
 * and the REST calls that act on it, behind one object with one event stream.
 *
 * Framework-free. A surface acquires the session for the ids it shows and
 * releases it on unmount; every surface showing the same session shares one
 * instance, so the log is fetched once, folded once, and speculated once.
 *
 * Speculation lives in the machine, not here. `issue` folds an action the
 * moment it is sent and the machine promotes it when the log confirms it,
 * rebases it when a foreign row lands first, and drops it if this class
 * retracts it. Listeners only ever see fold events; whether a message is
 * still on the wire is a field on the message, never a second channel.
 */

import {
  closeSession,
  type FoldInput,
  pushSession,
  readSession,
  type SessionFoldSnapshot,
} from '@core/agent-fold/client';
import { subscribeSocketSessionStarted } from '@queries/agent-session/queue-sync';
import {
  type AgentSessionLogEvent,
  entryOf,
} from '@queries/agent-session/realtime-protocol';
import type { FoldedStreamEvent } from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentAction,
  AgentSessionResponse,
  ControlRequest,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { v7 as uuidv7 } from 'uuid';

export type AgentSessionListener = (events: FoldedStreamEvent[]) => void;

/** The session row and the bot it runs as, once the load resolved. */
export type AgentSessionRecord = {
  session: AgentSessionResponse;
  bot: SessionBot;
};

export type IssueResult = Awaited<
  ReturnType<typeof agentHarnessServiceClient.control>
>;

/**
 * The control body with the id the client speculated under. The harness
 * adopts the id when it accepts client-minted ids and ignores it otherwise;
 * either way the response names the id the action was accepted under, and
 * `issue` reconciles the two.
 */
type ControlRequestWithId = ControlRequest & { actionId: string };

export class AgentSession {
  private static readonly open = new Map<string, AgentSession>();

  /**
   * The shared instance for `id`, created on first acquisition. Every
   * acquisition needs a matching {@link release}; the last one closes the
   * machine and drops the subscriptions.
   */
  static acquire(id: string): AgentSession {
    const session = AgentSession.open.get(id) ?? new AgentSession(id);
    AgentSession.open.set(id, session);
    session.references += 1;
    return session;
  }

  /** The open instance for `id`, for a caller that only wants to act on it. */
  static get(id: string): AgentSession | undefined {
    return AgentSession.open.get(id);
  }

  /**
   * Realtime ingress: one persisted row, addressed by session. The socket
   * dispatch and the replay driver both call this; a session nobody has open
   * ignores it.
   */
  static ingest(event: AgentSessionLogEvent): void {
    AgentSession.open
      .get(event.agentSessionId)
      ?.enqueue({ kind: 'confirmed', row: entryOf(event) });
  }

  readonly id: string;

  private references = 0;
  private closed = false;
  /** The snapshot has been folded; inputs no longer wait for it. */
  private ready = false;
  /** Inputs that arrived before the snapshot, in order. */
  private buffered: FoldInput[] = [];
  private readonly listeners = new Set<AgentSessionListener>();
  private readonly unsubscribeSocket: () => void;
  /**
   * Serializes worker pushes so inputs reach the machine in the order this
   * class saw them, even though each push is its own await.
   */
  private chain: Promise<void> = Promise.resolve();
  private loading: Promise<AgentSessionRecord>;
  private loadFailed = false;

  private constructor(id: string) {
    this.id = id;
    // Subscribed before the fetch so no row between the two is lost: rows
    // that arrive during the load are buffered and folded after the snapshot.
    this.unsubscribeSocket = subscribeSocketSessionStarted(() => {
      void this.resync();
    });
    this.loading = this.startLoad();
  }

  /**
   * The load: the session row and the log, fetched and folded. Resolves to
   * the same record for every caller; a load that failed is re-run by the
   * next call, which is how a surface's Retry works.
   */
  load(): Promise<AgentSessionRecord> {
    if (this.loadFailed) {
      this.loadFailed = false;
      this.loading = this.startLoad();
    }
    return this.loading;
  }

  /**
   * Do something to the agent. The action is folded before the harness
   * answers, so its effect is visible at once: a prompt as a pending bubble,
   * a stop as a pending Stopped line, a model change as a pending control.
   * The harness's answer settles it: accepted under the same id, the
   * confirmed row promotes it in place; accepted under another id, the
   * speculation is reissued under that one; refused, it is retracted.
   *
   * `userId` is the caller, so the pending bubble is attributed exactly as
   * the confirmed row will be.
   */
  async issue(
    action: AgentAction,
    options: { userId?: string } = {}
  ): Promise<IssueResult> {
    // An elicitation answer rides on the agent's own request id: nothing this
    // client mints reaches the wire, so there is nothing to speculate.
    const speculatable = action.type !== 'respondElicitation';
    const actionId = uuidv7();
    if (speculatable) {
      void this.enqueue({
        kind: 'speculated',
        actionId,
        action,
        userId: options.userId,
      });
    }

    const request: ControlRequestWithId = { ...action, actionId };
    const result = await agentHarnessServiceClient.control(this.id, request);

    if (!speculatable) return result;
    if (result.isErr()) {
      void this.enqueue({ kind: 'retracted', actionId });
      return result;
    }
    // A stop is a notification and carries no id on the wire, so the log
    // confirms it by content whatever id the harness accepted it under.
    const accepted = result.value.actionId;
    if (accepted !== actionId && action.type !== 'stop') {
      void this.apply([
        { kind: 'retracted', actionId },
        {
          kind: 'speculated',
          actionId: accepted,
          action,
          userId: options.userId,
        },
      ]);
    }
    return result;
  }

  /** Fold events, in order. The only way anything about the fold is observed. */
  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Everything the machine holds right now, for a listener that joined late.
   * Ordered after every input pushed so far, so a caller that subscribes
   * first and reads second misses nothing and double-applies nothing worse
   * than a message it already holds.
   */
  snapshot(): Promise<SessionFoldSnapshot> {
    return this.chain.then(() => readSession(this.id));
  }

  release(): void {
    this.references -= 1;
    if (this.references > 0) return;
    if (AgentSession.open.get(this.id) === this)
      AgentSession.open.delete(this.id);
    this.closed = true;
    this.listeners.clear();
    this.unsubscribeSocket();
    closeSession(this.id);
  }

  private startLoad(): Promise<AgentSessionRecord> {
    return this.fetchAndFold().catch((error: unknown) => {
      this.loadFailed = true;
      throw error;
    });
  }

  private async fetchAndFold(): Promise<AgentSessionRecord> {
    const [session, log] = await Promise.all([
      agentHarnessServiceClient.get(this.id),
      agentHarnessServiceClient.getLog(this.id),
    ]);
    if (session.isErr()) {
      throw new Error(`agent session could not be fetched: ${this.id}`);
    }
    if (log.isErr()) {
      throw new Error(`agent session log could not be fetched: ${this.id}`);
    }
    if (this.closed) throw new Error(`agent session released: ${this.id}`);

    await this.apply([{ kind: 'snapshot', rows: log.value.entries }]);
    // Inputs can keep arriving while each push is in flight; drain until a
    // check finds nothing, then flip ready so the next one goes straight in.
    while (this.buffered.length > 0) {
      const inputs = this.buffered;
      this.buffered = [];
      await this.apply(inputs);
    }
    this.ready = true;
    return { session: session.value, bot: log.value.bot };
  }

  /**
   * A reopened socket is a new socket session: rows may have been missed
   * while it was down. Refetch, and let the machine reconcile the overlap
   * and settle any speculation the log confirmed meanwhile.
   */
  private async resync(): Promise<void> {
    if (!this.ready || this.closed) return;
    const log = await agentHarnessServiceClient.getLog(this.id);
    if (log.isErr() || this.closed) return;
    await this.apply([{ kind: 'snapshot', rows: log.value.entries }]);
  }

  private enqueue(input: FoldInput): Promise<void> {
    if (!this.ready) {
      this.buffered.push(input);
      return Promise.resolve();
    }
    return this.apply([input]);
  }

  private apply(inputs: FoldInput[]): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.closed) return;
      const events = await pushSession(this.id, inputs);
      if (this.closed || events.length === 0) return;
      for (const listener of this.listeners) listener(events);
    });
    // A failed push must not poison the chain for every input after it.
    this.chain = run.catch((error: unknown) => {
      console.error('[agent-session] fold input could not be applied', error);
    });
    return this.chain;
  }
}
