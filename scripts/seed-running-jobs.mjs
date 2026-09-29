/**
 * Local-only fixture: jobs that stay in flight, for judging how a running card
 * looks. `DEV_FAKE_GENERATION` jobs finish in ten seconds, too fast to study a
 * layout, and rows written straight to the local D1 are never picked up by the
 * workflow, so these hold their state until deleted.
 *
 *   node scripts/seed-running-jobs.mjs          # add them for the local creator
 *   node scripts/seed-running-jobs.mjs --clear  # remove them again
 *
 * Sign in once first (the account page's "Use local test account") so the user
 * row exists. Never touches anything but the local database under cloud/.wrangler.
 */
import { execFileSync } from 'node:child_process';

const wrangler = (sql) => JSON.parse(execFileSync('node', ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql], { cwd: 'cloud', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8' }));
const rows = (sql) => wrangler(sql)[0].results;
const PREFIX = 'seed-running-';

if (process.argv.includes('--clear')) {
  wrangler(`DELETE FROM account_jobs WHERE id LIKE '${PREFIX}%'`);
  console.log('Removed the seeded jobs.');
  process.exit(0);
}

const [user] = rows('SELECT id FROM account_users ORDER BY rowid LIMIT 1');
if (!user) throw new Error('No local user yet: sign in with the local test account first.');

const now = Date.now();
const jobs = [
  ['video', 'running', 'fal', 'veo-3-1', 'Animate this cartoon image into a playful six-second tug-of-war. The two fluffy sheep keep gripping opposite ends of a laptop while the camera slowly pushes in.', 79],
  ['image', 'running', 'gemini', 'gemini-3-pro-image-preview', 'Ground-level close-up of a narrow wet city alley at dusk. In the foreground, a small gray rat is frozen mid-step, fur beaded with rain, while a tabby cat crouches behind it.', 42],
  ['video', 'queued', 'fal', 'veo-3-1', 'A slow orbit around a lighthouse in a storm, waves breaking against the rocks, warm lamp light cutting through spray.', 8],
  ['image', 'submitting', 'atlas', 'gpt-image-1', 'Convert the existing photograph to a black and white oil painting style with warm, soft lighting and a low-angle view.', 3],
  ['video', 'saving', 'fal', 'veo-3-1', 'A paper boat drifting down a rain-filled gutter in the golden hour, shallow depth of field.', 211],
  ['image', 'running', 'atlas', 'gpt-image-1', 'Isometric cutaway of a tiny film studio inside a teacup, every prop lit from within.', 15],
];
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
jobs.forEach(([mediaType, state, provider, modelId, prompt, ageSeconds], i) => {
  const request = { provider, modelId, mediaType, inputMode: 'text', prompt, values: {}, referenceIds: [] };
  const at = now - ageSeconds * 1000;
  wrangler(`INSERT OR REPLACE INTO account_jobs (id, user_id, request_token, request_digest, provider, request_json, state, reservation_bytes, dispatched, created_at, updated_at) VALUES (${q(`${PREFIX}${i}`)}, ${q(user.id)}, ${q(`${PREFIX}token-${i}`)}, 'seed', ${q(provider)}, ${q(JSON.stringify(request))}, ${q(state)}, 67108864, 1, ${at}, ${at})`);
});
console.log(`Seeded ${jobs.length} in-flight jobs for ${user.id}. Reload the account page (Generating tab) or open the library.`);
