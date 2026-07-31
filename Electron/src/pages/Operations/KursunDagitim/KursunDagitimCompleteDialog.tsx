import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { kursunDagitimService } from "./service";
import type { KursunDistributionAssignedRow } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: KursunDistributionAssignedRow | null;
  onCompleted?: () => void;
}

/**
 * "İşi Bitir" onayı — kurşun ROTANIN SON ADIMI olduğunda. Toplar Kurşun/KK2'den
 * tamamlanmış sayılır ve DEPOYA alınır; kalite yazılmaz (Belirsiz kalır).
 *
 * Yıkıcı-işlem kuralı: soyut sayı yetmez → önizlemeden gelen SOMUT top listesi
 * (barkod + metraj) basılır ve `complete` çağrısına giden `rollIds` AYNI
 * listeden okunur. Backend kapsamı birebir doğrular; arada adıma yeni top
 * girdiyse 409 döner (sessiz kapsam kayması yok).
 *
 * NOT: Backend `complete` ucu YALNIZ `rollIds` kabul ediyor
 * (`kursun-bypass.controller.ts` → `completeSchema`); serbest "sebep" alanı
 * bilinçli olarak KONULMADI — Zod bilinmeyen anahtarı sessizce atardı ve
 * operatörün yazdığı gerekçe hiçbir yere (audit'e de) düşmezdi.
 */
export function KursunDagitimCompleteDialog({
  open,
  onOpenChange,
  row,
  onCompleted,
}: Props) {
  const qc = useQueryClient();
  const assignmentId = row?.assignmentId ?? null;

  const previewQ = useQuery({
    queryKey: ["kursun-bypass", "complete-preview", assignmentId],
    queryFn: () => kursunDagitimService.getCompletePreview(assignmentId as string),
    enabled: open && Boolean(assignmentId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  const completeMut = useMutation({
    mutationFn: () =>
      kursunDagitimService.complete(
        assignmentId as string,
        (preview?.rolls ?? []).map((r) => r.rollId),
      ),
    onSuccess: (res) => {
      toast.success(res.message ?? "İş tamamlandı.");
      void qc.invalidateQueries({ queryKey: ["kursun-bypass"] });
      void qc.invalidateQueries({ queryKey: ["kursun-queue"] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
      onCompleted?.();
      onOpenChange(false);
    },
  });

  const confirmDisabled =
    !preview?.canComplete || preview.rolls.length === 0 || completeMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="text-success h-5 w-5" />
            İşi bitir — kurşun son adım
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{row?.workOrderNumber ?? "İş emri"}</span> ·{" "}
            {preview?.stationName ?? row?.stationName ?? "—"} istasyonu
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4 text-sm">
          {previewQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : previewQ.isError ? (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-4">
              <div className="text-destructive font-medium">
                Önizleme yüklenemedi — iş bitirilemez.
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void previewQ.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          ) : preview ? (
            <>
              {!preview.canComplete && (
                <div className="border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border p-3 text-xs">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {preview.blockReason ?? "Bu dağıtım şu anda tamamlanamaz."}
                  </span>
                </div>
              )}

              <div className="bg-muted/20 rounded-md border p-3 text-xs">
                <span className="font-medium">{preview.rollCount} top</span> ·{" "}
                {formatNumber(preview.totalMeters, 0)} m — atanan istasyon:{" "}
                <span className="font-medium">{preview.stationName}</span>
              </div>

              <div>
                <div className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                  Etkilenecek toplar
                </div>
                <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                  {preview.rolls.map((r) => (
                    <li
                      key={r.rollId}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                    >
                      <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                      <span className="tabular-nums">
                        {formatNumber(r.currentQty, 0)} m
                      </span>
                    </li>
                  ))}
                  {preview.rolls.length === 0 && (
                    <li className="text-muted-foreground px-3 py-2 text-xs">
                      Adımda açık top yok — tamamlanacak bir şey bulunmuyor.
                    </li>
                  )}
                </ul>
              </div>

              <div className="bg-muted/20 space-y-1 rounded-md border p-3 text-xs">
                <div className="font-medium">Bu onay ne yapacak?</div>
                <ul className="text-muted-foreground ml-4 list-disc space-y-0.5">
                  <li>
                    Toplar <span className="font-medium">Kurşun/KK2</span> adımından
                    tamamlanmış sayılacak (kurşun fiziksel olarak yapıldı — hata kaydı
                    kâğıtta).
                  </li>
                  <li>
                    Toplar <span className="font-medium">DEPOYA</span> alınacak; kalite{" "}
                    <span className="font-medium">Belirsiz</span> kalır (bypass'ta kalite
                    yazılmaz).
                  </li>
                  {preview.willFinalize.barcodesToGenerate > 0 && (
                    <li>
                      {preview.willFinalize.barcodesToGenerate} barkodsuz açık kumaşa
                      barkod üretilecek.
                    </li>
                  )}
                  <li>
                    {preview.workOrderWillComplete
                      ? "İş emri KAPANACAK (Tamamlandı)."
                      : "İş emrinde başka açık adım var — iş emri açık kalır."}
                  </li>
                </ul>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="bg-background shrink-0 border-t px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={confirmDisabled}
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={() => completeMut.mutate()}
          >
            {completeMut.isPending ? "Bitiriliyor..." : "İşi bitir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
