import { usePdfCommentRealtimeBehavior } from '@block-pdf/store/commentsResource';
import { createEffect } from 'solid-js';
import { usePdfComments } from '../../context/pdf-comments-context';
import {
  useDeleteNewComments,
  useScrollToCommentThread,
} from './commentOperations';

const useDeleteNewCommentEffect = () => {
  const deleteNewComments = useDeleteNewComments();
  const activeCommentThreadId = usePdfComments().activeThreadId;

  createEffect(() => {
    const activeThreadId = activeCommentThreadId();
    if (!activeThreadId || activeThreadId !== -1) {
      deleteNewComments();
    }
  });
};

const useScrollToActiveThreadEffect = () => {
  const scrollToCommentThread = useScrollToCommentThread();
  const commentsContext = usePdfComments();
  const comments = commentsContext.all;
  const activeCommentThreadId = commentsContext.activeThreadId;
  const activeThreadScrollingSuppressed = commentsContext.scrollingSuppressed;

  createEffect(() => {
    if (activeThreadScrollingSuppressed()) return;

    const activeThreadId = activeCommentThreadId();
    if (activeThreadId == null) return;

    if (!comments().some((comment) => comment.threadId === activeThreadId)) {
      return;
    }

    scrollToCommentThread(activeThreadId);
  });
};

export const usePdfCommentEffects = () => {
  usePdfCommentRealtimeBehavior();
  useDeleteNewCommentEffect();
  useScrollToActiveThreadEffect();
};
