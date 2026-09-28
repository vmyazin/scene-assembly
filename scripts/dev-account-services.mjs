import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const portIndex = args.findIndex(arg => arg === '--port' || arg === '-p');
const port = portIndex >= 0 ? args[portIndex + 1] : (process.env.PORT || '3097');
const workerPort = process.env.ACCOUNT_WORKER_PORT || '8797';
if (!/^\d+$/.test(port) || !/^\d+$/.test(workerPort)) throw new Error('Ports must be numeric.');
if (!existsSync('cloud/node_modules/wrangler/bin/wrangler.js')) {
  console.error('Install account dependencies with pnpm --dir cloud install --frozen-lockfile');
  process.exit(1);
}
if (!existsSync('cloud/.dev.vars')) copyFileSync('cloud/.dev.vars.example', 'cloud/.dev.vars');
// Keep the OAuth origin aligned with the actual web port. Never change real credentials.
let localVars = readFileSync('cloud/.dev.vars', 'utf8').replace(/^APP_ORIGIN=.*$/m, `APP_ORIGIN=http://localhost:${port}`);
if (!/^ACCOUNT_ENCRYPTION_KEYS=/m.test(localVars)) localVars += `\nACCOUNT_ENCRYPTION_KEYS='${JSON.stringify({ '1': randomBytes(32).toString('base64') })}'\nACCOUNT_ENCRYPTION_VERSION=1\n`;
localVars = localVars.replace(/^PUBLIC_WORKER_ORIGIN=.*\n?/m, '') + `\nPUBLIC_WORKER_ORIGIN=http://localhost:${workerPort}\n`;
// Agents connect to the Worker directly, and /oauth/finish sends the browser back to it.
localVars = localVars.replace(/^MCP_ORIGIN=.*\n?/m, '') + `MCP_ORIGIN=http://localhost:${workerPort}\n`;
writeFileSync('cloud/.dev.vars', localVars);
const children = [];
let stopping = false;
let scheduledTimer;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(scheduledTimer);
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function run(commandArgs, options = {}) {
  const child = spawn(process.execPath, commandArgs, { stdio: 'inherit', ...options });
  children.push(child);
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
  return child;
}
// The compile-time local marker is false in the checked-in deploy configuration.
run(['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--test-scheduled', '--port', workerPort, '--define', '__LOCAL_DEV__:true'], { cwd: 'cloud', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
run(['node_modules/next/dist/bin/next', 'dev', '--port', port], { env: { ...process.env, ACCOUNT_WORKER_ORIGIN: `http://127.0.0.1:${workerPort}` } });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

// Wrangler does not fire cron locally. Exercise the same reconciliation path so
// accepted jobs and expired staging files recover without a second command.
let scheduling = false;
scheduledTimer = setInterval(async () => {
  if(stopping || scheduling)return;
  scheduling = true;
  try {
    const origin = `http://127.0.0.1:${workerPort}`;
    await fetch(`${origin}/health`, {signal:AbortSignal.timeout(5000)});
    await fetch(`${origin}/__scheduled`, {signal:AbortSignal.timeout(30000)});
  } catch { /* A reload may interrupt one tick; the next tick retries. */ }
  finally { scheduling = false; }
}, 60000);
