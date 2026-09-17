import { usePdfDocument } from '@block-pdf/context/pdf-document-context';
import { usePdfCommentRealtimeBehavior } from '@block-pdf/store/commentsResource';
import { createEffect, createMemo } from 'solid-js';
import {
  useDeleteNewComments,
  useScrollToCommentThread,
} from './commentOperations';
import { useCommentStoreBehavior } from './commentStore';

const useDeleteNewCommentEffect = () => {
  const deleteNewComments = useDeleteNewComments();
  const [activeCommentThread] =
    usePdfDocument().state.signals.activeCommentThread;

  createEffect(() => {
    const activeThreadId = activeCommentThread();
    if (!activeThreadId || activeThreadId !== -1) {
      deleteNewComments();
    }
  });
};

const useScrollToActiveThreadEffect = () => {
  const scrollToCommentThread = useScrollToCommentThread();
  const { signals, stores } = usePdfDocument().state;
  const [comments] = stores.comments;
  const [activeCommentThread] = signals.activeCommentThread;
  const [noScrollToActiveCommentThread] = signals.noScrollToActiveCommentThread;
  const noScroll = createMemo(() => {
    return noScrollToActiveCommentThread();
  });
  const hasMatch = createMemo(() => {
    return comments.find((c) => c.threadId === activeCommentThread()) != null;
  });

  createEffect(() => {
    if (noScroll()) return;

    const activeThreadId = activeCommentThread();
    if (activeThreadId == null) return;

    if (!hasMatch()) return;

    scrollToCommentThread(activeThreadId);
  });
};

export const usePdfCommentEffects = () => {
  useCommentStoreBehavior();
  usePdfCommentRealtimeBehavior();
  useDeleteNewCommentEffect();
  useScrollToActiveThreadEffect();
};
