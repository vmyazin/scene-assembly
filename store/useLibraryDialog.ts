import { create } from 'zustand';

export type LibraryTab = 'results' | 'prompts';

/**
 * Whether the library dialog is open, and which section it lands on.
 *
 * A store for the same reason as `useConnectionsDialog`: the dialog belongs to
 * `StudioHeader`, but the prompt panel in every workspace asks for it too —
 * opened on saved prompts, so a prompt can be reused without the trip through
 * the header's Library button and a tab switch. Passing a callback down would
 * mean each route re-declaring the dialog.
 */
interface LibraryDialogState {
  open: boolean;
  tab: LibraryTab;
  /** Opens the dialog on a section; the header's Library button opens results. */
  openLibrary: (tab?: LibraryTab) => void;
  setOpen: (open: boolean) => void;
}

export const useLibraryDialog = create<LibraryDialogState>()((set) => ({
  open: false,
  tab: 'results',
  openLibrary: (tab = 'results') => set({ open: true, tab }),
  setOpen: (open) => set({ open }),
}));
