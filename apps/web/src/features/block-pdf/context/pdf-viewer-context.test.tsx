import { cleanup, render } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { PDFViewer } from '../PdfViewer';
import {
  createEventBus,
  type IVisiblePage,
  type TEvents,
} from '../PdfViewer/EventBus';
import {
  type PdfViewerContextValue,
  PdfViewerProvider,
  usePdfViewer,
} from './pdf-viewer-context';

afterEach(cleanup);

function Probe(props: { capture: (context: PdfViewerContextValue) => void }) {
  props.capture(usePdfViewer());
  return null;
}

function setup(...ids: string[]) {
  const contexts = new Map<string, PdfViewerContextValue>();
  render(() => (
    <For each={ids}>
      {(id) => (
        <PdfViewerProvider>
          <Probe capture={(context) => contexts.set(id, context)} />
        </PdfViewerProvider>
      )}
    </For>
  ));
  return contexts;
}

function viewerSnapshot(context: PdfViewerContextValue) {
  return {
    popupOpen: context.isPopupOpen(),
    currentPageNumber: context.root.currentPageNumber(),
    currentScale: context.root.currentScale() ?? null,
    canZoomIn: context.root.canZoomIn(),
    canZoomOut: context.root.canZoomOut(),
    pageCount: context.root.pageCount() ?? null,
    popupCurrentPageNumber: context.popup.currentPageNumber(),
    popupCurrentScale: context.popup.currentScale() ?? null,
    viewerReady: context.root.isReady(),
    viewerHasVisiblePages: context.root.hasVisiblePages(),
  };
}

function installViewers(context: PdfViewerContextValue) {
  const root = { event: createEventBus() } as unknown as PDFViewer;
  const popup = { event: createEventBus() } as unknown as PDFViewer;
  context.installPair({ root, popup });
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

describe('PdfViewerProvider', () => {
  it('owns and isolates mounted viewer state without a document provider', () => {
    const contexts = setup('first', 'second');
    const first = contexts.get('first')!;
    const second = contexts.get('second')!;
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
    const context = setup('viewer').get('viewer')!;
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

  it('owns viewer elements and temporary interaction locks', () => {
    const context = setup('viewer').get('viewer')!;
    const rootElement = document.createElement('div');
    context.setRootElement(rootElement);
    expect(context.rootElement()).toBe(rootElement);

    context.beginTextSelection();
    expect(context.textSelectionActive()).toBe(true);
    context.endTextSelection();
    expect(context.textSelectionActive()).toBe(false);

    expect(context.searchNavigationPending()).toBe(false);
    context.beginSearchNavigation();
    expect(context.searchNavigationPending()).toBe(true);
    context.endSearchNavigation();
    expect(context.searchNavigationPending()).toBe(false);

    const observed: boolean[] = [];
    context.runWithPageClicksDisabled(() => {
      observed.push(context.pageClicksDisabled());
    });
    observed.push(context.pageClicksDisabled());
    expect(() =>
      context.runWithPageClicksDisabled(() => {
        observed.push(context.pageClicksDisabled());
        throw new Error('failed');
      })
    ).toThrow('failed');

    expect(observed).toEqual([true, false, true]);
    expect(context.pageClicksDisabled()).toBe(false);
  });
});
