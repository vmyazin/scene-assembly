/** Local-only catalog review: dummy connections, no provider requests or user media. */
const origin = process.env.ACCOUNT_DEMO_ORIGIN || 'http://localhost:3331';
const target = new URL(origin);
if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('Localhost only.');
const login = await fetch(`${origin}/api/account/local-sign-in`, { method: 'POST', headers: { Origin: origin } });
if (!login.ok) throw new Error('Start the local development server first.');
const headers = { Origin: origin, Cookie: login.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), 'Content-Type': 'application/json' };
for (const provider of ['atlas', 'fal']) {
  const response = await fetch(`${origin}/api/account/connections`, {
    method: 'POST', headers,
    body: JSON.stringify({ provider, apiKey: `local-catalog-preview-${provider}`, ifAbsent: true }),
  });
  if (!response.ok) throw new Error(`Could not seed the local ${provider} connection.`);
}
console.log('Local catalog preview ready. Sign in with Use local test account. No provider requests made.');
