import { ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { refetchHistory } from '@queries/history/history';
import { storageServiceClient } from '@service-storage/client';
import { createMemo } from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import {
  getSaveModificationData,
  hashModificationData,
  hashModificationDataSync,
} from '../util/buildModificationData';

export function useDoEdit() {
  return usePdfDocument().model.commands.recordEdit;
}

export function useHasModificationData() {
  const pdf = usePdfDocument();
  const { highlights } = pdf.state.stores;
  const [highlightStoreValue] = highlights;

  return () =>
    Object.keys(highlightStoreValue).length > 0 ||
    pdf.model.modificationData.placeables.length > 0;
}

export function useSaveModificationData() {
  const pdf = usePdfDocument();
  const pdfModificationValue = pdf.model.modificationData;
  const [tableOfContents] = pdf.state.stores.tableOfContents;

  const serverModificationDataHash = createMemo(() => {
    const modificationData_ = pdf.model.serverSnapshot();
    if (!modificationData_) return '';
    const hash = hashModificationDataSync(modificationData_);
    return hash;
  });

  const shouldSave = () => {
    if (!ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE) return false;
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      TOCItems: tableOfContents.items,
      pinnedTerms: [],
    });
    const sha = hashModificationDataSync(modificationData);
    return pdf.permissions.canEdit() && serverModificationDataHash() !== sha;
  };

  const save = async () => {
    const placeables = pdfModificationValue.placeables ?? [];
    const { modificationData } = getSaveModificationData({
      placeables,
      TOCItems: tableOfContents.items,
      pinnedTerms: [],
    });

    const serverSaves: Promise<any>[] = [];

    const sha = await hashModificationData(modificationData);
    serverSaves.push(
      storageServiceClient.pdfSave({
        documentId: pdf.documentId(),
        modificationData,
        sha,
      })
    );
    serverSaves.push(refetchHistory());

    await Promise.all(serverSaves);
  };

  return () => pdf.persistence.runSave(save, shouldSave);
}

export function usePdfSaveLocation() {
  const pdf = usePdfDocument();
  const [viewer] = pdf.state.signals.rootViewer;
  const prevLocationHash = pdf.navigation.persistedViewLocation;
  const userId = useUserId();

  const shouldSave = () => {
    const userId_ = userId();
    if (!userId_) return false;

    const location = viewer()?.getLocationHash();
    return location != null && prevLocationHash() !== location;
  };

  const save = async () => {
    const location = viewer()?.getLocationHash();
    pdf.navigation.commands.setPersistedViewLocation(location);
    if (location == null) {
      await storageServiceClient.deleteDocumentViewLocation({
        documentId: pdf.documentId(),
      });
    } else {
      await storageServiceClient.upsertDocumentViewLocation({
        documentId: pdf.documentId(),
        location,
      });
    }
  };

  return () => pdf.persistence.runSave(save, shouldSave);
}

export const usePdfSave = () => {
  const saveLocation = usePdfSaveLocation();
  const saveModificationData = useSaveModificationData();

  const save = async () => {
    await Promise.all([saveLocation(), saveModificationData()]);
  };

  return save;
};
