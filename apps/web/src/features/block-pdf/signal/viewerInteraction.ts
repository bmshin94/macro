import { batch } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { usePdfViewer } from '../context/pdf-viewer-context';
import { PayloadMode } from '../type/placeables';

export function useOverlayClicksDisabled() {
  const pdfDocument = usePdfDocument();
  const pdfViewer = usePdfViewer();
  return () =>
    pdfDocument.markup.mode() !== PayloadMode.NoMode ||
    pdfViewer.textSelectionActive();
}

export function useViewerTextSelectionDisabled() {
  const selectedCommentThread = usePdfDocument().selectedCommentThread;
  return () => selectedCommentThread() != null;
}

export function useBeginViewerTextSelection() {
  const pdfDocument = usePdfDocument();
  const pdfViewer = usePdfViewer();

  return () => {
    if (pdfViewer.textSelectionActive()) return;
    batch(() => {
      pdfDocument.clearSelectedCommentThread();
      pdfViewer.beginTextSelection();
    });
  };
}
