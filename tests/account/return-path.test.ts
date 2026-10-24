import { describe, expect, it } from 'vitest';
import { afterSignIn, returnPath } from '@/lib/account/return-path';

describe('return paths', () => {
  it('keeps a path on this site with its query', () => {
    expect(returnPath('/connect-agent?request=abc-123')).toBe('/connect-agent?request=abc-123');
  });
  it.each(['https://evil.example/x', '//evil.example', '/\\evil', '/api/account/session', 'account', '/a\u0000b', 42, '/..//evil.example', '/.//evil.example', '/%2e%2e//evil.example', '/x/..//evil.example', '/x/../api/account/session'])('refuses %s', value => {
    expect(returnPath(value)).toBe('/');
  });
  it('lands on the account page when there is nowhere safe to return to', () => {
    expect(afterSignIn(undefined)).toBe('/account');
    expect(afterSignIn('https://evil.example')).toBe('/account');
    expect(afterSignIn('/connect-agent?request=r1')).toBe('/connect-agent?request=r1');
  });
});
