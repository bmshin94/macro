import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PdfDocumentContextValue,
  PdfDocumentProvider,
  usePdfDocument,
} from '../context/pdf-document-context';
import {
  type PdfViewerContextValue,
  PdfViewerProvider,
  usePdfViewer,
} from '../context/pdf-viewer-context';
import { PayloadMode } from '../type/placeables';
import {
  useBeginViewerTextSelection,
  useOverlayClicksDisabled,
  useViewerTextSelectionDisabled,
} from './viewerInteraction';

vi.mock('../queries/annotations', () => ({
  getPdfAnchors: vi.fn(async () => []),
  getPdfComments: vi.fn(async () => []),
}));

afterEach(cleanup);

type Capture = {
  document: PdfDocumentContextValue;
  viewer: PdfViewerContextValue;
  overlayClicksDisabled: () => boolean;
  viewerTextSelectionDisabled: () => boolean;
  beginViewerTextSelection: () => void;
};

function Probe(props: { capture: (value: Capture) => void }) {
  props.capture({
    document: usePdfDocument(),
    viewer: usePdfViewer(),
    overlayClicksDisabled: useOverlayClicksDisabled(),
    viewerTextSelectionDisabled: useViewerTextSelectionDisabled(),
    beginViewerTextSelection: useBeginViewerTextSelection(),
  });
  return null;
}

function setup() {
  let capture!: Capture;
  render(() => (
    <PdfDocumentProvider
      documentId="document-1"
      documentName="document-1.pdf"
      permissions={{
        canComment: true,
        canEdit: true,
        isOwner: true,
      }}
    >
      <PdfViewerProvider>
        <Probe capture={(value) => (capture = value)} />
      </PdfViewerProvider>
    </PdfDocumentProvider>
  ));
  return capture;
}

describe('PDF document-viewer interaction bridge', () => {
  it('derives locks without mirroring state across contexts', () => {
    const capture = setup();

    expect({
      overlayClicksDisabled: capture.overlayClicksDisabled(),
      viewerTextSelectionDisabled: capture.viewerTextSelectionDisabled(),
    }).toEqual({
      overlayClicksDisabled: false,
      viewerTextSelectionDisabled: false,
    });

    capture.document.selectCommentThread(42);
    expect(capture.viewerTextSelectionDisabled()).toBe(true);

    capture.beginViewerTextSelection();
    expect({
      textSelectionActive: capture.viewer.textSelectionActive(),
      selectedCommentThread: capture.document.selectedCommentThread(),
      overlayClicksDisabled: capture.overlayClicksDisabled(),
      viewerTextSelectionDisabled: capture.viewerTextSelectionDisabled(),
    }).toEqual({
      textSelectionActive: true,
      selectedCommentThread: null,
      overlayClicksDisabled: true,
      viewerTextSelectionDisabled: false,
    });

    capture.document.selectCommentThread(7);
    capture.beginViewerTextSelection();
    expect(capture.document.selectedCommentThread()).toBe(7);

    capture.viewer.endTextSelection();
    expect(capture.overlayClicksDisabled()).toBe(false);

    capture.document.markup.commands.beginPlacement(PayloadMode.Thread);
    expect(capture.overlayClicksDisabled()).toBe(true);

    capture.document.markup.commands.cancelPlacement();
    expect(capture.overlayClicksDisabled()).toBe(false);
  });
});
