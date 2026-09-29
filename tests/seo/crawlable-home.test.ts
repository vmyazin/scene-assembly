import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { brand } from '@/lib/brand';
import { ENGINES } from '@/lib/engines/registry';
import { homeJsonLd } from '@/lib/seo/json-ld';

/**
 * The home page shipped a title and roughly fifty characters of body text for
 * as long as everything on it lived inside `Studio`'s Suspense boundary: the
 * studio reads the URL through nuqs, so a static prerender renders the fallback
 * and nothing else reaches a crawler.
 *
 * That failure is invisible — the page looks perfect in a browser, `next dev`
 * is happy, and every other test passes — so it is pinned here at the source
 * level. A render test cannot catch it: in jsdom the boundary resolves and the
 * intro appears wherever it is nested.
 */
const PAGE = readFileSync('app/page.tsx', 'utf8');

/** Comments in this repo discuss the boundary at length; strip them first. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the crawlable half of the home page', () => {
  it('renders the intro and the footer outside the studio Suspense boundary', () => {
    const source = withoutComments(PAGE);
    const boundary = source.indexOf('</Suspense>');
    expect(boundary).toBeGreaterThan(-1);

    for (const element of ['<LandingIntro />', '<SiteFooter />']) {
      expect(source).toContain(element);
      expect(source.indexOf(element)).toBeGreaterThan(boundary);
    }
  });

  it('declares its own canonical rather than inheriting one from the layout', () => {
    // A layout-level canonical would point every route at `/`.
    expect(PAGE).toContain("alternates: { canonical: '/' }");
    expect(readFileSync('app/layout.tsx', 'utf8')).not.toContain('canonical');
  });
});

describe('robots.txt', () => {
  const rules = robots();
  const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;
  const disallow = [rule?.disallow ?? []].flat();

  it('lets crawlers reach the studio and points them at the sitemap', () => {
    expect(rule?.allow).toBe('/');
    expect(rules.sitemap).toBe(`${brand.siteUrl}/sitemap.xml`);
  });

  it('blocks the API and the auth pages', () => {
    expect(disallow).toEqual(
      expect.arrayContaining(['/api/', '/account', '/sign-in', '/sign-up'])
    );
  });

  it('leaves the noindexed app shells crawlable so their noindex is read', () => {
    // Blocking a page means Google never fetches it, never sees the noindex,
    // and can still index the bare URL from a link. The two cannot be combined.
    for (const shell of ['/spend', '/timeline']) {
      expect(disallow).not.toContain(shell);
      expect(readFileSync(`app${shell}/layout.tsx`, 'utf8')).toContain('index: false');
    }
  });
});

describe('sitemap.xml', () => {
  const urls = sitemap().map((entry) => entry.url);

  it('lists the studio in the same form as its canonical', () => {
    // Next resolves `canonical: '/'` against metadataBase to the bare origin;
    // a sitemap with a trailing slash would disagree with the tag it points at.
    expect(urls).toEqual([brand.siteUrl, `${brand.siteUrl}/docs/mcp`]);
  });

  it('lists nothing that carries a noindex', () => {
    for (const shell of ['/spend', '/timeline', '/account', '/sign-in', '/sign-up']) {
      expect(urls).not.toContain(`${brand.siteUrl}${shell}`);
    }
  });
});

describe('home page structured data', () => {
  const data = homeJsonLd();

  it('describes the app at its canonical URL', () => {
    expect(data['@type']).toBe('WebApplication');
    expect(data.url).toBe(brand.siteUrl);
    expect(JSON.stringify(data)).not.toContain('undefined');
  });

  it('names every engine the studio can run', () => {
    for (const engine of ENGINES) expect(data.keywords).toContain(engine.label);
  });
});
