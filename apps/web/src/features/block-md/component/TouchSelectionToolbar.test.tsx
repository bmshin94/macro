import type { SelectionData } from '@core/component/LexicalMarkdown/plugins';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ElementName } from '@macro-inc/lexical-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { InlineFormat } from './formatMetadata';
import { TouchSelectionToolbar } from './TouchSelectionToolbar';

vi.mock('@core/mobile/nativeEditMenu', () => ({
  hasNativeEditMenu: () => true,
}));

// jsdom lays nothing out, so the toolbar's width measurement finds every
// option at zero and renders no pages. A uniform width stands in for layout;
// the viewport is wide enough that everything lands on one page.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 40,
  });
});

afterEach(cleanup);

const selectionData = (
  overrides: Partial<SelectionData> = {}
): SelectionData => ({
  type: 'range',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  code: false,
  superscript: false,
  subscript: false,
  highlight: false,
  elementsInRange: new Set(),
  nodeKeys: new Set(),
  hasLinks: false,
  onMergableCells: false,
  onSplittableCells: false,
  ...overrides,
});

function setup(
  overrides: {
    canEdit?: boolean;
    hasSelection?: boolean;
    formatState?: SelectionData;
  } = {}
) {
  const onInlineFormat = vi.fn<(format: InlineFormat) => void>();
  const onBlockFormat = vi.fn<(format: ElementName) => void>();
  const onLink = vi.fn();
  render(() => (
    <TouchSelectionToolbar
      canEdit={overrides.canEdit ?? true}
      canComment={false}
      isConverting={false}
      hasSelection={overrides.hasSelection ?? true}
      showTasksOption={false}
      showTableOption={false}
      showEditWithAiOption={false}
      showOpenCommentOption={false}
      locationCopied={false}
      formatState={overrides.formatState ?? selectionData()}
      setPopupVisible={() => {}}
      onConvertToTasks={() => {}}
      onConvertListToTable={() => {}}
      onOpenComment={() => {}}
      onShare={() => {}}
      onInsertComment={() => {}}
      onPaste={() => {}}
      onEditWithAi={() => {}}
      onInlineFormat={onInlineFormat}
      onBlockFormat={onBlockFormat}
      onLink={onLink}
    />
  ));
  return { onInlineFormat, onBlockFormat, onLink };
}

/** The visible page; the hidden measuring row holds a copy of every option. */
const visible = (name: string | RegExp) =>
  screen
    .getAllByRole('button', { name })
    .find((button) => !button.closest('[aria-hidden="true"]'))!;

const openFormatPage = () => visible('Format').click();

describe('TouchSelectionToolbar formatting', () => {
  it('offers formatting for an editable selection', () => {
    setup();
    expect(visible('Format')).toBeDefined();
  });

  it('offers no formatting without edit access or a selection', () => {
    setup({ canEdit: false });
    expect(screen.queryAllByRole('button', { name: 'Format' })).toHaveLength(0);
    cleanup();

    setup({ hasSelection: false });
    expect(screen.queryAllByRole('button', { name: 'Format' })).toHaveLength(0);
  });

  it('swaps the actions for the format toggles and back again', () => {
    setup();
    openFormatPage();

    expect(visible('Bold')).toBeDefined();
    expect(visible('Heading 1')).toBeDefined();
    expect(visible('Code block')).toBeDefined();
    expect(screen.queryAllByRole('button', { name: 'Copy' })).toHaveLength(0);

    visible('Back to actions').click();

    expect(visible('Copy')).toBeDefined();
    expect(screen.queryAllByRole('button', { name: 'Bold' })).toHaveLength(0);
  });

  it('reports the tapped inline and block formats', () => {
    const { onInlineFormat, onBlockFormat } = setup();
    openFormatPage();

    visible('Italic').click();
    visible('Bullet List').click();

    expect(onInlineFormat).toHaveBeenCalledWith('italic');
    expect(onBlockFormat).toHaveBeenCalledWith('list-bullet');
  });

  it('lights the formats the selection already carries', () => {
    setup({
      formatState: selectionData({
        bold: true,
        elementsInRange: new Set<ElementName>(['heading2']),
      }),
    });
    openFormatPage();

    expect(visible('Bold').dataset.variant).toBe('accent');
    expect(visible('Italic').dataset.variant).toBe('ghost');
    expect(visible('Heading 2').dataset.variant).toBe('accent');
    expect(visible('Heading 1').dataset.variant).toBe('ghost');
  });

  it('turns the link toggle into a remove action on a linked selection', () => {
    const { onLink } = setup({
      formatState: selectionData({ hasLinks: true }),
    });
    openFormatPage();

    expect(screen.queryAllByRole('button', { name: 'Insert link' })).toHaveLength(
      0
    );
    visible('Remove link').click();
    expect(onLink).toHaveBeenCalled();
  });

  it('keeps the editor focused when a toggle is pressed', () => {
    setup();
    openFormatPage();

    const pointerDown = new Event('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    visible('Bold').dispatchEvent(pointerDown);

    expect(pointerDown.defaultPrevented).toBe(true);
  });
});
