// components/WorkspaceCard.tsx
import type { ReactNode } from 'react';
import ModelControls, { type ModelControlField } from '@/components/ModelControls';
import RelaxedFilterControl from '@/components/RelaxedFilterControl';
import type { useRelaxedFilter } from '@/lib/moderation/use-relaxed-filter';

/** A setup card in a provider workspace: a title, one muted line, then its body. */
export function WorkspaceCard({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="glass-card space-y-3 p-3.5 md:p-4">
      <div>
        <h3 className="display text-base font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * The "Model controls" card: the selected model's own controls beside the
 * Standard / Relaxed filter, which sits here because it is a setting of the
 * run like any other. `children` follow the controls, for a note about them.
 */
export function ModelControlsCard({
  description,
  namespace,
  fields,
  values,
  onChange,
  relaxed,
  children,
}: {
  description: ReactNode;
  namespace: string;
  fields: ModelControlField[];
  values: Record<string, string | number | boolean>;
  onChange: (key: string, value: string | number | boolean) => void;
  relaxed: ReturnType<typeof useRelaxedFilter>;
  children?: ReactNode;
}) {
  return (
    <WorkspaceCard title="Model controls" description={description}>
      <div className="grid gap-4 sm:grid-cols-2">
        <ModelControls namespace={namespace} fields={fields} values={values} onChange={onChange} />
        <RelaxedFilterControl filter={relaxed} />
      </div>
      {children}
    </WorkspaceCard>
  );
}
