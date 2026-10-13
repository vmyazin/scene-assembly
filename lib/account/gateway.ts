// lib/account/gateway.ts
/** Fixed upstream and allowlisted headers: account identity is validated by the Worker. */
export async function accountGateway(request: Request): Promise<Response> {
  const upstream = process.env.ACCOUNT_WORKER_ORIGIN;
  if(!upstream&&new URL(request.url).pathname==='/api/account/session')return Response.json({account:null,googleEnabled:false,localSignIn:false,providers:[],connections:[]},{headers:{'Cache-Control':'no-store'}});
  if (!upstream) return Response.json({ error: 'Account sign-in is not available yet. You can continue as a guest.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const base = new URL(upstream);
  if (base.protocol !== 'https:' && !(process.env.NODE_ENV === 'development' && base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    return Response.json({ error: 'Account service is not configured.' }, { status: 503 });
  }
  const incoming = new URL(request.url);
  const allowed = new Set(['session', 'profile', 'sign-in/google', 'callback/google', 'sign-out', 'local-sign-in', 'provider-billing', 'relaxed-consent', 'youtube-clips']);
  const path = incoming.pathname.slice('/api/account/'.length);
  if (!allowed.has(path) && !/^(?:jobs(?:\/[a-zA-Z0-9-]+(?:\/(?:resume|cancel|dismiss|recovery))?)?|assets(?:\/[a-zA-Z0-9-]+(?:\/(?:content|access))?)?|uploads(?:\/[a-zA-Z0-9-]+)?|imports(?:\/[a-zA-Z0-9-]+)?|spend(?:\/[a-zA-Z0-9_-]+)?|storage|agents(?:\/[a-zA-Z0-9-]+)?|agent-authorizations\/[a-zA-Z0-9-]+)$/.test(path) && !/^connections(?:\/(?:gemini|fal|kie|runware|atlas|comet|piapi|cloudflare|pollinations))?$/.test(path)) return new Response(null, { status: 404 });
  const headers = new Headers();
  for (const name of ['cookie', 'origin', 'content-type', 'range', 'x-account-id']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let body: string | undefined;
  if (request.method === 'POST') {
    // Bound actual bytes, rather than trusting Content-Length.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > (path === 'jobs' ? 40000 : path === 'imports' ? 32768 : path === 'connections' ? 8192 : path === 'youtube-clips' ? 4096 : 2048)) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    body = new TextDecoder().decode(bytes);
  }
  // A YouTube import holds the request while the Worker cuts the section (up to 120 s),
  // and Cancel in the dialog must reach the container, so this one path gets a longer
  // ceiling and the browser's own abort.
  const slow = path === 'youtube-clips';
  try {
    const response = await fetch(new URL(`${incoming.pathname}${incoming.search}`, base), { method: request.method, headers, body, redirect: 'manual', cache: 'no-store', signal: slow ? AbortSignal.any([request.signal, AbortSignal.timeout(130_000)]) : AbortSignal.timeout(25_000) });
    const outgoing = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    for (const name of ['content-type', 'location', 'content-range', 'accept-ranges', 'content-length', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    for (const value of response.headers.getSetCookie()) outgoing.append('set-cookie', value);
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    if (slow) return Response.json({ error: request.signal.aborted ? 'Import cancelled.' : 'The import took too long. Try a shorter section.' }, { status: 504, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ error: 'Account sign-in is temporarily unavailable. You can continue as a guest.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
