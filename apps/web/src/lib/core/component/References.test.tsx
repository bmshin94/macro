import type { ApiAttachmentEntityReference } from '@service-storage/generated/schemas/apiAttachmentEntityReference';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryState = {
  isSuccess: boolean;
  data: ApiAttachmentEntityReference[] | undefined;
};

const [queryState, setQueryState] = createSignal<QueryState>({
  isSuccess: false,
  data: undefined,
});
const useAttachmentReferencesQueryMock = vi.hoisted(() => vi.fn());
const navigateToChannelMessageMock = vi.hoisted(() => vi.fn());

// The section registers with the side panel accordion, which needs the
// panel layout; render the section inline instead.
vi.mock('@components/app/side-panel', () => ({
  SidePanel: {
    Section: (props: {
      id: string;
      title: JSX.Element;
      children: JSX.Element;
    }) => (
      <section data-section={props.id}>
        <h3>{props.title}</h3>
        {props.children}
      </section>
    ),
    CountTitle: (props: { label: string; count: number }) => (
      <span>
        {props.label} {props.count}
      </span>
    ),
    Loading: () => <div data-loading />,
    Card: (props: { children: JSX.Element }) => <div>{props.children}</div>,
  },
}));
vi.mock('@queries/storage/attachment-references', () => ({
  useAttachmentReferencesQuery: useAttachmentReferencesQueryMock,
}));
vi.mock('@queries/preview', () => ({
  useItemPreview: () => [() => ({ loading: true }), {}],
  isAccessiblePreviewItem: () => false,
}));
vi.mock('./ItemPreview', () => ({
  InlineItemPreview: (props: { id: string }) => (
    <span data-inline-preview={props.id} />
  ),
}));
vi.mock('./LexicalMarkdown/component/core/StaticMarkdown', () => ({
  StaticMarkdown: (props: { markdown: string }) => <div>{props.markdown}</div>,
}));
vi.mock('./LexicalMarkdown/theme', () => ({ twoLineClampMarkdownTheme: {} }));
vi.mock('./UserIcon', () => ({ UserIcon: () => <span data-user-icon /> }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({}),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@block-channel/utils/link', () => ({
  navigateToChannelMessage: navigateToChannelMessageMock,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@entity', () => ({ formatRelativeTimestamp: () => '1h' }));
vi.mock('@core/user', () => ({
  getDisplayNameParts: () => ({ firstName: 'Jacob', fullName: 'Jacob B' }),
  tryMacroId: (id: string) => id,
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'md',
}));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: (onNavigate: (e: MouseEvent) => void) => ({
    onMouseDown: () => {},
    onClick: onNavigate,
  }),
}));

import { ReferencesSidePanelSection } from './References';

const channelReference = {
  reference_type: 'channel',
  channel_id: 'channel-1',
  channel_name: 'gtm',
  message_id: 'message-1',
  thread_id: null,
  sender_id: 'macro|jacob@macro.com',
  message_content:
    'can u invite <m-document-mention>{"documentId":"contact-1"}</m-document-mention> to party too',
  message_created_at: '2026-09-15T19:55:05Z',
  attachment_created_at: '2026-09-15T19:55:05Z',
} as unknown as ApiAttachmentEntityReference;

function renderSection() {
  return render(() => (
    <ReferencesSidePanelSection
      entityId="contact-1"
      entityType="crm_contact"
      order={30}
    />
  ));
}

describe('ReferencesSidePanelSection', () => {
  beforeEach(() => {
    setQueryState({ isSuccess: false, data: undefined });
    useAttachmentReferencesQueryMock.mockReset();
    useAttachmentReferencesQueryMock.mockImplementation(() => ({
      get isSuccess() {
        return queryState().isSuccess;
      },
      get data() {
        return queryState().data;
      },
    }));
    navigateToChannelMessageMock.mockReset();
  });
  afterEach(cleanup);

  it('queries references for the record by its CRM entity type', () => {
    renderSection();

    const [entityId, entityType] =
      useAttachmentReferencesQueryMock.mock.calls[0] ?? [];
    expect(entityId?.()).toBe('contact-1');
    expect(entityType?.()).toBe('crm_contact');
  });

  it('renders nothing while pending and nothing for a record with no mentions', () => {
    const { container } = renderSection();
    expect(container.querySelector('[data-section]')).toBeNull();

    setQueryState({ isSuccess: true, data: [] });
    expect(container.querySelector('[data-section]')).toBeNull();
  });

  it('shows the counted section with a row per mentioning message once references land', () => {
    const { container } = renderSection();

    setQueryState({ isSuccess: true, data: [channelReference] });

    const section = container.querySelector('[data-section="references"]');
    expect(section).not.toBeNull();
    expect(section?.querySelector('h3')?.textContent).toBe('References 1');
    const row = section?.querySelector('[role="button"]');
    expect(row?.textContent).toContain('Jacob');
    expect(row?.textContent).toContain('to party too');
    expect(
      row?.querySelector('[data-inline-preview="channel-1"]')
    ).not.toBeNull();
  });

  it('opens the mentioning message when a row is clicked', () => {
    const { container } = renderSection();
    setQueryState({ isSuccess: true, data: [channelReference] });

    const row = container.querySelector('[role="button"]');
    if (!row) throw new Error('row not rendered');
    fireEvent.click(row);

    expect(navigateToChannelMessageMock).toHaveBeenCalledTimes(1);
    const [, channelId, messageId, threadId] =
      navigateToChannelMessageMock.mock.calls[0] ?? [];
    expect(channelId).toBe('channel-1');
    expect(messageId).toBe('message-1');
    expect(threadId).toBeNull();
  });
});
