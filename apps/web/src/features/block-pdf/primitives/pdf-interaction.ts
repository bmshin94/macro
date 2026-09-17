import type { ThreadId } from '@core/comments/commentType';
import { type Accessor, batch, createSignal } from 'solid-js';
import type { IHighlight } from '../model/Highlight';
import { PayloadMode, type PayloadType } from '../type/placeables';

export type PdfSelectionMenuLocation = {
  pageIndex: number;
  element: HTMLElement;
};

export type PdfAnnotationSelection = {
  nativeSelection: Selection | null;
  selectedHighlights: IHighlight[];
};

export function createPdfInteraction(placementMode: Accessor<PayloadType>) {
  const [selectionMenuLocation, setSelectionMenuLocation] =
    createSignal<PdfSelectionMenuLocation | null>(null);
  const [annotationSelection, setAnnotationSelection] =
    createSignal<PdfAnnotationSelection>({
      nativeSelection: null,
      selectedHighlights: [],
    });
  const [activeHighlightId, setActiveHighlightId] = createSignal<string | null>(
    null
  );
  const [hoveredHighlightId, setHoveredHighlightId] = createSignal<
    string | null
  >(null);
  const [convertedHighlightThreadDraftId, setConvertedHighlightThreadDraftId] =
    createSignal<string | null>(null);
  const [activeCommentThreadId, setActiveCommentThreadId] =
    createSignal<ThreadId | null>(null);
  const [activeThreadScrollingSuppressed, setActiveThreadScrollingSuppressed] =
    createSignal(false);
  const [pageClicksDisabled, setPageClicksDisabled] = createSignal(false);
  const [viewerTextSelectionActive, setViewerTextSelectionActive] =
    createSignal(false);
  const [selectedCommentThread, setSelectedCommentThread] = createSignal<
    number | null
  >(null);

  const commands = {
    openSelectionMenu(location: PdfSelectionMenuLocation) {
      setSelectionMenuLocation(location);
    },
    closeSelectionMenu() {
      setSelectionMenuLocation(null);
    },
    setNativeSelection(nativeSelection: Selection) {
      setAnnotationSelection({
        nativeSelection,
        selectedHighlights: [],
      });
    },
    replaceSelectedHighlights(selectedHighlights: IHighlight[]) {
      setAnnotationSelection((previous) => ({
        ...previous,
        selectedHighlights,
      }));
    },
    resetSelection() {
      batch(() => {
        setSelectionMenuLocation(null);
        setAnnotationSelection({
          nativeSelection: null,
          selectedHighlights: [],
        });
        setActiveHighlightId(null);
      });
    },
    activateHighlight(uuid: string) {
      setActiveHighlightId(uuid);
    },
    clearActiveHighlight() {
      setActiveHighlightId(null);
    },
    hoverHighlight(uuid: string) {
      setHoveredHighlightId(uuid);
    },
    clearHoveredHighlight() {
      setHoveredHighlightId(null);
    },
    activateCommentThread(threadId: ThreadId) {
      setActiveCommentThreadId(threadId);
    },
    clearActiveCommentThread() {
      setActiveCommentThreadId(null);
    },
    markConvertedHighlightDraft(uuid: string) {
      setConvertedHighlightThreadDraftId(uuid);
    },
    clearConvertedHighlightDraft() {
      setConvertedHighlightThreadDraftId(null);
    },
    suppressActiveThreadScrolling() {
      setActiveThreadScrollingSuppressed(true);
    },
    restoreActiveThreadScrolling() {
      setActiveThreadScrollingSuppressed(false);
    },
    clearUserHighlightFocus() {
      batch(() => {
        setActiveCommentThreadId(null);
        setActiveHighlightId(null);
        setHoveredHighlightId(null);
      });
    },
    beginViewerTextSelection() {
      if (viewerTextSelectionActive()) return;
      batch(() => {
        setSelectedCommentThread(null);
        setViewerTextSelectionActive(true);
      });
    },
    endViewerTextSelection() {
      setViewerTextSelectionActive(false);
    },
    selectCommentThread(threadId: number) {
      setSelectedCommentThread(threadId);
    },
    clearSelectedCommentThread() {
      setSelectedCommentThread(null);
    },
    runWithPageClicksDisabled(operation: () => void) {
      setPageClicksDisabled(true);
      try {
        operation();
      } finally {
        setPageClicksDisabled(false);
      }
    },
  };

  return {
    selectionMenuLocation,
    annotationSelection,
    activeHighlightId,
    hoveredHighlightId,
    convertedHighlightThreadDraftId,
    activeCommentThreadId,
    activeThreadScrollingSuppressed,
    overlayClicksDisabled: () =>
      placementMode() !== PayloadMode.NoMode || viewerTextSelectionActive(),
    viewerTextSelectionDisabled: () => selectedCommentThread() != null,
    pageClicksDisabled,
    viewerTextSelectionActive,
    selectedCommentThread,
    ...commands,
  };
}

export type PdfInteraction = ReturnType<typeof createPdfInteraction>;
