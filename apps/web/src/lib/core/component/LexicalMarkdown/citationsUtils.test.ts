import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceCitations } from './citationsUtils';

const getCitation = vi.hoisted(() => vi.fn());
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: { getCitation },
}));
vi.mock('@queries/preview', () => ({
  getItemPreview: vi.fn(),
  isAccessiblePreviewItem: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToBlockName: vi.fn() }));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));

afterEach(() => {
  getCitation.mockReset();
  vi.restoreAllMocks();
});

describe('citation resolution across streamed updates', () => {
  it.each(['result error', 'thrown error'])(
    'retries a failed PDF lookup after a %s and reuses its successful result',
    async (failure) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      if (failure === 'result error')
        getCitation.mockResolvedValueOnce(err('temporarily unavailable'));
      else getCitation.mockRejectedValueOnce(new Error('network failure'));
      getCitation.mockResolvedValueOnce(
        ok({
          document_id: 'pdf-document',
          reference: {
            kind: 'pdf',
            page_index: 2,
            top: 0.1,
            left: 0.2,
            width: 0.3,
            height: 0.4,
          },
        })
      );
      const citation = '6a2b138d-dfbe-439a-a78b-282471a1e165';
      const cache = new Map<string, string>();
      await replaceCitations(`See [[${citation}]]`, cache);
      expect(cache.has(citation)).toBe(false);

      const resolved = await replaceCitations(
        `See [[${citation}]] and more`,
        cache
      );
      expect(resolved).toContain('"documentId":"pdf-document"');
      expect(cache.get(citation)).toContain('"collapsed":true');
      expect(
        await replaceCitations(`See [[${citation}]] and more text`, cache)
      ).toBe(`${resolved} text`);
      expect(getCitation).toHaveBeenCalledTimes(2);
    }
  );
});
