import type { PortalScope } from '@core/component/ScopedPortal';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import {
  type Accessor,
  createContext,
  createSignal,
  type FlowComponent,
  useContext,
} from 'solid-js';
import {
  createPdfDefinitions,
  type PdfDefinitions,
} from '../primitives/pdf-definitions';
import {
  createPdfDocumentModel,
  type PdfDocumentModel,
} from '../primitives/pdf-document-model';
import {
  createPdfInteraction,
  type PdfInteraction,
} from '../primitives/pdf-interaction';
import { createPdfMarkup, type PdfMarkup } from '../primitives/pdf-markup';
import {
  createPdfNavigation,
  type PdfNavigation,
} from '../primitives/pdf-navigation';
import { createPdfOutline, type PdfOutline } from '../primitives/pdf-outline';
import {
  createPdfPersistence,
  type PdfPersistence,
} from '../primitives/pdf-persistence';
import { createPdfTabs, type PdfTabs } from '../primitives/pdf-tabs';
import {
  createPdfViewerRuntime,
  type PdfViewerRuntime,
} from '../primitives/pdf-viewer-runtime';
import type { LocationSearchParams } from '../signal/location';
import {
  createPdfDocumentState,
  type PdfDocumentState,
} from './pdf-document-state';

export type PdfDocumentPermissions = {
  canComment: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export type PdfDocumentContextValue = {
  documentId: Accessor<string>;
  documentProxy: Accessor<PDFDocumentProxy | undefined>;
  documentVersionId: Accessor<number | undefined>;
  documentName: Accessor<string>;
  isNested: Accessor<boolean>;
  portalScope: Accessor<PortalScope>;
  permissions: {
    canComment: Accessor<boolean>;
    canEdit: Accessor<boolean>;
    isOwner: Accessor<boolean>;
  };
  locationParams: Accessor<LocationSearchParams>;
  rootElement: Accessor<HTMLElement | undefined>;
  setRootElement: (element: HTMLElement | undefined) => void;
  definitions: PdfDefinitions;
  interaction: PdfInteraction;
  markup: PdfMarkup;
  model: PdfDocumentModel;
  navigation: PdfNavigation;
  persistence: PdfPersistence;
  tabs: PdfTabs;
  viewer: PdfViewerRuntime;
  outline: PdfOutline;
  state: PdfDocumentState;
};

export type PdfDocumentProviderProps = {
  documentId: string;
  documentProxy?: PDFDocumentProxy;
  documentVersionId?: number;
  documentName: string;
  isNested?: boolean;
  portalScope?: PortalScope;
  permissions: PdfDocumentPermissions;
  locationParams?: LocationSearchParams;
};

const PdfDocumentContext = createContext<PdfDocumentContextValue>();

export const PdfDocumentProvider: FlowComponent<PdfDocumentProviderProps> = (
  props
) => {
  const documentId = () => props.documentId;
  const [rootElement, setRootElement] = createSignal<HTMLElement>();
  const definitions = createPdfDefinitions();
  const markup = createPdfMarkup();
  const interaction = createPdfInteraction(markup.mode);
  const model = createPdfDocumentModel();
  const navigation = createPdfNavigation();
  const persistence = createPdfPersistence();
  const tabs = createPdfTabs();
  const viewer = createPdfViewerRuntime();
  const outline = createPdfOutline();
  const context: PdfDocumentContextValue = {
    documentId,
    documentProxy: () => props.documentProxy,
    documentVersionId: () => props.documentVersionId,
    documentName: () => props.documentName,
    isNested: () => props.isNested ?? false,
    portalScope: () => props.portalScope ?? 'split',
    permissions: {
      canComment: () => props.permissions.canComment,
      canEdit: () => props.permissions.canEdit,
      isOwner: () => props.permissions.isOwner,
    },
    locationParams: () => props.locationParams ?? {},
    rootElement,
    setRootElement,
    definitions,
    interaction,
    markup,
    model,
    navigation,
    persistence,
    tabs,
    viewer,
    outline,
    state: createPdfDocumentState(documentId),
  };

  return (
    <PdfDocumentContext.Provider value={context}>
      {props.children}
    </PdfDocumentContext.Provider>
  );
};

export function usePdfDocument(): PdfDocumentContextValue {
  const context = useContext(PdfDocumentContext);
  if (!context) {
    throw new Error('usePdfDocument must be used within a PdfDocumentProvider');
  }
  return context;
}
