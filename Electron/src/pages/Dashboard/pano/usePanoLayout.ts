import { useCallback, useMemo } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import type { PanoBoxDef } from "./box-types";
import { applySubsetOrder, cleanLayout, cleanSizes, defaultLayout, LOCAL_BOXES, LOCAL_BOX_KEYS, type SizeChoice } from "./pano-layout";

export interface PanoLayout {
  /** Çizilecek kutular (sıralı; katalogda/erişimde olmayan anahtar düşmüş). */
  boxes: PanoBoxDef[];
  /** Eklenebilir kutuların tamamı (katalog + açık yerel kutular). */
  available: PanoBoxDef[];
  /** Kullanıcı düzeni hiç değiştirmedi mi (varsayılan düzen). */
  isDefault: boolean;
  add: (key: string) => void;
  remove: (key: string) => void;
  /** Görünen kutuların yeni sırası. */
  reorder: (visibleOrder: string[]) => void;
  /** Kutu boyutunu değiştirir (katalog boyutuna dönünce kayıttan düşer). */
  resize: (key: string, size: SizeChoice) => void;
  /** Düzen + boyut + kutu ayarları varsayılana. */
  reset: () => void;
}

/**
 * Kutu düzeni — kullanıcı tercihinde (`prefs.dashboard.boxes`), cihazdan bağımsız. Okurken katalogda olmayan
 * anahtar sessizce düşer (veri ucuna 400 gitmez); yazım yalnız kullanıcı eyleminde olur.
 */
export function usePanoLayout(catalog: readonly PanoBoxDef[] | undefined, localAvailable: ReadonlySet<string>): PanoLayout {
  const ctx = useOptionalPreferences();
  const saved = ctx?.prefs.dashboard?.boxes;
  const savedSizes = ctx?.prefs.dashboard?.boxSizes;
  const setPreference = ctx?.setPreference;

  const { known, available, byKey } = useMemo(() => {
    const cat = catalog ?? [];
    const avail = [...cat, ...LOCAL_BOXES.filter((b) => localAvailable.has(b.anahtar))];
    return {
      known: new Set([...cat.map((b) => b.anahtar), ...LOCAL_BOX_KEYS]),
      available: avail,
      byKey: new Map(avail.map((b) => [b.anahtar, b])),
    };
  }, [catalog, localAvailable]);

  // Tam liste (yerel kutu bayrak beklerken de kaydı korunur); görünen = erişilebilir olanlar.
  const full = useMemo(
    () => (catalog ? cleanLayout(saved, known) ?? defaultLayout(catalog, new Set(LOCAL_BOX_KEYS)) : []),
    [catalog, saved, known],
  );
  const sizes = useMemo(() => cleanSizes(savedSizes), [savedSizes]);
  // Kullanıcı boyutu katalog tanımının yerine geçer (KPI boyutu değişmez).
  const boxes = useMemo(
    () => full.map((k) => byKey.get(k)).filter((b): b is PanoBoxDef => b !== undefined)
      .map((b) => (b.boyut !== "kpi" && sizes[b.anahtar] ? { ...b, boyut: sizes[b.anahtar]! } : b)),
    [full, byKey, sizes],
  );

  const write = useCallback(
    (next: string[] | undefined) => setPreference?.((cur) => ({ dashboard: { ...(cur.dashboard ?? {}), boxes: next } })),
    [setPreference],
  );
  const add = useCallback((key: string) => { if (!full.includes(key)) write([...full, key]); }, [full, write]);
  const remove = useCallback((key: string) => write(full.filter((k) => k !== key)), [full, write]);
  const reorder = useCallback((visibleOrder: string[]) => write(applySubsetOrder(full, visibleOrder)), [full, write]);
  const resize = useCallback((key: string, size: SizeChoice) => {
    const def = byKey.get(key);
    if (!def || def.boyut === "kpi") return;
    const next = { ...sizes };
    if (def.boyut === size) delete next[key];
    else next[key] = size;
    setPreference?.((cur) => ({ dashboard: { ...(cur.dashboard ?? {}), boxSizes: Object.keys(next).length ? next : undefined } }));
  }, [byKey, sizes, setPreference]);
  const reset = useCallback(
    () => setPreference?.((cur) => ({ dashboard: { ...(cur.dashboard ?? {}), boxes: undefined, boxSizes: undefined, boxOptions: undefined } })),
    [setPreference],
  );
  const isDefault = saved === undefined && savedSizes === undefined && ctx?.prefs.dashboard?.boxOptions === undefined;

  return { boxes, available, isDefault, add, remove, reorder, resize, reset };
}
