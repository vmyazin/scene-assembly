// lib/seo/json-ld.ts
import { brand } from '@/lib/brand';
import { ENGINES } from '@/lib/engines/registry';
import { FEATURES } from '@/types';

/**
 * Structured data for the home page, emitted as `application/ld+json`.
 *
 * `WebApplication` rather than `SoftwareApplication` because there is nothing
 * to download: the studio is the page. The `offers` price is genuinely zero —
 * the app charges nothing and every generation bills to the visitor's own
 * provider key — and `description` says so, because a free-price claim with no
 * explanation invites the wrong expectation.
 *
 * Built from the same registries the UI renders, so a new engine or mode shows
 * up here without anyone remembering to edit a second list.
 */
export function homeJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${brand.siteUrl}/#app`,
    name: brand.name,
    url: brand.siteUrl,
    // The same positioning as `brand.metaDescription`, spelled out at length:
    // this one is read by machines rather than shown in a result, so it keeps
    // the full provider enumeration that makes the entity legible.
    description:
      'A studio for generating and editing images and for creating video, built around picking ' +
      'the provider that fits the job rather than locking you to one vendor. No monthly ' +
      'subscription — connect your own provider keys (Gemini, FLUX, fal.ai, Kie.ai, Runware, ' +
      'Atlas Cloud, CometAPI, PiAPI or Cloudflare Workers AI) and pay those providers as you go.',
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any modern web browser',
    browserRequirements: 'Requires JavaScript',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free to use. Generations bill to your own provider account at that provider’s rates.',
    },
    featureList: [
      ...FEATURES.map((feature) => feature.name),
      'Text, image and first/last-frame video generation',
      'Multi-clip timeline and export',
    ],
    // `keywords` rather than a bespoke property: the engine names are the terms
    // people search this product by, and it is the only Text-valued slot in the
    // vocabulary that fits a flat list of them.
    keywords: ENGINES.map((engine) => engine.label).join(', '),
    codeRepository: brand.githubUrl,
    author: {
      '@type': 'Person',
      name: brand.maintainer.name,
      url: brand.maintainer.url,
    },
  } as const;
}
