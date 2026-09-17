import type { PortalScope } from '@core/component/ScopedPortal';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import {
  type Accessor,
  createContext,
  type FlowComponent,
  useContext,
} from 'solid-js';
import {
  createPdfAnnotations,
  type PdfAnnotations,
} from '../primitives/pdf-annotations';
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
import type { LocationSearchParams } from '../signal/location';

export type PdfDocumentPermissions = {
  canComment: boolean;
  canEdit: boolean;
  isOwner: boolean;
};

export type PdfDocumentContextValue = PdfInteraction & {
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
  annotations: PdfAnnotations;
  definitions: PdfDefinitions;
  markup: PdfMarkup;
  model: PdfDocumentModel;
  navigation: PdfNavigation;
  persistence: PdfPersistence;
  tabs: PdfTabs;
  outline: PdfOutline;
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
  const definitions = createPdfDefinitions();
  const markup = createPdfMarkup();
  const interaction = createPdfInteraction();
  const model = createPdfDocumentModel();
  const navigation = createPdfNavigation();
  const persistence = createPdfPersistence();
  const tabs = createPdfTabs();
  const outline = createPdfOutline();
  const annotations = createPdfAnnotations(documentId);
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
    ...interaction,
    annotations,
    definitions,
    markup,
    model,
    navigation,
    persistence,
    tabs,
    outline,
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
