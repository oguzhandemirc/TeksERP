// "PDF Kaydet" kapısının sabitleri: ana süreç bayt ile KESİN karar verir, panel satır
// sayısıyla erken uyarır (dev HTML'i hiç kurmadan). İkisi de buradan okur.

/** Ana süreç kapısı: bunun üstündeki HTML hiç çizilmez (render belleği GB mertebesine çıkar). */
export const PDF_MAX_HTML_BYTES = 6 * 1024 * 1024;

/** Panel aynası: liste/rapor/döküm bu satır sayısının üstünde PDF'e gönderilmez. */
export const PDF_MAX_ROWS = 10_000;

/** Tek belgenin yüklenip PDF'e çevrilmesi için üst süre. */
export const PDF_TIMEOUT_MS = 60_000;

export function pdfTooLargeMessage(bytes: number): string {
  const kb = Math.ceil(bytes / 1024).toLocaleString("tr-TR");
  return `Belge PDF için çok büyük (${kb} KB) — PDF yerine Excel indirin.`;
}

export function pdfTooManyRowsMessage(rows: number, what = "Liste"): string {
  return `${what} PDF için çok büyük (${rows.toLocaleString("tr-TR")} satır) — PDF yerine Excel indirin.`;
}

export const PDF_TIMEOUT_MESSAGE = "PDF 60 saniye içinde oluşturulamadı — belge çok büyük olabilir, Excel indirin.";
