import { useState } from "react";
import { toast } from "sonner";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isWebPdf, printAsPdf } from "@/lib/web-pdf";
import { trackPdfSave, type PrintSubject } from "@/lib/print";

/**
 * PDF kaydetme mantığı (Electron main → printToPDF → kaydet dialoğu) — TEK KAYNAK.
 * Hem düğme hem de "İndir ▾" menü kalemi bunu kullanır; iki ayrı kopya olsaydı
 * web dalı (`lib/web-pdf`) yalnız birinde olurdu.
 */
export function usePdfSave(html: string | null, fileName: string, subject: PrintSubject) {
  const [busy, setBusy] = useState(false);
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;

  const web = !pdfApi && isWebPdf();

  const save = async () => {
    if (!html) return;
    if (web) return printAsPdf(html, subject);
    if (!pdfApi) return;
    setBusy(true);
    try {
      const res = await trackPdfSave(subject, () => pdfApi.save({ html, suggestedName: fileName }));
      if (res.saved) toast.success("PDF kaydedildi.");
      else if (res.error) toast.error(res.error);
    } catch {
      toast.error("PDF oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  return { available: Boolean(pdfApi) || web, busy, save };
}

/**
 * Belge HTML'ini PDF olarak kaydeder. Yazdır düğmesinin yanında durur; webde aynı belge
 * yazdırma penceresinde açılır (Hedef: PDF olarak kaydet — `lib/web-pdf`).
 */
export function PdfSaveButton({
  html,
  fileName,
  disabled,
  subject,
}: {
  html: string | null;
  fileName: string;
  disabled?: boolean;
  /** Yazdırma geçmişindeki konu (yalnız kimlik). */
  subject: PrintSubject;
}) {
  const { available, busy, save } = usePdfSave(html, fileName, subject);
  if (!available) return null;

  return (
    <Button type="button" variant="outline" className="gap-1" disabled={disabled || busy || !html} onClick={save}>
      <FileDown className="h-4 w-4" /> {busy ? "PDF…" : "PDF"}
    </Button>
  );
}
