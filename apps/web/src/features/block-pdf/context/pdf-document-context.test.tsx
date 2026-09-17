import { cleanup, render } from '@solidjs/testing-library';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import { createSignal, For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IHighlight } from '../model/Highlight';
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

describe('PdfDocumentProvider', () => {
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

  it('isolates markup and interaction between document providers', () => {
    const contexts = setup('document-1', 'document-2');
    const first = contexts.get('document-1')!;
    const second = contexts.get('document-2')!;

    expect('viewer' in first).toBe(false);
    expect('rootElement' in first).toBe(false);
    expect('interaction' in first).toBe(false);

    first.markup.commands.beginPlacement(PayloadMode.Signature);
    first.markup.commands.activate('placeable-1');
    first.selectCommentThread(42);

    expect({
      firstMode: first.markup.mode(),
      firstActiveId: first.markup.activeId(),
      firstSelectedThread: first.selectedCommentThread(),
      secondMode: second.markup.mode(),
      secondActiveId: second.markup.activeId(),
      secondSelectedThread: second.selectedCommentThread(),
    }).toEqual({
      firstMode: PayloadMode.Signature,
      firstActiveId: 'placeable-1',
      firstSelectedThread: 42,
      secondMode: PayloadMode.NoMode,
      secondActiveId: undefined,
      secondSelectedThread: null,
    });
  });

  it('projects highlight indexes and isolates annotation state', () => {
    const contexts = setup('document-1', 'document-2');
    const first = contexts.get('document-1')!;
    const second = contexts.get('document-2')!;
    const highlight = {
      uuid: 'highlight-1',
      pageNum: 2,
      hasTempThread: true,
    } as IHighlight;

    first.annotations.commands.beginNewHighlightCommentDrafts([highlight]);

    expect({
      highlight: first.annotations.highlightsByUuid()['highlight-1'],
      secondHighlights: second.annotations.highlightsByUuid(),
    }).toEqual({
      highlight,
      secondHighlights: {},
    });
  });
});
