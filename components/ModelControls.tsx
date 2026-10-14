'use client';

import { useId } from 'react';
import SegmentedToggleGroup from '@/components/SegmentedToggleGroup';
import { isValueCompatible } from '@/lib/draft/carry-over';

export interface ModelControlField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  description?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string | number }>;
  min?: number;
  max?: number;
  step?: number;
}

export interface ModelControlsProps {
  namespace: string;
  fields: ModelControlField[];
  values: Record<string, string | number | boolean>;
  onChange: (key: string, value: string | number | boolean) => void;
}

const safeIdPart = (value: string, fallback: string) => {
  const safeValue = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return safeValue || fallback;
};

type ModelControlValue = string | number | boolean;

const emptyValueFor = (field: ModelControlField): ModelControlValue => {
  if (field.type === 'number') return 0;
  if (field.type === 'boolean') return false;
  return '';
};

const resolvedValueFor = (
  field: ModelControlField,
  values: Record<string, ModelControlValue>
): ModelControlValue => {
  const controlledValue = values[field.key];
  if (isValueCompatible(field, controlledValue)) return controlledValue;
  if (isValueCompatible(field, field.defaultValue)) return field.defaultValue as ModelControlValue;
  return emptyValueFor(field);
};

export default function ModelControls({ namespace, fields, values, onChange }: ModelControlsProps) {
  const instanceId = safeIdPart(useId(), 'instance');
  const namespaceId = safeIdPart(namespace, 'controls');

  return fields.map((field, fieldIndex) => {
    const fieldId = `model-${namespaceId}-${instanceId}-${fieldIndex}-${safeIdPart(field.key, 'field')}`;
    const descriptionId = field.description ? `${fieldId}-description` : undefined;
    const resolvedValue = resolvedValueFor(field, values);

    if (field.type === 'boolean') {
      return (
        <label key={`${field.key}-${fieldIndex}`} htmlFor={fieldId} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--background-elevated)]/60 p-3">
          <span>
            <span className="block text-sm font-medium text-[var(--foreground)]">{field.label}</span>
            {field.description && <span id={descriptionId} className="mt-0.5 block text-xs text-[var(--foreground-muted)]">{field.description}</span>}
          </span>
          <input
            id={fieldId}
            aria-label={field.label}
            aria-describedby={descriptionId}
            type="checkbox"
            checked={resolvedValue as boolean}
            onChange={(event) => onChange(field.key, event.target.checked)}
            className="h-4 w-4 accent-[var(--neon-cyan)]"
          />
        </label>
      );
    }

    if (field.type === 'select' && field.key === 'resolution') {
      return (
        <div key={`${field.key}-${fieldIndex}`} className="space-y-1.5">
          <span className="block text-sm font-medium text-[var(--foreground)]">{field.label}</span>
          <SegmentedToggleGroup
            label={field.label}
            ariaDescribedBy={descriptionId}
            options={field.options ?? []}
            value={resolvedValue as string | number}
            onChange={(value) => onChange(field.key, value)}
          />
          {field.description && (
            <span id={descriptionId} className="block text-xs text-[var(--foreground-subtle)]">{field.description}</span>
          )}
        </div>
      );
    }

    return (
      <label key={`${field.key}-${fieldIndex}`} htmlFor={fieldId} className="block space-y-1.5">
        <span className="block text-sm font-medium text-[var(--foreground)]">{field.label}</span>
        {field.type === 'select' ? (
          <select
            id={fieldId}
            aria-label={field.label}
            aria-describedby={descriptionId}
            value={String(field.options?.findIndex((option) => Object.is(option.value, resolvedValue)) ?? -1)}
            onChange={(event) => {
              const option = field.options?.[Number(event.target.value)];
              if (option) onChange(field.key, option.value);
            }}
            className="w-full"
          >
            {field.options?.map((option, optionIndex) => (
              <option key={optionIndex} value={String(optionIndex)}>{option.label}</option>
            ))}
          </select>
        ) : field.type === 'number' ? (
          <input
            id={fieldId}
            aria-label={field.label}
            aria-describedby={descriptionId}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={resolvedValue as number}
            onChange={(event) => {
              if (event.target.value === '') return;
              const value = Number(event.target.value);
              if (Number.isFinite(value)) onChange(field.key, value);
            }}
            className="w-full"
          />
        ) : (
          <input
            id={fieldId}
            aria-label={field.label}
            aria-describedby={descriptionId}
            type="text"
            value={resolvedValue as string}
            onChange={(event) => onChange(field.key, event.target.value)}
            className="w-full"
          />
        )}
        {field.description && (
          <span id={descriptionId} className="block">{field.description}</span>
        )}
      </label>
    );
  });
}
