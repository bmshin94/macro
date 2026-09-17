# Streaming static markdown

Use `StreamingStaticMarkdown` for successively updated strings. It accepts the
same props as `StaticMarkdown`, including themes, `target`, `singleLine`, refs,
and lazy mentions. Keep the same component mounted when the stream finishes.

```tsx
import {
  StaticMarkdownContext,
  StreamingStaticMarkdown,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';

<StaticMarkdownContext>
  <StreamingStaticMarkdown markdown={text()} target="internal" />
</StaticMarkdownContext>
```

The component reparses the full string using the existing Lexical transformers,
extracts render snapshots inside that instance's editor-state read, and
reconciles those snapshots before Solid renders them. It does not keep old
Lexical nodes or editor states in the render tree. A context can still share one
parsing editor across many messages; each message owns its snapshot and
reconciliation history.

Text and containers update in place. Decorators match by type, payload, and
occurrence within their parent. Repeated mentions have separate component
owners. An unchanged mention in a growing paragraph keeps its lazy wrapper,
preview subscription, and local state. A different target or payload gets a new
owner. Structural reinterpretation of markdown can replace an affected subtree;
this is not a general editor diff that preserves identity across arbitrary moves.

Lazy rendering remains enabled by default. A mention outside the viewport's
400px margin stays a placeholder. Once revealed it stays mounted while the
message grows. Scrolling a whole virtualized message out of the transcript can
still unmount that message.

Citation resolutions are scoped to a message, reused on later appends, and
discarded for rendering when their input has been superseded or unmounted.
Unchanged citation results do not trigger a second parse.

Full-document parsing remains proportional to message size on each update.
This change reduces repeated DOM and decorator construction; parsing is not
incremental.

## Regression tests

The lifecycle regression tests are in
`src/lib/core/component/LexicalMarkdown/component/core/StaticMarkdown.test.tsx`.
Run them from `apps/web`:

```sh
bunx vitest run --project core src/lib/core/component/LexicalMarkdown/component/core/StaticMarkdown.test.tsx
```
