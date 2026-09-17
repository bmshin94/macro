import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { URL_PARAMS } from '../constants';
import type { LocationBlockParams } from '../signal/location';
import { createPdfNavigation, type PdfNavigation } from './pdf-navigation';

function setup(): {
  navigation: PdfNavigation;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    navigation: createPdfNavigation(),
    dispose,
  }));
}

describe('createPdfNavigation', () => {
  it('starts with an empty navigation session', () => {
    const { navigation, dispose } = setup();

    expect({
      pendingParams: navigation.pendingParams(),
      searchLocationPending: navigation.isSearchLocationPending(),
      persistedViewLocation: navigation.persistedViewLocation(),
      locations: navigation.locations,
      allowsInitialUrlNavigation: navigation.allowsInitialUrlNavigation(),
    }).toEqual({
      pendingParams: undefined,
      searchLocationPending: false,
      persistedViewLocation: undefined,
      locations: {
        general: undefined,
        precise: undefined,
        annotation: undefined,
      },
      allowsInitialUrlNavigation: true,
    });
    dispose();
  });

  it('deep-clones queued params and permanently closes initial navigation', () => {
    const { navigation, dispose } = setup();
    const first: LocationBlockParams = {
      [URL_PARAMS.pageNumber]: '2',
      [URL_PARAMS.yPos]: '0.25',
    };

    navigation.commands.queueImperativeParams(first);
    first[URL_PARAMS.pageNumber] = '9';

    expect(navigation.pendingParams()).toEqual({
      [URL_PARAMS.pageNumber]: '2',
      [URL_PARAMS.yPos]: '0.25',
    });
    expect(navigation.pendingParams()).not.toBe(first);
    expect(navigation.allowsInitialUrlNavigation()).toBe(false);

    navigation.commands.queueImperativeParams({
      [URL_PARAMS.annotationId]: 'annotation-1',
    });
    expect(navigation.pendingParams()).toEqual({
      [URL_PARAMS.annotationId]: 'annotation-1',
    });
    expect(navigation.allowsInitialUrlNavigation()).toBe(false);
    dispose();
  });

  it('owns persisted view location and search navigation status', () => {
    const { navigation, dispose } = setup();

    navigation.commands.setPersistedViewLocation('#page=3');
    expect(navigation.persistedViewLocation()).toBe('#page=3');

    navigation.commands.beginSearchLocationNavigation();
    expect(navigation.isSearchLocationPending()).toBe(true);

    navigation.commands.endSearchLocationNavigation();
    expect(navigation.isSearchLocationPending()).toBe(false);

    navigation.commands.setPersistedViewLocation(null);
    expect(navigation.persistedViewLocation()).toBeNull();
    dispose();
  });

  it('writes general, precise, and annotation locations independently', () => {
    const { navigation, dispose } = setup();
    const general = { type: 'general', pageIndex: 2, y: 0.1 } as const;
    const precise = {
      type: 'precise',
      pageIndex: 3,
      y: 0.2,
      x: 0.3,
      width: 0.4,
      height: 0.5,
    } as const;
    const annotation = {
      type: 'annotation',
      pageIndex: 4,
      id: 'annotation-1',
    } as const;

    navigation.commands.setGeneralLocation(general);
    navigation.commands.setPreciseLocation(precise);
    navigation.commands.setAnnotationLocation(annotation);

    expect(navigation.locations).toEqual({ general, precise, annotation });

    navigation.commands.setPreciseLocation(undefined);
    expect(navigation.locations).toEqual({
      general,
      precise: undefined,
      annotation,
    });
    dispose();
  });

  it('isolates navigation authorities', () => {
    const first = setup();
    const second = setup();

    first.navigation.commands.queueImperativeParams({
      [URL_PARAMS.pageNumber]: '5',
    });
    first.navigation.commands.setGeneralLocation({
      type: 'general',
      pageIndex: 5,
      y: 0,
    });

    expect({
      firstAllowed: first.navigation.allowsInitialUrlNavigation(),
      firstGeneral: first.navigation.locations.general,
      secondAllowed: second.navigation.allowsInitialUrlNavigation(),
      secondGeneral: second.navigation.locations.general,
    }).toEqual({
      firstAllowed: false,
      firstGeneral: { type: 'general', pageIndex: 5, y: 0 },
      secondAllowed: true,
      secondGeneral: undefined,
    });
    first.dispose();
    second.dispose();
  });
});
