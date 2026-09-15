/**
 * @file Icons, labels and shortcuts for the markdown editor's formats, shared
 * by every surface that offers them. Kept apart from FormatTools so the touch
 * selection toolbar can reuse them without pulling in the whole toolbar.
 */

import type { ValidHotkey } from '@core/hotkey/types';
import type { ElementName } from '@macro-inc/lexical-core';
import Check from '@phosphor/check-square.svg';
import TextCode from '@phosphor/code.svg';
import CodeBlock from '@phosphor/code-block.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListChecks from '@phosphor/list-checks.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import One from '@phosphor/number-one.svg';
import TextHighlight from '@phosphor/paint-roller.svg';
import Quote from '@phosphor/quotes.svg';
import TextBold from '@phosphor/text-b.svg';
import TextH1 from '@phosphor/text-h-one.svg';
import TextH3 from '@phosphor/text-h-three.svg';
import TextH2 from '@phosphor/text-h-two.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStriketrough from '@phosphor/text-strikethrough.svg';
import TextSub from '@phosphor/text-subscript.svg';
import TextSuper from '@phosphor/text-superscript.svg';
import TextT from '@phosphor/text-t.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import type { Component, JSX } from 'solid-js';

export type SvgIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export type NodeMenuOption = {
  label: string;
  icon: SvgIcon;
  show: boolean;
  themeClass?: string;
  before?: JSX.Element;
};

export const NodeMenuOptions: Record<ElementName, NodeMenuOption> = {
  paragraph: {
    label: 'Body',
    icon: TextT,
    show: false,
    themeClass: '',
  },
  heading1: {
    label: 'Heading 1',
    icon: TextH1,
    show: true,
    themeClass: 'text-[1.15em] font-bold',
  },
  heading2: {
    label: 'Heading 2',
    icon: TextH2,
    show: true,
    themeClass: 'text-[1.07em] font-bold',
  },
  heading3: {
    label: 'Heading 3',
    icon: TextH3,
    show: true,
    themeClass: 'text-[1.03em] font-bold',
  },
  quote: { label: 'Quote', icon: Quote, show: true, themeClass: 'italic' },
  code: { label: 'Code', icon: CodeBlock, show: true, themeClass: 'font-mono' },
  'custom-code': {
    label: 'Code',
    icon: CodeBlock,
    show: false,
    themeClass: 'font-mono',
  },
  'list-bullet': {
    label: 'Bullet List',
    icon: ListBullets,
    show: true,
    before: <div class="bg-ink size-1.5 rounded-full ml-1.5 mr-3" />,
  },
  'list-number': {
    label: 'Numbered List',
    icon: ListNumbers,
    show: true,
    before: <One class="size-4 mr-2" />,
  },
  'list-check': {
    label: 'Checklist',
    icon: ListChecks,
    show: true,
    before: <Check class="size-4 mr-2" />,
  },
  link: { label: 'Link', icon: LinkIcon, show: false, themeClass: '' },
} as const;

export type InlineFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'highlight'
  | 'code'
  | 'superscript'
  | 'subscript';

export const InlineIcons: Record<InlineFormat, SvgIcon> = {
  bold: TextBold,
  italic: TextItalic,
  underline: TextUnderline,
  strikethrough: TextStriketrough,
  highlight: TextHighlight,
  code: TextCode,
  superscript: TextSuper,
  subscript: TextSub,
} as const;

export const InlineShortcuts: Partial<Record<InlineFormat, ValidHotkey>> = {
  bold: 'cmd+b',
  italic: 'cmd+i',
  underline: 'cmd+u',
  strikethrough: 'shift+cmd+x',
  highlight: 'shift+cmd+h',
  code: 'cmd+e',
} as const;

export const InlineLabels: Record<InlineFormat, string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  highlight: 'Highlight',
  code: 'Inline code',
  superscript: 'Superscript',
  subscript: 'Subscript',
} as const;
