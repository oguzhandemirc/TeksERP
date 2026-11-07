// "Tüm listeyi indir" imleç döngüsü — tavana çarpınca SÖYLER (Perf-2 B4, 2026-10-13).
// Eskiden 1000 sayfada `for` sessizce bitiyordu: kullanıcı eksik dosyayı tam sanıyordu.

/** Dışa aktarma sayfa boyu (backend liste tavanıyla hizalı). */
export const EXPORT_PAGE_LIMIT = 500;
/** Kaçak döngü kesici: en çok bu kadar sayfa (500 × 1000 = 500.000 satır). */
export const EXPORT_MAX_PAGES = 1000;

/** Sunucu toplamı bunu aşarsa indirme başlamadan önce kullanıcıya sorulur. */
export const EXPORT_CONFIRM_ROWS = 100_000;

/** Kullanıcı büyük indirmeyi onaylamadı — çağıran sessizce durur (hata bildirimi yok). */
export class ExportCancelledError extends Error {
  constructor() {
    super("İndirme iptal edildi");
    this.name = "ExportCancelledError";
  }
}
export const isExportCancelled = (err: unknown): boolean => err instanceof ExportCancelledError;

export interface DrainPage<T> {
  data: T[];
  pagination: { nextCursor: string | null; totalEstimate?: number };
}

/**
 * İmleci sonuna (ya da tavana) kadar döndürür; `truncated` = sunucuda alınmamış satır kaldı.
 * `confirmTotal`: ilk sayfanın toplam tahmini EXPORT_CONFIRM_ROWS'u aşarsa sorulur; red →
 * `cancelled` (kalan sayfalar çekilmez).
 */
export async function drainCursor<T>(
  fetchPage: (cursor: string | null) => Promise<DrainPage<T>>,
  onProgress?: (loaded: number, total?: number) => void,
  maxPages: number = EXPORT_MAX_PAGES,
  confirmTotal?: (total: number) => Promise<boolean>,
): Promise<{ rows: T[]; truncated: boolean; cancelled?: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  let total: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res: DrainPage<T> = await fetchPage(cursor);
    if (cursor === null) {
      total = res.pagination.totalEstimate;
      if (confirmTotal && total !== undefined && total > EXPORT_CONFIRM_ROWS && !(await confirmTotal(total))) {
        return { rows: [], truncated: false, cancelled: true };
      }
    }
    for (const r of res.data) rows.push(r);
    onProgress?.(rows.length, total);
    cursor = res.pagination.nextCursor;
    if (!cursor) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Tavan uyarısının metni (indirme bildirimi). */
export function truncatedExportNote(loaded: number): string {
  return `Liste ${loaded.toLocaleString("tr-TR")} kayıtta kesildi — dosya listenin TAMAMI DEĞİL; süzgeçle daraltıp yeniden indirin.`;
}
