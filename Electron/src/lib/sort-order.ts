/** Mevcut listenin sortOrder'larından bir sonrakini hesaplar. Boş listede 1 döner. */
export function nextSortOrder(
  items: readonly { sortOrder?: number | null }[],
): number {
  return (
    items.reduce((max, x) => Math.max(max, x.sortOrder ?? 0), 0) + 1
  );
}
