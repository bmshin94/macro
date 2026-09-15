import {
  AgentChangesProvider,
  AgentChangesSplit,
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from '@app/features/agent-changes/agent-changes';
import { AgentComposer } from '@app/features/block-agent/component/AgentComposer';
import { Transcript } from '@app/features/block-agent/component/Transcript';
import {
  AgentSessionProvider,
  useAgentSession,
} from '@app/features/block-agent/context/AgentSessionContext';
import {
  forgetPendingSession,
  pendingSession,
} from '@app/features/block-agent/context/pending-session';
import { LoadErrorPanel } from '@core/component/EntityLoadGate';
import { onCleanup, Show } from 'solid-js';

function AgentSessionContent() {
  const { loadFailed, loadRetryable, metadata, retryLoad, session } =
    useAgentSession();

  return (
    <>
      <header class="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <h2 class="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {metadata()?.title ?? session()?.name ?? 'New Chat'}
        </h2>
        <ChangesToggle />
      </header>
      <Show
        when={!loadFailed()}
        fallback={
          <LoadErrorPanel
            title="Unable to load this session"
            onRetry={loadRetryable() ? retryLoad : undefined}
          />
        }
      >
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <Transcript />
        </div>
        <div class="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-4 pb-4">
          <ChangesHandoff />
          <ReviewNotesDock />
          <AgentComposer autofocus />
        </div>
      </Show>
    </>
  );
}

export function AgentSessionPane(props: {
  id: string;
  onSessionId: (sessionId: string) => void;
}) {
  const pending = pendingSession(props.id);
  onCleanup(() => {
    if (pending?.sessionId() || pending?.failed()) {
      forgetPendingSession(props.id);
    }
  });

  return (
    <AgentSessionProvider blockId={props.id} onSessionId={props.onSessionId}>
      <AgentChangesProvider>
        <AgentChangesSplit>
          <AgentSessionContent />
        </AgentChangesSplit>
      </AgentChangesProvider>
    </AgentSessionProvider>
  );
}
