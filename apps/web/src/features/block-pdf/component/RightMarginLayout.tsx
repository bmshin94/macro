import {
  GUTTER_MARGIN,
  MIN_RIGHT_COLUMN_WIDTH,
  THREAD_WIDTH,
} from '@block-pdf/signal/viewerThreeColumnLayout';
import { usePageCommentLayout } from '@block-pdf/store/comments/commentLayout';
import {
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '@block-pdf/store/comments/commentOperations';
import {
  baseCommentTheme,
  CommentsContext,
  type CommentsContextType,
  Thread,
} from '@core/comments/Thread';
import { useUserId } from '@core/context/user';
import { createSelector, For } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';

const rightMarginStyle = {
  minWidth: `${MIN_RIGHT_COLUMN_WIDTH}px`,
  width: `${THREAD_WIDTH - GUTTER_MARGIN * 2}px`,
  right: `${-THREAD_WIDTH + GUTTER_MARGIN}px`,
};

export function RightMarginLayout(props: { pageIndex: number }) {
  return (
    <div
      class="rightMargin absolute [transition: width 0.05s linear, right 0.05s linear]"
      style={rightMarginStyle}
    >
      <CommentsAndSuggestions pageIndex={props.pageIndex} />
    </div>
  );
}

const useCommentsContext = (
  setThreadHeight: CommentsContextType['setThreadHeight']
): CommentsContextType => {
  const pdf = usePdfDocument();
  const { signals, derived } = pdf.state;
  const setActiveThread = signals.activeCommentThread[1];

  const createComment = useCreateComment();
  const updateComment = useUpdateComment();
  const deleteComment = useDeleteComment();

  const userId = useUserId();
  const ownedComment = (id: number) => {
    const currentUserId = userId();
    return (
      currentUserId != null &&
      derived.commentMap()?.get(id)?.owner === currentUserId
    );
  };
  const getCommentById = (id: number) => derived.commentMap()?.get(id);

  const commentsContext: CommentsContextType = {
    setActiveThread,
    setThreadHeight,
    canComment: () => !pdf.isNested() && pdf.permissions.canComment(),
    isDocumentOwner: pdf.permissions.isOwner,
    getCommentById,
    documentId: pdf.documentId(),
    ownedComment,
    commentOperations: {
      createComment,
      deleteComment,
      updateComment,
    },
    inComment: true,
    highlightedCommentId: () => null,
  };

  return commentsContext;
};

function CommentsAndSuggestions(props: { pageIndex: number }) {
  const pdf = usePdfDocument();
  const { signals } = pdf.state;
  const { threads, setThreadHeight } = usePageCommentLayout(
    () => props.pageIndex
  );

  const [activeCommentThread, setActiveThreadId] = signals.activeCommentThread;
  const isActiveThreadSelector = createSelector(activeCommentThread);

  const isSelectingThreadSelector = createSelector(
    pdf.interaction.selectedCommentThread
  );

  const commentTheme = (threadId: number | null) => {
    const isSelecting = isSelectingThreadSelector(threadId);
    let theme = {
      ...baseCommentTheme,
      text: {
        ...baseCommentTheme.text,
        base: isSelecting ? 'select-text!' : 'select-none',
      },
    };
    return theme;
  };

  const handleThreadMouseDown = (threadId: number) => (e: MouseEvent) => {
    e.stopPropagation();
    pdf.interaction.commands.selectCommentThread(threadId);

    const handleMouseUp = (e: MouseEvent) => {
      e.stopPropagation();
      setActiveThreadId(threadId);
      document.removeEventListener('mouseup', handleMouseUp, true);
    };
    document.addEventListener('mouseup', handleMouseUp, true);
  };

  const commentsContext = useCommentsContext(setThreadHeight);

  return (
    <CommentsContext.Provider value={commentsContext}>
      <For each={threads()}>
        {(root) => (
          <Thread
            comment={root}
            layout={root.layout}
            isActive={isActiveThreadSelector(root.threadId)}
            theme={commentTheme(root.threadId)}
            handleMouseDown={handleThreadMouseDown(root.threadId)}
          />
        )}
      </For>
    </CommentsContext.Provider>
  );
}
