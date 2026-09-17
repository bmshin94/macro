import { ENABLE_STATIC_DOCUMENT_CARDS } from '@core/constant/featureFlags';
import type { CodeNode } from '@lexical/code';
import type { LinkNode } from '@lexical/link';
import { $getListDepth, type ListItemNode, type ListNode } from '@lexical/list';
import type { MarkNode } from '@lexical/mark';
import type { HeadingNode, QuoteNode } from '@lexical/rich-text';
import type { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  $isClassedBlockNode,
  type AgentContextNode,
  type AgentSessionMentionNode,
  type AwaitNode,
  type ClassedBlockNode,
  type ConnectAppNode,
  type ContactMentionNode,
  type DateMentionNode,
  type DocumentCardNode,
  type DocumentMentionNode,
  type EquationNode,
  type GroupMentionNode,
  type HorizontalRuleNode,
  type ImageNode,
  type MagicChipNode,
  type PasteNode,
  type ReplyTargetNode,
  type SnapshotNode,
  type TagMentionNode,
  type ThemeMentionNode,
  type UnknownMentionNode,
  type UserMentionNode,
  type VideoNode,
  type WatermarkNode,
} from '@macro-inc/lexical-core';
import type { SearchMatchNode } from '@macro-inc/lexical-core/nodes/SearchMatchNode';
import { cn } from '@ui';
import {
  $getRoot,
  $isElementNode,
  type EditorState,
  type EditorThemeClasses,
  type LexicalNode,
  type LineBreakNode,
  type ParagraphNode,
  TEXT_TYPE_TO_FORMAT,
  type TextFormatType,
  type TextNode,
} from 'lexical';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { AgentContext } from '../decorator/AgentContext';
import { AgentSessionMention } from '../decorator/AgentSessionMention';
import { Await } from '../decorator/Await';
import { ConnectApp } from '../decorator/ConnectApp';
import { ContactMention } from '../decorator/ContactMention';
import { DateMention } from '../decorator/DateMention';
import { DocumentCard } from '../decorator/DocumentCard';
import {
  DocumentMention,
  DocumentMentionStatic,
} from '../decorator/DocumentMention';
import { Equation } from '../decorator/Equation';
import { GroupMention } from '../decorator/GroupMention';
import { LazyDecorator } from '../decorator/LazyDecorator';
import { MagicChip } from '../decorator/MagicChip';
import { MarkdownImage } from '../decorator/MarkdownImage';
import { MarkdownVideo } from '../decorator/MarkdownVideo';
import { PasteNode as Paste } from '../decorator/PasteNode';
import { ReplyTarget } from '../decorator/ReplyTarget';
import { Snapshot } from '../decorator/Snapshot';
import { TagMention } from '../decorator/TagMention';
import { ThemeMention } from '../decorator/ThemeMention';
import { UnknownMention } from '../decorator/UnknownMention';
import { UserMention } from '../decorator/UserMention';
import { Watermark } from '../decorator/Watermark';
import { LinkWithPreview } from './LinkWithPreview';
import { MarkdownCode } from './static-markdown-code';
import {
  defineMarkdownNode,
  type MarkdownRenderNode,
} from './static-markdown-tree';

const TEXT_FORMATS: TextFormatType[] = [
  'code',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'highlight',
  'subscript',
  'superscript',
];

function textClass(format: number, theme: EditorThemeClasses): string {
  return TEXT_FORMATS.reduce(
    (classes, type) =>
      format & TEXT_TYPE_TO_FORMAT[type]
        ? `${classes} ${theme.text?.[type]}`
        : classes,
    theme.text?.base ?? ''
  );
}

function format(node: LexicalNode): number {
  return '__format' in node && typeof node.__format === 'number'
    ? node.__format
    : 0;
}

// Every read runs under the matching EditorState. Renderers receive only
// captured values, so reactive updates never read another message's shared editor.
const parsers = [
  defineMarkdownNode({
    guard: (node): node is TextNode => node.__type === 'text',
    mutable: true,
    read: (node) => ({ text: node.__text, format: node.__format }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        {props.data.text}
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is LineBreakNode => node.__type === 'linebreak',
    read: () => null,
    render: () => <br />,
  }),
  defineMarkdownNode({
    guard: (node): node is DocumentMentionNode =>
      node.__type === 'document-mention',
    read: (node) => ({ ...node.exportComponentProps(), format: format(node) }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        <Show
          when={props.lazy}
          fallback={
            <DocumentMention
              {...props.data}
              key={props.nodeKey}
              theme={props.theme}
            />
          }
        >
          <LazyDecorator
            placeholder={
              <DocumentMentionStatic
                {...props.data}
                key={props.nodeKey}
                theme={props.theme}
              />
            }
            render={() => (
              <DocumentMention
                {...props.data}
                key={props.nodeKey}
                theme={props.theme}
              />
            )}
          />
        </Show>
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is UserMentionNode => node.__type === 'user-mention',
    read: (node) => ({ ...node.exportComponentProps(), format: format(node) }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        <UserMention {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is AgentSessionMentionNode =>
      node.__type === 'agent-session-mention',
    read: (node) => ({ ...node.exportComponentProps(), format: format(node) }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        <AgentSessionMention
          {...props.data}
          key={props.nodeKey}
          theme={props.theme}
        />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ContactMentionNode =>
      node.__type === 'contact-mention',
    read: (node) => ({ ...node.exportComponentProps(), format: format(node) }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        <ContactMention
          {...props.data}
          key={props.nodeKey}
          theme={props.theme}
        />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is DateMentionNode => node.__type === 'date-mention',
    read: (node) => ({ ...node.exportComponentProps(), format: format(node) }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        <DateMention {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is WatermarkNode => node.__type === 'watermark',
    read: (node) => ({ ...node.exportComponentProps(), format: format(node) }),
    render: (props) => (
      <span class={textClass(props.data.format, props.theme)}>
        <Watermark {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ThemeMentionNode => node.__type === 'theme-mention',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <span>
        <ThemeMention {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ConnectAppNode => node.__type === 'connect-app',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <span>
        <ConnectApp {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is TagMentionNode => node.__type === 'tag-mention',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <span>
        <TagMention {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is GroupMentionNode => node.__type === 'group-mention',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <span>
        <GroupMention {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is AwaitNode => node.__type === 'await',
    read: (node) => {
      const data = node.exportComponentProps();
      return { ...data, text: data.text, inline: data.inline ?? true };
    },
    render: (props) => (
      <span>
        <Await {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is AgentContextNode => node.__type === 'agent-context',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <AgentContext {...props.data} key={props.nodeKey} theme={props.theme} />
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ReplyTargetNode => node.__type === 'reply-target',
    read: (node) => ({
      ...node.exportComponentProps(),
      targetMessageId: node.__targetMessageId,
    }),
    render: (props) => (
      <div
        class="max-w-full"
        data-reply-target-node={props.data.targetMessageId}
      >
        <ReplyTarget {...props.data} key={props.nodeKey} theme={props.theme} />
      </div>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is MagicChipNode => node.__type === 'magic-chip',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <div class="min-w-0 max-w-full overflow-x-hidden">
        <MagicChip {...props.data} />
      </div>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is SnapshotNode => node.__type === 'snapshot',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <span>
        <Snapshot {...props.data} key={props.nodeKey} theme={props.theme} />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is UnknownMentionNode =>
      node.__type === 'unknown-mention',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <span>
        <UnknownMention
          {...props.data}
          key={props.nodeKey}
          theme={props.theme}
        />
      </span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ImageNode => node.__type === 'image',
    read: (node) => node.exportComponentProps(),
    render: (props) => <MarkdownImage {...props.data} />,
  }),
  defineMarkdownNode({
    guard: (node): node is VideoNode => node.__type === 'video',
    read: (node) => node.exportComponentProps(),
    render: (props) => <MarkdownVideo {...props.data} />,
  }),
  defineMarkdownNode({
    guard: (node): node is HorizontalRuleNode =>
      node.__type === 'horizontalrule',
    read: () => null,
    render: (props) => <div class={props.theme.hr} />,
  }),
  defineMarkdownNode({
    guard: (node): node is EquationNode => node.__type === 'equation',
    read: (node) => ({ equation: node.__equation, inline: node.__inline }),
    render: (props) => <Equation {...props.data} />,
  }),
  defineMarkdownNode({
    guard: (node): node is DocumentCardNode => node.__type === 'document-card',
    read: (node) => node.exportComponentProps(),
    render: (props) =>
      ENABLE_STATIC_DOCUMENT_CARDS ? (
        <DocumentCard {...props.data} key={props.nodeKey} theme={props.theme} />
      ) : (
        <p class="my-1.5">
          <DocumentMention
            {...props.data}
            key={props.nodeKey}
            theme={props.theme}
          />
        </p>
      ),
  }),
  defineMarkdownNode({
    guard: (node): node is PasteNode => node.__type === 'paste',
    read: (node) => node.exportComponentProps(),
    render: (props) => (
      <Paste {...props.data} key={props.nodeKey} theme={props.theme} />
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ParagraphNode => node.__type === 'paragraph',
    mutable: true,
    read: () => null,
    render: (props) => <p class={props.theme.paragraph}>{props.children}</p>,
  }),
  defineMarkdownNode({
    guard: (node): node is HeadingNode => node.__type === 'heading',
    mutable: true,
    read: (node) => ({ tag: node.__tag }),
    render: (props) => (
      <Dynamic
        component={props.data.tag}
        class={props.theme.heading?.[props.data.tag]}
      >
        {props.children}
      </Dynamic>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ListNode => node.__type === 'list',
    mutable: true,
    read: (node) => ({
      type: node.__listType,
      depth: $getListDepth(node),
      start: node.__start,
    }),
    render: (props) => (
      <Dynamic
        component={props.data.type === 'number' ? 'ol' : 'ul'}
        class={
          props.data.type === 'number'
            ? props.theme.list?.ol + ' static-md'
            : cn(
                props.theme.list?.ul,
                props.data.type === 'check' && props.theme.list?.checklist
              )
        }
        classList={{
          [`depth-${props.data.depth}`]: props.data.type === 'number',
        }}
        style={
          props.data.type === 'number'
            ? {
                'counter-reset': `static-md-counter-${props.data.depth} ${props.data.start - 1}`,
              }
            : undefined
        }
      >
        {props.children}
      </Dynamic>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ListItemNode => node.__type === 'listitem',
    mutable: true,
    read: (node) => ({
      checked: node.__checked,
      nested: node.getChildren().some((child) => child.__type === 'list'),
    }),
    render: (props) => (
      <li
        class={cn(
          props.theme.list?.listitem,
          props.data.checked && props.theme.list?.listitemChecked,
          props.data.nested && props.theme.list?.nested?.listitem
        )}
      >
        {props.children}
      </li>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is QuoteNode => node.__type === 'quote',
    mutable: true,
    read: () => null,
    render: (props) => (
      <blockquote class={props.theme.quote}>{props.children}</blockquote>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is CodeNode => node.__type === 'code',
    mutable: true,
    read: (node) => ({
      language: node.__language ?? undefined,
      text: node.getTextContent(),
    }),
    render: (props) => <MarkdownCode {...props.data} theme={props.theme} />,
  }),
  defineMarkdownNode({
    guard: (node): node is LinkNode => node.__type === 'link',
    // LinkWithPreview captures its URL when mounting its unfurl query.
    read: (node) => ({ url: node.__url, title: node.__title ?? node.__url }),
    render: (props) => (
      <LinkWithPreview {...props.data} class={props.theme.link}>
        {props.children}
      </LinkWithPreview>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is MarkNode => node.__type === 'mark',
    mutable: true,
    read: () => null,
    render: (props) => <span class={props.theme.mark}>{props.children}</span>,
  }),
  defineMarkdownNode({
    guard: (node): node is SearchMatchNode => node.__type === 'search-match',
    mutable: true,
    read: () => null,
    render: (props) => (
      <span class={props.theme.searchMatch}>{props.children}</span>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is TableNode => node.__type === 'table',
    mutable: true,
    read: () => null,
    render: (props) => (
      <div class={cn(props.theme.static?.['table-container'])}>
        <table
          class={cn(props.theme.table, 'min-w-full table-auto')}
          style="width: max-content;"
        >
          {props.children}
        </table>
      </div>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is TableRowNode => node.__type === 'tablerow',
    mutable: true,
    read: (node) => ({
      first: node.getIndexWithinParent() === 0,
      height: node.getHeight(),
    }),
    render: (props) => (
      <tr
        class={cn(props.theme.tableRow, props.data.first && 'font-bold')}
        style={
          props.data.height ? { height: `${props.data.height}px` } : undefined
        }
      >
        {props.children}
      </tr>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is TableCellNode => node.__type === 'tablecell',
    mutable: true,
    read: (node) => ({ colSpan: node.__colSpan, rowSpan: node.__rowSpan }),
    render: (props) => (
      <td
        class={cn(props.theme.tableCell, 'min-w-25 max-w-87.5')}
        colspan={props.data.colSpan}
        rowspan={props.data.rowSpan}
      >
        {props.children}
      </td>
    ),
  }),
  defineMarkdownNode({
    guard: (node): node is ClassedBlockNode => $isClassedBlockNode(node),
    mutable: true,
    read: (node) => ({
      tag: node.__tag,
      classes: node.__classes.join(' '),
      attributes: node.__attributes,
    }),
    render: (props) => (
      <Dynamic
        component={props.data.tag}
        class={props.data.classes}
        data-classed-block="true"
        {...props.data.attributes}
      >
        {props.children}
      </Dynamic>
    ),
  }),
];

function readNode(node: LexicalNode): MarkdownRenderNode {
  for (const parse of parsers) {
    const parsed = parse(node);
    if (!parsed) continue;
    // Code owns its highlighted content; its Lexical text children are not
    // separately rendered (nor unnecessarily allocated as DOM nodes).
    if ($isElementNode(node) && node.__type !== 'code') {
      parsed.children = node.getChildren().map(readNode);
    }
    return parsed;
  }
  console.error('Static Markdown: no renderer for', node.getType());
  return {
    key: node.getKey(),
    identity: `unsupported:${node.getType()}`,
    signature: '',
    data: null,
    children: [],
    render: () => '',
  };
}

export function readMarkdownNodes(state: EditorState): MarkdownRenderNode[] {
  return state.read(() => $getRoot().getChildren().map(readNode));
}
