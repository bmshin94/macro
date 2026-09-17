import { createCallback } from '@solid-primitives/rootless';
import { cn } from '@ui';
import {
  createMemo,
  type JSX,
  onCleanup,
  onMount,
  type VoidProps,
} from 'solid-js';
import { usePdfDocument } from '../context/pdf-document-context';
import { Color, type IColor } from '../model/Color';
import type { IHighlight } from '../model/Highlight';
import { usePopupContextUpdate } from '../signal/definitionPopup';
import { useIsPopup } from '../signal/pdfViewer';
import type { IHighlightObj } from './PageOverlay';

// TODO: only check for highlight IDs within the block DOM subtree
export const highlightIdSelector = (highlightId: string) =>
  `[data-highlight-id="${highlightId}"]`;

export const useResetUserHighlights = () => {
  const { activeCommentThread, activeHighlight, hoverHighlight } =
    usePdfDocument().state.signals;
  const setActiveThread = activeCommentThread[1];
  const setHoverHighlight = hoverHighlight[1];
  const setActiveHighlight = activeHighlight[1];

  return createCallback(() => {
    setActiveThread(null);
    setActiveHighlight(null);
    setHoverHighlight(null);
  });
};

const isHighlightComment = (highlight: IHighlight) =>
  highlight.thread != null || highlight.hasTempThread;

// TODO: handle highlight selection in a different document
export const useHighlightSelection = () => {
  const pdf = usePdfDocument();
  const { signals, stores, derived } = pdf.state;
  const setSelectionStore = stores.selection[1];
  const setActiveThread = signals.activeCommentThread[1];
  const setActiveHighlight = signals.activeHighlight[1];

  return (highlightId: string, element?: HTMLElement) => {
    const highlight = derived.highlightsUuidMap()?.[highlightId];
    if (!highlight) return;

    if (isHighlightComment(highlight)) {
      setActiveThread(highlight.thread?.threadId ?? null);
    } else {
      setActiveHighlight(highlightId);
      setActiveThread(null);
    }

    const highlightElement =
      element ??
      pdf
        .rootElement()
        ?.querySelector<HTMLElement>(highlightIdSelector(highlightId));
    if (!highlightElement) return;

    const rect = highlightElement.getBoundingClientRect();
    const isInViewport =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth);

    if (!isHighlightComment(highlight)) {
      setSelectionStore('highlightsUnderSelection', [highlight]);
      pdf.interaction.commands.openSelectionMenu({
        pageIndex: highlight.pageNum,
        element: highlightElement,
      });
      pdf.navigation.commands.setAnnotationLocation({
        type: 'annotation',
        pageIndex: highlight.pageNum,
        id: highlight.uuid,
      });
    }

    if (!isInViewport) {
      setTimeout(
        () =>
          highlightElement.scrollIntoView({
            behavior: 'instant',
            block: 'center',
          }),
        0
      );
    }
  };
};

/** User Highlight object which stores both regular highlights and comments.
 * Note that comments have a thread id associated with them. */
export function UserHighlight(props: VoidProps<IHighlightObj>) {
  let highlightRef!: HTMLDivElement;
  let textRef!: HTMLDivElement;

  const pdf = usePdfDocument();
  const { signals } = pdf.state;
  const isPopup = useIsPopup();
  const popupDispatchCtx = usePopupContextUpdate(isPopup);
  const highlightSelection = useHighlightSelection();
  const setActiveThread = signals.activeCommentThread[1];
  const [hoverHighlight, setHoverHighlight] = signals.hoverHighlight;
  const setActiveHighlight = signals.activeHighlight[1];

  onMount(() => {
    const handleSelectStart = (e: MouseEvent) => {
      e.stopPropagation();
    };
    highlightRef.addEventListener('mousedown', handleSelectStart);

    textRef.innerText = props.text ?? '';
    textRef.addEventListener('copy', handleCopy);

    onCleanup(() => {
      highlightRef.removeEventListener('mousedown', handleSelectStart);
      textRef.removeEventListener('copy', handleCopy);
    });
  });

  const handleCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const selection = window.getSelection();
    let copiedText = '';

    if (selection && selection.toString()) {
      copiedText = selection.toString();
    } else if (props.text) {
      copiedText = props.text;
    }

    if (copiedText) {
      navigator.clipboard.writeText(copiedText).catch((err) => {
        console.error('Failed to copy text: ', err);
      });
    }
  };

  const isHover = createMemo(
    () => hoverHighlight() === (props.threadId || props.highlightId)
  );

  const alphaColor = createMemo((): IColor => {
    const alpha =
      props.color.alpha === 1
        ? props.color.alpha
        : isHover() || props.isActive
          ? 0.7
          : 0.4;
    return {
      red: props.color.red,
      green: props.color.green,
      blue: props.color.blue,
      alpha,
    };
  });

  const setNoScroll = signals.noScrollToActiveCommentThread[1];
  const clickHandler: JSX.EventHandler<HTMLDivElement, MouseEvent> =
    createCallback((e) => {
      // prevents the page overlay from receiving the click event and resetting
      e.stopPropagation();
      e.stopImmediatePropagation();

      popupDispatchCtx({
        type: 'REMOVE_POPUPS',
      });
      pdf.interaction.commands.closeSelectionMenu();

      if (props.threadId) {
        setNoScroll(true);
        setActiveThread(props.isActive ? null : props.threadId);
        setTimeout(() => setNoScroll(false), 10);
      } else {
        setActiveThread(null);
        highlightSelection(
          props.highlightId,
          e.target instanceof HTMLElement ? e.target : undefined
        );
      }
      setActiveHighlight(props.highlightId);
    });

  return (
    <div
      ref={highlightRef}
      class={cn(
        'absolute',
        props.threadId ? 'z-placeable' : 'z-user-highlight'
      )}
      style={{
        left: `${props.left}px`,
        top: `${props.top}px`,
        width: `${props.width}px`,
        height: `${props.height}px`,
        'pointer-events': 'all',
      }}
      data-highlight-id={props.highlightId}
    >
      <div
        class="relative top-0 left-0 size-full cursor-default"
        style={{
          'background-color': Color.toRgbaString(alphaColor()),
          outline:
            props.isActive && props.threadId ? '2px solid #FACC15' : undefined,
        }}
        on:click={clickHandler}
        onMouseOver={() => setHoverHighlight(props.highlightId)}
        onMouseOut={() => setHoverHighlight(null)}
      >
        <div
          ref={textRef}
          class={cn(
            'absolute inset-0 overflow-hidden whitespace-pre-wrap opacity-0 pointer-events-none',
            props.isActive ? 'select-text' : 'select-none'
          )}
        />
      </div>
    </div>
  );
}
