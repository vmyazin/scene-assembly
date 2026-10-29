// components/SiteFooter.tsx
import ProviderLogo from '@/components/ProviderLogo';
import { FooterLinks, FooterSoundToggle } from '@/components/SiteFooterControls';
import { brand } from '@/lib/brand';
import { ENGINE_DOCS } from '@/lib/engines/docs';

/**
 * The studio's footer.
 *
 * A server component, and rendered from `app/page.tsx` rather than from inside
 * `components/Studio.tsx` where it used to live: the studio suspends during a
 * static prerender (it reads the URL through nuqs), so anything nested in it is
 * missing from the HTML a crawler receives — including this row of outbound
 * engine-doc links, which is the most linkable thing on the page. The two parts
 * that genuinely need browser state are the client island in
 * `SiteFooterControls`.
 */
export default function SiteFooter() {
  return (
    <footer className="site-footer relative z-10 border-t border-[var(--border)] mt-8 sm:mt-10">
      <div className="w-full max-w-7xl mx-auto px-6 sm:px-8 md:px-12 lg:px-16 py-6 sm:py-7">
        {/* Who made this, and where to go next — one card each, so neither
            reads as a footnote to the other. */}
        <div className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background-glass)] px-5 py-4">
            <p className="text-[0.8125rem] text-[var(--foreground-muted)]">
              <a
                href={brand.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon-cyan)] hover:text-[var(--neon-purple)] font-bold transition-colors hover:underline"
              >
                {brand.shortName}
              </a>
              {' '}— maintained by{' '}
              <a
                href={brand.maintainer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--neon-cyan)] hover:text-[var(--neon-purple)] font-bold transition-colors hover:underline"
              >
                {brand.maintainer.name}
              </a>
            </p>
            <p className="mt-1.5 text-xs text-[var(--foreground-muted)]">
              {brand.description}
            </p>
          </div>

          <FooterLinks />
        </div>

        <div className="mt-5 flex justify-center">
          <FooterSoundToggle />
        </div>

        {/* Engines available — capability context, not product identity.
            Each one links to the docs you'd need to work with it directly. */}
        <div className="mt-6 pt-5 border-t border-[hsl(var(--tint)/0.05)] text-center">
          <p className="eyebrow mb-2">Provider docs</p>
          <ul className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
            {ENGINE_DOCS.map(({ id, label, href, accentClass }) => (
              <li key={id}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background-glass)] px-2.5 py-1 font-medium text-[var(--foreground-muted)] transition-colors hover:border-current ${accentClass}`}
                >
                  <ProviderLogo provider={id} size={13} />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
