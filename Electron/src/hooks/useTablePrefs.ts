import { useMemo, useState } from "react";
import type { ColumnSizingState, OnChangeFn, VisibilityState } from "@tanstack/react-table";
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

/**
 * Sütun sırası + görünürlüğü + genişliği — kullanıcı tercihinde (backend, cihazdan bağımsız) tablo anahtarı başına.
 * `useDataTable` (cursor'lı) ve `useLocalTable` (veriyi sayfa getirir) AYNI kaydı okur/yazar.
 */
export function useTablePrefs(tableKey: string, initialVisibility?: VisibilityState) {
  return useTablePrefsFrom(usePreferences(), tableKey, initialVisibility);
}

type Prefs = ReturnType<typeof usePreferences>["prefs"];
type TablePrefSlice = Pick<Prefs, "tableOrder" | "tableVisibility" | "tableSizing">;

/**
 * Sağlayıcısız (izole bileşen/test, kabuk dışı) kullanımda bellek içi düzene düşen sürüm — `useLocalTable` bunu kullanır;
 * kabukta davranış `useTablePrefs` ile aynıdır.
 */
export function useOptionalTablePrefs(tableKey: string, initialVisibility?: VisibilityState) {
  const ctx = useOptionalPreferences();
  const [local, setLocal] = useState<TablePrefSlice>({});
  const fallback = {
    prefs: local as Prefs,
    setPreference: (patch: PreferencePatch) =>
      setLocal((cur) => ({ ...cur, ...(typeof patch === "function" ? patch(cur as Prefs) : patch) })),
  };
  return useTablePrefsFrom(ctx ?? fallback, tableKey, initialVisibility);
}

function useTablePrefsFrom(
  { prefs, setPreference }: { prefs: Prefs; setPreference: (patch: PreferencePatch) => void },
  tableKey: string,
  initialVisibility?: VisibilityState,
) {
  const columnOrder = useMemo(() => prefs.tableOrder?.[tableKey] ?? [], [prefs.tableOrder, tableKey]);
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
