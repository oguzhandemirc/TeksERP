import { toast } from "sonner";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { printHtmlString } from "@/lib/print";
import { mergeDocsForPrint } from "@/lib/print-merge";

/**
 * WEBDE PDF = YAZDIR (bulut web paneli K3) — panelin her "PDF" yüzeyinin TEK web dalı.
 *
 * Electron PDF'i main süreçte `printToPDF` ile yazar; tarayıcıda bu yok ve PDF paketi
 * eklenmez. Aynı belge HTML'i yazdırma penceresinde açılır, kullanıcı Hedef'ten "PDF
 * olarak kaydet"i seçer. İpucu oturumda BİR KEZ gösterilir (her basışta tekrar etse körleşir).
 */
export const WEB_PDF_HINT = "Yazdır penceresinde Hedef: “PDF olarak kaydet”i seçin.";

let hintShown = false;

/** Bu hedefte PDF yazdırma penceresinden mi kaydedilir (Electron dışı). */
export function isWebPdf(): boolean {
  return !IS_ELECTRON;
}

/** Tek belge HTML'ini yazdırma penceresinde açar (+ bir kezlik ipucu). */
export function printAsPdf(html: string): void {
  printHtmlString(html);
  if (!hintShown) {
    hintShown = true;
    toast.info(WEB_PDF_HINT);
  }
}

/**
 * N belgeyi TEK baskı işinde açar (her belge kendi gölge kökünde, kendi sayfa boyutunda —
 * `print-merge`). Birleştirilemeyen belge sessizce düşmez: sayısı döner, çağıran söyler.
 */
export function printDocsAsPdf(htmls: string[]): { count: number; skipped: number } {
  if (htmls.length === 0) return { count: 0, skipped: 0 };
  const merged = mergeDocsForPrint(htmls);
  const skipped = merged.unmergeable.length;
  if (skipped < htmls.length) printAsPdf(merged.html);
  return { count: htmls.length - skipped, skipped };
}

/** Toplu web baskısının ortak sonucu: birleştirilemeyen belge varsa kullanıcıya söyler. */
export function printDocsAsPdfOutcome(htmls: string[]): { ok: boolean; count: number; printed: true; error?: string } {
  const { count, skipped } = printDocsAsPdf(htmls);
  if (skipped > 0 && count > 0) toast.warning(`${skipped} belge birleştirilemedi — tek tek açıp yazdırın.`);
  return {
    ok: count > 0,
    count,
    printed: true,
    ...(count === 0 ? { error: "Belgeler yazdırma için birleştirilemedi — tek tek açıp yazdırın." } : {}),
  };
}

/** Yalnız testler: bir kezlik ipucu bayrağını sıfırlar. */
export function resetWebPdfHintForTest(): void {
  hintShown = false;
}
