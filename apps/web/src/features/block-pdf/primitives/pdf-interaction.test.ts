import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { IHighlight } from '../model/Highlight';
import { createPdfInteraction, type PdfInteraction } from './pdf-interaction';

function setup(): {
  interaction: PdfInteraction;
  dispose: () => void;
} {
  return createRoot((dispose) => ({
    interaction: createPdfInteraction(),
    dispose,
  }));
}

describe('createPdfInteraction', () => {
  it('opens and closes the selection menu', () => {
    const { interaction, dispose } = setup();
    const element = document.createElement('div');

    interaction.openSelectionMenu({ pageIndex: 3, element });
    expect(interaction.selectionMenuLocation()).toEqual({
      pageIndex: 3,
      element,
    });

    interaction.closeSelectionMenu();
    expect(interaction.selectionMenuLocation()).toBeNull();
    dispose();
  });

  it('owns selection, highlight focus, and thread state', () => {
    const { interaction, dispose } = setup();
    const nativeSelection = {} as Selection;
    const highlight = { uuid: 'highlight-1' } as IHighlight;
    const menuElement = document.createElement('div');

    interaction.setNativeSelection(nativeSelection);
    interaction.replaceSelectedHighlights([highlight]);
    interaction.openSelectionMenu({
      pageIndex: 2,
      element: menuElement,
    });
    interaction.activateHighlight(highlight.uuid);
    interaction.hoverHighlight(highlight.uuid);
    interaction.activateCommentThread(-1);
    interaction.markConvertedHighlightDraft(highlight.uuid);
    interaction.suppressActiveThreadScrolling();

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

    interaction.resetSelection();
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

    interaction.clearUserHighlightFocus();
    interaction.clearConvertedHighlightDraft();
    interaction.restoreActiveThreadScrolling();
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

    first.interaction.openSelectionMenu({
      pageIndex: 1,
      element: document.createElement('div'),
    });
    first.interaction.activateHighlight('highlight-1');
    first.interaction.activateCommentThread(-1);
    first.interaction.selectCommentThread(7);
    first.interaction.suppressActiveThreadScrolling();

    expect({
      firstMenuPage: first.interaction.selectionMenuLocation()?.pageIndex,
      firstSelectedThread: first.interaction.selectedCommentThread(),
      secondMenu: second.interaction.selectionMenuLocation(),
      secondSelectedThread: second.interaction.selectedCommentThread(),
      secondActiveHighlight: second.interaction.activeHighlightId(),
      secondActiveThread: second.interaction.activeCommentThreadId(),
      secondScrollSuppressed:
        second.interaction.activeThreadScrollingSuppressed(),
    }).toEqual({
      firstMenuPage: 1,
      firstSelectedThread: 7,
      secondMenu: null,
      secondSelectedThread: null,
      secondActiveHighlight: null,
      secondActiveThread: null,
      secondScrollSuppressed: false,
    });
    first.dispose();
    second.dispose();
  });
});
