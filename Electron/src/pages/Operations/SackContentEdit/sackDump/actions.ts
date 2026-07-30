// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — çıktı aksiyonları (yazdır / PDF / Excel)
// =============================================================================
// Üçü de aynı normalize `SackDump[]` girdisini alır; yazdır ve PDF aynı HTML'i
// paylaşır (`buildSackDumpHtml`) → kağıt ve dosya birebir aynı görünür.
// =============================================================================

import { toast } from "sonner";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { printHtmlString } from "@/lib/print";
import { buildSackDumpHtml } from "./dumpHtml";
import { buildSackDumpSheets } from "./dumpSheets";
import { dumpRowCount, type SackDump, type SackDumpOptions } from "./types";

// Yazdır/PDF üst sınırı — `table-export.ts` PDF_MAX_ROWS ile aynı gerekçe: bu kadar
// satırın üstünde tek belge hem üretilemez (offscreen render çökme riski) hem
// okunmaz. 200 çuval × onlarca top bu sınıra ulaşabilir → Excel'e yönlendir.
const PDF_MAX_ROWS = 10000;

/** yyyy-MM-dd — dosya adına eklenen sıralanabilir tarih damgası. */
function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "İçerik Dökümü CV3007260003 2026-07-30" / "İçerik Dökümü 12 çuval 2026-07-30" */
export function sackDumpFileName(dumps: SackDump[]): string {
  const who = dumps.length === 1 ? dumps[0]!.sackNo : `${dumps.length} çuval`;
  return `İçerik Dökümü ${who} ${dateStamp()}`;
}

/** Tavan aşıldıysa kullanıcıyı Excel'e yönlendirir ve false döner. */
function withinPrintLimit(dumps: SackDump[]): boolean {
  const rows = dumpRowCount(dumps);
  if (rows <= PDF_MAX_ROWS) return true;
  toast.error(
    `Döküm çok büyük (${rows.toLocaleString("tr-TR")} satır) — yazdırma/PDF yerine Excel indirin.`,
  );
  return false;
}

function guardEmpty(dumps: SackDump[]): boolean {
  if (dumps.length === 0) {
    toast.info("Dökümü alınacak çuval yok.");
    return false;
  }
  return true;
}

/** Yazıcıya gönder (izole iframe — `printHtmlString`). */
export function printSackDump(dumps: SackDump[], opts?: SackDumpOptions): void {
  if (!guardEmpty(dumps) || !withinPrintLimit(dumps)) return;
  printHtmlString(buildSackDumpHtml(dumps, opts));
}

/** PDF dosyası olarak kaydet (Electron printToPDF + kaydet dialoğu). */
export async function saveSackDumpPdf(dumps: SackDump[], opts?: SackDumpOptions): Promise<void> {
  if (!guardEmpty(dumps) || !withinPrintLimit(dumps)) return;
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi) {
    toast.error("PDF desteği yok (masaüstü uygulaması gerekli).");
    return;
  }
  const res = await pdfApi.save({
    html: buildSackDumpHtml(dumps, opts),
    suggestedName: sackDumpFileName(dumps),
  });
  if (res.saved) toast.success("İçerik dökümü PDF olarak indirildi");
  else if (res.error) toast.error(res.error);
}

/** Excel olarak kaydet — tek dosya, çuval başına sayfa (+ Özet, + Kartelalar). */
export async function saveSackDumpExcel(dumps: SackDump[], opts?: SackDumpOptions): Promise<void> {
  if (!guardEmpty(dumps)) return;
  try {
    const blob = await buildWorkbook(buildSackDumpSheets(dumps, opts));
    if (await saveWorkbook(blob, sackDumpFileName(dumps))) {
      toast.success(
        dumps.length === 1
          ? "İçerik dökümü Excel olarak indirildi"
          : `${dumps.length} çuvalın içerik dökümü Excel olarak indirildi`,
      );
    }
  } catch {
    toast.error("Excel oluşturulamadı");
  }
}
