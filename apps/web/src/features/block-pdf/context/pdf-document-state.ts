import type { ThreadId } from '@core/comments/commentType';
import type { Accessor } from 'solid-js';
import { createMemo, createResource, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { IHighlight } from '../model/Highlight';
import { getPdfAnchors, getPdfComments } from '../queries/annotations';
import type { HighlightPageMap, HighlightUuidMap } from '../store/highlight';
import type { CommentStore } from '../type/comments';

export function createPdfDocumentState(documentId: Accessor<string>) {
  const highlights = createStore<HighlightPageMap>({});
  const selection = createStore<{
    highlightsUnderSelection: IHighlight[];
    selection: Selection | null;
  }>({
    highlightsUnderSelection: [],
    selection: null,
  });
  const activeHighlight = createSignal<string | null>(null);
  const hoverHighlight = createSignal<string | null>(null);

  const convertedHighlightThreadId = createSignal<string | null>(null);
  const activeCommentThread = createSignal<ThreadId | null>(null);
  const noScrollToActiveCommentThread = createSignal(false);
  const comments = createStore<CommentStore>([]);

  const commentThreads = createResource(documentId, getPdfComments);
  const anchors = createResource(documentId, getPdfAnchors);

  const highlightsUuidMap = createMemo(() => {
    const result: HighlightUuidMap = {};
    for (const pageHighlights of Object.values(highlights[0] ?? {})) {
      if (!pageHighlights) continue;
      for (const [uuid, highlight] of Object.entries(pageHighlights)) {
        result[uuid] = highlight;
      }
    }
    return result;
  });
  const commentMap = createMemo(() => {
    const result = new Map<number, CommentStore[number]>();
    for (const comment of comments[0]) result.set(comment.id, comment);
    return result;
  });

  return {
    signals: {
      activeHighlight,
      hoverHighlight,
      convertedHighlightThreadId,
      activeCommentThread,
      noScrollToActiveCommentThread,
    },
    stores: {
      highlights,
      selection,
      comments,
    },
    resources: {
      commentThreads,
      anchors,
    },
    derived: {
      highlightsUuidMap,
      commentMap,
    },
  };
}

export type PdfDocumentState = ReturnType<typeof createPdfDocumentState>;
