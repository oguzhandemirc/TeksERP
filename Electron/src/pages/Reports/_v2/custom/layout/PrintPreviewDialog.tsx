import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildReportHtml, type ReportExportSpec } from "@/pages/Reports/_components/reportExport";
import { grafikleriDoldur } from "../../grafik/svgUret";

interface Props {
  open: boolean;
  spec: ReportExportSpec | null;
  onClose: () => void;
}

/**
 * PDF'in birebir önizlemesi: PDF/Yazdır'ın kullandığı AYNI HTML (grafikler SVG, baskı CSS'i, sayfa
 * kesmeleri). Betik çalıştırmaz — `sandbox` boş (iframe denetimi `test/iframe-sandbox.test.ts`).
 */
export function PrintPreviewDialog({ open, spec, onClose }: Props) {
  const html = useQuery({
    queryKey: ["custom-report-print-preview", spec],
    queryFn: async () => buildReportHtml(await grafikleriDoldur(spec!)),
    enabled: open && spec !== null,
    staleTime: Infinity,
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="flex h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Baskı önizleme</DialogTitle>
          <DialogDescription>PDF ve yazıcı çıktısı bu görünümle aynıdır; sayfa kesmeleri baskıda uygulanır.</DialogDescription>
        </DialogHeader>
        {html.data ? (
          <iframe title="Baskı önizleme" srcDoc={html.data} sandbox="" className="min-h-0 w-full flex-1 rounded-md border bg-white" />
        ) : (
          <p className="text-sm text-muted-foreground">{html.isError ? "Önizleme hazırlanamadı." : "Önizleme hazırlanıyor…"}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
