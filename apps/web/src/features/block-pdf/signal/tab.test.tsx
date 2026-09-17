import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PdfDocumentContextValue,
  PdfDocumentProvider,
  usePdfDocument,
} from '../context/pdf-document-context';
import type { PDFViewer } from '../PdfViewer';
import type { TEvents } from '../PdfViewer/EventBus';
import { useCreateTab, useNavigateToTab } from './tab';

vi.mock('../queries/annotations', () => ({
  getPdfAnchors: vi.fn(async () => []),
  getPdfComments: vi.fn(async () => []),
}));

afterEach(cleanup);

type TabTestApi = {
  context: PdfDocumentContextValue;
  createTab: ReturnType<typeof useCreateTab>;
  navigateToTab: ReturnType<typeof useNavigateToTab>;
};

function Probe(props: { capture: (api: TabTestApi) => void }) {
  props.capture({
    context: usePdfDocument(),
    createTab: useCreateTab(),
    navigateToTab: useNavigateToTab(),
  });
  return null;
}

function setup(isNested = false): TabTestApi {
  let api!: TabTestApi;
  render(() => (
    <PdfDocumentProvider
      documentId="document-1"
      documentName="document-1.pdf"
      isNested={isNested}
      permissions={{
        canComment: true,
        canEdit: true,
        isOwner: true,
      }}
    >
      <Probe capture={(value) => (api = value)} />
    </PdfDocumentProvider>
  ));
  return api;
}

function setCurrentPage(context: PdfDocumentContextValue, pageNumber: number) {
  context.state.signals.pageChanging[1]({
    source: {},
    pageNumber,
    previous: pageNumber - 1,
    pageLabel: null,
  } satisfies TEvents['pagechanging']);
}

describe('PDF tab hooks', () => {
  it('does not create tabs without a viewer or for nested documents', () => {
    const withoutViewer = setup();
    withoutViewer.createTab();

    const nested = setup(true);
    nested.context.viewer.commands.installPair({
      root: {} as PDFViewer,
      popup: {} as PDFViewer,
    });
    nested.createTab();

    expect({
      withoutViewerCount: withoutViewer.context.tabs.count(),
      withoutViewerVisible: withoutViewer.context.tabs.isVisible(),
      nestedCount: nested.context.tabs.count(),
      nestedVisible: nested.context.tabs.isVisible(),
    }).toEqual({
      withoutViewerCount: 1,
      withoutViewerVisible: false,
      nestedCount: 1,
      nestedVisible: false,
    });
  });

  it('creates and navigates tabs through viewer state', () => {
    const { context, createTab, navigateToTab } = setup();
    const getLocationHash = vi.fn(() => '#page=3');
    const goToLocationHash = vi.fn();
    context.viewer.commands.installPair({
      root: {
        getLocationHash,
        goToLocationHash,
      } as unknown as PDFViewer,
      popup: {} as PDFViewer,
    });
    setCurrentPage(context, 3);

    createTab();
    createTab({ label: 'Saved location', locationHash: '#page=8' });

    expect(context.tabs.items).toEqual([
      { id: 0, label: 'Page 3', locationHash: '#page=3' },
      { id: 1, label: 'Page 3', locationHash: '#page=3' },
      { id: 2, label: 'Saved location', locationHash: '#page=8' },
    ]);
    expect(context.tabs.activeId()).toBe(2);
    expect(goToLocationHash.mock.calls).toEqual([['#page=3'], ['#page=8']]);

    getLocationHash.mockReturnValue('#page=4');
    setCurrentPage(context, 4);
    navigateToTab(0);

    expect(context.tabs.items[2]).toEqual({
      id: 2,
      label: 'Page 4',
      locationHash: '#page=4',
    });
    expect(context.tabs.activeId()).toBe(0);
    expect(goToLocationHash).toHaveBeenLastCalledWith('#page=3');
  });
});
