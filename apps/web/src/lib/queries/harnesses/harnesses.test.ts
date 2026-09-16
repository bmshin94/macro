import { useQuery } from '@tanstack/solid-query';
import { expect, it, vi } from 'vitest';

vi.mock('@tanstack/solid-query', () => ({ useQuery: vi.fn() }));
vi.mock('@queries/agents/agents', () => ({ invalidateAgents: vi.fn() }));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));

import { useHarnessesQuery } from './harnesses';

it('does not poll for harness presence', () => {
  useHarnessesQuery();
  const options = vi.mocked(useQuery).mock.calls[0][0]();
  expect(options.refetchInterval).toBeUndefined();
});
