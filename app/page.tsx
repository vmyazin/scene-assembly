// app/page.tsx
import type { Metadata } from 'next';
import { Suspense } from 'react';

import SiteFooter from '@/components/SiteFooter';
import Studio from '@/components/Studio';
import GuestOnly from '@/components/marketing/GuestOnly';
import LandingIntro from '@/components/marketing/LandingIntro';
import { homeJsonLd } from '@/lib/seo/json-ld';

/**
 * Canonical is declared per page rather than in the root layout: a layout-level
 * canonical would point every route at `/`, which is worse than having none.
 * Resolved against `metadataBase`, so the trailing-slash policy lives in one
 * place with the sitemap.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * The home route is two halves with different rendering needs, and the split
 * between them is deliberate.
 *
 * `Studio` reads the URL through nuqs, so it needs a Suspense boundary — and a
 * suspended boundary renders as its fallback in the HTML a crawler receives.
 * Everything worth crawling therefore lives *outside* it, as server components:
 * the intro (the page's `<h1>`, the BYOK explanation, the engine list) and the
 * footer. Move either back inside `Studio` and the page silently returns to
 * shipping a title and an empty body.
 */
export default function Home() {
  return (
    /* `overflow-x-clip`, not `-hidden`: a hidden axis turns this wrapper into a
       scroll container and silently disables every `position: sticky` inside it
       — the header and the generation workspace's stuck columns all measure
       against the viewport. Same reason as the rule on `body`. */
    <div className="relative min-h-screen w-full overflow-x-clip">
      <Suspense fallback={null}>
        <Studio />
      </Suspense>

      {/* Always server-rendered; `GuestOnly` removes it in the browser once the
          session says the reader is signed in. A crawler is never signed in, so
          the static HTML keeps it — see the component for why the gate cannot
          move up into this server component. */}
      <GuestOnly>
        <LandingIntro />
      </GuestOnly>

      <SiteFooter />

      <script
        type="application/ld+json"
        // The payload is built from our own registries — no user input reaches
        // it — and Next requires the raw string form for a JSON-LD block.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd()) }}
      />
    </div>
  );
}
