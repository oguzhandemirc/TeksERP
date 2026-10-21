// =============================================================================
// TEZGAH / LEVENT ETİKETİ BASKI DİYALOĞU — ortak çekirdek (adet · önizleme · yazdır · iz)
// =============================================================================
// Önizleme 1 adetlik backend HTML'idir (`sandbox=""`, DOM'una erişilmez); Yazdır N adetlik
// HTML'i ayrıca ister ve izole iframe'de basar, ARDINDAN `print-event` yazar.
// Şablon yoksa backend 400 → genel bildirim TEK toast basar; burası ikinci toast basmaz.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { printHtmlString } from "@/lib/print";
import {
  LOOM_LABEL_COPIES_MAX,
  LOOM_LABEL_COPIES_MIN,
  loomLabelService,
  parseLabelCopies,
  type LoomLabelTarget,
} from "@/services/loomLabelService";

export interface LoomLabelPrintDialogProps {
  target: LoomLabelTarget;
  /** `null` = kapalı. */
  subject: { id: string; label: string } | null;
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
}

export function LoomLabelPrintDialog({ target, subject, title, description, onOpenChange }: LoomLabelPrintDialogProps) {
  const [rawCopies, setRawCopies] = useState("1");
  const [busy, setBusy] = useState(false);
  const copies = parseLabelCopies(rawCopies);
  const preview = useQuery({
    queryKey: ["loom-label-html", target, subject?.id],
    queryFn: () => loomLabelService.getHtml(target, subject!.id, 1),
    enabled: Boolean(subject),
    // Yeniden deneme 400'ü (şablon yok) tekrarlar ve aynı bildirimi çoğaltırdı.
    retry: false,
    staleTime: 0,
  });

  const handlePrint = async () => {
    if (!subject || copies === null || busy) return;
    setBusy(true);
    try {
      const html = copies === 1 && preview.data ? preview.data : await loomLabelService.getHtml(target, subject.id, copies);
      printHtmlString(html);
      try {
        await loomLabelService.recordPrint(target, subject.id, copies);
      } catch {
        toast.warning("Etiket yazdırıldı — baskı kaydı sunucuya işlenemedi.", {
          description: "Kâğıt geçerlidir; tekrar bastırmanız gerekmez.",
        });
      }
      onOpenChange(false);
    } catch {
      // HTML alınamadı: sunucunun cümlesini genel bildirim zaten bastı.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={Boolean(subject)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm font-medium">{subject?.label}</div>
          <LabelPreview isLoading={preview.isLoading} isError={preview.isError} html={preview.data} />
          <div className="space-y-1">
            <Label htmlFor="loom-label-copies">Adet</Label>
            <Input
              id="loom-label-copies"
              inputMode="numeric"
              className="w-28"
              value={rawCopies}
              onChange={(e) => setRawCopies(e.target.value)}
              aria-invalid={copies === null}
            />
            {copies === null && (
              <p role="alert" className="text-xs text-destructive">
                Adet {LOOM_LABEL_COPIES_MIN}–{LOOM_LABEL_COPIES_MAX} arası tam sayı olmalı.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
          <Button type="button" disabled={copies === null || busy || !preview.data} onClick={() => void handlePrint()}>
            <Printer className="h-4 w-4" /> Yazdır
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LabelPreview({ isLoading, isError, html }: { isLoading: boolean; isError: boolean; html: string | undefined }) {
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-destructive">
        Etiket hazırlanamadı — nedeni bildirimde yazıyor (ör. Etiket Stüdyosu'nda bu türe şablon atanmamış).
      </div>
    );
  }
  return <iframe title="Etiket önizlemesi" srcDoc={html ?? ""} sandbox="" className="h-48 w-full rounded border bg-white" />;
}
