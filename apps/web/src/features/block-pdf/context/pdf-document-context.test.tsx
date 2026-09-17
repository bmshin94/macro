import { cleanup, render } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TEvents } from '../PdfViewer/EventBus';
import { PayloadMode } from '../type/placeables';
import {
  type PdfDocumentContextValue,
  PdfDocumentProvider,
  usePdfDocument,
} from './pdf-document-context';

vi.mock('../queries/annotations', () => ({
  getPdfAnchors: vi.fn(async () => []),
  getPdfComments: vi.fn(async () => []),
}));

afterEach(cleanup);

function Probe(props: { capture: (context: PdfDocumentContextValue) => void }) {
  props.capture(usePdfDocument());
  return null;
}

function setup(...documentIds: string[]) {
  const contexts = new Map<string, PdfDocumentContextValue>();
  render(() => (
    <For each={documentIds}>
      {(documentId) => (
        <PdfDocumentProvider
          documentId={documentId}
          documentName={`${documentId}.pdf`}
          hotkeyScope="test"
          permissions={{
            canComment: true,
            canEdit: true,
            isOwner: true,
          }}
        >
          <Probe capture={(context) => contexts.set(documentId, context)} />
        </PdfDocumentProvider>
      )}
    </For>
  ));
  return contexts;
}

function viewerSnapshot(context: PdfDocumentContextValue) {
  return {
    popupOpen: context.state.derived.popupOpen(),
    currentPageNumber: context.state.derived.currentPageNumber(),
    currentScale: context.state.derived.currentScale() ?? null,
    canZoomIn: context.state.derived.canZoomIn(),
    canZoomOut: context.state.derived.canZoomOut(),
    pageCount: context.state.derived.pageCount() ?? null,
    popupCurrentPageNumber: context.state.derived.popupCurrentPageNumber(),
    popupCurrentScale: context.state.derived.popupCurrentScale() ?? null,
    viewerReady: context.state.derived.viewerReady(),
  };
}

const flushEffects = () =>
  new Promise<void>((resolve) => queueMicrotask(resolve));

describe('PdfDocumentProvider state', () => {
  it('isolates viewer state between document providers', () => {
    const contexts = setup('document-1', 'document-2');
    const first = contexts.get('document-1')!;
    const second = contexts.get('document-2')!;

    first.state.signals.pagesLoaded[1]({
      source: {},
      pagesCount: 12,
    } satisfies TEvents['pagesloaded']);
    first.state.signals.pageChanging[1]({
      source: {},
      pageNumber: 4,
      previous: 3,
      pageLabel: null,
    } satisfies TEvents['pagechanging']);

    expect(viewerSnapshot(first)).toEqual({
      popupOpen: false,
      currentPageNumber: 4,
      currentScale: null,
      canZoomIn: false,
      canZoomOut: false,
      pageCount: 12,
      popupCurrentPageNumber: 1,
      popupCurrentScale: null,
      viewerReady: true,
    });
    expect(viewerSnapshot(second)).toEqual({
      popupOpen: false,
      currentPageNumber: 1,
      currentScale: null,
      canZoomIn: false,
      canZoomOut: false,
      pageCount: null,
      popupCurrentPageNumber: 1,
      popupCurrentScale: null,
      viewerReady: false,
    });
  });

  it('projects root and popup viewer events into observable state', () => {
    const context = setup('document-1').get('document-1')!;

    context.state.signals.pagesLoaded[1]({
      source: {},
      pagesCount: 8,
    } satisfies TEvents['pagesloaded']);
    context.state.signals.scaleChanging[1]({
      source: {},
      scale: 1,
      presetValue: undefined,
    } satisfies TEvents['scalechanging']);
    context.state.signals.pageChanging[1]({
      source: {},
      pageNumber: 3,
      previous: 2,
      pageLabel: null,
    } satisfies TEvents['pagechanging']);
    context.state.signals.popupVisibilityChanged[1]({
      source: {},
      isOpen: true,
      target: document.createElement('div'),
    } satisfies TEvents['popupvisibilitychanged']);
    context.state.signals.scaleChangingPopup[1]({
      source: {},
      scale: 1.5,
      presetValue: undefined,
    } satisfies TEvents['scalechanging']);
    context.state.signals.pageChangingPopup[1]({
      source: {},
      pageNumber: 6,
      previous: 5,
      pageLabel: null,
    } satisfies TEvents['pagechanging']);

    expect(viewerSnapshot(context)).toEqual({
      popupOpen: true,
      currentPageNumber: 3,
      currentScale: 1,
      canZoomIn: true,
      canZoomOut: true,
      pageCount: 8,
      popupCurrentPageNumber: 6,
      popupCurrentScale: 1.5,
      viewerReady: true,
    });
  });

  it('coordinates text selection, comment selection, and placeable mode', async () => {
    const context = setup('document-1').get('document-1')!;
    const {
      disableOverlayClick,
      disableViewerTextSelection,
      isSelectingViewerText,
      placeableMode,
      selectingCommentThread,
    } = context.state.signals;

    selectingCommentThread[1](42);
    await flushEffects();
    expect({
      disableOverlayClick: disableOverlayClick[0](),
      disableViewerTextSelection: disableViewerTextSelection[0](),
      selectingCommentThread: selectingCommentThread[0](),
    }).toEqual({
      disableOverlayClick: false,
      disableViewerTextSelection: true,
      selectingCommentThread: 42,
    });

    isSelectingViewerText[1](true);
    await flushEffects();
    expect({
      disableOverlayClick: disableOverlayClick[0](),
      disableViewerTextSelection: disableViewerTextSelection[0](),
      selectingCommentThread: selectingCommentThread[0](),
    }).toEqual({
      disableOverlayClick: true,
      disableViewerTextSelection: false,
      selectingCommentThread: null,
    });

    isSelectingViewerText[1](false);
    placeableMode[1](PayloadMode.Thread);
    await flushEffects();
    expect(disableOverlayClick[0]()).toBe(true);

    placeableMode[1](PayloadMode.NoMode);
    await flushEffects();
    expect(disableOverlayClick[0]()).toBe(false);
  });
});
