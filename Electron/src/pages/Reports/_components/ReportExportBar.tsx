import { useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { printTracked, trackPdfSave, type PrintSubject } from "@/lib/print";
import { PDF_MAX_ROWS, pdfTooManyRowsMessage } from "@shared/pdf-limits";
import { isWebPdf, printAsPdf } from "@/lib/web-pdf";
import { grafikleriDoldur } from "../_v2/grafik/svgUret";
import { ExportDialog } from "@/components/data-table/export-dialog/ExportDialog";
import { buildReportHtml, reportRowCount, slugifyFileName, toSheets, type ReportExportSpec } from "./reportExport";
import { applyReportColumns, reportColumnCatalog } from "./reportExportColumns";

interface Props {
  /** Spec bir FONKSİYON — veri yüklendiğinde değil, TIKLANDIĞINDA üretilir. */
  buildSpec: () => ReportExportSpec | null;
  disabled?: boolean;
  /** Başlık satırında az yer kaplayan bitişik düğme grubu (etiket geniş ekranda). */
  compact?: boolean;
}

/** Rapor çıktısı geçmişe "Rapor" türüyle, başlığıyla düşer (içerik gitmez). */
const reportSubject = (title: string): PrintSubject => ({ kind: "RAPOR", no: title.slice(0, 64) });
const reportFileName = (spec: ReportExportSpec) => slugifyFileName(`${spec.title} ${spec.subtitle ?? ""}`);

async function saveReportExcel(spec: ReportExportSpec): Promise<boolean> {
  try {
    const ok = await saveWorkbook(await buildWorkbook(toSheets(spec)), reportFileName(spec));
    if (ok) toast.success("Excel kaydedildi.");
    return ok;
  } catch {
    toast.error("Excel oluşturulamadı.");
    return false;
  }
}

/** PDF Electron'da main süreçteki printToPDF; webde yazdırma penceresi (`lib/web-pdf`). */
async function saveReportPdf(spec: ReportExportSpec): Promise<boolean> {
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi && !isWebPdf()) return false;
  try {
    // Grafik blokları kâğıda SVG olarak girer; çizim yalnız tıklanınca (motor tembel).
    const html = buildReportHtml(await grafikleriDoldur(spec));
    if (!pdfApi) {
      printAsPdf(html, reportSubject(spec.title));
      return true;
    }
    const res = await trackPdfSave(reportSubject(spec.title), () => pdfApi.save({ html, suggestedName: `${reportFileName(spec)}.pdf` }));
    if (res.saved) toast.success("PDF kaydedildi.");
    else if (res.error) toast.error(res.error);
    return res.saved;
  } catch {
    toast.error("PDF oluşturulamadı.");
    return false;
  }
}

/**
 * Rapor sayfalarının ortak dışa aktarım şeridi: Excel · PDF · Yazdır.
 * Üçü de TEK spec'ten türer (bkz. `reportExport.ts` başlığı). Excel/PDF ortak çıktı diyaloğunu açar
 * (biçim + sütun seçimi); seçim spec'e uygulanır, iki dosya aynı süzülmüş spec'ten çıkar.
 *
 * `buildSpec` neden fonksiyon: spec'i her render'da kurmak, kullanıcı hiç export
 * etmese bile her filtre değişiminde tüm tabloları yeniden biçimlendirmek olurdu.
 * `null` dönmesi "henüz veri yok" demektir ve butonlar sessizce iş yapmaz —
 * boş bir Excel indirmek, hiç indirmemekten kötüdür (kullanıcı onu veri sanır).
 */
export function ReportExportBar({ buildSpec, disabled, compact = false }: Props) {
  const [busy, setBusy] = useState<null | "xlsx" | "pdf">(null);
  // Diyalog açıkken spec donar: kullanıcı sütun seçerken veri tazelenirse katalog altından kaymasın.
  const [dialog, setDialog] = useState<{ spec: ReportExportSpec; format: "xlsx" | "pdf" } | null>(null);
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  const webPdf = !pdfApi && isWebPdf();

  const save = async (spec: ReportExportSpec, format: "xlsx" | "pdf"): Promise<boolean> => {
    // Ana süreç bayt kapısının erken aynası: dev rapor HTML'i hiç kurulmaz.
    const rows = reportRowCount(spec);
    if (format === "pdf" && rows > PDF_MAX_ROWS) {
      toast.error(pdfTooManyRowsMessage(rows, "Rapor"));
      return false;
    }
    setBusy(format);
    try {
      return format === "pdf" ? await saveReportPdf(spec) : await saveReportExcel(spec);
    } finally {
      setBusy(null);
    }
  };

  const openDialog = (format: "xlsx" | "pdf") => {
    const spec = buildSpec();
    if (spec) setDialog({ spec, format });
  };

  const onPrint = async () => {
    const spec = buildSpec();
    if (!spec) return;
    void printTracked({ subject: reportSubject(spec.title), html: buildReportHtml(await grafikleriDoldur(spec)) });
  };

  const exportDialog = dialog && (
    <ExportDialog
      open
      onOpenChange={(o) => !o && setDialog(null)}
      title={`Dışa aktar — ${dialog.spec.title}`}
      info="Excel ve PDF ekrandaki raporla aynı satırları ve aynı rakamları taşır; seçilmeyen sütun iki dosyada da yer almaz."
      catalog={reportColumnCatalog(dialog.spec)}
      formats={pdfApi || webPdf ? ["xlsx", "pdf"] : ["xlsx"]}
      defaultFormat={dialog.format}
      prefKey={`rapor:${dialog.spec.title}`}
      onRun={async (c) => {
        const spec = applyReportColumns(dialog.spec, c.columns);
        return save(spec, c.format === "pdf" ? "pdf" : "xlsx");
      }}
    />
  );

  if (compact) {
    return (
      <>
        {exportDialog}
        <CompactExportGroup off={disabled || busy !== null} busy={busy} showPdf={Boolean(pdfApi || webPdf)} onExcel={() => openDialog("xlsx")} onPdf={() => openDialog("pdf")} onPrint={onPrint} />
      </>
    );
  }
  const onExcel = () => openDialog("xlsx");
  const onPdf = () => openDialog("pdf");
  return (
    <div className="flex items-center gap-1.5">
      {exportDialog}
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
