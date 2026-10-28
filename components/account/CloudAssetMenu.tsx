'use client';

import { Clipboard, Download, Film, ImageDown, Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu';
import { knownAccountAssetFilenameBase } from '@/lib/account/asset-name';
import type { CloudAsset } from '@/lib/account/contracts';
import { useLastFrame } from '@/lib/use-last-frame';

/**
 * The library card's ⋯ menu: everything a saved asset offers besides its one
 * primary action. Its own component because the last-frame actions hold a
 * per-clip frame cache, and the grid renders its cards in a loop.
 *
 * Every action goes through the grid's `run`, so the owner check, the shared
 * busy flag and the toast on failure are the ones the card's buttons already
 * use. The old inline "Copied" tick and error line had nowhere to live once the
 * buttons moved into a menu that closes on select, so both are toasts now.
 */
export default function CloudAssetMenu({
  asset,
  disabled,
  busy,
  run,
  onReuseSettings,
  onDownload,
  onDelete,
  onContinue,
}: {
  asset: CloudAsset;
  disabled: boolean;
  busy: boolean;
  run: (task: () => Promise<unknown>) => Promise<void>;
  /** Absent for a saved YouTube section, which has no settings to reuse. */
  onReuseSettings?: () => void;
  onDownload: () => Promise<unknown>;
  onDelete: () => void;
  /** Where "Continue from last frame" goes after seeding the draft. Absent hides it. */
  onContinue?: () => void;
}) {
  const frame = useLastFrame(`/api/account/assets/${asset.id}/content`, knownAccountAssetFilenameBase(asset));
  const video = asset.kind === 'video';

  const use: (ActionMenuItem | false)[] = [
    video && onContinue !== undefined && {
      id: 'continue',
      label: 'Continue from last frame',
      description: 'Start a new clip from where this one ends',
      icon: Film,
      onSelect: () => void run(async () => {
        await frame.seed();
        onContinue();
      }),
    },
    video && {
      id: 'save-frame',
      label: 'Save last frame',
      description: 'Download the closing frame as a PNG',
      icon: ImageDown,
      onSelect: () => void run(frame.save),
    },
    video && frame.copySupported && {
      id: 'copy-frame',
      label: 'Copy last frame',
      description: 'Copy the closing frame as an image',
      icon: Clipboard,
      onSelect: () => void run(async () => {
        await frame.copy();
        toast.success('Last frame copied');
      }),
    },
    onReuseSettings !== undefined && {
      id: 'reuse',
      label: 'Reuse settings',
      description: 'Select this model and load its prompt and settings',
      icon: Wand2,
      onSelect: onReuseSettings,
    },
  ];
  const file: ActionMenuItem[] = [
    {
      id: 'download',
      label: video ? 'Download video' : 'Download image',
      icon: Download,
      onSelect: () => void run(onDownload),
    },
    { id: 'delete', label: 'Delete…', icon: Trash2, onSelect: onDelete, danger: true },
  ];

  return (
    <ActionMenu
      label="More actions"
      sections={[use.filter((item): item is ActionMenuItem => Boolean(item)), file]}
      disabled={disabled}
      busy={busy}
    />
  );
}
