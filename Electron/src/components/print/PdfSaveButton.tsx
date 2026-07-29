import { useState } from "react";
import { toast } from "sonner";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Belge HTML'ini PDF olarak kaydeder (Electron main → printToPDF → kaydet dialoğu).
 * Yazdır düğmesinin yanında durur; web (Electron dışı) ortamda `window.api` yoksa
 * gizlenir.
 */
export function PdfSaveButton({
  html,
  fileName,
  disabled,
}: {
  html: string | null;
  fileName: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const pdfApi = typeof window !== "undefined" ? window.api?.pdf : undefined;
  if (!pdfApi) return null;

  const onSave = async () => {
    if (!html) return;
    setBusy(true);
    try {
      const res = await pdfApi.save({ html, suggestedName: fileName });
      if (res.saved) toast.success("PDF kaydedildi.");
      else if (res.error) toast.error(res.error);
    } catch {
      toast.error("PDF oluşturulamadı.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="outline" className="gap-1" disabled={disabled || busy || !html} onClick={onSave}>
      <FileDown className="h-4 w-4" /> {busy ? "PDF…" : "PDF"}
    </Button>
  );
}
