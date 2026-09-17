import type { BlockAlias, BlockName } from './block';
import { resolveBlockAlias } from './constant/allBlocks';

export type ContentIdentity = {
  type: BlockName | BlockAlias | 'component';
  id: string;
};
export type ContentOwner = object | string | symbol;

/** Single-instance by default. CRDT-backed Markdown (including tasks) can opt in. */
const multipleInstanceTypes: Partial<Record<BlockName, boolean>> = { md: true };

export function allowsMultipleContentInstances(type: ContentIdentity['type']) {
  return (
    type !== 'component' &&
    multipleInstanceTypes[resolveBlockAlias(type)] === true
  );
}

export function sameContentIdentity(a: ContentIdentity, b: ContentIdentity) {
  if (a.type === 'component' || b.type === 'component') return false;
  return (
    a.id === b.id && resolveBlockAlias(a.type) === resolveBlockAlias(b.type)
  );
}

/** Owned by the app orchestrator; sources include selections before their UI mounts. */
export function createContentInstanceRegistry() {
  const sources = new Set<
    () => readonly { owner: ContentOwner; content: ContentIdentity }[]
  >();
  return {
    register(
      source: () => readonly { owner: ContentOwner; content: ContentIdentity }[]
    ) {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    isOpenElsewhere(content: ContentIdentity, owner?: ContentOwner) {
      if (allowsMultipleContentInstances(content.type)) return false;
      return [...sources].some((source) =>
        source().some(
          (entry) =>
            entry.owner !== owner && sameContentIdentity(entry.content, content)
        )
      );
    },
  };
}
