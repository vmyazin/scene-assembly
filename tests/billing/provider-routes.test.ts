import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { readProviderBilling } = vi.hoisted(() => ({ readProviderBilling: vi.fn() }));
vi.mock('../../lib/billing/provider-readout', () => ({ readProviderBilling }));

import { POST } from '../../app/api/provider-billing/route';

afterEach(() => vi.clearAllMocks());

describe('guest provider billing proxy', () => {
  it('accepts only supported providers and nonempty keys', async () => {
    for (const body of [{ provider: 'comet', apiKey: 'secret' }, { provider: 'kie', apiKey: '' }, null]) {
      const response = await POST(new Request('http://localhost/api/provider-billing', { method: 'POST', body: JSON.stringify(body) }) as NextRequest);
      expect(response.status).toBe(400);
    }
    expect(readProviderBilling).not.toHaveBeenCalled();
  });

  it('returns normalized billing without echoing the key', async () => {
    readProviderBilling.mockResolvedValue({ provider: 'kie', balance: 1500, unit: 'credits', fetchedAt: 1 });
    const response = await POST(new Request('http://localhost/api/provider-billing', { method: 'POST', body: JSON.stringify({ provider: 'kie', apiKey: 'private-key' }) }) as NextRequest);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('private-key');
    expect(readProviderBilling).toHaveBeenCalledWith('kie', 'private-key');
  });
});
