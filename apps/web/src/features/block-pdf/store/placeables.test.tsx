import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type PdfDocumentContextValue,
  PdfDocumentProvider,
  usePdfDocument,
} from '../context/pdf-document-context';
import {
  type IPlaceable,
  PayloadMode,
  type PayloadType,
} from '../type/placeables';
import { useModifyPlaceable } from './placeables';

vi.mock('../queries/annotations', () => ({
  getPdfAnchors: vi.fn(async () => []),
  getPdfComments: vi.fn(async () => []),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
}));

vi.mock('../signal/pdfViewer', () => ({
  useIsPopup: () => false,
}));

vi.mock('./comments/commentOperations', () => ({
  useDeleteComment: () => vi.fn(),
  useDeleteNewComments: () => vi.fn(),
}));

vi.mock('./comments/freeComments', () => ({
  isThreadPlaceable: () => false,
  useCommentPlaceables: () => () => [],
}));

vi.mock('./commentsResource', () => ({
  useEditPdfFreeCommentAnchor: () => vi.fn(),
}));

afterEach(cleanup);

function textPlaceable(text: string): IPlaceable {
  return {
    internalId: 'placeable-1',
    allowableEdits: {
      allowResize: true,
      allowTranslate: true,
      allowRotate: true,
      allowDelete: true,
      lockAspectRatio: false,
    },
    wasEdited: false,
    wasDeleted: false,
    pageRange: new Set([0]),
    position: {
      xPct: 0.1,
      yPct: 0.2,
      widthPct: 0.3,
      heightPct: 0.4,
      rotation: 0,
    },
    payload: {
      color: { red: 0, green: 0, blue: 0, alpha: 1 },
      fontSize: 10,
      bold: false,
      fontFamily: 'Times New Roman',
      text,
      italic: false,
      underlined: false,
      textType: 'pdf-text',
    },
    payloadType: PayloadMode.FreeTextAnnotation,
    shouldLockOnSave: false,
    originalPage: 0,
    originalIndex: -1,
  };
}

type PlaceableTestApi = {
  context: PdfDocumentContextValue;
  modifyPlaceable: ReturnType<typeof useModifyPlaceable>;
};

function Probe(props: { capture: (api: PlaceableTestApi) => void }) {
  props.capture({
    context: usePdfDocument(),
    modifyPlaceable: useModifyPlaceable(),
  });
  return null;
}

function setup(): PlaceableTestApi {
  let api!: PlaceableTestApi;
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
      <Probe capture={(value) => (api = value)} />
    </PdfDocumentProvider>
  ));
  return api;
}

describe('useModifyPlaceable', () => {
  it('updates a matching placeable and records one edit', () => {
    const { context, modifyPlaceable } = setup();
    const [, setModificationData] = context.state.stores.modificationData;
    const [numOperations] = context.state.signals.numOperations;
    const original = textPlaceable('before');
    setModificationData('placeables', [original]);

    const updated = textPlaceable('after');

    expect(modifyPlaceable(0, updated)).toBe(true);
    expect(context.state.stores.modificationData[0].placeables[0]).toEqual({
      ...updated,
      wasEdited: true,
    });
    expect(numOperations()).toBe(1);
  });

  it('rejects missing or mismatched placeables without recording an edit', () => {
    const { context, modifyPlaceable } = setup();
    const [, setModificationData] = context.state.stores.modificationData;
    const [numOperations] = context.state.signals.numOperations;
    const original = textPlaceable('before');
    setModificationData('placeables', [original]);

    const mismatched = {
      ...textPlaceable('after'),
      payloadType: PayloadMode.Signature as PayloadType,
    } as IPlaceable;

    expect(modifyPlaceable(-1, original)).toBe(false);
    expect(modifyPlaceable(1, original)).toBe(false);
    expect(modifyPlaceable(0, mismatched)).toBe(false);
    expect(context.state.stores.modificationData[0].placeables).toEqual([
      original,
    ]);
    expect(numOperations()).toBe(0);
  });
});
