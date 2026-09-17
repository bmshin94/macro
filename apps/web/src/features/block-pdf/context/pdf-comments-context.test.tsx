import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommentStore } from '../type/comments';
import { PdfCommentsProvider, usePdfComments } from './pdf-comments-context';

afterEach(cleanup);

describe('PdfCommentsProvider', () => {
  it('derives the comment index from the current projection', () => {
    const first = { id: 1, text: 'first' } as CommentStore[number];
    const replacement = { id: 2, text: 'second' } as CommentStore[number];
    const [comments, setComments] = createSignal<CommentStore>([first]);
    let value!: ReturnType<typeof usePdfComments>;

    function Probe() {
      value = usePdfComments();
      return null;
    }

    render(() => (
      <PdfCommentsProvider comments={comments}>
        <Probe />
      </PdfCommentsProvider>
    ));

    expect(value.byId().get(1)).toEqual(first);

    setComments([replacement]);
    expect({
      all: value.all(),
      removed: value.byId().get(1),
      replacement: value.byId().get(2),
    }).toEqual({
      all: [replacement],
      removed: undefined,
      replacement,
    });
  });
});
