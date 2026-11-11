import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Column, Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";

/** Geçerli sütun sırası — kayıtlı sıra yoksa tanım sırası. */
export function currentOrder<T>(table: Table<T>): string[] {
  const saved = table.getState().columnOrder ?? [];
  const all = table.getAllLeafColumns().map((c) => c.id);
  if (!saved.length) return all;
  // Kayıttan sonra eklenen sütun kaybolmasın: kayıtta olmayanlar sona.
  return [...saved.filter((id) => all.includes(id)), ...all.filter((id) => !saved.includes(id))];
}

/**
 * Sütunu görünür komşusunun yerine taşı (klavye/menü yolu; sürükle-bırakın ikizi).
 * `step` -1 = sola, +1 = sağa. Gizli sütunlar atlanır ki tık görünürde bir yer değiştirsin.
 */
export function moveColumn<T>(table: Table<T>, columnId: string, step: -1 | 1): void {
  const order = currentOrder(table);
  const visible = new Set(table.getVisibleLeafColumns().map((c) => c.id));
  const from = order.indexOf(columnId);
  let to = from + step;
  while (to >= 0 && to < order.length && !visible.has(order[to] ?? "")) to += step;
  const target = order[to];
  if (from < 0 || target === undefined) return;
  const next = [...order];
  next[to] = columnId;
  next[from] = target;
  table.setColumnOrder(next);
}

/** "Sütunları sıfırla": sıra, görünürlük ve elle genişlik tanım varsayılanına döner (tercihten silinir). */
export function resetColumnLayout<T>(table: Table<T>): void {
  table.resetColumnOrder(true);
  table.resetColumnVisibility(true);
  table.resetColumnSizing(true);
}

/** Sütunlar menüsündeki sola/sağa düğmeleri — gizli sütunda pasif. */
export function MoveButtons<T>({ table, col, label }: { table: Table<T>; col: Column<T, unknown>; label: string }) {
  const visibleIds = table.getVisibleLeafColumns().map((c) => c.id);
  const i = visibleIds.indexOf(col.id);
  return (
    <span className="flex shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label={`${label} sola taşı`}
        disabled={i <= 0}
        onClick={() => moveColumn(table, col.id, -1)}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label={`${label} sağa taşı`}
        disabled={i < 0 || i >= visibleIds.length - 1}
        onClick={() => moveColumn(table, col.id, 1)}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}
