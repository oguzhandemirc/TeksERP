import { useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { printTracked, trackPdfSave, type PrintSubject } from "@/lib/print";
import { PDF_MAX_ROWS, pdfTooManyRowsMessage } from "@shared/pdf-limits";
import { isWebPdf, printAsPdf } from "@/lib/web-pdf";
import { grafikleriDoldur } from "../_v2/grafik/svgUret";
import { buildReportHtml, reportRowCount, slugifyFileName, toSheets, type ReportExportSpec } from "./reportExport";

interface Props {
  /** Spec bir FONKSİYON — veri yüklendiğinde değil, TIKLANDIĞINDA üretilir. */
  buildSpec: () => ReportExportSpec | null;
  disabled?: boolean;
  /** Başlık satırında az yer kaplayan bitişik düğme grubu (etiket geniş ekranda). */
  compact?: boolean;
}

/** Rapor çıktısı geçmişe "Rapor" türüyle, başlığıyla düşer (içerik gitmez). */
const reportSubject = (title: string): PrintSubject => ({ kind: "RAPOR", no: title.slice(0, 64) });

/**
 * Rapor sayfalarının ortak dışa aktarım şeridi: Excel · PDF · Yazdır.
 * Üçü de TEK spec'ten türer (bkz. `reportExport.ts` başlığı).
 *
 * `buildSpec` neden fonksiyon: spec'i her render'da kurmak, kullanıcı hiç export
 * etmese bile her filtre değişiminde tüm tabloları yeniden biçimlendirmek olurdu.
 * `null` dönmesi "henüz veri yok" demektir ve butonlar sessizce iş yapmaz —
 * boş bir Excel indirmek, hiç indirmemekten kötüdür (kullanıcı onu veri sanır).
 */
export function ReportExportBar({ buildSpec, disabled, compact = false }: Props) {
  const [busy, setBusy] = useState<null | "xlsx" | "pdf">(null);
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  const webPdf = !pdfApi && isWebPdf();

  const onExcel = async () => {
    const spec = buildSpec();
    if (!spec) return;
    setBusy("xlsx");
    try {
      const blob = await buildWorkbook(toSheets(spec));
      const ok = await saveWorkbook(blob, slugifyFileName(`${spec.title} ${spec.subtitle ?? ""}`));
      if (ok) toast.success("Excel kaydedildi.");
    } catch {
      toast.error("Excel oluşturulamadı.");
    } finally {
      setBusy(null);
    }
  };

  const onPdf = async () => {
    const spec = buildSpec();
    if (!spec || (!pdfApi && !webPdf)) return;
    // Ana süreç bayt kapısının erken aynası: dev rapor HTML'i hiç kurulmaz.
    const rows = reportRowCount(spec);
    if (rows > PDF_MAX_ROWS) {
      toast.error(pdfTooManyRowsMessage(rows, "Rapor"));
      return;
    }
    setBusy("pdf");
    try {
      // Grafik blokları kâğıda SVG olarak girer; çizim yalnız tıklanınca (motor tembel).
      const html = buildReportHtml(await grafikleriDoldur(spec));
      if (!pdfApi) return printAsPdf(html, reportSubject(spec.title));
      const res = await trackPdfSave(reportSubject(spec.title), () =>
        pdfApi.save({
          html,
          suggestedName: `${slugifyFileName(`${spec.title} ${spec.subtitle ?? ""}`)}.pdf`,
        }),
      );
      if (res.saved) toast.success("PDF kaydedildi.");
      else if (res.error) toast.error(res.error);
    } catch {
      toast.error("PDF oluşturulamadı.");
    } finally {
      setBusy(null);
    }
  };

  const onPrint = async () => {
    const spec = buildSpec();
    if (!spec) return;
    void printTracked({ subject: reportSubject(spec.title), html: buildReportHtml(await grafikleriDoldur(spec)) });
  };

  if (compact) {
    return <CompactExportGroup off={disabled || busy !== null} busy={busy} showPdf={Boolean(pdfApi || webPdf)} onExcel={onExcel} onPdf={onPdf} onPrint={onPrint} />;
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || busy !== null} onClick={onExcel}>
        <FileSpreadsheet className="h-4 w-4" /> {busy === "xlsx" ? "Excel…" : "Excel"}
      </Button>
      {/* PDF Electron'da main süreçteki printToPDF; webde yazdırma penceresi (`lib/web-pdf`). */}
      {pdfApi || webPdf ? (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || busy !== null} onClick={onPdf}>
          <FileDown className="h-4 w-4" /> {busy === "pdf" ? "PDF…" : "PDF"}
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || busy !== null} onClick={onPrint}>
        <Printer className="h-4 w-4" /> Yazdır
      </Button>
    </div>
  );
}

interface CompactProps {
  off: boolean;
  busy: null | "xlsx" | "pdf";
  showPdf: boolean;
  onExcel: () => void;
  onPdf: () => void;
  onPrint: () => void;
}

/** Başlık satırı için bitişik düğme grubu; etiket yalnız geniş ekranda. */
function CompactExportGroup({ off, busy, showPdf, onExcel, onPdf, onPrint }: CompactProps) {
  const seg = "h-8 gap-1.5 rounded-none border-0 px-2.5";
  return (
    <div className="flex items-center divide-x divide-border overflow-hidden rounded-md border bg-card" role="group" aria-label="Dışa aktar">
      <Button type="button" variant="ghost" size="sm" className={seg} disabled={off} onClick={onExcel} title="Excel" aria-label="Excel">
        <FileSpreadsheet className="h-4 w-4 text-success" /> <span className="hidden xl:inline">{busy === "xlsx" ? "Excel…" : "Excel"}</span>
      </Button>
      {showPdf ? (
        <Button type="button" variant="ghost" size="sm" className={seg} disabled={off} onClick={onPdf} title="PDF" aria-label="PDF">
          <FileDown className="h-4 w-4 text-destructive" /> <span className="hidden xl:inline">{busy === "pdf" ? "PDF…" : "PDF"}</span>
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" className={seg} disabled={off} onClick={onPrint} title="Yazdır" aria-label="Yazdır">
        <Printer className="h-4 w-4" /> <span className="hidden xl:inline">Yazdır</span>
      </Button>
    </div>
  );
}
