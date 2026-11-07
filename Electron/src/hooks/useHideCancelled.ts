import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * "İptalleri göster" anahtarı — sipariş / iş emri / sevkiyat listeleri.
 *
 * Varsayılan KAPALI: iptal edilmiş kayıt operatörün anlık kararına girmez, yalnız
 * satır sayısını şişirir. Tik açılınca liste tekrar hepsini gösterir.
 *
 * ⚠️ Bayrak GİZLEMEYİ ister (`hideCancelled=true`), göstermeyi değil. Parametresiz
 * istek eski davranışı korur → mobil ve diğer istemciler etkilenmez. Backend tarafı:
 * `Teks-Erp/src/services/helpers/hidden-status.helper.ts`.
 *
 * Dönen `forceFilters` doğrudan `useDataTable`'a verilir; URL'deki `filter[status]`
 * seçimini EZMEZ (farklı anahtar) — kullanıcı Durum filtresinden "İptal" seçerse
 * backend dışlamayı kendiliğinden devre dışı bırakır.
 */
export function useHideCancelled() {
  const [showCancelled, setShowCancelled] = useState(false);

  const forceFilters = useMemo<Record<string, string>>(
    () => (showCancelled ? {} : ({ hideCancelled: "true" } as Record<string, string>)),
    [showCancelled],
  );

  return { showCancelled, setShowCancelled, forceFilters };
}

/** URL'de duran "İptaller dahil" anahtarı — kayıtlı görünüme ve filtre kaydına girer. */
export const SHOW_CANCELLED_PARAM = "showCancelled";

/**
 * `useHideCancelled`ın URL ikizi (Siparişler): durum `?showCancelled=1`de — filtre kaydı
 * (`persistFilters.extraKeys`) ve kayıtlı görünümler onu da saklar; "Temizle" tek URL yazımıyla siler.
 * Anahtar `filter[...]` değil → sunucuya gitmez (`parseUrlToQueryParams` yalnız `filter[*]` okur).
 */
export function useHideCancelledInUrl() {
  const [sp, setSp] = useSearchParams();
  const showCancelled = sp.get(SHOW_CANCELLED_PARAM) === "1";
  const setShowCancelled = useCallback(
    (v: boolean) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v) next.set(SHOW_CANCELLED_PARAM, "1");
          else next.delete(SHOW_CANCELLED_PARAM);
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  const forceFilters = useMemo<Record<string, string>>(
    () => (showCancelled ? {} : ({ hideCancelled: "true" } as Record<string, string>)),
    [showCancelled],
  );
  return { showCancelled, setShowCancelled, forceFilters };
}
