// components/marketing/LandingIntro.tsx
import Link from 'next/link';
import { Clapperboard, Film, ImageIcon, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';

import ProviderLogo from '@/components/ProviderLogo';
import LandingDisclosure from '@/components/marketing/LandingDisclosure';
import { brand } from '@/lib/brand';
import { ENGINES, type EngineId } from '@/lib/engines/registry';
import { FEATURES } from '@/types';

/**
 * The crawlable half of the home page.
 *
 * A server component on purpose, and rendered from `app/page.tsx` rather than
 * from inside `components/Studio.tsx`: the studio reads the URL through nuqs,
 * so it suspends during a static prerender and everything inside its Suspense
 * boundary is replaced by the fallback in the HTML that ships. Before this
 * section existed, a crawler fetching `/` got the document title and about
 * fifty characters of body text — no heading, no product explanation, no engine
 * names — which is why the site had nothing to rank on, and why
 * `site:sceneassembly.mzork.com` returned nothing at all.
 *
 * Two rules keep it that way:
 *
 * 1. **No client hooks, no `'use client'`, nothing lazy.** The value of this
 *    section is that it exists in the first byte of HTML; a `dynamic()` import
 *    or a store read would put it back behind hydration.
 * 2. **The lists come from the registries, not from prose.** `ENGINES` and
 *    `FEATURES` already describe what the studio can do, and a hand-written
 *    copy of either goes stale the first time an engine is added — silently,
 *    because nothing renders the difference.
 *
 * It carries the page's only `<h1>`. The header's wordmark is a link home, not
 * this page's heading, and the studio's hero line above is a display line that
 * disappears the moment a mode is picked.
 */
/**
 * Each engine's mark in the colour it carries everywhere else — the hero pills,
 * the footer's doc links (`ENGINE_DOCS.accentClass`, which is hover-only and so
 * cannot be reused as-is). A `Record` over `EngineId` so a new engine fails the
 * typecheck here rather than shipping grey.
 */
const ENGINE_ACCENT: Record<EngineId, string> = {
  gemini: 'text-emerald-400',
  pollinations: 'text-[var(--neon-purple)]',
  cloudflare: 'text-[var(--brand-accent)]',
  fal: 'text-[var(--neon-pink)]',
  kie: 'text-[var(--foreground)]',
  runware: 'text-[var(--neon-cyan)]',
  atlas: 'text-[var(--neon-purple)]',
  piapi: 'text-[var(--neon-cyan)]',
  comet: 'text-[var(--neon-pink)]',
};

/** Icon tile beside a card title: a tinted square so the colour reads at a glance. */
function IconTile({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/20 bg-current/10 ${tone}`}
    >
      {children}
    </span>
  );
}

export default function LandingIntro() {
  return (
    <section
      aria-labelledby="about-scene-assembly"
      className="relative z-10 border-t border-[var(--border)] mt-10 sm:mt-14"
    >
      <div className="w-full max-w-7xl mx-auto px-6 sm:px-8 md:px-12 lg:px-16 py-12 sm:py-16">
        <div className="max-w-3xl">
          <p className="eyebrow mb-3">About {brand.name}</p>
          <h1
            id="about-scene-assembly"
            className="display text-2xl sm:text-3xl md:text-4xl font-semibold text-balance"
          >
            <span className="text-[var(--foreground)]">Pick the right</span>{' '}
            <span className="gradient-text">AI provider for every image and video</span>
            <span className="text-[var(--foreground)]">, on your own keys</span>
          </h1>
          <p className="mt-5 text-sm sm:text-base leading-relaxed text-[var(--foreground-muted)]">
            {brand.name} is a studio for generating and editing images and for creating video —
            built around choosing the provider that fits the work, not locking you to one vendor. Use
            Google Gemini when you need grounded, multi-reference editing; Veo, Kling, or Seedance
            when the job is video. No monthly subscription: connect the provider keys you already
            use and pay as you go. The studio is the interface on top.
          </p>
        </div>

        {/* Everything from here to the studio link is the folded half. It is
            still rendered right here on the server — the disclosure only
            animates a grid row and toggles `inert` — so the HTML a crawler
            reads is identical whether or not anyone opens it. */}
        <LandingDisclosure label={`Learn about ${brand.name}`}>

          {/* BYOK, in the three questions people actually arrive with. */}
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <article className="glass-card px-5 py-5">
              <h2 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                <IconTile tone="text-[var(--neon-cyan)]"><KeyRound size={16} /></IconTile>
                Bring your own keys
              </h2>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
                There is no {brand.name} subscription and no credit to buy. You paste a provider key —
                Gemini, fal.ai, Kie.ai, Runware, Atlas Cloud, CometAPI, PiAPI or a Cloudflare token —
                and generations bill to that provider account at its own rates.
              </p>
            </article>

            <article className="glass-card px-5 py-5">
              <h2 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                <IconTile tone="text-emerald-400"><ShieldCheck size={16} /></IconTile>
                Keys stay in your browser
              </h2>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
                As a guest, credentials live in this browser&rsquo;s local storage and are sent only
                with your own generations. Sign in with the optional account and saved connections are
                encrypted instead, so background jobs can keep running after you close the tab.
              </p>
            </article>

            <article className="glass-card px-5 py-5">
              <h2 className="flex items-center gap-2.5 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                <IconTile tone="text-[var(--neon-pink)]"><Sparkles size={16} /></IconTile>
                Start without a key
              </h2>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
                Pollinations runs FLUX text-to-image with no credentials at all, and Cloudflare
                Workers AI has a free daily tier. Both are enough to try every part of the interface
                before you connect anything paid.
              </p>
            </article>
          </div>

          {/* The engine list, straight out of the registry the studio itself
              reads — the single most useful thing a crawler can find here, since
              "which UI wraps Gemini / FLUX / Veo / Kling" is how people search. */}
          <div className="mt-12">
            <h2 className="display text-xl sm:text-2xl font-semibold text-[var(--foreground)]">
              Providers you can connect
            </h2>
            <p className="mt-2 max-w-2xl text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
              Every provider below is selectable per generation, so the same prompt and the same
              reference images can be re-run somewhere else without leaving the page.
            </p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ENGINES.map((engine) => (
                <li key={engine.id} className="glass-card px-4 py-3.5">
                  <h3 className="flex items-center gap-2 text-[0.875rem] font-semibold text-[var(--foreground)]">
                    <ProviderLogo provider={engine.id} size={15} className={ENGINE_ACCENT[engine.id]} />
                    {engine.label}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--foreground-muted)]">
                    {engine.blurb}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    <span className="pill">{engine.free ? 'Free tier' : 'Your key, your rate'}</span>
                    {engine.supportsInputImages && <span className="pill">Reference images</span>}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Mode names only, deliberately. The picker above already renders
              each one as a card with the same description from `FEATURES`, and
              repeating those descriptions here would show a visitor the same six
              paragraphs twice on one screen. The list still earns its place: it
              is the crawlable copy (the picker is behind hydration), and it adds
              the video modes and the timeline, which the picker never mentions. */}
          <div className="mt-12">
            <h2 className="display text-xl sm:text-2xl font-semibold text-[var(--foreground)]">
              What you can make
            </h2>
            <p className="mt-2 max-w-2xl text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
              Six image modes, three ways into video, and a timeline to cut the results together:
            </p>
            {/* One colour per kind of output — image, video, timeline — the same
                three the studio's workspace switch uses. */}
            <ul className="mt-4 flex flex-wrap gap-2">
              {FEATURES.map((feature) => (
                <li key={feature.id} className="pill">
                  <ImageIcon size={13} aria-hidden="true" className="text-[var(--brand-accent)]" />
                  {feature.name}
                </li>
              ))}
              {['Text to video', 'Image to video', 'First and last frame to video'].map((mode) => (
                <li key={mode} className="pill">
                  <Clapperboard size={13} aria-hidden="true" className="text-[var(--neon-purple)]" />
                  {mode}
                </li>
              ))}
              <li className="pill">
                <Film size={13} aria-hidden="true" className="text-[var(--neon-cyan)]" />
                Multi-clip timeline and export
              </li>
            </ul>
            <p className="mt-4 max-w-2xl text-[0.8125rem] leading-relaxed text-[var(--foreground-muted)]">
              A clip can start from a prompt, from a still you just generated, or from a first and
              last frame you hand it. Finished clips land in a rail you can drag onto the timeline,
              trim, reorder, and export as a single file — without uploading anything to us.
            </p>
          </div>

          <p className="mt-10 text-[0.8125rem] text-[var(--foreground-muted)]">
            <Link
              href="/"
              className="font-bold text-[var(--neon-cyan)] transition-colors hover:text-[var(--neon-purple)] hover:underline"
            >
              Open the studio
            </Link>
            {' '}— or read the{' '}
            <a
              href={brand.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[var(--neon-cyan)] transition-colors hover:text-[var(--neon-purple)] hover:underline"
            >
              source on GitHub
            </a>
            .
          </p>
        </LandingDisclosure>
      </div>
    </section>
  );
}
