import { useSearchParams } from "react-router-dom";

/**
 * URL'deki aktif tarih aralığı filtresi (`dateFrom`/`dateTo`) — indirilen dosyanın
 * ADINDA kullanılır. Tüm liste filtreleri URL'de yaşadığı için (useDataTable
 * sözleşmesi) sayfa başına ek prop geçirmeye gerek yok: aralık neredeyse oradan
 * okunur. Aralık yoksa `{}` → dosya adı bugünün damgasını alır.
 */
export function useExportRange(): { from?: string; to?: string } {
  const [params] = useSearchParams();
  const from = params.get("dateFrom") ?? undefined;
  const to = params.get("dateTo") ?? undefined;
  return { from, to };
}
