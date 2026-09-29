/**
 * The one rule for where signing in may send someone back to: a path on this
 * site, never another origin and never an API route. The Worker applies it to
 * the Google callback and the sign-in page applies it before navigating, so the
 * two cannot disagree about which links are safe. Returns '/' when unsafe.
 */
export function returnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\x00-\x1f]/.test(value)) return '/';
  const url = new URL(value, 'https://return.invalid');
  return url.origin === 'https://return.invalid' && !url.pathname.startsWith('/api/') ? `${url.pathname}${url.search}` : '/';
}

/** Where a person lands after signing in: the page that sent them, or their account. */
export function afterSignIn(value: unknown): string {
  const path = returnPath(value);
  return path === '/' ? '/account' : path;
}
