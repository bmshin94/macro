import { cleanup, render } from '@solidjs/testing-library';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFViewer } from '../PdfViewer';
import {
  createEventBus,
  type IVisiblePage,
  type TEvents,
} from '../PdfViewer/EventBus';
import type { IModificationDataOnServer } from '../type/coParse';
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
    popupOpen: context.viewer.isPopupOpen(),
    currentPageNumber: context.viewer.root.currentPageNumber(),
    currentScale: context.viewer.root.currentScale() ?? null,
    canZoomIn: context.viewer.root.canZoomIn(),
    canZoomOut: context.viewer.root.canZoomOut(),
    pageCount: context.viewer.root.pageCount() ?? null,
    popupCurrentPageNumber: context.viewer.popup.currentPageNumber(),
    popupCurrentScale: context.viewer.popup.currentScale() ?? null,
    viewerReady: context.viewer.root.isReady(),
    viewerHasVisiblePages: context.viewer.root.hasVisiblePages(),
  };
}

function installViewers(context: PdfDocumentContextValue) {
  const root = { event: createEventBus() } as unknown as PDFViewer;
  const popup = { event: createEventBus() } as unknown as PDFViewer;
  context.viewer.commands.installPair({ root, popup });
  return { root, popup };
}

const updateViewArea = (pageNumber: number): TEvents['updateviewarea'] => {
  const page = {
    id: pageNumber,
    x: 0,
    y: 0,
    view: {} as IVisiblePage['view'],
    percent: 100,
    widthPercent: 100,
  };
  return {
    source: {},
    location: {
      pageNumber,
      scale: 1,
      top: 0,
      left: 0,
      rotation: 0,
      pdfOpenParams: '',
      unscaledYPos: 0,
      viewportScale: 1,
    },
    visiblePages: {
      first: page,
      last: page,
      views: [page],
      ids: new Set([pageNumber]),
    },
  };
};

const flushEffects = () =>
  new Promise<void>((resolve) => queueMicrotask(resolve));

describe('PdfDocumentProvider state', () => {
  it('reads reactive document proxy props without remounting providers', () => {
    const firstProxy = { name: 'first' } as unknown as PDFDocumentProxy;
    const nextProxy = { name: 'next' } as unknown as PDFDocumentProxy;
    const secondProxy = { name: 'second' } as unknown as PDFDocumentProxy;
    const [proxy, setProxy] = createSignal(firstProxy);
    const contexts = new Map<string, PdfDocumentContextValue>();
    const captures = new Map<string, number>();

    render(() => (
      <For each={['document-1', 'document-2']}>
        {(documentId) => (
          <PdfDocumentProvider
            documentId={documentId}
            documentProxy={documentId === 'document-1' ? proxy() : secondProxy}
            documentName={`${documentId}.pdf`}
            permissions={{
              canComment: true,
              canEdit: true,
              isOwner: true,
            }}
          >
            <Probe
              capture={(context) => {
                contexts.set(documentId, context);
                captures.set(documentId, (captures.get(documentId) ?? 0) + 1);
              }}
            />
          </PdfDocumentProvider>
        )}
      </For>
    ));

    const first = contexts.get('document-1')!;
    const second = contexts.get('document-2')!;
    expect(first.documentProxy()).toBe(firstProxy);
    expect(second.documentProxy()).toBe(secondProxy);

    setProxy(nextProxy);

    expect(first.documentProxy()).toBe(nextProxy);
    expect(second.documentProxy()).toBe(secondProxy);
    expect(captures).toEqual(
      new Map([
        ['document-1', 1],
        ['document-2', 1],
      ])
    );
  });

  it('isolates viewer state between document providers', () => {
    const contexts = setup('document-1', 'document-2');
    const first = contexts.get('document-1')!;
    const second = contexts.get('document-2')!;
    const { root } = installViewers(first);

    root.event.dispatch('pagesloaded', {
      source: {},
      pagesCount: 12,
    } satisfies TEvents['pagesloaded']);
    root.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 4,
      previous: 3,
      pageLabel: null,
    } satisfies TEvents['pagechanging']);
    root.event.dispatch('updateviewarea', updateViewArea(4));

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
      viewerHasVisiblePages: true,
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
      viewerHasVisiblePages: false,
    });
  });

  it('projects root and popup viewer events into observable state', () => {
    const context = setup('document-1').get('document-1')!;
    const { root, popup } = installViewers(context);

    root.event.dispatch('pagesloaded', {
      source: {},
      pagesCount: 8,
    } satisfies TEvents['pagesloaded']);
    root.event.dispatch('scalechanging', {
      source: {},
      scale: 1,
      presetValue: undefined,
    } satisfies TEvents['scalechanging']);
    root.event.dispatch('pagechanging', {
      source: {},
      pageNumber: 3,
      previous: 2,
      pageLabel: null,
    } satisfies TEvents['pagechanging']);
    root.event.dispatch('popupvisibilitychanged', {
      source: {},
      isOpen: true,
      target: document.createElement('div'),
    } satisfies TEvents['popupvisibilitychanged']);
    popup.event.dispatch('scalechanging', {
      source: {},
      scale: 1.5,
      presetValue: undefined,
    } satisfies TEvents['scalechanging']);
    popup.event.dispatch('pagechanging', {
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
      viewerHasVisiblePages: false,
    });
  });

  it('isolates document models between providers', () => {
    const contexts = setup('document-1', 'document-2');
    const first = contexts.get('document-1')!;
    const second = contexts.get('document-2')!;
    const snapshot = {
      bookmarks: [],
      highlights: null,
      pinnedTermsNames: [],
      placeables: [],
    } satisfies IModificationDataOnServer;

    first.model.commands.hydrateFromServer(snapshot);
    first.model.commands.recordEdit();

    expect(first.model).not.toBe(second.model);
    expect(first.model.serverSnapshot()).toBe(snapshot);
    expect(first.model.revision()).toBe(1);
    expect(second.model.serverSnapshot()).toBeUndefined();
    expect(second.model.revision()).toBe(0);
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
