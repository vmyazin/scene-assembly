/** Local-only source-picker smoke fixture; never submits a paid generation. */
const origin = process.env.ACCOUNT_DEMO_ORIGIN || 'http://localhost:3307';
const target = new URL(origin);
if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname)) throw new Error('This fixture only runs against localhost.');
const login = await fetch(`${origin}/api/account/local-sign-in`, { method: 'POST', headers: { Origin: origin } });
if (!login.ok) throw new Error('Local account sign-in failed.');
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const response = await fetch(`${origin}/api/account/connections`, {
  method: 'POST',
  headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider: 'fal', apiKey: 'local-source-picker-fixture', ifAbsent: true }),
});
if (!response.ok) throw new Error('Local fal connection setup failed.');
console.log('Local fal source-picker fixture ready. No provider requests made.');
