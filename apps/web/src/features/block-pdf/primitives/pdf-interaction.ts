import type { ThreadId } from '@core/comments/commentType';
import { batch, createSignal } from 'solid-js';
import type { IHighlight } from '../model/Highlight';

export type PdfSelectionMenuLocation = {
  pageIndex: number;
  element: HTMLElement;
};

export type PdfAnnotationSelection = {
  nativeSelection: Selection | null;
  selectedHighlights: IHighlight[];
};

export function createPdfInteraction() {
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
    selectCommentThread(threadId: number) {
      setSelectedCommentThread(threadId);
    },
    clearSelectedCommentThread() {
      setSelectedCommentThread(null);
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
    selectedCommentThread,
    ...commands,
  };
}

export type PdfInteraction = ReturnType<typeof createPdfInteraction>;
