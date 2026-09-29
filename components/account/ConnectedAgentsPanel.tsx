'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import { accountRequest } from '@/lib/account/client';
import type { ConnectedAgent } from '@/lib/account/contracts';
import { formatUsdTotal } from '@/lib/spend/format';

interface AgentsResponse { accountId: string; mcpUrl: string | null; limits: { minUsd: number; maxUsd: number }; agents: ConnectedAgent[] }
type Settings = Pick<ConnectedAgent, 'budgetUsd' | 'allowUnknownCost' | 'allowDelete'>;

/** The agents this account has connected over MCP: where to connect one, what
 *  each may spend, and the switch that disconnects it at once. */
export default function ConnectedAgentsPanel({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<ConnectedAgent | null>(null);
  // Which agent ids have a DELETE in flight. A ref for the synchronous re-entry
  // guard — `AccountDeletion`'s `pending` ref, scoped per agent instead of one
  // shared flag — plus mirrored state so the row can actually render disabled;
  // a ref alone never triggers a re-render, and state alone lags one tick behind
  // a second click fired before React re-renders.
  const disconnectingIdsRef = useRef<Set<string>>(new Set());
  const [pendingDisconnectIds, setPendingDisconnectIds] = useState<Set<string>>(new Set());

  // Defined inline rather than as a `useCallback` called by reference: the
  // linter's `set-state-in-effect` check reads a `setState` reached through a
  // callback reference as happening synchronously in the effect body, even
  // though it only runs after the `await` — `useAccountLibrary`'s own poll
  // effect uses the same inline shape for the same reason.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await accountRequest<AgentsResponse>('agents', { signal: controller.signal, headers: { 'X-Account-Id': ownerId } });
        if (response.accountId === ownerId) setData(response);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Connected agents could not be loaded.');
      }
    })();
    return () => controller.abort();
  }, [ownerId]);

  async function save(agent: ConnectedAgent, settings: Settings) {
    try {
      const { agent: saved } = await accountRequest<{ agent: ConnectedAgent }>(`agents/${agent.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Account-Id': ownerId }, body: JSON.stringify(settings) });
      setData(current => current && { ...current, agents: current.agents.map(candidate => candidate.id === agent.id ? saved : candidate) });
      toast.success(`${agent.name} updated.`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Please try again.');
    }
  }

  async function disconnect(agent: ConnectedAgent) {
    // Ignore a second confirmation for the same agent: the row's own Disconnect
    // button is disabled the instant this starts, but the ref check is what
    // actually stops a re-entrant call rather than relying on the DOM alone.
    if (disconnectingIdsRef.current.has(agent.id)) return;
    disconnectingIdsRef.current.add(agent.id);
    setPendingDisconnectIds(current => new Set(current).add(agent.id));
    setDisconnecting(null);
    try {
      await accountRequest(`agents/${agent.id}`, { method: 'DELETE', headers: { 'X-Account-Id': ownerId } });
      setData(current => current && { ...current, agents: current.agents.filter(candidate => candidate.id !== agent.id) });
      toast.success(`${agent.name} disconnected.`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Please try again.');
    } finally {
      // Re-enable on failure (the row is still there); a no-op on success,
      // since the row that held this id is gone from `data.agents` already.
      disconnectingIdsRef.current.delete(agent.id);
      setPendingDisconnectIds(current => { const next = new Set(current); next.delete(agent.id); return next; });
    }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success('MCP URL copied.'); }
    catch { toast.error('Copy did not work. Select the URL instead.'); }
  }

  return (
    <section aria-label="Connected agents">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--foreground-subtle)]">Connected agents</p>
      {data?.mcpUrl && (
        <div className="mt-2">
          <p className="text-xs text-[var(--foreground-muted)]">Add this URL to an MCP client to connect an agent:</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">{data.mcpUrl}</code>
            <button type="button" aria-label="Copy MCP URL" onClick={() => void copy(data.mcpUrl!)} className="btn-secondary px-2 py-1"><Copy size={13} aria-hidden="true" /></button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-[var(--neon-pink)]">{error}</p>}
      {data && data.agents.length === 0 && <p className="mt-3 text-xs text-[var(--foreground-muted)]">No agents connected.</p>}
      {data && data.agents.length > 0 && (
        <ul className="mt-3 space-y-3">
          {data.agents.map(agent => <AgentRow key={agent.id} agent={agent} limits={data.limits} disconnecting={pendingDisconnectIds.has(agent.id)} onSave={settings => save(agent, settings)} onDisconnect={() => setDisconnecting(agent)} />)}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(disconnecting)}
        title={`Disconnect ${disconnecting?.name ?? 'this agent'}?`}
        description="It stops working at once. Jobs it already started keep running and stay in your library."
        confirmLabel="Disconnect"
        onConfirm={() => { if (disconnecting) void disconnect(disconnecting); }}
        onCancel={() => setDisconnecting(null)}
      />
    </section>
  );
}

function AgentRow({ agent, limits, disconnecting, onSave, onDisconnect }: { agent: ConnectedAgent; limits: AgentsResponse['limits']; disconnecting: boolean; onSave(settings: Settings): Promise<void>; onDisconnect(): void }) {
  const [budget, setBudget] = useState(String(agent.budgetUsd));
  const [allowUnknownCost, setAllowUnknownCost] = useState(agent.allowUnknownCost);
  const [allowDelete, setAllowDelete] = useState(agent.allowDelete);
  const [busy, setBusy] = useState(false);
  const budgetUsd = Number(budget);
  const valid = Number.isFinite(budgetUsd) && budgetUsd >= limits.minUsd && budgetUsd <= limits.maxUsd;
  const changed = budgetUsd !== agent.budgetUsd || allowUnknownCost !== agent.allowUnknownCost || allowDelete !== agent.allowDelete;
  const id = `agent-${agent.id}`;
  return (
    <li className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-sm font-medium text-[var(--foreground)]">{agent.name}</p>
      <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">{formatUsdTotal(agent.usedUsd)} of {formatUsdTotal(agent.budgetUsd)} in the last 24 hours</p>
      <label htmlFor={`${id}-limit`} className="field-sublabel mt-3 block">Limit per 24 hours</label>
      <input id={`${id}-limit`} type="number" inputMode="decimal" min={limits.minUsd} max={limits.maxUsd} step="0.5" value={budget} onChange={event => setBudget(event.target.value)} className="mt-1 w-full" />
      <label htmlFor={`${id}-unknown`} className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--foreground-muted)]">
        Allow unpriced models
        <input id={`${id}-unknown`} type="checkbox" checked={allowUnknownCost} onChange={event => setAllowUnknownCost(event.target.checked)} className="h-4 w-4 accent-[var(--neon-cyan)]" />
      </label>
      <label htmlFor={`${id}-delete`} className="mt-2 flex items-center justify-between gap-3 text-xs text-[var(--foreground-muted)]">
        Allow deleting files
        <input id={`${id}-delete`} type="checkbox" checked={allowDelete} onChange={event => setAllowDelete(event.target.checked)} className="h-4 w-4 accent-[var(--neon-cyan)]" />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!changed || !valid || busy || disconnecting} onClick={async () => { setBusy(true); await onSave({ budgetUsd, allowUnknownCost, allowDelete }); setBusy(false); }} className="btn-secondary flex flex-1 justify-center">Save</button>
        <button type="button" disabled={disconnecting} onClick={onDisconnect} className="btn-secondary flex flex-1 justify-center text-red-300">Disconnect</button>
      </div>
    </li>
  );
}
