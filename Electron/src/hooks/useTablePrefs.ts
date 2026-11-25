import { useMemo, useState } from "react";
import type { ColumnDef, ColumnSizingState, OnChangeFn, VisibilityState } from "@tanstack/react-table";
import { useOptionalPreferences, usePreferences, type PreferencePatch } from "@/providers/PreferencesProvider";

/** Tablo-başı tercih haritasına yaz; `null` = anahtarı düşür ("Sütunları sıfırla", 64KB tavanı). */
export function withTableEntry<V>(map: Record<string, V> | undefined, key: string, value: V | null): Record<string, V> {
  const next = { ...(map ?? {}) };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

/** Genişlikler tam px; geçersiz/sıfır değer saklanmaz; hiç kalmazsa `null` (anahtar düşer). */
export function roundSizing(sizing: ColumnSizingState): ColumnSizingState | null {
  const out: ColumnSizingState = {};
  for (const [id, w] of Object.entries(sizing)) if (Number.isFinite(w) && w > 0) out[id] = Math.round(w);
  return Object.keys(out).length ? out : null;
}

/** TanStack'in sütun kimliği kuralı: `id` > `accessorKey` (nokta → `_`) > metin başlık. */
export function columnIdsOf<T>(columns: readonly ColumnDef<T>[] | undefined): string[] {
  return (columns ?? []).flatMap((c) => {
    const key = (c as { accessorKey?: unknown }).accessorKey;
    const id = c.id ?? (typeof key === "string" ? key.replace(/\./g, "_") : typeof c.header === "string" ? c.header : undefined);
    return id ? [id] : [];
  });
}

/**
 * Kayıtlı sıradan SONRA eklenen sütun tanımdaki komşusunun ardına girer. TanStack bilinmeyeni sona atar → işlem
 * sütununun da ötesine, dar ekranda görünmez yere düşerdi (ürün listesi "Kumaş türü", 2026-11-25).
 */
export function placeNewColumns(saved: readonly string[], ids: readonly string[]): string[] {
  if (!saved.length) return [...saved];
  const out = [...saved];
  ids.forEach((id, i) => {
    if (out.includes(id)) return;
    const prev = ids.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(prev === undefined ? 0 : out.indexOf(prev) + 1, 0, id);
  });
  return out;
}

/**
 * Sütun sırası + görünürlüğü + genişliği — kullanıcı tercihinde (backend, cihazdan bağımsız) tablo anahtarı başına.
 * `useDataTable` (cursor'lı) ve `useLocalTable` (veriyi sayfa getirir) AYNI kaydı okur/yazar.
 */
export function useTablePrefs<T>(tableKey: string, initialVisibility?: VisibilityState, columns?: readonly ColumnDef<T>[]) {
  return useTablePrefsFrom(usePreferences(), tableKey, initialVisibility, columns);
}

type Prefs = ReturnType<typeof usePreferences>["prefs"];
type TablePrefSlice = Pick<Prefs, "tableOrder" | "tableVisibility" | "tableSizing">;

/**
 * Sağlayıcısız (izole bileşen/test, kabuk dışı) kullanımda bellek içi düzene düşen sürüm — `useLocalTable` bunu kullanır;
 * kabukta davranış `useTablePrefs` ile aynıdır.
 */
export function useOptionalTablePrefs<T>(tableKey: string, initialVisibility?: VisibilityState, columns?: readonly ColumnDef<T>[]) {
  const ctx = useOptionalPreferences();
  const [local, setLocal] = useState<TablePrefSlice>({});
  const fallback = {
    prefs: local as Prefs,
    setPreference: (patch: PreferencePatch) =>
      setLocal((cur) => ({ ...cur, ...(typeof patch === "function" ? patch(cur as Prefs) : patch) })),
  };
  return useTablePrefsFrom(ctx ?? fallback, tableKey, initialVisibility, columns);
}

function useTablePrefsFrom<T>(
  { prefs, setPreference }: { prefs: Prefs; setPreference: (patch: PreferencePatch) => void },
  tableKey: string,
  initialVisibility?: VisibilityState,
  columns?: readonly ColumnDef<T>[],
) {
  const idsStr = columnIdsOf(columns).join("\n");
  const columnOrder = useMemo(
    () => placeNewColumns(prefs.tableOrder?.[tableKey] ?? [], idsStr ? idsStr.split("\n") : []),
    [prefs.tableOrder, tableKey, idsStr],
  );
  const initialVisibilityStr = JSON.stringify(initialVisibility);
  const columnVisibility = useMemo<VisibilityState>(
    () => ({ ...initialVisibility, ...(prefs.tableVisibility?.[tableKey] ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prefs.tableVisibility, tableKey, initialVisibilityStr],
  );
  const columnSizing = useMemo<ColumnSizingState>(() => prefs.tableSizing?.[tableKey] ?? {}, [prefs.tableSizing, tableKey]);
  const onColumnOrderChange: OnChangeFn<string[]> = (updater) => {
    const next = typeof updater === "function" ? updater(columnOrder) : updater;
    setPreference({ tableOrder: withTableEntry(prefs.tableOrder, tableKey, next.length ? next : null) });
  };
  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = (updater) => {
    const next = typeof updater === "function" ? updater(columnVisibility) : updater;
    setPreference({ tableVisibility: withTableEntry(prefs.tableVisibility, tableKey, Object.keys(next).length ? next : null) });
  };
  const onColumnSizingChange: OnChangeFn<ColumnSizingState> = (updater) => {
    const next = typeof updater === "function" ? updater(columnSizing) : updater;
    setPreference({ tableSizing: withTableEntry(prefs.tableSizing, tableKey, roundSizing(next)) });
  };
  return { columnOrder, columnVisibility, columnSizing, onColumnOrderChange, onColumnVisibilityChange, onColumnSizingChange };
}
