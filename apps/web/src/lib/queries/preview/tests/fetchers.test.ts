import { storageServiceClient } from '@service-storage/client';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name?: string }) => item.name ?? '',
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  isFeatureEnabled: () => false,
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {},
}));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getContact: vi.fn(),
  },
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));
vi.mock('../../channel/message-sender', () => ({
  normalizeMessageSender: (message: unknown) => message,
}));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../email/keys', () => ({ emailKeys: {} }));
vi.mock('../../email/thread', () => ({ threadQueryOptions: vi.fn() }));

import { fetchRestPreviewBatch } from '../fetchers';

function contact(overrides: Partial<CrmContactResponse>): CrmContactResponse {
  return {
    id: 'contact-1',
    companyId: 'company-1',
    email: 'shlomo@example.com',
    name: 'Shlomo Example',
    hidden: false,
    firstInteraction: '2026-09-01T00:00:00Z',
    lastInteraction: '2026-09-14T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

describe('fetchRestPreviewBatch crm_contact', () => {
  beforeEach(() => {
    vi.mocked(storageServiceClient.getContact).mockReset();
  });

  it('resolves a readable contact mention to its name', async () => {
    vi.mocked(storageServiceClient.getContact).mockResolvedValue(
      ok(contact({}))
    );

    const previews = await fetchRestPreviewBatch([
      { id: 'contact-1', type: 'crm_contact' },
    ]);

    expect(storageServiceClient.getContact).toHaveBeenCalledWith({
      contactId: 'contact-1',
    });
    expect(previews.get('contact-1')).toEqual({
      id: 'contact-1',
      type: 'crm_contact',
      access: 'access',
      loading: false,
      rawName: 'Shlomo Example',
      name: 'Shlomo Example',
      updatedAt: '2026-09-14T00:00:00Z',
    });
  });

  it('falls back to the email when the contact has no name', async () => {
    vi.mocked(storageServiceClient.getContact).mockResolvedValue(
      ok(contact({ name: null }))
    );

    const previews = await fetchRestPreviewBatch([
      { id: 'contact-1', type: 'crm_contact' },
    ]);

    expect(previews.get('contact-1')).toMatchObject({
      access: 'access',
      name: 'shlomo@example.com',
      rawName: 'shlomo@example.com',
    });
  });

  it('maps a failed contact fetch to no_access, never does_not_exist', async () => {
    vi.mocked(storageServiceClient.getContact).mockResolvedValue(
      err([{ code: 'not_found', message: 'not found' } as never])
    );

    const previews = await fetchRestPreviewBatch([
      { id: 'contact-1', type: 'crm_contact' },
    ]);

    expect(previews.get('contact-1')).toEqual({
      id: 'contact-1',
      type: 'crm_contact',
      access: 'no_access',
      loading: false,
    });
  });
});
