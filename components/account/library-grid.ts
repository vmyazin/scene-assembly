/**
 * The cloud library's card grid.
 *
 * Shared by the saved-asset cards and the in-progress job cards because the two
 * are one wall of cards to the reader and two components to us: a running job
 * laid out on its own column rhythm reads as a different screen that happens to
 * be on the same page. Changing the breakpoints here changes both.
 */
export function libraryGridClass(columns: 1 | 2 | 4): string {
  // One column is a narrow rail (the studio's result panel), where the
  // two-up breakpoint would squeeze each card below a readable width.
  if (columns === 1) return 'grid grid-cols-1 gap-4';
  return `grid grid-cols-1 gap-4 sm:grid-cols-2 ${columns === 4 ? 'lg:grid-cols-3 xl:grid-cols-4' : ''}`;
}
