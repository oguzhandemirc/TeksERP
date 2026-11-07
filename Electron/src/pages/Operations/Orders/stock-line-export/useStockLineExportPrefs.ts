import { useCallback, useMemo } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";
import { readStockLineOptions, sortColumns, type StockLineOptions } from "./options";

/**
 * Modalın son seçimi KULLANICI tercihinde (sunucu blob'u; başka bilgisayarda da aynı kişiye gelir).
 * ⚠️ `ready` gelmeden yazılmaz: önbellek boşken setPreference varsayılan + yamayı yazar ve kullanıcının
 * diğer tercihlerini ezer (Siparişler `statsView` ile aynı ders).
 */
export function useStockLineExportPrefs() {
  const { prefs, setPreference, ready } = usePreferences();
  const raw = prefs.orders?.stockLineExport;
  const options = useMemo(() => readStockLineOptions(raw), [raw]);
  const save = useCallback(
    (next: StockLineOptions) => {
      if (!ready) return;
      setPreference({ orders: { ...prefs.orders, stockLineExport: { ...next, columns: sortColumns(next.columns) } } });
    },
    [ready, prefs.orders, setPreference],
  );
  return { options, save, ready };
}
