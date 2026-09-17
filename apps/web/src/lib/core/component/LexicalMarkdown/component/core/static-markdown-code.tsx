import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import { PrismTokenizer } from '@lexical/code';
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  normalizedLanguage,
} from '@macro-inc/lexical-core';
import type { EditorThemeClasses } from 'lexical';
import { createMemo, createSignal, Show } from 'solid-js';
import { StaticCodeBoxAccessory } from '../accessory/CodeBoxAccessory';

type Token = {
  type: string;
  content: string | Token | (string | Token)[];
};

const CodeHighlightShim = {
  createEmptyLinePlaceholder: (): Node => {
    const spanNode = document.createElement('span');
    spanNode.classList.add('md-code-empty-line');
    spanNode.setAttribute('aria-hidden', 'true');
    spanNode.innerText = '\u200B';
    return spanNode;
  },

  /**
   * Get highlight spans from the Prism tokens.
   */
  getHighlights: (
    tokens: Array<string | Token>,
    type: string | null,
    theme: EditorThemeClasses
  ): Node[] => {
    const nodes: Node[] = [];
    let atLineStart = true;
    for (const token of tokens) {
      if (typeof token === 'string') {
        const partials = token.split(/(\n|\t)/);
        const partialsLength = partials.length;
        for (let i = 0; i < partialsLength; i++) {
          const part = partials[i];
          if (part === '\n' || part === '\r\n') {
            if (atLineStart) {
              nodes.push(CodeHighlightShim.createEmptyLinePlaceholder());
            }
            nodes.push(document.createElement('br'));
            atLineStart = true;
          } else if (part === '\t') {
            const tabNode = document.createElement('span');
            const className = theme.tab;
            if (className) tabNode.classList.add(className);
            nodes.push(tabNode);
            atLineStart = false;
          } else if (part.length > 0) {
            const spanNode = document.createElement('span');
            const className = type
              ? (theme?.codeHighlight?.[type!] ?? null)
              : null;
            if (className) spanNode.classList.add(className);
            spanNode.innerText = part;
            nodes.push(spanNode);
            atLineStart = false;
          }
        }
      } else {
        const { content } = token;
        if (typeof content === 'string') {
          nodes.push(
            ...CodeHighlightShim.getHighlights([content], token.type, theme)
          );
        } else if (Array.isArray(content)) {
          nodes.push(
            ...CodeHighlightShim.getHighlights(content, token.type, theme)
          );
        }
      }
    }
    if (nodes.length === 0) {
      nodes.push(CodeHighlightShim.createEmptyLinePlaceholder());
    }
    return nodes;
  },

  getLineNumbers: (text: string) => {
    let lineCount = 1;
    let lineNumbers = '1\n';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        lineCount++;
        lineNumbers += lineCount + '\n';
      }
    }
    return lineNumbers;
  },
};

export function MarkdownCode(props: {
  language?: string;
  text: string;
  theme: EditorThemeClasses;
}) {
  const language = () => {
    const value = props.language ?? DEFAULT_LANGUAGE;
    return isSupportedLanguage(value) ? normalizedLanguage(value) : value;
  };
  const nodes = createMemo(() => {
    const tokens = PrismTokenizer.tokenize(props.text, language());
    return CodeHighlightShim.getHighlights(
      tokens as Array<string | Token>,
      null,
      props.theme
    );
  });
  return (
    <StaticCodeContainer
      language={language()}
      text={props.text}
      theme={props.theme}
      nodes={nodes()}
    />
  );
}

function StaticCodeContainer(props: {
  language: string;
  text: string;
  theme: EditorThemeClasses;
  nodes: Node[];
}) {
  const [isPreviewMode, setIsPreviewMode] = createSignal(false);

  const showPreview = () => {
    return (
      ENABLE_SVG_PREVIEW &&
      props.language.toLowerCase() === 'svg' &&
      isPreviewMode()
    );
  };

  return (
    <div
      class={props.theme.static?.['code-container']}
      classList={{
        'md-static-code-container': true,
      }}
      style={{
        position: 'relative',
        'min-height': showPreview() ? '400px' : 'auto',
      }}
    >
      <StaticCodeBoxAccessory
        language={props.language}
        code={props.text}
        theme={props.theme}
        isPreviewMode={isPreviewMode}
        setIsPreviewMode={setIsPreviewMode}
      />
      <Show when={!showPreview()}>
        <pre
          class={props.theme.static?.['code'] ?? props.theme.code}
          data-gutter={CodeHighlightShim.getLineNumbers(props.text)}
        >
          {props.nodes}
        </pre>
      </Show>
    </div>
  );
}
