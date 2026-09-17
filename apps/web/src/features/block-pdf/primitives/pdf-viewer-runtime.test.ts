import { createComputed, createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { PDFViewer } from '../PdfViewer';
import {
  createPdfViewerRuntime,
  type PdfViewerRuntime,
} from './pdf-viewer-runtime';

function setup(): {
  viewer: PdfViewerRuntime;
  snapshots: Array<{
    root: PDFViewer | undefined;
    popup: PDFViewer | undefined;
  }>;
  dispose: () => void;
} {
  return createRoot((dispose) => {
    const viewer = createPdfViewerRuntime();
    const snapshots: Array<{
      root: PDFViewer | undefined;
      popup: PDFViewer | undefined;
    }> = [];
    createComputed(() => {
      snapshots.push({ root: viewer.root(), popup: viewer.popup() });
    });
    return { viewer, snapshots, dispose };
  });
}

describe('createPdfViewerRuntime', () => {
  it('installs and clears the viewer pair atomically', () => {
    const { viewer, snapshots, dispose } = setup();
    const root = { name: 'root' } as unknown as PDFViewer;
    const popup = { name: 'popup' } as unknown as PDFViewer;

    viewer.commands.installPair({ root, popup });
    viewer.commands.clearPair();

    expect(snapshots).toEqual([
      { root: undefined, popup: undefined },
      { root, popup },
      { root: undefined, popup: undefined },
    ]);
    dispose();
  });

  it('owns one shared overlay value', () => {
    const { viewer, dispose } = setup();
    const overlays = ['overlay-1', 'overlay-2'];

    expect(viewer.overlays()).toBeUndefined();
    viewer.commands.replaceOverlays(overlays);

    expect(viewer.overlays()).toBe(overlays);
    dispose();
  });

  it('isolates viewer runtimes', () => {
    const first = setup();
    const second = setup();
    const root = {} as PDFViewer;
    const popup = {} as PDFViewer;

    first.viewer.commands.installPair({ root, popup });
    first.viewer.commands.replaceOverlays(['overlay-1']);

    expect({
      firstRoot: first.viewer.root(),
      firstPopup: first.viewer.popup(),
      firstOverlays: first.viewer.overlays(),
      secondRoot: second.viewer.root(),
      secondPopup: second.viewer.popup(),
      secondOverlays: second.viewer.overlays(),
    }).toEqual({
      firstRoot: root,
      firstPopup: popup,
      firstOverlays: ['overlay-1'],
      secondRoot: undefined,
      secondPopup: undefined,
      secondOverlays: undefined,
    });
    first.dispose();
    second.dispose();
  });
});
