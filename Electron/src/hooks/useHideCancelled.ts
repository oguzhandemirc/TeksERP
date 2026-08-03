import { useMemo, useState } from "react";

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
