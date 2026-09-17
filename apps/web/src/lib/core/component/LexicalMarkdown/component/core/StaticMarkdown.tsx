/** Read-only Lexical markdown, with an opt-in persistent tree for streams. */
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  createEditor,
  type EditorState,
  type EditorThemeClasses,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  useContext,
} from 'solid-js';
import { replaceCitations } from '../../citationsUtils';
import '../../styles.css';
import { theme as baseTheme, createTheme } from '../../theme';
import { forceSingleLine, setEditorStateFromMarkdown } from '../../utils';
import { readMarkdownNodes } from './static-markdown-nodes';
import {
  MarkdownDocument,
  type MarkdownRenderNode,
  reconcileMarkdownNodes,
} from './static-markdown-tree';

export type StaticMarkdownProps = {
  markdown: string;
  parentEditor?: LexicalEditor;
  theme?: EditorThemeClasses;
  setEditorRef?: (editor: LexicalEditor) => void;
  /** This instance's snapshot, even when the parsing editor is shared. */
  setStateRef?: (
    state: Accessor<EditorState | null> | undefined,
    key?: string
  ) => void;
  stateRefKey?: string;
  rootRef?: (ref: HTMLDivElement) => void;
  target?: 'internal' | 'external' | 'both';
  singleLine?: boolean;
  lazy?: boolean;
};

function newStaticRenderingEditor(props: {
  parentEditor?: LexicalEditor;
  theme: EditorThemeClasses;
}): LexicalEditor {
  return createEditor({
    parentEditor: props.parentEditor,
    theme: props.theme,
    namespace: 'static-renderer',
    nodes: SupportedNodeTypes,
    onError: console.error,
  });
}

const context = createContext<{
  editor: LexicalEditor | null;
  theme: Accessor<EditorThemeClasses>;
  lazy: Accessor<boolean>;
}>({ editor: null, theme: () => baseTheme, lazy: () => true });

function Markdown(props: StaticMarkdownProps & { streaming: boolean }) {
  const parent = useContext(context);
  const [editorState, setEditorState] = createSignal<EditorState | null>(null);
  // Resolved citations must not turn back into raw tokens on the next append.
  // This cache belongs to the rendered message, never the shared parsing editor.
  const citationCache = new Map<string, string>();
  const theme = createMemo(() =>
    props.theme ? createTheme(props.theme, parent.theme()) : parent.theme()
  );
  const lazy = () => props.lazy ?? parent.lazy();
  const editor =
    parent.editor ??
    newStaticRenderingEditor({
      parentEditor: props.parentEditor,
      theme: theme(),
    });

  createEffect(() => props.setEditorRef?.(editor));
  createEffect(() => {
    const setStateRef = props.setStateRef;
    const key = props.stateRefKey;
    if (!setStateRef) return;
    setStateRef(editorState, key);
    onCleanup(() => setStateRef(undefined, key));
  });

  // Lexical is an imperative parser. Only these inputs may trigger a parse;
  // preview queries and reactive renderers must not do so.
  createEffect(
    on(
      [() => props.markdown, () => props.target, () => props.singleLine],
      ([markdown, target, singleLine]) => {
        let active = true;
        onCleanup(() => {
          active = false;
        });
        const parse = (text: string) => {
          setEditorStateFromMarkdown(editor, text, target);
          if (singleLine) forceSingleLine(editor);
          setEditorState(editor.getEditorState());
        };
        const currentCitations = new Set(
          [...markdown.matchAll(/\[\[(.*?)\]\]/g)].map((match) => match[1])
        );
        for (const citation of citationCache.keys()) {
          if (!currentCitations.has(citation)) citationCache.delete(citation);
        }
        const normalized = markdown.replace(
          /\[\[(.*?)\]\]/g,
          (token, citation: string) => citationCache.get(citation) ?? token
        );
        parse(normalized);
        if (!markdown.includes('[[')) return;

        async function resolveCitations() {
          try {
            const content = await replaceCitations(markdown, citationCache);
            if (active && content !== normalized) parse(content);
          } catch (error) {
            // Keep the immediately rendered markdown if a citation lookup fails.
            if (active)
              console.error('Static Markdown: citation lookup failed', error);
          }
        }
        void resolveCitations();
      }
    )
  );

  const nodes = createMemo<MarkdownRenderNode[]>((previous) => {
    const state = editorState();
    if (!state) return previous;
    const next = readMarkdownNodes(state);
    return props.streaming ? reconcileMarkdownNodes(previous, next) : next;
  }, []);

  if (props.streaming) {
    return (
      <MarkdownDocument
        nodes={nodes()}
        theme={theme()}
        lazy={lazy()}
        rootRef={props.rootRef}
      />
    );
  }
  // Preserve the one-shot renderer's lifecycle. Both paths use the same node
  // definitions and markup; only streaming retains owners across parses.
  const domTree = createMemo(() => {
    const parsed = nodes();
    if (!editorState()) return null;
    const currentTheme = theme();
    const renderLazy = lazy();
    return (
      <MarkdownDocument
        nodes={parsed}
        theme={currentTheme}
        lazy={renderLazy}
        rootRef={props.rootRef}
      />
    );
  });
  return <>{domTree()}</>;
}

export function StaticMarkdown(props: StaticMarkdownProps) {
  return <Markdown {...props} streaming={false} />;
}

/**
 * Use for successively updated markdown. Keep this component mounted when the
 * stream ends: it also handles complete text, replacement, truncation, and reset.
 * Expensive offscreen mentions remain lazy; revealed mentions retain their owner.
 */
export function StreamingStaticMarkdown(props: StaticMarkdownProps) {
  return <Markdown {...props} streaming />;
}

export function StaticMarkdownContext(props: {
  children: JSX.Element;
  theme?: EditorThemeClasses;
  lazy?: boolean;
}) {
  const theme = createMemo(() =>
    props.theme
      ? createTheme(props.theme, baseTheme, { join: true })
      : baseTheme
  );
  const editor = newStaticRenderingEditor({ theme: theme() });
  return (
    <context.Provider value={{ editor, theme, lazy: () => props.lazy ?? true }}>
      {props.children}
    </context.Provider>
  );
}
