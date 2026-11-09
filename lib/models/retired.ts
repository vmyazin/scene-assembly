/**
 * The rows a model picker shows: everything current, plus a retired model only
 * while it is the one selected.
 *
 * A retired model has a better successor, often at a lower price, so a new
 * visitor has no reason to see it. It stays in the catalog and stays runnable
 * because a person may already be on it, and removing the selected row would
 * leave them running a model the list no longer names, with no way to see the
 * switch `ReplaceDeprecatedModel` offers.
 */
export function hideRetiredModels<T extends { id: string; deprecated?: boolean }>(
  models: readonly T[],
  selectedId: string | undefined
): T[] {
  return models.filter((model) => !model.deprecated || model.id === selectedId);
}
