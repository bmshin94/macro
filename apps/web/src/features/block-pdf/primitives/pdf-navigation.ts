import type { GetDocumentResponseDataViewLocation } from '@service-storage/generated/schemas/getDocumentResponseDataViewLocation';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  AnnotationLocation,
  GeneralLocation,
  LocationBlockParams,
  PreciseLocation,
} from '../signal/location';

type ShareLocations = {
  general: GeneralLocation | undefined;
  precise: PreciseLocation | undefined;
  annotation: AnnotationLocation | undefined;
};

export function createPdfNavigation() {
  const [pendingParams, setPendingParams] = createSignal<LocationBlockParams>();
  const [isSearchLocationPending, setIsSearchLocationPending] =
    createSignal(false);
  const [persistedViewLocation, setPersistedViewLocation] =
    createSignal<GetDocumentResponseDataViewLocation>();
  const [allowsInitialUrlNavigation, setAllowsInitialUrlNavigation] =
    createSignal(true);
  const [locations, setLocations] = createStore<ShareLocations>({
    general: undefined,
    precise: undefined,
    annotation: undefined,
  });

  const commands = {
    queueImperativeParams(params: LocationBlockParams) {
      setAllowsInitialUrlNavigation(false);
      setPendingParams(JSON.parse(JSON.stringify(params)));
    },
    setPersistedViewLocation(
      location: GetDocumentResponseDataViewLocation | undefined
    ) {
      setPersistedViewLocation(location);
    },
    beginSearchLocationNavigation() {
      setIsSearchLocationPending(true);
    },
    endSearchLocationNavigation() {
      setIsSearchLocationPending(false);
    },
    setGeneralLocation(location: GeneralLocation | undefined) {
      setLocations('general', location);
    },
    setPreciseLocation(location: PreciseLocation | undefined) {
      setLocations('precise', location);
    },
    setAnnotationLocation(location: AnnotationLocation | undefined) {
      setLocations('annotation', location);
    },
  };

  return {
    pendingParams,
    isSearchLocationPending,
    persistedViewLocation,
    locations,
    allowsInitialUrlNavigation,
    commands,
  };
}

export type PdfNavigation = ReturnType<typeof createPdfNavigation>;
