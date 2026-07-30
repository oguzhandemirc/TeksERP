import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, ShieldAlert } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { formatNumber } from "@/lib/format";
import { workOrderService } from "./service";
import {
  WorkOrderCompleteDispositionList,
  type DispositionChoice,
} from "./WorkOrderCompleteDispositionList";
import { WorkOrderCompleteBlockedRolls } from "./WorkOrderCompleteBlockedRolls";
import { WorkOrderCompleteEffects } from "./WorkOrderCompleteEffects";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string | null;
  workOrderNumber?: string;
  /** Kapatma başarılı olunca tetiklenir (dialog kendini kapatır). */
  onCompleted?: () => void;
}

/**
 * İş emrini MANUEL KAPATMA diyaloğu + KAPANIŞ DİSPOZİSYONU. İstasyonda kalan her top
 * için karar sorulur (ham stok / depo / 2. kalite / fire / hatalı kayıt / devir); karar
 * ve sebep tek istekte gider. Fasondaki toplar kapatmayı ENGELLER — mal fiziksel olarak
 * dışarıda, ofis kararı onu geri getirmez.
 */
export function WorkOrderCompleteDialog({
  open,
  onOpenChange,
  workOrderId,
  workOrderNumber,
  onCompleted,
}: Props) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canAdjustRolls = hasPermission("roll:manual-adjust");

  const [choices, setChoices] = useState<Record<string, DispositionChoice>>({});
  const [reason, setReason] = useState("");
  // null = kullanıcı dokunmadı → default sipariş bağından türetilir. Explicit seçim
  // önizleme refetch'inde (pencere odağı) EZİLMESİN diye state ayrı tutuluyor.
  const [keepOrderLinkChoice, setKeepOrderLinkChoice] = useState<boolean | null>(null);
  // Devir yeni iş emri doğurur → açık onay şart (kaza ile hayalet WO açılmasın).
  const [transferAck, setTransferAck] = useState(false);

  const previewQ = useQuery({
    queryKey: ["work-order-complete-preview", workOrderId],
    queryFn: () => workOrderService.getCompletePreview(workOrderId as string),
    enabled: open && Boolean(workOrderId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  // Dialog her açılışta / başka WO'ya geçişte sıfırlanır.
  useEffect(() => {
    if (!open) return;
    setChoices({});
    setReason("");
    setKeepOrderLinkChoice(null);
    setTransferAck(false);
  }, [open, workOrderId]);

  // Devir default'u sipariş bağından gelir: bağlı WO'nun devamı da siparişe bağlı kalsın.
  const keepOrderLink = keepOrderLinkChoice ?? preview?.orderLinked ?? false;

  const dispositionRolls = useMemo(() => preview?.dispositionRolls ?? [], [preview]);
  const blockedRolls = preview?.blockedRolls ?? [];
  const needsDisposition = dispositionRolls.length > 0;

  const allChosen = useMemo(
    () => dispositionRolls.every((r) => choices[r.id]?.action != null),
    [dispositionRolls, choices],
  );
  const transferRolls = useMemo(
    () => dispositionRolls.filter((r) => choices[r.id]?.action === "TRANSFER"),
    [dispositionRolls, choices],
  );
  const hasTransfer = transferRolls.length > 0;
  const reasonOk = !needsDisposition || reason.trim().length >= 3;

  const completeMut = useMutation({
    mutationFn: () =>
      workOrderService.complete(workOrderId as string, {
        ...(needsDisposition
          ? {
              reason: reason.trim(),
              dispositions: dispositionRolls.map((r) => ({
                rollId: r.id,
                action: choices[r.id]!.action!,
                qualityGradeId: choices[r.id]?.qualityGradeId ?? null,
              })),
              ...(hasTransfer
                ? { transferOrderMode: keepOrderLink ? ("keep" as const) : ("stock" as const) }
                : {}),
            }
          : {}),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "İş emri kapatıldı (tamamlandı).");
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      // WO COMPLETED → sipariş "İş Emri" rollup rozeti "Üretildi"ye dönsün.
      void qc.invalidateQueries({ queryKey: ["orders"] });
      // Dispozisyon top statülerini değiştirdi → stok/depo listeleri bayat kalmasın.
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      if (workOrderId) {
        void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
        void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      }
      onCompleted?.();
      onOpenChange(false);
    },
  });

  const confirmDisabled =
    !preview?.canComplete ||
    completeMut.isPending ||
    (needsDisposition && (!canAdjustRolls || !allChosen || !reasonOk)) ||
    (hasTransfer && !transferAck);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            İş emrini kapat
          </DialogTitle>
          <DialogDescription>
            {workOrderNumber ? <span className="font-mono">{workOrderNumber}</span> : "İş emri"}{" "}
            <span className="font-medium text-foreground">Tamamlandı</span> olarak işaretlenecek.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : previewQ.isError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
              <div className="font-medium text-destructive">
                Önizleme yüklenemedi — kapatma onaylanamaz.
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
            <div className="space-y-3 text-sm">
              {!preview.canComplete && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{preview.blockReason}</span>
                </div>
              )}

              <WorkOrderCompleteBlockedRolls rolls={blockedRolls} />

              {preview.canComplete && needsDisposition && !canAdjustRolls && (
                <div className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-warning-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <span>
                    Bu iş emrinde {dispositionRolls.length} top istasyonda duruyor. Statülerine
                    karar vermek için <span className="font-mono">roll:manual-adjust</span> yetkisi
                    gerekiyor — yetkili bir kullanıcı kapatmalı.
                  </span>
                </div>
              )}

              {preview.canComplete && needsDisposition && canAdjustRolls && (
                <>
                  <div className="rounded-md border bg-muted/20 p-3 text-xs">
                    <span className="font-medium">{dispositionRolls.length} top</span> hâlâ
                    istasyonda ({formatNumber(
                      dispositionRolls.reduce((s, r) => s + r.currentQty, 0),
                      0,
                    )}{" "}
                    m). Kapatmadan önce her biri için ne yapılacağını seç — karar sebebiyle
                    birlikte kayda geçer.
                  </div>

                  <WorkOrderCompleteDispositionList
                    rolls={dispositionRolls}
                    choices={choices}
                    onChange={(rollId, choice) =>
                      setChoices((prev) => ({ ...prev, [rollId]: choice }))
                    }
                  />

                  {/* DEVİR AÇIK ONAYI: devir YENİ BİR İŞ EMRİ doğurur — diğer beş
                      karar yalnız statü değiştirir. Tek tıkla hayalet iş emri
                      açılmasın diye sonucu somut listeleyip açık onay istiyoruz
                      ("yıkıcı işlemde detaylı onay" ilkesi). */}
                  {hasTransfer && (
                    <div className="space-y-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-xs">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                        <div>
                          <span className="font-semibold">
                            {transferRolls.length} top YENİ bir iş emrine taşınacak.
                          </span>{" "}
                          Bu toplar depoya GİRMEZ — üretimde kalır ve yeni açılan iş
                          emrinde devam eder.
                          <ul className="mt-1 ml-4 list-disc">
                            {transferRolls.map((r) => (
                              <li key={r.id}>
                                <span className="font-mono">{r.barcode ?? "açık kumaş"}</span> ·{" "}
                                {formatNumber(r.currentQty, 0)} m
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <label className="flex items-start gap-2 border-t border-warning/40 pt-2">
                        <Checkbox
                          checked={keepOrderLink}
                          onCheckedChange={(v) => setKeepOrderLinkChoice(v === true)}
                        />
                        <span>
                          <span className="font-medium">Yeni iş emri siparişe bağlı kalsın</span>
                          <span className="block text-muted-foreground">
                            Kapalıysa devredilen toplar stok üretimi olarak devam eder.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-start gap-2 border-t border-warning/40 pt-2">
                        <Checkbox
                          checked={transferAck}
                          onCheckedChange={(v) => setTransferAck(v === true)}
                        />
                        <span className="font-medium">
                          Yeni iş emri açılmasını onaylıyorum
                        </span>
                      </label>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="wo-complete-reason"
                      className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                    >
                      İşlem nedeni (zorunlu)
                    </label>
                    <Textarea
                      id="wo-complete-reason"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Örn. sipariş iptal oldu, kalan mal depoya alındı"
                    />
                    {!reasonOk && reason.length > 0 && (
                      <p className="mt-1 text-[10px] text-destructive">En az 3 karakter.</p>
                    )}
                  </div>
                </>
              )}

              {preview.canComplete && (
                <WorkOrderCompleteEffects
                  remainingSteps={preview.remainingSteps}
                  dispositionCount={dispositionRolls.length}
                />
              )}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={confirmDisabled}
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={() => completeMut.mutate()}
          >
            {completeMut.isPending ? "Kapatılıyor..." : "İş emrini kapat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
