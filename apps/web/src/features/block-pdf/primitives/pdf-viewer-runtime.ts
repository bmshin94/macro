import { createSignal } from 'solid-js';
import type { PDFViewer } from '../PdfViewer';

type ViewerPair = {
  root: PDFViewer;
  popup: PDFViewer;
};

export function createPdfViewerRuntime() {
  const [pair, setPair] = createSignal<ViewerPair>();
  const [overlays, setOverlays] = createSignal<string[]>();

  const commands = {
    installPair(viewers: ViewerPair) {
      setPair(viewers);
    },
    clearPair() {
      setPair(undefined);
    },
    replaceOverlays(value: string[]) {
      setOverlays(value);
    },
  };

  return {
    root: () => pair()?.root,
    popup: () => pair()?.popup,
    overlays,
    commands,
  };
}

export type PdfViewerRuntime = ReturnType<typeof createPdfViewerRuntime>;
