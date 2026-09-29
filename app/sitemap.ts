// app/sitemap.ts
import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';

/**
 * Served at /sitemap.xml, and pointed at from robots.txt.
 *
 * Only genuinely indexable URLs belong here: a sitemap listing a page that
 * carries `noindex` is a contradictory signal, and it spends crawl budget on
 * pages we have already said we do not want ranked. So the list is the studio
 * landing and the agent setup guide at /docs/mcp: `/spend` and `/timeline` are
 * noindexed app shells, and the auth pages are disallowed outright. Add
 * marketing and documentation routes here as they ship, not before.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: brand.siteUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${brand.siteUrl}/docs/mcp`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];
}
