import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import type { EditorThemeClasses, LexicalNode } from 'lexical';
import { type Accessor, createMemo, type JSX } from 'solid-js';

type RenderProps<T> = {
  data: T;
  nodeKey: string;
  theme: EditorThemeClasses;
  lazy: boolean;
  children: JSX.Element;
};

/** A render snapshot: no Lexical nodes or editor-state reads survive parsing. */
export type MarkdownRenderNode = {
  key: string;
  identity: string;
  signature: string;
  data: unknown;
  children: MarkdownRenderNode[];
  render: (props: RenderProps<unknown>) => JSX.Element;
};

export function defineMarkdownNode<N extends LexicalNode, T>(definition: {
  guard: (node: LexicalNode) => node is N;
  read: (node: N) => T;
  render: (props: RenderProps<T>) => JSX.Element;
  /** Text and containers update in place. Atomic decorators match their payload. */
  mutable?: boolean;
}) {
  // The matching parser is the only producer of this renderer's data. Keeping
  // the erasure here lets each node definition retain its exact snapshot type.
  const render = (props: RenderProps<unknown>) =>
    definition.render({
      get data() {
        return props.data as T;
      },
      get nodeKey() {
        return props.nodeKey;
      },
      get theme() {
        return props.theme;
      },
      get lazy() {
        return props.lazy;
      },
      get children() {
        return props.children;
      },
    });
  return (node: LexicalNode): MarkdownRenderNode | undefined => {
    if (!definition.guard(node)) return;
    const data = definition.read(node);
    const signature = JSON.stringify(data);
    return {
      key: node.getKey(),
      identity: `${node.getType()}:${definition.mutable ? '' : signature}`,
      signature,
      data,
      children: [],
      render,
    };
  };
}

/**
 * Match siblings by kind (text/containers) or complete payload (decorators).
 * Preserve unchanged edges and positions before matching remaining occurrences.
 * This keeps duplicate mentions distinct when an earlier citation resolves or a
 * target changes. Lexical allocates new keys on every parse, so reuse old keys.
 * Matching is local to the parent and linear in the number of nodes.
 */
export function reconcileMarkdownNodes(
  previous: MarkdownRenderNode[],
  next: MarkdownRenderNode[]
): MarkdownRenderNode[] {
  const matches = new Map<number, MarkdownRenderNode>();
  const used = new Set<MarkdownRenderNode>();
  const match = (index: number, old: MarkdownRenderNode) => {
    matches.set(index, old);
    used.add(old);
  };
  const unchanged = (old: MarkdownRenderNode, node: MarkdownRenderNode) =>
    old.identity === node.identity && old.signature === node.signature;
  let start = 0;
  while (
    start < Math.min(previous.length, next.length) &&
    unchanged(previous[start], next[start])
  ) {
    match(start, previous[start]);
    start++;
  }
  let oldEnd = previous.length - 1;
  let nextEnd = next.length - 1;
  while (
    oldEnd >= start &&
    nextEnd >= start &&
    unchanged(previous[oldEnd], next[nextEnd])
  ) {
    match(nextEnd--, previous[oldEnd--]);
  }
  for (let index = start; index <= Math.min(oldEnd, nextEnd); index++) {
    const old = previous[index];
    if (!used.has(old) && old.identity === next[index].identity) {
      match(index, old);
    }
  }
  const groups = new Map<
    string,
    { nodes: MarkdownRenderNode[]; cursor: number }
  >();
  for (const node of previous) {
    if (used.has(node)) continue;
    const group = groups.get(node.identity);
    if (group) group.nodes.push(node);
    else groups.set(node.identity, { nodes: [node], cursor: 0 });
  }
  const reconciled = next.map((node, index) => {
    const group = groups.get(node.identity);
    const old = matches.get(index) ?? group?.nodes[group.cursor++];
    if (!old) return node;
    const children = reconcileMarkdownNodes(old.children, node.children);
    if (old.signature === node.signature && children === old.children) {
      return old;
    }
    return {
      ...node,
      key: old.key,
      data: old.signature === node.signature ? old.data : node.data,
      children,
    };
  });
  return reconciled.length === previous.length &&
    reconciled.every((node, index) => node === previous[index])
    ? previous
    : reconciled;
}

type TreeProps = {
  nodes: MarkdownRenderNode[];
  theme: EditorThemeClasses;
  lazy: boolean;
};

function MarkdownNode(props: {
  node: Accessor<MarkdownRenderNode>;
  theme: EditorThemeClasses;
  lazy: boolean;
}) {
  // A sibling append changes the parent snapshot, but not its presentation.
  const data = createMemo(() => props.node().data);
  return props.node().render({
    get data() {
      return data();
    },
    nodeKey: props.node().key,
    get theme() {
      return props.theme;
    },
    get lazy() {
      return props.lazy;
    },
    children: (
      <MarkdownTree
        nodes={props.node().children}
        theme={props.theme}
        lazy={props.lazy}
      />
    ),
  });
}

function MarkdownTree(props: TreeProps): JSX.Element {
  return (
    <Key each={props.nodes} by="key">
      {(node) => (
        <MarkdownNode node={node} theme={props.theme} lazy={props.lazy} />
      )}
    </Key>
  );
}

export function MarkdownDocument(
  props: TreeProps & { rootRef?: (ref: HTMLDivElement) => void }
) {
  return (
    <div
      class={cn(
        'markdown-content',
        props.theme.root,
        'wrap-break-word max-w-full'
      )}
      ref={(element) => props.rootRef?.(element)}
    >
      <MarkdownTree nodes={props.nodes} theme={props.theme} lazy={props.lazy} />
    </div>
  );
}
