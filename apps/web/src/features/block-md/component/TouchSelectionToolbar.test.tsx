/**
 * @vitest-environment jsdom
 */

import type { SelectionData } from '@core/component/LexicalMarkdown/plugins';
import type { ElementName } from '@macro-inc/lexical-core';
import { fireEvent, render } from '@solidjs/testing-library';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TouchSelectionToolbar } from './TouchSelectionToolbar';

// The toolbar only renders the options it has measured, and jsdom reports
// every element as zero-width. Give the measuring row a width so the greedy
// partition produces the single page these assertions read.
const OPTION_WIDTH = 40;
let restoreOffsetWidth: PropertyDescriptor | undefined;

beforeAll(() => {
  restoreOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetWidth'
  );
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => OPTION_WIDTH,
  });
});

afterAll(() => {
  if (restoreOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      'offsetWidth',
      restoreOffsetWidth
    );
  }
});

// Spelled out rather than imported from the plugin barrel, which opens a
// collaboration socket jsdom cannot serve.
const selectionData = (overrides: Partial<SelectionData> = {}): SelectionData =>
  ({
    type: 'range',
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
    superscript: false,
    subscript: false,
    highlight: false,
    elementsInRange: new Set<ElementName>(),
    nodeKeys: new Set(),
    hasLinks: false,
    onMergableCells: false,
    onSplittableCells: false,
    ...overrides,
  }) satisfies SelectionData;

const baseProps = () => ({
  canEdit: true,
  canComment: false,
  isConverting: false,
  hasSelection: true,
  showTasksOption: false,
  showTableOption: false,
  showEditWithAiOption: false,
  showFormatOption: true,
  showOpenCommentOption: false,
  locationCopied: false,
  selectionData: selectionData(),
  setPopupVisible: () => {},
  onConvertToTasks: () => {},
  onConvertListToTable: () => {},
  onOpenComment: () => {},
  onShare: () => {},
  onInsertComment: () => {},
  onPaste: () => {},
  onEditWithAi: () => {},
  onInlineFormat: () => {},
  onBlockFormat: () => {},
  onToggleLink: () => {},
});

describe('TouchSelectionToolbar', () => {
  it('swaps the actions for the formatting toggles and back', () => {
    const onInlineFormat = vi.fn();
    const onBlockFormat = vi.fn();
    const { getByRole, queryByRole } = render(() => (
      <TouchSelectionToolbar
        {...baseProps()}
        onInlineFormat={onInlineFormat}
        onBlockFormat={onBlockFormat}
      />
    ));

    expect(queryByRole('button', { name: 'Bold' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Format' }));
    expect(queryByRole('button', { name: 'Copy' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Bold' }));
    expect(onInlineFormat).toHaveBeenCalledWith('bold');

    fireEvent.click(getByRole('button', { name: 'Heading 1' }));
    expect(onBlockFormat).toHaveBeenCalledWith('heading1');

    // Paging back off the first formatting page returns to the actions.
    fireEvent.click(getByRole('button', { name: 'Back to actions' }));
    expect(getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Bold' })).toBeNull();
  });

  it('marks the formats the selection already carries', () => {
    const { getByRole } = render(() => (
      <TouchSelectionToolbar
        {...baseProps()}
        selectionData={selectionData({
          bold: true,
          elementsInRange: new Set<ElementName>(['heading2']),
        })}
      />
    ));

    fireEvent.click(getByRole('button', { name: 'Format' }));

    expect(
      getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')
    ).toBe('false');
    expect(
      getByRole('button', { name: 'Heading 2' }).classList.contains(
        'text-accent'
      )
    ).toBe(true);
  });

  it('offers unlink instead of insert-link on a linked selection', () => {
    const onToggleLink = vi.fn();
    const { getByRole, queryByRole } = render(() => (
      <TouchSelectionToolbar
        {...baseProps()}
        selectionData={selectionData({ hasLinks: true })}
        onToggleLink={onToggleLink}
      />
    ));

    fireEvent.click(getByRole('button', { name: 'Format' }));
    expect(queryByRole('button', { name: 'Insert link' })).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Remove link' }));
    expect(onToggleLink).toHaveBeenCalled();
  });

  it('hides Format while the block cannot be formatted', () => {
    const { queryByRole } = render(() => (
      <TouchSelectionToolbar {...baseProps()} showFormatOption={false} />
    ));

    expect(queryByRole('button', { name: 'Format' })).toBeNull();
    expect(queryByRole('button', { name: 'Copy' })).toBeTruthy();
  });
});
