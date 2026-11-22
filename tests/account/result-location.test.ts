import { describe, expect, it } from 'vitest';

import { acceptedResultUrl } from '@/lib/account/result-location';

/**
 * One list gates the Worker's capture (`safeResultUrl`), the resume check
 * (`canRetryResultLocation`) and the app's `/api/download-video` proxy, so the
 * policy is pinned here once and each caller is exercised in its own suite.
 */
describe('acceptedResultUrl', () => {
  it('accepts Kie\'s temporary result host over https', () => {
    const url = acceptedResultUrl('https://tempfile.aiquickdraw.com/f/abc123/result.mp4?sig=x');
    expect(url?.hostname).toBe('tempfile.aiquickdraw.com');
    expect(acceptedResultUrl('https://TEMPFILE.aiquickdraw.com/h/result.png')?.hostname).toBe('tempfile.aiquickdraw.com');
    expect(acceptedResultUrl('https://tempfile.aiquickdraw.com:443/h/result.png')).not.toBeNull();
  });

  it('accepts the host Kie documents for Veo 4K and Z-Image results', () => {
    expect(acceptedResultUrl('https://file.aiquickdraw.com/v/task.mp4')?.hostname).toBe('file.aiquickdraw.com');
    for (const url of [
      'http://file.aiquickdraw.com/v/task.mp4',
      'https://file.aiquickdraw.com.evil.test/v/task.mp4',
      'https://evilfile.aiquickdraw.com/v/task.mp4',
      'https://a.file.aiquickdraw.com/v/task.mp4',
    ]) expect(acceptedResultUrl(url)).toBeNull();
  });

  it.each([
    ['plain http', 'http://tempfile.aiquickdraw.com/result.mp4'],
    ['another scheme', 'ftp://tempfile.aiquickdraw.com/result.mp4'],
    ['a non-default port', 'https://tempfile.aiquickdraw.com:8443/result.mp4'],
    ['embedded credentials', 'https://user:pass@tempfile.aiquickdraw.com/result.mp4'],
    ['the host as a userinfo decoy', 'https://tempfile.aiquickdraw.com@evil.test/result.mp4'],
    ['the host as a prefix', 'https://tempfile.aiquickdraw.com.evil.test/result.mp4'],
    ['the host as a suffix without a dot', 'https://eviltempfile.aiquickdraw.com/result.mp4'],
    ['the parent as a prefix', 'https://aiquickdraw.com.evil/result.mp4'],
    ['the parent domain', 'https://aiquickdraw.com/result.mp4'],
    ['a sibling host seen only as a sample asset', 'https://static.aiquickdraw.com/result.mp4'],
    ['a sibling host seen only on inputs', 'https://tempfileb.aiquickdraw.com/result.mp4'],
    ['a subdomain of the host', 'https://a.tempfile.aiquickdraw.com/result.mp4'],
    ['a trailing-dot spelling', 'https://tempfile.aiquickdraw.com./result.mp4'],
    ['the host in the path', 'https://evil.test/tempfile.aiquickdraw.com/result.mp4'],
  ])('refuses %s', (_name, url) => {
    expect(acceptedResultUrl(url)).toBeNull();
  });

  it('keeps the Kie hosts that were already accepted', () => {
    for (const url of [
      'https://tempfile.redpandaai.co/kieai/result.png',
      'https://kieai.redpandaai.co/files/result.png',
      'https://tempfile.ai/result.png',
      'https://file.kie.ai/result.mp4',
    ]) expect(acceptedResultUrl(url)).not.toBeNull();
    expect(acceptedResultUrl('https://redpandaai.co.evil.test/result.png')).toBeNull();
    expect(acceptedResultUrl('https://evilredpandaai.co/result.png')).toBeNull();
  });
});
