import {
  type Accessor,
  createContext,
  createMemo,
  type FlowComponent,
  useContext,
} from 'solid-js';
import type { CommentStore } from '../type/comments';

type PdfCommentsContextValue = {
  all: Accessor<CommentStore>;
  byId: Accessor<Map<number, CommentStore[number]>>;
};

const PdfCommentsContext = createContext<PdfCommentsContextValue>();

export const PdfCommentsProvider: FlowComponent<{
  comments: Accessor<CommentStore>;
}> = (props) => {
  const byId = createMemo(() => {
    const comments = new Map<number, CommentStore[number]>();
    for (const comment of props.comments()) comments.set(comment.id, comment);
    return comments;
  });

  return (
    <PdfCommentsContext.Provider value={{ all: props.comments, byId }}>
      {props.children}
    </PdfCommentsContext.Provider>
  );
};

export function usePdfComments() {
  const context = useContext(PdfCommentsContext);
  if (!context) {
    throw new Error('usePdfComments must be used within PdfCommentsProvider');
  }
  return context;
}
