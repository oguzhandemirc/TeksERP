import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, FileText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "@/components/ui/callout";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { workOrderService } from "./service";
import { FasonStepRollSelectModal } from "./FasonStepRollSelectModal";
import { FasonCekiDraftDialog } from "./FasonCekiDraftDialog";
import { MultiBatchDialog, type MultiBatchOption, type MultiBatchStrategy } from "./MultiBatchDialog";
import type { WorkOrderStepLite } from "./types";

/** Backend ROUTE_SKIP hata detayı (apiClient hata gövdesinden okunur). */
type RouteSkipError = {
  response?: {
    data?: {
      message?: string;
      details?: { code?: string; skippedStep?: { stationName?: string }; batches?: MultiBatchOption[] };
    };
  };
  message?: string;
};

interface Props {
  step: WorkOrderStepLite;
  /** Sıralı tüm adımlar — önceki/sonraki adımın fason olup olmadığını anlamak için. */
  steps: WorkOrderStepLite[];
  workOrderId: string;
  /** true: satır başına istasyon adı etiketi + girinti yok — adım satırının ALTINDA
   *  değil, bağımsız bir listede (v3 detay sayfası) render edilirken bağlam verir. */
  withStationLabel?: boolean;
}

/**
 * Planlama ekranı (masaüstü) fason aksiyonları — bir EXTERNAL rota adımı için.
 * "Sevk Et" (bekleyen toplar) + "Sonraki Fasona Aktar" (fasonda → sonraki fason) +
 * "Çeki Taslağı" (sevkten önce sonraki fason çekisi). Mal konumu top-türevli (tek
 * kaynak); aksiyonlar gerçek dispatch()/receive()'e gider. Yalnız workorder:write.
 */
export function FasonStepActions({ step, steps, workOrderId, withStationLabel = false }: Props) {
  const qc = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  // ROUTE_SKIP uyarısı: backend rota-atlama tespit ederse buraya düşer; operatör
  // onaylarsa aynı toplar allowRouteSkip ile yeniden sevk edilir.
  const [routeSkip, setRouteSkip] = useState<{ rollIds: string[]; stationName: string } | null>(null);
  // 409 MULTI_BATCH: aynı toplar seçilen stratejiyle yeniden gönderilir (varsayılan ayrı sevk).
  const [multiBatch, setMultiBatch] = useState<{ rollIds: string[]; allowRouteSkip?: boolean; batches: MultiBatchOption[] } | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["work-orders"] });
    // Fason sevki İE'yi üretime alabilir → sipariş listesi "İş Emri" rozeti tazelensin.
    void qc.invalidateQueries({ queryKey: ["orders"] });
  };

  const bulkMut = useMutation({
    mutationFn: (vars: { rollIds: string[]; allowRouteSkip?: boolean; multiBatchStrategy?: MultiBatchStrategy }) =>
      workOrderService.bulkDispatchStep({
        workOrderId,
        stepId: step.id,
        rollIds: vars.rollIds,
        allowRouteSkip: vars.allowRouteSkip,
        multiBatchStrategy: vars.multiBatchStrategy,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fasona sevk edildi.");
      invalidate();
      setBulkOpen(false);
      setRouteSkip(null);
      setMultiBatch(null);
    },
    onError: (err: RouteSkipError, vars) => {
      const d = err.response?.data?.details;
      if (d?.code === "ROUTE_SKIP") {
        setBulkOpen(false);
        setRouteSkip({ rollIds: vars.rollIds, stationName: d.skippedStep?.stationName ?? "önceki fason" });
        return;
      }
      if (d?.code === "MULTI_BATCH") {
        setBulkOpen(false);
        setRouteSkip(null);
        setMultiBatch({ rollIds: vars.rollIds, allowRouteSkip: vars.allowRouteSkip, batches: d.batches ?? [] });
        return;
      }
      toast.error(err.response?.data?.message ?? err.message ?? "Sevk başarısız.");
    },
  });

  const transferMut = useMutation({
    mutationFn: (rollIds: string[]) =>
      workOrderService.transferToNextFason({ workOrderId, stepId: step.id, rollIds }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sonraki fasona aktarıldı.");
      invalidate();
      setTransferOpen(false);
    },
  });

  const rollList = useMemo(() => step.currentRollList ?? [], [step.currentRollList]);
  const waitingRolls = useMemo(
    () => rollList.filter((r) => r.status !== "AT_SUBCONTRACTOR"),
    [rollList],
  );
  const atSubRolls = useMemo(
    () => rollList.filter((r) => r.status === "AT_SUBCONTRACTOR"),
    [rollList],
  );

  // Yalnız fason (EXTERNAL) adımlar için.
  if (step.station?.type !== "EXTERNAL") return null;

  const sorted = [...steps].sort((a, b) => a.stepSequence - b.stepSequence);
  const idx = sorted.findIndex((s) => s.id === step.id);
  const nextStep = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined;
  const prevStep = idx > 0 ? sorted[idx - 1] : undefined;
  const nextIsFason = nextStep?.station?.type === "EXTERNAL";

  const showBulk = waitingRolls.length > 0;
  const showTransfer = atSubRolls.length > 0 && nextIsFason;
  // Erken çeki taslağı: bu fason adımına henüz sevk yok ama önceki fason mal tutuyor
  // (mal direkt buraya gelebilir) → çekiyi şimdiden bas.
  const prevHoldsFasonGoods =
    prevStep?.station?.type === "EXTERNAL" &&
    (prevStep.currentRolls?.atSubcontractorCount ?? 0) > 0;
  const showDraft = !!prevHoldsFasonGoods && !!step.plannedSubcontractorId;

  if (!showBulk && !showTransfer && !showDraft) return null;

  const stationName = step.station?.name ?? "Fason";
  const plannedFirm = step.plannedSubcontractor?.name ?? null;
  const nextStationName = nextStep?.station?.name ?? "sonraki fason";

  const bulkDisabled = !step.plannedSubcontractorId;
  const transferDisabled = !nextStep?.plannedSubcontractorId;

  return (
    <PermissionGate permission="workorder:write">
      <div
        className={cn(
          "mt-2 flex flex-wrap items-center gap-2",
          withStationLabel ? "pl-0" : "pl-7",
        )}
      >
        {withStationLabel && (
          <span className="text-[11px] font-medium text-muted-foreground">{stationName}:</span>
        )}
        {showBulk && (
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-7 gap-1.5 text-xs"
              disabled={bulkDisabled || bulkMut.isPending}
              onClick={() => setBulkOpen(true)}
            >
              <Send className="h-3.5 w-3.5" />
              Sevk Et
              {plannedFirm && <span className="font-normal opacity-90">→ {plannedFirm}</span>}
            </Button>
            {bulkDisabled && (
              <span className="text-[10px] text-muted-foreground">
                Önce bu adıma fason firma planlayın.
              </span>
            )}
          </div>
        )}

        {showTransfer && (
          <div className="flex flex-col gap-0.5">
            <Button
              type="button"
              size="sm"
              variant="default"
              className="h-7 gap-1.5 text-xs"
              disabled={transferDisabled || transferMut.isPending}
              onClick={() => setTransferOpen(true)}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Sonraki Fasona Aktar
              <span className="font-normal opacity-90">→ {nextStationName}</span>
            </Button>
            {transferDisabled && (
              <span className="text-[10px] text-muted-foreground">
                Sonraki fason firması planlanmamış.
              </span>
            )}
          </div>
        )}

        {showDraft && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setDraftOpen(true)}
          >
            <FileText className="h-3.5 w-3.5" />
            Çeki Taslağı
          </Button>
        )}
      </div>

      {showBulk && (
        <FasonStepRollSelectModal
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          title={`${stationName} — Toplu Fason Sevki`}
          mode="dispatch"
          rolls={waitingRolls}
          destinationName={plannedFirm ?? stationName}
          confirmLabel="Sevk Et"
          isPending={bulkMut.isPending}
          onConfirm={(ids) => bulkMut.mutate({ rollIds: ids })}
        />
      )}

      {showTransfer && (
        <FasonStepRollSelectModal
          open={transferOpen}
          onOpenChange={setTransferOpen}
          title={`${stationName} → ${nextStationName} Aktarımı`}
          mode="transfer"
          rolls={atSubRolls}
          destinationName={nextStationName}
          confirmLabel="Aktar"
          isPending={transferMut.isPending}
          onConfirm={(ids) => transferMut.mutate(ids)}
        />
      )}

      {showDraft && (
        <FasonCekiDraftDialog
          open={draftOpen}
          onOpenChange={setDraftOpen}
          workOrderId={workOrderId}
          stepId={step.id}
          stationName={stationName}
        />
      )}

      <MultiBatchDialog
        batches={multiBatch?.batches ?? null}
        pending={bulkMut.isPending}
        onCancel={() => setMultiBatch(null)}
        onConfirm={(strategy) => multiBatch && bulkMut.mutate({ rollIds: multiBatch.rollIds, allowRouteSkip: multiBatch.allowRouteSkip, multiBatchStrategy: strategy })}
      />

      {/* Rota-atlama uyarısı — backend ROUTE_SKIP döndü; bilinçli onayla geç. */}
      <Dialog open={routeSkip !== null} onOpenChange={(o) => !o && setRouteSkip(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rota Sırası Atlanıyor</DialogTitle>
          </DialogHeader>
          <Callout tone="warning">
            Bu sevk rota sırasını atlıyor — önce{" "}
            <strong>{routeSkip?.stationName}</strong> fason adımı bekliyor. Mal o adıma
            uğramadan gönderilecek. Devam edersen audit'e "rota atlama override" yazılır.
          </Callout>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRouteSkip(null)}>
              Vazgeç
            </Button>
            <Button
              type="button"
              disabled={bulkMut.isPending}
              onClick={() =>
                routeSkip && bulkMut.mutate({ rollIds: routeSkip.rollIds, allowRouteSkip: true })
              }
            >
              Yine de Sevk Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PermissionGate>
  );
}
