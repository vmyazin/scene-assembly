import { NextRequest, NextResponse } from 'next/server';

import { readProviderBilling, type BillingProvider } from '@/lib/billing/provider-readout';

const PROVIDERS: BillingProvider[] = ['kie', 'runware', 'atlas'];

/** Guest keys already travel to first-party provider routes; never put one in a URL. */
export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > 8192) return NextResponse.json({ error: 'Request is too large.' }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || !PROVIDERS.includes(body.provider as BillingProvider) || typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 4096 || /[\r\n]/.test(body.apiKey)) {
    return NextResponse.json({ error: 'Provider key is required.' }, { status: 400 });
  }
  try {
    const snapshot = await readProviderBilling(body.provider as BillingProvider, body.apiKey.trim());
    return NextResponse.json({ snapshot }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Provider billing is unavailable.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
