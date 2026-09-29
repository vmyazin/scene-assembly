// @vitest-environment node

import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

/**
 * The consent page must not be frameable: an attacker embedding /connect-agent
 * in an invisible iframe could trick a signed-in person into approving an
 * agent connection by clickjacking the Approve button. Both headers matter —
 * X-Frame-Options for browsers that predate frame-ancestors — and the rule
 * must be scoped to this one route, not applied site-wide.
 */
describe('next.config headers', () => {
  it('blocks /connect-agent from being framed', async () => {
    expect(nextConfig.headers).toBeInstanceOf(Function);
    const rules = await nextConfig.headers!();
    const rule = rules.find(entry => entry.source === '/connect-agent');
    expect(rule).toBeDefined();
    expect(rule!.headers).toEqual(
      expect.arrayContaining([
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Frame-Options', value: 'DENY' },
      ])
    );
  });

  it('scopes the rule to /connect-agent only, not every route', async () => {
    const rules = await nextConfig.headers!();
    const wide = rules.filter(entry =>
      entry.headers.some(header => header.key === 'Content-Security-Policy' && header.value.includes('frame-ancestors'))
    );
    expect(wide).toHaveLength(1);
    expect(wide[0]!.source).toBe('/connect-agent');
  });

  it('keeps the existing turbopack root setting', () => {
    expect(nextConfig.turbopack).toEqual({ root: process.cwd() });
  });
});
