'use client';

import { useEffect } from 'react';
import { Command } from 'cmdk';
import { useQueryState } from 'nuqs';
import { useRouter } from 'next/navigation';
import {
  Bookmark,
  Home,
  ImagePlus,
  Key,
  Layers,
  Library as LibraryIcon,
  MoveRight,
  Palette,
  Rocket,
  ScanFace,
  Search,
  Sparkles,
  Type,
  UserCircle,
  Volume2,
  VolumeX,
  Wallet,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import ProviderLogo from '@/components/ProviderLogo';
import { ENGINE_DOCS } from '@/lib/engines/docs';
import { enginesForFeature } from '@/lib/engines/registry';
import { brand } from '@/lib/brand';
import { FEATURES, type Feature } from '@/types';
import type { ProviderMode } from '@/lib/providers/types';
import { useAccountStore } from '@/store/useAccountStore';
import { useAppStore } from '@/store/useAppStore';
import { setUiSoundsEnabled } from '@/lib/notify/chime';

type LibraryTab = 'results' | 'prompts';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenApiKey: () => void;
  onOpenLibrary: (tab?: LibraryTab) => void;
}

/**
 * One icon per feature rather than one per category: in a flat list the icon is
 * the only thing distinguishing two rows before you read them, and three
 * repeated sparkles defeat that.
 */
const FEATURE_ICONS: Record<string, LucideIcon> = {
  'text-to-image': Sparkles,
  'image-editing': Wand2,
  'multi-image-compose': Layers,
  'search-grounding': Search,
  'social-media-thumbnail': Rocket,
  'style-transfer': Palette,
};

/**
 * Extra search terms per feature — the words someone types when they don't
 * remember the card's title. Curated rather than derived from the description:
 * cmdk scores subsequences, so feeding it a three-sentence blurb makes every
 * feature a weak match for almost anything (typing "video" surfaced four image
 * features above the video modes).
 */
const FEATURE_KEYWORDS: Record<string, string[]> = {
  'text-to-image': ['generate', 'create', 'prompt', 'photorealistic'],
  'image-editing': ['edit', 'transform', 'retouch', 'swap', 'inpaint'],
  'multi-image-compose': ['combine', 'merge', 'compose', 'try-on', 'mockup'],
  'search-grounding': ['google', 'grounding', 'live', 'weather', 'news'],
  'social-media-thumbnail': ['youtube', 'thumbnail', 'social', 'viral', 'cover'],
  'style-transfer': ['style', 'artistic', 'painting', 'anime', 'watercolor'],
};

/** Video modes, mirroring VideoWorkspace's own cards so the two agree. */
const VIDEO_MODES: ReadonlyArray<{
  id: ProviderMode;
  label: string;
  blurb: string;
  requires: string;
  icon: LucideIcon;
  /** Extra search terms — fal is the only engine with first/last-frame models. */
  keywords: string[];
}> = [
  {
    id: 'text',
    label: 'Text to video',
    blurb: 'Start from a written prompt',
    requires: 'Prompt only',
    icon: Type,
    keywords: ['animate', 'generate', 'clip', 'motion'],
  },
  {
    id: 'image',
    label: 'Image to video',
    blurb: 'Put a still frame into motion',
    requires: 'Needs an image',
    icon: ImagePlus,
    keywords: ['animate', 'still', 'motion'],
  },
  {
    id: 'frames',
    label: 'First & last frame',
    blurb: 'Fill the motion between two stills',
    requires: 'Two images',
    icon: MoveRight,
    keywords: ['interpolate', 'bookend', 'fal', 'transition'],
  },
  {
    id: 'reference',
    label: 'Character references',
    blurb: 'Carry one character into a new scene',
    requires: 'Character views',
    icon: ScanFace,
    keywords: ['consistent', 'identity', 'character', 'subject', 'runware', 'wan'],
  },
];

/** The badge on the right: what the feature needs before it can run. */
function inputRequirement(feature: Feature): string {
  if (feature.requiresMultipleImages) {
    return feature.maxImages ? `Up to ${feature.maxImages} images` : 'Multiple images';
  }
  return feature.requiresImage ? 'Needs an image' : 'Prompt only';
}

/** Feature blurbs run two or three sentences; a row has space for the first. */
function firstSentence(text: string): string {
  const end = text.indexOf('. ');
  return end === -1 ? text : text.slice(0, end);
}

function openExternal(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer');
}

/** Exact title > prefix > word start > mid-word. */
function substringScore(haystack: string, needle: string): number {
  if (haystack === needle) return 1;
  const at = haystack.indexOf(needle);
  if (at === -1) return 0;
  if (at === 0) return 0.9;
  return /[\s&/-]/.test(haystack[at - 1]) ? 0.8 : 0.6;
}

/**
 * Substring matching instead of cmdk's default fuzzy subsequence scoring.
 * With rows this wordy, subsequences match nearly everything — "video" pulled
 * four image features above the video modes, and "anime" ranked Multi-Image
 * Composition over Style Transfer, whose alias it literally is. A typo now
 * finds nothing, which is the better failure: the list is short enough to read.
 */
export function commandFilter(value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;

  const title = value.toLowerCase();
  const aliases = (keywords ?? []).map((k) => k.toLowerCase());
  const tokens = query.split(/\s+/);

  // Multi-word queries ("text image") rarely sit contiguously in one field, so
  // they only have to land somewhere across the title and its aliases.
  if (tokens.length > 1) {
    const all = [title, ...aliases].join(' ');
    return tokens.every((token) => all.includes(token)) ? 0.7 : 0;
  }

  // Aliases score a shade under the title so a title hit always wins the tie.
  return Math.max(
    substringScore(title, query),
    ...aliases.map((alias) => substringScore(alias, query) * 0.85)
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenApiKey,
  onOpenLibrary,
}: CommandPaletteProps) {
  const [, setFeatureId] = useQueryState('feature', { history: 'push' });
  const [, setWorkspace] = useQueryState('workspace', { history: 'push' });
  const [, setVideoMode] = useQueryState('videoMode', { history: 'push' });
  const router = useRouter();
  const setVideoEngine = useAppStore((state) => state.setVideoEngine);
  const uiSoundsEnabled = useAppStore((state) => state.uiSoundsEnabled);
  // Mirrors the footer link: only a settled session with nobody in it offers sign-in.
  const accountStatus = useAccountStore((state) => state.status);
  const hasAccount = useAccountStore((state) => Boolean(state.session?.account));
  const signedOut = accountStatus === 'ready' && !hasAccount;

  // ⌘K / Ctrl-K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const go = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  // An image feature and a video mode are mutually exclusive views, so each
  // jump clears the other side's params — otherwise picking a feature from the
  // video workspace leaves ?workspace=video and nothing appears to happen.
  const goToFeature = (id: string) => {
    void setWorkspace(null);
    void setFeatureId(id);
  };

  const goToVideo = (mode: ProviderMode) => {
    void setFeatureId(null);
    void setWorkspace('video');
    // Today reference video is a Runware capability, so this global shortcut
    // lands on a provider that can actually honor the selected mode.
    if (mode === 'reference') setVideoEngine('runware');
    void setVideoMode(mode === 'text' ? null : mode);
  };

  const goHome = () => {
    void setWorkspace(null);
    void setVideoMode(null);
    void setFeatureId(null);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command menu"
      filter={commandFilter}
      loop
    >
      <Command.Input placeholder="Jump to a feature or action…" />
      <Command.List>
        <Command.Empty>No results found.</Command.Empty>

        <Command.Group heading="Image">
          {FEATURES.map((f) => {
            const Icon = FEATURE_ICONS[f.id] ?? Sparkles;
            const free = enginesForFeature(f).some((e) => e.free);
            return (
              <Command.Item
                key={f.id}
                // Title carries the match; the rest are aliases. Deliberately no
                // ids or categories here — hyphenated slugs hand the fuzzy
                // matcher letters that make every row a weak hit for anything.
                value={f.name}
                keywords={[...(FEATURE_KEYWORDS[f.id] ?? []), ...(free ? ['free'] : [])]}
                onSelect={() => go(() => goToFeature(f.id))}
              >
                <Icon size={15} />
                <span className="cmd-item-body">
                  <span className="cmd-item-title">{f.name}</span>
                  <span className="cmd-item-desc">{firstSentence(f.description)}</span>
                </span>
                <span className="cmd-item-meta">{inputRequirement(f)}</span>
              </Command.Item>
            );
          })}
        </Command.Group>

        <Command.Group heading="Video">
          {VIDEO_MODES.map((mode) => (
            <Command.Item
              key={mode.id}
              data-accent="purple"
              value={`${mode.label} video`}
              keywords={mode.keywords}
              onSelect={() => go(() => goToVideo(mode.id))}
            >
              <mode.icon size={15} />
              <span className="cmd-item-body">
                <span className="cmd-item-title">{mode.label}</span>
                <span className="cmd-item-desc">{mode.blurb}</span>
              </span>
              <span className="cmd-item-meta">{mode.requires}</span>
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Actions">
          <Command.Item
            value="Go to home"
            keywords={['start over', 'feature picker', 'back', 'reset']}
            onSelect={() => go(goHome)}
          >
            <Home size={15} />
            <span className="cmd-item-body">
              <span className="cmd-item-title">Go to home</span>
              <span className="cmd-item-desc">Back to the feature picker</span>
            </span>
          </Command.Item>
          <Command.Item
            value="Open library"
            keywords={['gallery', 'kept', 'results', 'history', 'storage']}
            onSelect={() => go(() => onOpenLibrary('results'))}
          >
            <LibraryIcon size={15} />
            <span className="cmd-item-body">
              <span className="cmd-item-title">Open library</span>
              <span className="cmd-item-desc">Results kept in this browser</span>
            </span>
          </Command.Item>
          <Command.Item
            value="Saved prompts"
            keywords={['library', 'reuse', 'bookmark']}
            onSelect={() => go(() => onOpenLibrary('prompts'))}
          >
            <Bookmark size={15} />
            <span className="cmd-item-body">
              <span className="cmd-item-title">Saved prompts</span>
              <span className="cmd-item-desc">Reuse a prompt you kept</span>
            </span>
          </Command.Item>
          <Command.Item
            value="View spend"
            keywords={['cost', 'spend', 'expenses', 'usage', 'billing', 'ledger', 'money']}
            onSelect={() => go(() => router.push('/spend'))}
          >
            <Wallet size={15} />
            <span className="cmd-item-body">
              <span className="cmd-item-title">View spend</span>
              <span className="cmd-item-desc">What your generations have cost</span>
            </span>
          </Command.Item>
          <Command.Item
            value={signedOut ? 'Sign in' : 'Your account'}
            keywords={['account', 'profile', 'cloud', 'login', 'sign in', 'connections', 'keys', 'workspace']}
            onSelect={() => go(() => router.push(signedOut ? '/sign-in' : '/account'))}
          >
            <UserCircle size={15} />
            <span className="cmd-item-body">
              <span className="cmd-item-title">{signedOut ? 'Sign in' : 'Your account'}</span>
              <span className="cmd-item-desc">
                {signedOut ? 'Access your cloud workspace and connections' : 'Cloud workspace, connections, and private library'}
              </span>
            </span>
          </Command.Item>
          <Command.Item
            value={uiSoundsEnabled ? 'Mute interface sounds' : 'Unmute interface sounds'}
            /* `chime` and `bell` stay as search aliases: they are what someone
               who remembers the sound rather than the setting will type. */
            keywords={['sound', 'audio', 'bell', 'chime', 'notification', 'silence', 'mute']}
            onSelect={() => go(() => setUiSoundsEnabled(!uiSoundsEnabled))}
          >
            {uiSoundsEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span className="cmd-item-body">
              {/* No description. It used to name the one event the sound marks,
                  which is the specificity this setting is moving away from, and
                  the title already says what selecting it does. */}
              <span className="cmd-item-title">
                {uiSoundsEnabled ? 'Mute interface sounds' : 'Unmute interface sounds'}
              </span>
            </span>
          </Command.Item>
          <Command.Item
            value="Connections"
            keywords={['gemini', 'fal', 'kie', 'credentials', 'connect', 'API keys']}
            onSelect={() => go(onOpenApiKey)}
          >
            <Key size={15} />
            <span className="cmd-item-body">
              <span className="cmd-item-title">Connections</span>
              <span className="cmd-item-desc">Add or update a provider connection</span>
            </span>
          </Command.Item>
        </Command.Group>

        <Command.Group heading="Resources">
          <Command.Item
            data-accent="muted"
            value="Get a Gemini API key"
            keywords={['billing', 'google ai studio', 'credentials']}
            onSelect={() => go(() => openExternal('https://aistudio.google.com/apikey'))}
          >
            <Key size={15} />
            Get a Gemini API key
          </Command.Item>
          {ENGINE_DOCS.map((engine) => (
            <Command.Item
              key={engine.id}
              data-accent="muted"
              value={`${engine.label} docs`}
              keywords={['documentation', 'api', 'reference']}
              onSelect={() => go(() => openExternal(engine.href))}
            >
              <ProviderLogo provider={engine.id} size={15} />
              {engine.label} docs
            </Command.Item>
          ))}
          <Command.Item
            data-accent="muted"
            value="GitHub repository"
            keywords={['source', 'code', 'issues', 'repo']}
            onSelect={() => go(() => openExternal(brand.githubUrl))}
          >
            <Layers size={15} />
            {brand.shortName} on GitHub
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
