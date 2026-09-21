import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LibraryOverlay from '../../components/LibraryOverlay';
import type { GalleryRecord } from '../../lib/gallery/storage';
import { useDraftStore } from '../../store/useDraftStore';
import { useGalleryStore } from '../../store/useGalleryStore';
import { useAccountStore } from '../../store/useAccountStore';
import { usePromptLibraryStore } from '../../store/usePromptLibraryStore';

vi.mock('../../components/account/AccountLibrary', () => ({
  default: function MockAccountLibrary({ownerId,onCounts}:{ownerId:string;onCounts?:(counts:{all:number;image:number;video:number;temporary:number})=>void}) {
    useEffect(() => { onCounts?.({all:7,image:5,video:2,temporary:0}); }, [onCounts]);
    return <div data-testid="cloud-library">Cloud assets for {ownerId}</div>;
  },
}));

function record(overrides: Partial<GalleryRecord> = {}): GalleryRecord {
  return {
    id: 'image-1',
    kind: 'image',
    createdAt: 1,
    prompt: 'Moonlit palms moving in a warm wind',
    slug: 'moonlit-palms',
    provider: 'gemini',
    controlValues: {},
    mimeType: 'image/png',
    blob: new Blob(['png'], { type: 'image/png' }),
    bytes: 3,
    ...overrides,
  };
}

describe('LibraryOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let created = 0;
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:library-${++created}`),
      revokeObjectURL: vi.fn(),
    }));
    useDraftStore.getState().reset();
    useGalleryStore.setState({ records: [], hydrated: true, storageError: null });
    useAccountStore.setState({session:null,status:'ready',epoch:0,jobs:[],assets:[]});
  });

  it('takes an upload, so the picker is never a dead end with nothing stored', async () => {
    // SA-06: Replace opens this dialog and nothing else, so a reader with an
    // empty library met "No stored images yet." and no way forward - swapping
    // one picture for another off disk meant removing the reference entirely.
    const onOpenChange = vi.fn();
    render(
      <LibraryOverlay open onOpenChange={onOpenChange} purpose="pick-image" referenceLimit={2} />
    );

    expect(screen.getByText('No stored images yet.')).toBeInTheDocument();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/*');

    fireEvent.change(input, {
      target: { files: [new File(['png'], 'from-disk.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(useDraftStore.getState().references).toHaveLength(1));
    expect(useDraftStore.getState().references[0].file.name).toBe('from-disk.png');
    // Picked and done: the dialog closes the way choosing a stored image does.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('swaps the slot Replace recorded, rather than appending to it', async () => {
    useDraftStore.getState().addReferences(
      [{ file: new File(['a'], 'first.png', { type: 'image/png' }) },
       { file: new File(['b'], 'second.png', { type: 'image/png' }) }],
      2
    );
    // What Replace sets before opening this dialog.
    useDraftStore.getState().setReplaceTarget(0);

    render(
      <LibraryOverlay open onOpenChange={() => undefined} purpose="pick-image" referenceLimit={2} />
    );
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['c'], 'swapped.png', { type: 'image/png' })] },
    });

    await waitFor(() =>
      expect(useDraftStore.getState().references.map(r => r.file.name)).toEqual(['swapped.png', 'second.png'])
    );
  });

  it('refuses a file that is not an image, without touching the draft', async () => {
    render(
      <LibraryOverlay open onOpenChange={() => undefined} purpose="pick-image" referenceLimit={2} />
    );

    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['clip'], 'clip.mp4', { type: 'video/mp4' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an image file.');
    expect(useDraftStore.getState().references).toHaveLength(0);
  });

  it('presents a focused image-only picker without library management', () => {
    useGalleryStore.setState({
      records: [
        record(),
        record({
          id: 'video-1',
          kind: 'video',
          slug: 'moving-palms',
          mimeType: 'video/mp4',
          blob: new Blob(['video'], { type: 'video/mp4' }),
          posterBlob: new Blob(['poster'], { type: 'image/png' }),
          bytes: 5,
        }),
      ],
    });

    render(
      <LibraryOverlay
        open
        onOpenChange={() => undefined}
        purpose="pick-image"
        referenceLimit={2}
      />
    );

    // Named for what it offers: the picker takes an upload as well as a stored
    // image, so it no longer claims to be only the library.
    expect(screen.getByRole('dialog', { name: 'Choose an image' })).toBeInTheDocument();
    expect(screen.getByText('moonlit palms')).toBeInTheDocument();
    expect(screen.queryByText('moving palms')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear library' })).toBeNull();
    expect(screen.getByText('1 stored image')).toBeInTheDocument();
  });

  it('closes after a contextual image is used', async () => {
    useGalleryStore.setState({ records: [record()] });
    const onOpenChange = vi.fn();
    render(
      <LibraryOverlay
        open
        onOpenChange={onOpenChange}
        purpose="pick-image"
        referenceLimit={2}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use image' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(useDraftStore.getState().references).toHaveLength(1);
  });

  it('keeps the normal library tabs and management by default', () => {
    useGalleryStore.setState({ records: [record()] });

    render(<LibraryOverlay open onOpenChange={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^results/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^prompts/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear library' })).toBeInTheDocument();
  });

  it('offers cloud and browser sources only while signed in', () => {
    useGalleryStore.setState({ records: [record()] });
    useAccountStore.getState().applySession({account:{id:'owner-1',name:'Owner',email:'owner@example.test'},googleEnabled:true,localSignIn:false,providers:[],connections:[]});
    render(<LibraryOverlay open onOpenChange={() => undefined} />);

    expect(screen.getByTestId('cloud-library')).toHaveTextContent('owner-1');
    expect(screen.getByRole('button',{name:'Cloud account'})).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByRole('button',{name:'This browser'}));
    expect(screen.getByText('moonlit palms')).toBeInTheDocument();
    expect(screen.queryByTestId('cloud-library')).toBeNull();
  });

  it('returns to the browser library when the account disappears', () => {
    useGalleryStore.setState({ records: [record()] });
    useAccountStore.getState().applySession({account:{id:'owner-1',name:'Owner',email:'owner@example.test'},googleEnabled:true,localSignIn:false,providers:[],connections:[]});
    render(<LibraryOverlay open onOpenChange={() => undefined} />);
    expect(screen.getByTestId('cloud-library')).toBeInTheDocument();

    act(()=>useAccountStore.getState().applySession({account:null,googleEnabled:true,localSignIn:false,providers:[],connections:[]}));
    expect(screen.getByText('moonlit palms')).toBeInTheDocument();
    expect(screen.queryByRole('group',{name:'Library source'})).toBeNull();
  });
  it('labels each tab with how much it lists', () => {
    useGalleryStore.setState({ records: [record(), record({ id: 'image-2' })] });
    usePromptLibraryStore.setState({
      history: [{ id: 'p1', text: 'one', savedAt: 1 }, { id: 'p2', text: 'two', savedAt: 2 }],
      favourites: [{ id: 'p3', text: 'kept', savedAt: 3 }],
    });
    render(<LibraryOverlay open onOpenChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'results (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'prompts (3)' })).toBeInTheDocument();
  });

  it('counts the cloud library account-wide while the cloud source is shown', async () => {
    useGalleryStore.setState({ records: [record()] });
    act(() => useAccountStore.getState().applySession({ account: { id: 'owner', name: 'Owner', email: 'owner@example.test' }, googleEnabled: true, localSignIn: false, providers: [], connections: [] }));
    render(<LibraryOverlay open onOpenChange={() => {}} />);
    expect(await screen.findByRole('tab', { name: 'results (7)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This browser' }));
    expect(screen.getByRole('tab', { name: 'results (1)' })).toBeInTheDocument();
  });

  it('portals onto document.body so a sticky generate column cannot paint over it', () => {
    // The workspace prompt pane is `lg:sticky lg:z-20` with backdrop-blur —
    // a stacking context. An in-tree `fixed z-[60]` overlay from the setup
    // column stays trapped in that column's (z-auto) context, which is how
    // Prompt / Generate showed through the cloud library. jsdom cannot compute
    // stacking, so this asserts the DOM escape the CSS needs.
    const { container } = render(
      <div>
        <div data-testid="setup-column" className="lg:sticky">
          <LibraryOverlay open onOpenChange={() => undefined} purpose="pick-image" />
        </div>
        <div data-testid="prompt-column" className="lg:sticky lg:z-20 lg:backdrop-blur-xl">
          Generate video
        </div>
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Choose an image' });
    expect(dialog.closest('[data-testid="setup-column"]')).toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });
});
