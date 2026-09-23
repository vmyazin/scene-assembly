import { readProviderBilling, type BillingProvider } from '../../lib/billing/provider-readout';
import { currentAccount } from './sessions';
import { json, type Env } from './security';
import { decryptSecret, type Connection } from './vault';

const PROVIDERS: BillingProvider[] = ['kie', 'runware', 'atlas'];

export async function providerBillingRoutes(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/account/provider-billing') return null;
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const account = await currentAccount(request, env);
  if (!account) return json({ error: 'Sign in to read provider billing.' }, 401);
  const rows = await env.DB.prepare('SELECT * FROM account_connections WHERE user_id = ? AND provider IN (?, ?, ?)')
    .bind(account.id, ...PROVIDERS).all<Connection>();
  const results = await Promise.all((rows.results ?? []).map(async row => {
    try {
      const secret = await decryptSecret(env, account.id, row.provider, row);
      return { provider: row.provider, snapshot: await readProviderBilling(row.provider as BillingProvider, secret.apiKey) };
    } catch {
      return { provider: row.provider, error: 'Provider billing is unavailable.' };
    }
  }));
  return json({ results });
}
