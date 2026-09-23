import { afterEach, describe, expect, it, vi } from 'vitest';

import { readProviderBilling } from '../../lib/billing/provider-readout';

afterEach(() => vi.restoreAllMocks());

describe('read-only provider billing', () => {
  it('reads Kie credits and rejects a vendor error with HTTP 200', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ code: 200, data: 1900 }));
    await expect(readProviderBilling('kie', 'secret')).resolves.toMatchObject({ provider: 'kie', balance: 1900, unit: 'credits' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.kie.ai/api/v1/chat/credit');
    fetch.mockResolvedValueOnce(Response.json({ code: 401, msg: 'bad key' }));
    await expect(readProviderBilling('kie', 'secret')).rejects.toThrow();
  });

  it('reads Runware balance and rolling provider usage without creating an inference task', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [{ balance: { amount: 31.25, currency: 'USD' }, usage: { last30Days: { credits: 18.5, requests: 42 } } }] }));
    await expect(readProviderBilling('runware', 'secret')).resolves.toMatchObject({ balance: 31.25, spentLast30Days: 18.5, requestsLast30Days: 42 });
    const task = JSON.parse(String(fetch.mock.calls[0][1]?.body))[0];
    expect(task).toMatchObject({ taskType: 'accountManagement', operation: 'getDetails' });
  });

  it('keeps Atlas balance visible when its cost permission fails', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ available: { value: '25.500000', currency: 'usd' }, cash: { value: '20.000000', currency: 'usd' }, bonus: { value: '5.500000', currency: 'usd' } }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(readProviderBilling('atlas', 'secret')).resolves.toMatchObject({ balance: 25.5, cash: 20, bonus: 5.5 });
    expect(fetch.mock.calls[1][0]).toContain('/public/v1/model-costs?');
  });

  it('totals Atlas provider-reported daily costs', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ available: { value: '40.000000' } }))
      .mockResolvedValueOnce(Response.json({ data: [{ results: [{ amount: { value: '1.250000' } }, { amount: { value: '0.750000' } }] }], has_more: false }));
    await expect(readProviderBilling('atlas', 'secret')).resolves.toMatchObject({ balance: 40, spentLast30Days: 2 });
  });
});
