import { useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildWorkbook, saveWorkbook } from "@/lib/xlsx-export";
import { printHtmlString } from "@/lib/print";
import { buildReportHtml, slugifyFileName, toSheets, type ReportExportSpec } from "./reportExport";

interface Props {
  /** Spec bir FONKSİYON — veri yüklendiğinde değil, TIKLANDIĞINDA üretilir. */
  buildSpec: () => ReportExportSpec | null;
  disabled?: boolean;
}

/**
 * Rapor sayfalarının ortak dışa aktarım şeridi: Excel · PDF · Yazdır.
 * Üçü de TEK spec'ten türer (bkz. `reportExport.ts` başlığı).
 *
 * `buildSpec` neden fonksiyon: spec'i her render'da kurmak, kullanıcı hiç export
 * etmese bile her filtre değişiminde tüm tabloları yeniden biçimlendirmek olurdu.
 * `null` dönmesi "henüz veri yok" demektir ve butonlar sessizce iş yapmaz —
 * boş bir Excel indirmek, hiç indirmemekten kötüdür (kullanıcı onu veri sanır).
 */
export function ReportExportBar({ buildSpec, disabled }: Props) {
  const [busy, setBusy] = useState<null | "xlsx" | "pdf">(null);
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;

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
    if (!spec || !pdfApi) return;
    setBusy("pdf");
    try {
      const res = await pdfApi.save({
        html: buildReportHtml(spec),
        suggestedName: `${slugifyFileName(`${spec.title} ${spec.subtitle ?? ""}`)}.pdf`,
      });
      if (res.saved) toast.success("PDF kaydedildi.");
      else if (res.error) toast.error(res.error);
    } catch {
      toast.error("PDF oluşturulamadı.");
    } finally {
      setBusy(null);
    }
  };

  const onPrint = () => {
    const spec = buildSpec();
    if (!spec) return;
    printHtmlString(buildReportHtml(spec));
  };

  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled || busy !== null} onClick={onExcel}>
        <FileSpreadsheet className="h-4 w-4" /> {busy === "xlsx" ? "Excel…" : "Excel"}
      </Button>
      {/* PDF yalnız Electron'da var (main süreçteki printToPDF). Web'de butonu
          çizmek, tıklayınca hiçbir şey olmayan bir vaat olurdu. */}
      {pdfApi ? (
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
