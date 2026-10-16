import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CloudJobCardGrid from '@/components/account/CloudJobCardGrid';
import type { CloudJobView } from '@/lib/account/contracts';

const running: CloudJobView = {
  id: 'j1', provider: 'runware', state: 'running', errorCode: null, createdAt: 1, updatedAt: 1,
  request: { provider: 'runware', modelId: 'bytedance:seedance@2.0-mini', mediaType: 'video', inputMode: 'text', prompt: 'A canal at dusk', values: {}, referenceIds: [] },
};

/** UX audit L2: the studio rail offered a link to the page it was already on. */
describe('a running job card', () => {
  it('links back to its studio form from elsewhere', () => {
    render(<CloudJobCardGrid jobs={[running]} />);
    expect(screen.getByRole('link', { name: 'Open the studio form' })).toBeInTheDocument();
  });

  it('drops the link inside the form it belongs to', () => {
    render(<CloudJobCardGrid jobs={[running]} inOwnForm />);
    expect(screen.queryByRole('link', { name: 'Open the studio form' })).toBeNull();
  });
});
