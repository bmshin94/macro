import { type Accessor, batch, createSignal } from 'solid-js';
import { PayloadMode, type PayloadType } from '../type/placeables';

export type PdfSelectionMenuLocation = {
  pageIndex: number;
  element: HTMLElement;
};

export function createPdfInteraction(placementMode: Accessor<PayloadType>) {
  const [selectionMenuLocation, setSelectionMenuLocation] =
    createSignal<PdfSelectionMenuLocation | null>(null);
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
    overlayClicksDisabled: () =>
      placementMode() !== PayloadMode.NoMode || viewerTextSelectionActive(),
    viewerTextSelectionDisabled: () => selectedCommentThread() != null,
    pageClicksDisabled,
    viewerTextSelectionActive,
    selectedCommentThread,
    commands,
  };
}

export type PdfInteraction = ReturnType<typeof createPdfInteraction>;
