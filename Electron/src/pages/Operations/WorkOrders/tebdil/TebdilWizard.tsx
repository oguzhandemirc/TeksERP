import { useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
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
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { cn } from "@/lib/utils";
import { FasonSevkPrintDialog } from "../FasonSevkPrintDialog";
import { useTebdilWizard, type TebdilStep } from "./useTebdilWizard";
import { TebdilRollStep, TebdilColorStep, TebdilDispatchStep, TebdilResultView } from "./TebdilSteps";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  batchId: string;
  batchNumber: string;
  /** true → "Fasona sevk bekliyor" badge'inden: parti zaten ayrık, yalnız fason sevk. */
  dispatchOnly?: boolean;
}

const STEP_TITLES: Record<TebdilStep, string> = {
  1: "Toplar",
  2: "Renk kararı",
  3: "Sevk",
  4: "Sonuç",
};

/**
 * "Tebdil / Yeniden Boyat" sihirbazı — tek modal, adımlı: (1) toplar (2) renk kararı
 * (aynı/farklı renk, boyanmadan taşı) (3) sevk kararı (hemen boyahaneye / sahada okut)
 * → (4) sonuç (çeki yazdır / yeni iş emrine git). dispatchOnly ise yalnız sevk adımı.
 */
export function TebdilWizard({ open, onOpenChange, workOrderId, batchId, batchNumber, dispatchOnly = false }: Props) {
  const w = useTebdilWizard({ workOrderId, batchId, open, dispatchOnly });
  const openTarget = useOpenTarget();
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);

  const submitLabel = dispatchOnly
    ? "Fason Sevk"
    : w.mode === "NEW_COLOR"
      ? "Yeni İş Emri Oluştur"
      : w.mode === "UNDYED_MOVE"
        ? "Yeni İş Emrine Taşı"
        : w.dispatchNow
          ? "Ayır + Fason Sevk"
          : "Ayır (sahada sevk)";

  const goWorkOrder = (woId: string, e?: React.MouseEvent) => {
    openTarget(`/operations/work-orders/${woId}`, e);
    onOpenChange(false);
  };

  const stepsShown: TebdilStep[] = dispatchOnly ? [3] : [1, 2, 3];

  // İki-adımlı mutasyon (splitBranch → bulkDispatchStep) uçarken dialog kapanmasını
  // engelle: ortada kapanma sonuç ekranını (adım 4, çeki basımı) kaybettirir.
  const handleOpenChange = (next: boolean) => {
    if (w.runMut.isPending) return;
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              {dispatchOnly ? "Fason Sevk" : "Tebdil / Yeniden Boyat"}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono">{batchNumber}</span>
              {dispatchOnly
                ? " partisini boyahaneye gönder."
                : " partisini yeniden boyamaya al ya da yeni iş emrine ayır."}
            </DialogDescription>
            {w.step !== 4 && stepsShown.length > 1 && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {stepsShown.map((s, i) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex h-5 items-center rounded-full px-2 font-medium",
                        w.step === s ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      {i + 1}. {STEP_TITLES[s]}
                    </span>
                    {i < stepsShown.length - 1 && <span>·</span>}
                  </span>
                ))}
              </div>
            )}
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {w.previewQ.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : w.blocked ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{w.preview?.blockReason ?? "Bu parti şu an ayrılamaz."}</span>
              </div>
            ) : w.step === 4 && w.result ? (
              <TebdilResultView result={w.result} onPrintCeki={setPrintDispatchId} onGoWorkOrder={goWorkOrder} />
            ) : w.preview ? (
              <>
                {w.step === 1 && (
                  <TebdilRollStep
                    rolls={w.preview.rolls}
                    selected={w.selected}
                    onToggle={w.toggleRoll}
                    onToggleAll={w.toggleAll}
                    selectableCount={w.selectableRolls.length}
                    allSelectable={w.allSelectable}
                  />
                )}
                {w.step === 2 && (
                  <TebdilColorStep
                    allowedModes={w.preview.allowedModes}
                    mode={w.mode}
                    setMode={w.setMode}
                    isNewColor={w.isNewColor}
                    newColorId={w.newColorId}
                    setNewColorId={w.setNewColorId}
                  />
                )}
                {w.step === 3 && (
                  <TebdilDispatchStep
                    mode={w.mode}
                    dispatchOnly={dispatchOnly}
                    dispatchNow={w.dispatchNow}
                    setDispatchNow={w.setDispatchNow}
                    subcontractorId={w.subcontractorId}
                    setSubcontractorId={w.setSubcontractorId}
                    reason={w.reason}
                    setReason={w.setReason}
                    plate={w.plate}
                    setPlate={w.setPlate}
                    driver={w.driver}
                    setDriver={w.setDriver}
                  />
                )}
              </>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
            {w.step === 4 ? (
              <Button onClick={() => onOpenChange(false)}>Kapat</Button>
            ) : w.blocked ? (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Kapat
              </Button>
            ) : (
              <>
                <Button variant="outline" disabled={w.runMut.isPending} onClick={() => handleOpenChange(false)}>
                  Vazgeç
                </Button>
                {w.step > 1 && !dispatchOnly && (
                  <Button variant="ghost" onClick={() => w.setStep((w.step - 1) as TebdilStep)}>
                    Geri
                  </Button>
                )}
                {w.step === 1 && (
                  <Button disabled={!w.canLeaveStep1} onClick={() => w.setStep(2)}>
                    İleri
                  </Button>
                )}
                {w.step === 2 && (
                  <Button disabled={!w.canLeaveStep2} onClick={() => w.setStep(3)}>
                    İleri
                  </Button>
                )}
                {w.step === 3 && (
                  <Button disabled={!w.canSubmit} onClick={() => w.runMut.mutate()}>
                    {w.runMut.isPending ? "İşleniyor..." : submitLabel}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FasonSevkPrintDialog
        dispatchId={printDispatchId}
        open={Boolean(printDispatchId)}
        onOpenChange={(o) => !o && setPrintDispatchId(null)}
      />
    </>
  );
}
