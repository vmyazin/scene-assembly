'use client';

import { KeyRound } from 'lucide-react';

/**
 * Where Generate would be, once there is a prompt and no key to run it with. The
 * ask comes here rather than before the prompt because someone who has written
 * what they want has a reason to go and fetch a key.
 */
export default function ConnectToGenerateButton({
  label,
  onConnect,
  disabled = false,
}: {
  /** The provider's display name. */
  label: string;
  onConnect: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onConnect} disabled={disabled} className="btn-primary w-full">
      <KeyRound size={18} aria-hidden="true" /> Connect {label} key to generate
    </button>
  );
}
