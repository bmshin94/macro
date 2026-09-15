import type { EntityItem } from '@core/context/quickAccess';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: () => 'unknown',
}));

import { getMentionTrackTypeFromEntity } from './entityUtils';

function entityItem(bucket: EntityItem['bucket']): EntityItem {
  return {
    kind: 'entity',
    bucket,
    data: { id: 'entity-1', type: 'document', name: 'Entity' },
  } as unknown as EntityItem;
}

describe('getMentionTrackTypeFromEntity', () => {
  it.each(['channel', 'dm'] as const)('tracks a %s as a channel', (bucket) => {
    expect(getMentionTrackTypeFromEntity(entityItem(bucket))).toBe('channel');
  });

  // A company tracked as `document` never shows up in the company record's
  // References, which look the mention up by `crm_company`.
  it('tracks a CRM company under its own entity type', () => {
    expect(getMentionTrackTypeFromEntity(entityItem('crm_company'))).toBe(
      'crm_company'
    );
  });

  it.each(['document', 'task', 'note', 'email', 'project', 'chat'] as const)(
    'tracks a %s as a document',
    (bucket) => {
      expect(getMentionTrackTypeFromEntity(entityItem(bucket))).toBe(
        'document'
      );
    }
  );
});
