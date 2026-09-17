import type { Completion } from '@core/client/completion';
import type { ThreadId } from '@core/comments/commentType';
import type { Accessor } from 'solid-js';
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import type { IHighlight } from '../model/Highlight';
import { getPdfAnchors, getPdfComments } from '../queries/annotations';
import type { HighlightPageMap, HighlightUuidMap } from '../store/highlight';
import type { CommentStore } from '../type/comments';
import {
  type IPlaceable,
  PayloadMode,
  type PayloadType,
} from '../type/placeables';

export function createPdfDocumentState(documentId: Accessor<string>) {
  const generalPopupLocation = createSignal<{
    pageIndex: number;
    element: HTMLElement;
    hasHighlight?: boolean;
    hasComment?: boolean;
  } | null>(null);

  const disableOverlayClick = createSignal(false);
  const disableViewerTextSelection = createSignal(false);
  const disablePageViewClick = createSignal(false);
  const isSelectingViewerText = createSignal(false);
  const selectingCommentThread = createSignal<number | null>(null);

  const placeableMode = createSignal<PayloadType>(PayloadMode.NoMode);
  const activePlaceableId = createSignal<string>();
  const newPlaceable = createSignal<IPlaceable>();

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
  const popupSelectedText = createSignal<string>();
  const popupCompletion = createSignal<Completion>();
  const isPopupDrag = createSignal(false);

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

  createEffect(() => {
    const disabled =
      placeableMode[0]() !== PayloadMode.NoMode || isSelectingViewerText[0]();
    disableOverlayClick[1](disabled);
  });
  createEffect(() => {
    if (isSelectingViewerText[0]()) selectingCommentThread[1](null);
  });
  createEffect(() => {
    disableViewerTextSelection[1](selectingCommentThread[0]() != null);
  });
  return {
    signals: {
      generalPopupLocation,
      disableOverlayClick,
      disableViewerTextSelection,
      disablePageViewClick,
      isSelectingViewerText,
      selectingCommentThread,
      placeableMode,
      activePlaceableId,
      newPlaceable,
      activeHighlight,
      hoverHighlight,
      popupSelectedText,
      popupCompletion,
      isPopupDrag,
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
