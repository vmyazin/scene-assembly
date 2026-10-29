import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import Studio from '../components/Studio';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('next/dynamic', () => ({ default: () => ({ onBack }: { onBack: () => void }) => <button onClick={onBack}>Back to modes</button> }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock('../components/StudioHeader', () => ({ default: ({ active, onSelectWorkspace }: { active: string; onSelectWorkspace: (next: string) => void }) => <header><span>Active: {active}</span><button onClick={() => onSelectWorkspace('image')}>Image</button></header> }));
vi.mock('../components/StudioLauncher', () => ({ default: () => <p>Balanced home</p> }));
vi.mock('../components/FeatureSelector', () => ({ default: () => <p>Image modes only</p> }));
vi.mock('../components/VideoWorkspace', () => ({ default: () => <p>Video workspace</p> }));
afterEach(cleanup);

it('keeps home distinct and makes Image navigation open its dedicated picker', async () => {
  const onUrlUpdate = vi.fn();
  render(<NuqsTestingAdapter onUrlUpdate={onUrlUpdate}><Studio /></NuqsTestingAdapter>);
  expect(screen.getByText('Balanced home')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Image' }));
  await waitFor(() => expect(screen.getByText('Image modes only')).toBeTruthy());
  expect(screen.queryByText('Balanced home')).toBeNull();
  expect(screen.getByText('Active: image')).toBeTruthy();
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
  expect(onUrlUpdate.mock.calls.at(-1)?.[0].queryString).toBe('?workspace=image');
});

it('opens the image picker directly and returns there from a deep-linked image tool', async () => {
  const { unmount } = render(<NuqsTestingAdapter searchParams="?workspace=image"><Studio /></NuqsTestingAdapter>);
  expect(screen.getByText('Image modes only')).toBeTruthy();
  unmount();
  render(<NuqsTestingAdapter searchParams="?feature=image-editing"><Studio /></NuqsTestingAdapter>);
  fireEvent.click(screen.getByRole('button', { name: 'Back to modes' }));
  await waitFor(() => expect(screen.getByText('Image modes only')).toBeTruthy());
  expect(screen.queryByText('Balanced home')).toBeNull();
});
