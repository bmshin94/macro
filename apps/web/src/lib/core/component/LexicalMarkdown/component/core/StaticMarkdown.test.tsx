/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import { $getRoot, type EditorState } from 'lexical';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceCitations } from '../../citationsUtils';
import { setEditorStateFromMarkdown } from '../../utils';
import {
  StaticMarkdown,
  StaticMarkdownContext,
  StreamingStaticMarkdown,
} from './StaticMarkdown';

// Keep the real Lexical parser, render tree, and lazy visibility lifecycle.
// Network-backed decorators are stand-ins with observable mount/local state.
const lifetime = vi.hoisted(() => ({ mounts: 0, disposals: 0 }));
vi.mock('../decorator/DocumentMention', async () => {
  const { createSignal, onMount, onCleanup } = await import('solid-js');
  return {
    DocumentMentionStatic: () => <span data-placeholder>Loading...</span>,
    DocumentMention: (props: {
      documentId: string;
      blockParams?: Record<string, string>;
    }) => {
      const [open, setOpen] = createSignal(false);
      onMount(() => lifetime.mounts++);
      onCleanup(() => lifetime.disposals++);
      return (
        <button
          data-mention={props.documentId}
          data-params={JSON.stringify(props.blockParams)}
          onClick={() => setOpen(!open())}
        >
          {open() ? 'Open' : 'Loaded'}
        </button>
      );
    },
  };
});
vi.mock('../../citationsUtils', () => ({
  replaceCitations: vi.fn(async (text: string) => text),
}));
vi.mock('../../utils', async (importOriginal) => {
  const utils = await importOriginal<typeof import('../../utils')>();
  return {
    ...utils,
    setEditorStateFromMarkdown: vi.fn(utils.setEditorStateFromMarkdown),
  };
});
vi.mock('../../plugins', () => ({}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_MARKDOWN_SEARCH_TEXT: true,
  ENABLE_STATIC_DOCUMENT_CARDS: false,
  ENABLE_SVG_PREVIEW: true,
}));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));
vi.mock('../accessory/CodeBoxAccessory', () => ({
  StaticCodeBoxAccessory: () => <button data-code-accessory>Copy</button>,
}));
vi.mock('./LinkWithPreview', () => ({
  LinkWithPreview: (props: {
    url: string;
    children: import('solid-js').JSX.Element;
  }) => <a href={props.url}>{props.children}</a>,
}));
vi.mock('../decorator/AgentContext', () => ({ AgentContext: () => null }));
vi.mock('../decorator/AgentSessionMention', () => ({
  AgentSessionMention: () => null,
}));
vi.mock('../decorator/Await', () => ({ Await: () => null }));
vi.mock('../decorator/ConnectApp', () => ({ ConnectApp: () => null }));
vi.mock('../decorator/ContactMention', () => ({ ContactMention: () => null }));
vi.mock('../decorator/DateMention', () => ({ DateMention: () => null }));
vi.mock('../decorator/DocumentCard', () => ({ DocumentCard: () => null }));
vi.mock('../decorator/Equation', () => ({
  Equation: (props: { equation: string }) => (
    <span data-equation>{props.equation}</span>
  ),
}));
vi.mock('../decorator/GroupMention', () => ({ GroupMention: () => null }));
vi.mock('../decorator/MagicChip', () => ({ MagicChip: () => null }));
vi.mock('../decorator/MarkdownImage', () => ({ MarkdownImage: () => null }));
vi.mock('../decorator/MarkdownVideo', () => ({ MarkdownVideo: () => null }));
vi.mock('../decorator/PasteNode', () => ({ PasteNode: () => null }));
vi.mock('../decorator/ReplyTarget', () => ({ ReplyTarget: () => null }));
vi.mock('../decorator/Snapshot', () => ({ Snapshot: () => null }));
vi.mock('../decorator/TagMention', () => ({ TagMention: () => null }));
vi.mock('../decorator/ThemeMention', () => ({ ThemeMention: () => null }));
vi.mock('../decorator/UnknownMention', () => ({ UnknownMention: () => null }));
vi.mock('../decorator/UserMention', () => ({ UserMention: () => null }));
vi.mock('../decorator/Watermark', () => ({ Watermark: () => null }));

const observed = new Set<Element>();
let intersect: (entries: IntersectionObserverEntry[]) => void;
class Observer {
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    intersect = callback;
  }
  observe(element: Element) {
    observed.add(element);
  }
  unobserve(element: Element) {
    observed.delete(element);
  }
  disconnect() {
    observed.clear();
  }
}
vi.stubGlobal('IntersectionObserver', Observer);

function reveal() {
  intersect(
    [...observed].map(
      (target) =>
        ({ target, isIntersecting: true }) as IntersectionObserverEntry
    )
  );
}

const mention = (
  documentId = 'doc-a',
  blockParams: Record<string, string> = {}
) =>
  `<m-document-mention>${JSON.stringify({ documentId, documentName: 'Document', blockName: 'md', blockParams })}</m-document-mention>`;

function mountStream(initial: string, lazy = false) {
  const [text, setText] = createSignal(initial);
  const view = render(() => (
    <StaticMarkdownContext>
      <StreamingStaticMarkdown markdown={text()} lazy={lazy} />
    </StaticMarkdownContext>
  ));
  return { ...view, setText };
}

beforeEach(() => {
  lifetime.mounts = 0;
  lifetime.disposals = 0;
  vi.mocked(setEditorStateFromMarkdown).mockClear();
  vi.mocked(replaceCitations)
    .mockReset()
    .mockImplementation(async (text) => text);
});
afterEach(cleanup);

describe('StreamingStaticMarkdown', () => {
  it('retains a revealed mention inside the growing paragraph and across completion', () => {
    const view = mountStream(`Before ${mention()}`, true);
    expect(lifetime.mounts).toBe(0);
    expect(view.container.querySelector('[data-placeholder]')).not.toBeNull();
    reveal();
    const root = view.container.firstElementChild;
    const pill = view.getByText('Loaded');
    fireEvent.click(pill);
    for (let index = 0; index < 20; index++)
      view.setText(`Before ${mention()} ${'more '.repeat(index + 1)}`);
    view.setText(`Before ${mention()} done.\n\nNext paragraph.`);
    expect(view.container.firstElementChild).toBe(root);
    expect(view.getByText('Open')).toBe(pill);
    expect(view.container.textContent).toContain('Next paragraph.');
    expect(view.container.querySelector('[data-placeholder]')).toBeNull();
    expect(lifetime).toEqual({ mounts: 1, disposals: 0 });
  });

  it('never mounts offscreen mentions as streamed text grows, and releases their observer on removal', () => {
    const view = mountStream(`${mention()} start`, true);
    const pending = [...observed][0];
    for (let index = 0; index < 10; index++)
      view.setText(`${mention()} ${index}`);
    expect([...observed]).toEqual([pending]);
    expect(lifetime.mounts).toBe(0);
    view.setText('Removed');
    expect(observed.size).toBe(0);
    reveal();
    expect(lifetime.mounts).toBe(0);
  });

  it.each([
    ['list', (text: string) => `- ${mention()} ${text}`, 'li'],
    ['quote', (text: string) => `> ${mention()} ${text}`, 'blockquote'],
    [
      'table',
      (text: string) => `| Heading |\n| --- |\n| ${mention()} ${text} |`,
      'td',
    ],
  ] as const)('keeps mentions in a growing %s', (_name, markdown, selector) => {
    const view = mountStream(markdown('a'));
    const pill = view.getByText('Loaded');
    expect(pill.closest(selector)).not.toBeNull();
    view.setText(markdown('appended text'));
    expect(view.getByText('Loaded')).toBe(pill);
    expect(lifetime).toEqual({ mounts: 1, disposals: 0 });
  });

  it('gives repeated mentions independent owners and replaces a changed target', () => {
    const view = mountStream(`${mention()} and ${mention()}`);
    const pills = view.getAllByText('Loaded');
    fireEvent.click(pills[1]);
    view.setText(`${mention()} and ${mention()} followed by text`);
    expect(view.getByText('Open')).toBe(pills[1]);
    view.setText(`${mention('doc-b')} and ${mention()} followed by text`);
    expect(view.container.querySelector('[data-mention="doc-b"]')).not.toBe(
      pills[0]
    );
    expect(view.getByText('Open')).toBe(pills[1]);
    expect(lifetime.mounts).toBe(3);
    expect(lifetime.disposals).toBe(1);
  });

  it('replaces changed mention parameters and handles truncation/reset without stale content', () => {
    const view = mountStream(`${mention('doc-a', { nodeId: 'one' })} tail`);
    const pill = view.getByText('Loaded');
    view.setText(mention('doc-a', { nodeId: 'two' }));
    expect(view.getByText('Loaded')).not.toBe(pill);
    expect(view.getByText('Loaded').getAttribute('data-params')).toContain(
      'two'
    );
    expect(view.container.textContent).not.toContain('tail');
    view.setText('');
    expect(view.container.querySelector('[data-mention]')).toBeNull();
    expect(lifetime.disposals).toBe(2);
    view.setText('Fresh reply');
    expect(view.container.textContent).toBe('Fresh reply');
  });

  it('updates formatting and syntax while preserving completed code accessories', () => {
    const view = mountStream('**bold');
    view.setText('**bold**\n\n```ts\nconst value = 1;\n```');
    expect(view.container.querySelector('.font-bold')?.textContent).toBe(
      'bold'
    );
    const code = view.container.querySelector('[data-code-accessory]');
    const highlight = view.container.querySelector('pre')?.firstChild;
    view.setText('**bold**\n\n```ts\nconst value = 1;\n```\n\nMore text');
    expect(view.container.querySelector('[data-code-accessory]')).toBe(code);
    expect(view.container.querySelector('pre')?.firstChild).toBe(highlight);
    view.setText('# A heading\n\n```ts\nconst value = 2;\n```');
    expect(view.container.querySelector('h1')?.textContent).toBe('A heading');
    expect(
      view.container.querySelector('pre')?.getAttribute('data-gutter')
    ).toBe('1\n');
  });

  it('does not parse unchanged text twice when there are no citations', async () => {
    const view = mountStream('hello');
    view.setText('hello world');
    await Promise.resolve();
    expect(setEditorStateFromMarkdown).toHaveBeenCalledTimes(2);
    expect(replaceCitations).not.toHaveBeenCalled();
  });

  it('ignores stale citation resolutions and resolutions after unmount', async () => {
    const pending = new Map<string, (value: string) => void>();
    vi.mocked(replaceCitations).mockImplementation(
      (text) => new Promise((resolve) => pending.set(text, resolve))
    );
    const view = mountStream('old [[citation]]');
    view.setText('new [[citation]]');
    pending.get('new [[citation]]')?.(`new ${mention()}`);
    await waitFor(() => expect(view.container.textContent).toBe('new Loaded'));
    pending.get('old [[citation]]')?.('outdated');
    await Promise.resolve();
    expect(view.container.textContent).toBe('new Loaded');
    view.setText('last [[citation]]');
    const parses = vi.mocked(setEditorStateFromMarkdown).mock.calls.length;
    view.unmount();
    pending.get('last [[citation]]')?.('after unmount');
    await Promise.resolve();
    expect(setEditorStateFromMarkdown).toHaveBeenCalledTimes(parses);
  });

  it('keeps snapshots isolated when messages share a parsing editor', () => {
    const [first, setFirst] = createSignal('First');
    const [second, setSecond] = createSignal('Second');
    let firstState: Accessor<EditorState | null> | undefined;
    let secondState: Accessor<EditorState | null> | undefined;
    const view = render(() => (
      <StaticMarkdownContext>
        <StreamingStaticMarkdown
          markdown={first()}
          setStateRef={(state) => {
            firstState = state;
          }}
        />
        <StreamingStaticMarkdown
          markdown={second()}
          setStateRef={(state) => {
            secondState = state;
          }}
        />
      </StaticMarkdownContext>
    ));
    setFirst('First extended');
    setSecond('Second extended');
    const read = (state: Accessor<EditorState | null> | undefined) =>
      state?.()?.read(() => $getRoot().getTextContent());
    expect(read(firstState)).toBe('First extended');
    expect(read(secondState)).toBe('Second extended');
    expect(view.container.textContent).toBe('First extendedSecond extended');
  });

  it('retains an already resolved citation while later text arrives', async () => {
    vi.mocked(replaceCitations).mockImplementation(async (text, cache) => {
      cache?.set('citation', mention());
      return text.replace('[[citation]]', mention());
    });
    const view = mountStream('See [[citation]]');
    await waitFor(() => expect(view.getByText('Loaded')).toBeTruthy());
    const pill = view.getByText('Loaded');
    view.setText('See [[citation]] and more text');
    await Promise.resolve();
    expect(view.getByText('Loaded')).toBe(pill);
    expect(lifetime).toEqual({ mounts: 1, disposals: 0 });
    // Initial raw parse + citation resolution + one normalized append.
    expect(setEditorStateFromMarkdown).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])(
    'retains an existing duplicate when an earlier citation resolves (leading mention: %s)',
    async (leadingMention) => {
      vi.mocked(replaceCitations).mockImplementation(async (text, cache) => {
        cache?.set('citation', mention());
        return text.replace('[[citation]]', mention());
      });
      const view = mountStream(
        `${leadingMention ? `${mention()} and ` : ''}[[citation]] then ${mention()}`
      );
      const pill = view.getAllByText('Loaded').at(-1)!;
      fireEvent.click(pill);
      await waitFor(() =>
        expect(view.container.querySelectorAll('[data-mention]')).toHaveLength(
          leadingMention ? 3 : 2
        )
      );
      expect(view.getByText('Open')).toBe(pill);
      expect(lifetime.disposals).toBe(0);
    }
  );

  it('renders the same final markup as StaticMarkdown for supported formatting', () => {
    const markdown =
      '# Heading\n\n**bold** _italic_ ~~strike~~ `inline`\n\n- one\n- two\n\n> quote\n\n[link](https://example.com)\n\n| A | B |\n| --- | --- |\n| C | D |\n\n---\n\n```ts\nconst x = 1;\n```';
    const view = render(() => (
      <StaticMarkdownContext>
        <div data-static>
          <StaticMarkdown markdown={markdown} />
        </div>
        <div data-streaming>
          <StreamingStaticMarkdown markdown={markdown} />
        </div>
      </StaticMarkdownContext>
    ));
    expect(view.container.querySelector('[data-streaming]')?.innerHTML).toBe(
      view.container.querySelector('[data-static]')?.innerHTML
    );
  });
});
