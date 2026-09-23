/** Read-only vendor billing data. No payment or account mutation endpoints belong here. */
export type BillingProvider = 'kie' | 'runware' | 'atlas';

export interface ProviderBillingSnapshot {
  provider: BillingProvider;
  balance: number;
  unit: 'credits' | 'usd';
  cash?: number;
  bonus?: number;
  spentLast30Days?: number;
  requestsLast30Days?: number;
  fetchedAt: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function amount(value: unknown): number | undefined {
  const raw = record(value).value;
  const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function vendorJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Provider billing is unavailable');
  return record(await response.json());
}

function utcDate(date: Date): string { return date.toISOString().slice(0, 10); }

export async function readProviderBilling(provider: BillingProvider, apiKey: string): Promise<ProviderBillingSnapshot> {
  const fetchedAt = Date.now();
  if (provider === 'kie') {
    // https://docs.kie.ai/common-api/get-account-credits
    const payload = await vendorJson('https://api.kie.ai/api/v1/chat/credit', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const balance = payload.code === 200 && typeof payload.data === 'number' ? payload.data : NaN;
    if (!Number.isFinite(balance) || balance < 0) throw new Error('Kie billing response is unavailable');
    return { provider, balance, unit: 'credits', fetchedAt };
  }
  if (provider === 'runware') {
    // https://runware.ai/docs/platform/account-management — getDetails is read-only.
    const payload = await vendorJson('https://api.runware.ai/v1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ taskType: 'accountManagement', taskUUID: crypto.randomUUID(), operation: 'getDetails' }]),
    });
    if (Array.isArray(payload.errors) && payload.errors.length) throw new Error('Runware billing is unavailable');
    const detail = record(Array.isArray(payload.data) ? payload.data[0] : null);
    const rawBalance = record(detail.balance).amount;
    const balance = typeof rawBalance === 'number' ? rawBalance : NaN;
    if (!Number.isFinite(balance) || balance < 0) throw new Error('Runware billing response is unavailable');
    const usage = record(record(detail.usage).last30Days);
    const spentLast30Days = typeof usage.credits === 'number' && usage.credits >= 0 ? usage.credits : undefined;
    const requestsLast30Days = typeof usage.requests === 'number' && usage.requests >= 0 ? usage.requests : undefined;
    return { provider, balance, unit: 'usd', spentLast30Days, requestsLast30Days, fetchedAt };
  }

  // https://www.atlascloud.ai/docs/public-api — balance is account-wide; costs default to the authenticated user's keys.
  const headers = { Authorization: `Bearer ${apiKey}` };
  const payload = await vendorJson('https://api.atlascloud.ai/public/v1/balance', { headers });
  const balance = amount(payload.available);
  if (balance === undefined) throw new Error('Atlas billing response is unavailable');
  const snapshot: ProviderBillingSnapshot = {
    provider, balance, unit: 'usd', cash: amount(payload.cash), bonus: amount(payload.bonus), fetchedAt,
  };
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - 30 * 86_400_000);
  // Ungrouped results contain at most one bucket per day, so 30 days fit on one page.
  const query = new URLSearchParams({ start_date: utcDate(start), end_date: utcDate(end), limit: '100' });
  try {
    let total = 0;
    const costs = await vendorJson(`https://api.atlascloud.ai/public/v1/model-costs?${query}`, { headers });
    if (!Array.isArray(costs.data) || costs.has_more === true) throw new Error('Atlas cost response is incomplete');
    for (const bucket of costs.data) {
      for (const result of Array.isArray(record(bucket).results) ? record(bucket).results as unknown[] : []) {
        const value = amount(record(result).amount);
        if (value !== undefined) total += value;
      }
    }
    snapshot.spentLast30Days = total;
  } catch {
    // A restricted cost permission must not hide a valid balance.
  }
  return snapshot;
}
