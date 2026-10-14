// lib/format-bytes.ts

/**
 * A file size in binary units (1 KB = 1024 B), one decimal below 10. Account
 * storage uses `formatAccountBytes` instead, which counts in 1000s.
 */
export function formatBytes(bytes: number): string {
  const units = ['KB', 'MB', 'GB', 'TB'];
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
