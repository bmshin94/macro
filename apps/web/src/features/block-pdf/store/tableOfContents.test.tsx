import { cleanup, render } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PdfDocumentProvider } from '../context/pdf-document-context';
import type Section from '../model/Section';
import type { ICoParse } from '../type/coParse';
import {
  useGetIdToSectionMap,
  useTableOfContentsUpdate,
  useTableOfContentsValue,
} from './tableOfContents';

vi.mock('../queries/annotations', () => ({
  getPdfAnchors: vi.fn(async () => []),
  getPdfComments: vi.fn(async () => []),
}));

afterEach(cleanup);

type TocApi = {
  value: ReturnType<typeof useTableOfContentsValue>;
  dispatch: ReturnType<typeof useTableOfContentsUpdate>;
  getIdToSectionMap: ReturnType<typeof useGetIdToSectionMap>;
};

function Probe(props: { capture: (api: TocApi) => void }) {
  props.capture({
    value: useTableOfContentsValue(),
    dispatch: useTableOfContentsUpdate(),
    getIdToSectionMap: useGetIdToSectionMap(),
  });
  return null;
}

function setup(...documentIds: string[]) {
  const apis = new Map<string, TocApi>();
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
          <Probe capture={(api) => apis.set(documentId, api)} />
        </PdfDocumentProvider>
      )}
    </For>
  ));
  return apis;
}

function coparse(toc: string) {
  return { toc } as ICoParse;
}

function sectionMapSnapshot(map: Partial<Record<number, Section>>) {
  return Object.values(map)
    .filter((section): section is Section => section != null)
    .map((section) => ({
      id: section.id,
      page: section.page,
      y: section.y,
      title: section.title,
    }));
}

const firstToc = `
  <document>
    <section
      id="10"
      title="Root section"
      literal="1"
      page="0"
      y="12.5"
      qualified="1 Root section"
      show="true"
      type="SECTION"
    >
      <section
        id="11"
        title="Nested section"
        literal="1.1"
        page="1"
        y="33.25"
        qualified="1.1 Nested section"
        show="true"
        type="SECTION"
      />
    </section>
  </document>
`;

const replacementToc = `
  <document>
    <section
      id="20"
      title="Replacement section"
      literal="2"
      page="2"
      y="48.75"
      qualified="2 Replacement section"
      show="true"
      type="SECTION"
    />
  </document>
`;

describe('live PDF table of contents hooks', () => {
  it('loads only the AI section-reference map while bookmarks mode is active', () => {
    const api = setup('document-1').get('document-1')!;

    expect({
      items: api.value().items,
      pageToSectionMap: api.value().pageToSectionMap,
      idToSectionMap: api.value().idToSectionMap,
      sectionReferenceMap: api.getIdToSectionMap(),
    }).toEqual({
      items: [],
      pageToSectionMap: [],
      idToSectionMap: {},
      sectionReferenceMap: {},
    });

    api.dispatch({ type: 'LOAD_AI_TOC', coparse: coparse(firstToc) });

    expect({
      items: api.value().items,
      pageToSectionMap: api.value().pageToSectionMap,
      idToSectionMap: api.value().idToSectionMap,
    }).toEqual({
      items: [],
      pageToSectionMap: [],
      idToSectionMap: {},
    });
    expect(sectionMapSnapshot(api.getIdToSectionMap())).toEqual([
      {
        id: 10,
        page: 0,
        y: 12.5,
        title: 'Root section',
      },
      {
        id: 11,
        page: 1,
        y: 33.25,
        title: 'Nested section',
      },
    ]);
  });

  it('replaces stale AI section IDs and isolates providers', () => {
    const apis = setup('document-1', 'document-2');
    const first = apis.get('document-1')!;
    const second = apis.get('document-2')!;

    first.dispatch({ type: 'LOAD_AI_TOC', coparse: coparse(firstToc) });
    first.dispatch({ type: 'LOAD_AI_TOC', coparse: coparse(replacementToc) });

    expect(sectionMapSnapshot(first.getIdToSectionMap())).toEqual([
      {
        id: 20,
        page: 2,
        y: 48.75,
        title: 'Replacement section',
      },
    ]);
    expect({
      items: second.value().items,
      pageToSectionMap: second.value().pageToSectionMap,
      idToSectionMap: second.value().idToSectionMap,
      sectionReferenceMap: second.getIdToSectionMap(),
    }).toEqual({
      items: [],
      pageToSectionMap: [],
      idToSectionMap: {},
      sectionReferenceMap: {},
    });
  });
});
