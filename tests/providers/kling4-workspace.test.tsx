import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderVideoWorkspace from '@/components/ProviderVideoWorkspace';
import { findModel } from '@/lib/providers/catalog';
import { editPromptShortcuts } from '@/lib/providers/video-edit';
import { useAppStore } from '@/store/useAppStore';
import { useDraftStore } from '@/store/useDraftStore';
import { useProviderJobsStore } from '@/store/useProviderJobsStore';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  useProviderJobsStore.getState().clearJobs();
  useAppStore.setState({ atlasApiKey: 'test-only', atlasVideoModel: 'kwaivgi/kling-v4.0/image-to-video' });
  useDraftStore.setState({ prompt: '', controlValues: {}, references: Array.from({ length: 10 }, (_, index) => ({
    id: String(index), file: new File(['x'], `${index}.png`, { type: 'image/png' }), previewUrl: `blob:${index}`,
  })) });
});

describe('Kling 4 image ordering', () => {
  it('shows all ten keyframe positions without an aspect ratio or audio toggle', () => {
    render(<ProviderVideoWorkspace provider="atlas" label="Atlas Cloud" inputMode="image" onBack={() => {}} onOpenConnections={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Keyframes in order' })).toBeInTheDocument();
    expect(screen.getByText('First frame')).toBeInTheDocument();
    expect(screen.getByText('Middle frame 8')).toBeInTheDocument();
    expect(screen.getByText('Last frame')).toBeInTheDocument();
    expect(useDraftStore.getState().references).toHaveLength(10);
    expect(screen.queryByLabelText('Aspect ratio')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Generate audio')).not.toBeInTheDocument();
  });

  it('describes the selectable edit length without claiming it matches the source', () => {
    useAppStore.setState({ atlasVideoModel: 'kwaivgi/kling-v4.0/video-edit' });
    render(<ProviderVideoWorkspace provider="atlas" label="Atlas Cloud" inputMode="edit" onBack={() => {}} onOpenConnections={() => {}} />);
    expect(screen.getByText('Choose the output duration; aspect ratio follows the source video.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Output duration' })).toBeInTheDocument();
  });

  it('uses Kling 4 source and image names in edit shortcuts', () => {
    const edit = findModel('atlas', 'kwaivgi/kling-v4.0/video-edit')!.videoEdit!;
    const replacement = editPromptShortcuts(edit)[0][1];
    expect(replacement).toContain('@video_1');
    expect(replacement).toContain('@image_1');
    expect(replacement).not.toContain('@Image1');
  });
});
