import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { IHighlight } from '../model/Highlight';
import { PayloadMode, type PayloadType } from '../type/placeables';
import { createPdfInteraction, type PdfInteraction } from './pdf-interaction';

function setup(): {
  interaction: PdfInteraction;
  setPlacementMode: (mode: PayloadType) => void;
  dispose: () => void;
} {
  return createRoot((dispose) => {
    const [placementMode, setPlacementMode] = createSignal<PayloadType>(
      PayloadMode.NoMode
    );
    return {
      interaction: createPdfInteraction(placementMode),
      setPlacementMode,
      dispose,
    };
  });
}

describe('createPdfInteraction', () => {
  it('derives click and text-selection locks from their authorities', () => {
    const { interaction, setPlacementMode, dispose } = setup();

    expect({
      overlayClicksDisabled: interaction.overlayClicksDisabled(),
      viewerTextSelectionDisabled: interaction.viewerTextSelectionDisabled(),
    }).toEqual({
      overlayClicksDisabled: false,
      viewerTextSelectionDisabled: false,
    });

    setPlacementMode(PayloadMode.Thread);
    expect(interaction.overlayClicksDisabled()).toBe(true);

    setPlacementMode(PayloadMode.NoMode);
    interaction.commands.selectCommentThread(42);
    expect({
      overlayClicksDisabled: interaction.overlayClicksDisabled(),
      viewerTextSelectionDisabled: interaction.viewerTextSelectionDisabled(),
    }).toEqual({
      overlayClicksDisabled: false,
      viewerTextSelectionDisabled: true,
    });
    dispose();
  });

  it('coordinates viewer and comment text selection synchronously', () => {
    const { interaction, dispose } = setup();

    interaction.commands.selectCommentThread(42);
    interaction.commands.beginViewerTextSelection();

    expect({
      viewerTextSelectionActive: interaction.viewerTextSelectionActive(),
      selectedCommentThread: interaction.selectedCommentThread(),
      overlayClicksDisabled: interaction.overlayClicksDisabled(),
      viewerTextSelectionDisabled: interaction.viewerTextSelectionDisabled(),
    }).toEqual({
      viewerTextSelectionActive: true,
      selectedCommentThread: null,
      overlayClicksDisabled: true,
      viewerTextSelectionDisabled: false,
    });

    interaction.commands.selectCommentThread(7);
    interaction.commands.beginViewerTextSelection();
    interaction.commands.endViewerTextSelection();

    expect({
      viewerTextSelectionActive: interaction.viewerTextSelectionActive(),
      selectedCommentThread: interaction.selectedCommentThread(),
      viewerTextSelectionDisabled: interaction.viewerTextSelectionDisabled(),
    }).toEqual({
      viewerTextSelectionActive: false,
      selectedCommentThread: 7,
      viewerTextSelectionDisabled: true,
    });

    interaction.commands.clearSelectedCommentThread();
    expect(interaction.selectedCommentThread()).toBeNull();
    dispose();
  });

  it('opens and closes the selection menu', () => {
    const { interaction, dispose } = setup();
    const element = document.createElement('div');

    interaction.commands.openSelectionMenu({ pageIndex: 3, element });
    expect(interaction.selectionMenuLocation()).toEqual({
      pageIndex: 3,
      element,
    });

    interaction.commands.closeSelectionMenu();
    expect(interaction.selectionMenuLocation()).toBeNull();
    dispose();
  });

  it('restores page clicks when scoped work returns or throws', () => {
    const { interaction, dispose } = setup();
    const observed: boolean[] = [];

    interaction.commands.runWithPageClicksDisabled(() => {
      observed.push(interaction.pageClicksDisabled());
    });
    observed.push(interaction.pageClicksDisabled());

    expect(() =>
      interaction.commands.runWithPageClicksDisabled(() => {
        observed.push(interaction.pageClicksDisabled());
        throw new Error('failed');
      })
    ).toThrow('failed');

    expect({
      observed,
      pageClicksDisabled: interaction.pageClicksDisabled(),
    }).toEqual({
      observed: [true, false, true],
      pageClicksDisabled: false,
    });
    dispose();
  });

  it('owns selection, highlight focus, and thread state', () => {
    const { interaction, dispose } = setup();
    const nativeSelection = {} as Selection;
    const highlight = { uuid: 'highlight-1' } as IHighlight;
    const menuElement = document.createElement('div');

    interaction.commands.setNativeSelection(nativeSelection);
    interaction.commands.replaceSelectedHighlights([highlight]);
    interaction.commands.openSelectionMenu({
      pageIndex: 2,
      element: menuElement,
    });
    interaction.commands.activateHighlight(highlight.uuid);
    interaction.commands.hoverHighlight(highlight.uuid);
    interaction.commands.activateCommentThread(-1);
    interaction.commands.markConvertedHighlightDraft(highlight.uuid);
    interaction.commands.suppressActiveThreadScrolling();

    expect({
      selection: interaction.annotationSelection(),
      activeHighlightId: interaction.activeHighlightId(),
      hoveredHighlightId: interaction.hoveredHighlightId(),
      activeCommentThreadId: interaction.activeCommentThreadId(),
      convertedHighlightThreadDraftId:
        interaction.convertedHighlightThreadDraftId(),
      activeThreadScrollingSuppressed:
        interaction.activeThreadScrollingSuppressed(),
    }).toEqual({
      selection: {
        nativeSelection,
        selectedHighlights: [highlight],
      },
      activeHighlightId: 'highlight-1',
      hoveredHighlightId: 'highlight-1',
      activeCommentThreadId: -1,
      convertedHighlightThreadDraftId: 'highlight-1',
      activeThreadScrollingSuppressed: true,
    });

    interaction.commands.resetSelection();
    expect({
      selection: interaction.annotationSelection(),
      menu: interaction.selectionMenuLocation(),
      activeHighlightId: interaction.activeHighlightId(),
      activeCommentThreadId: interaction.activeCommentThreadId(),
      hoveredHighlightId: interaction.hoveredHighlightId(),
    }).toEqual({
      selection: {
        nativeSelection: null,
        selectedHighlights: [],
      },
      menu: null,
      activeHighlightId: null,
      activeCommentThreadId: -1,
      hoveredHighlightId: 'highlight-1',
    });

    interaction.commands.clearUserHighlightFocus();
    interaction.commands.clearConvertedHighlightDraft();
    interaction.commands.restoreActiveThreadScrolling();
    expect({
      activeCommentThreadId: interaction.activeCommentThreadId(),
      hoveredHighlightId: interaction.hoveredHighlightId(),
      convertedHighlightThreadDraftId:
        interaction.convertedHighlightThreadDraftId(),
      activeThreadScrollingSuppressed:
        interaction.activeThreadScrollingSuppressed(),
    }).toEqual({
      activeCommentThreadId: null,
      hoveredHighlightId: null,
      convertedHighlightThreadDraftId: null,
      activeThreadScrollingSuppressed: false,
    });
    dispose();
  });

  it('isolates interaction authorities', () => {
    const first = setup();
    const second = setup();

    first.interaction.commands.beginViewerTextSelection();
    first.interaction.commands.openSelectionMenu({
      pageIndex: 1,
      element: document.createElement('div'),
    });
    first.interaction.commands.activateHighlight('highlight-1');
    first.interaction.commands.activateCommentThread(-1);
    first.interaction.commands.suppressActiveThreadScrolling();

    expect({
      firstSelecting: first.interaction.viewerTextSelectionActive(),
      firstMenuPage: first.interaction.selectionMenuLocation()?.pageIndex,
      secondSelecting: second.interaction.viewerTextSelectionActive(),
      secondMenu: second.interaction.selectionMenuLocation(),
      secondOverlayDisabled: second.interaction.overlayClicksDisabled(),
      secondActiveHighlight: second.interaction.activeHighlightId(),
      secondActiveThread: second.interaction.activeCommentThreadId(),
      secondScrollSuppressed:
        second.interaction.activeThreadScrollingSuppressed(),
    }).toEqual({
      firstSelecting: true,
      firstMenuPage: 1,
      secondSelecting: false,
      secondMenu: null,
      secondOverlayDisabled: false,
      secondActiveHighlight: null,
      secondActiveThread: null,
      secondScrollSuppressed: false,
    });
    first.dispose();
    second.dispose();
  });
});
