'use client';

import { useState } from 'react';
import Image from 'next/image';
import { UserRound } from 'lucide-react';
import { googleProfilePicture } from '@/lib/account/profile-picture';

/**
 * `44` is the account rail's identity block. `28` is the studio header's menu
 * button, where the photo sits inside a 44px target with a chevron beside it.
 */
export default function AccountAvatar({ name, picture, size = 44 }: { name: string; picture?: string | null; size?: 44 | 28 }) {
  const source = googleProfilePicture(picture);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-400/10 text-emerald-400 ring-1 ring-white/10 ${size === 28 ? 'h-7 w-7' : 'h-11 w-11'}`}>
      {source && source !== failedSource ? (
        <Image src={source} alt={`${name}'s profile photo`} width={size} height={size}
          unoptimized referrerPolicy="no-referrer" className="h-full w-full object-cover"
          onError={() => setFailedSource(source)} />
      ) : <UserRound size={size === 28 ? 15 : 20} aria-hidden="true" />}
    </span>
  );
}
