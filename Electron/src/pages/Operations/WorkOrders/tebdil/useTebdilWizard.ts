import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workOrderService, type SplitMode, type BatchSplitPreview } from "../service";

/** Sihirbaz adımları: 1 toplar · 2 renk kararı · 3 sevk kararı · 4 sonuç. */
export type TebdilStep = 1 | 2 | 3 | 4;

export interface TebdilResult {
  mode: SplitMode | "DISPATCH_ONLY";
  newBatchNumber?: string;
  newWorkOrderId?: string;
  newWorkOrderNumber?: string;
  dispatchId?: string;
  dispatchNo?: string;
  dispatched: boolean;
  dispatchError?: string;
}

interface Params {
  workOrderId: string;
  batchId: string;
  open: boolean;
  /** true → yalnız fason sevk (parti zaten ayrılmış; "Fasona sevk bekliyor" badge'inden). */
  dispatchOnly?: boolean;
}

function errMessage(e: unknown): string {
  const err = e as { response?: { data?: { message?: string } }; message?: string };
  return err.response?.data?.message ?? err.message ?? "Fason sevk başarısız.";
}

/**
 * "Tebdil / Yeniden Boyat" sihirbazının durum makinesi + mutation zinciri.
 * REDYE_SAME_COLOR: splitBranch → (ops.) bulkDispatchStep (aynı çağrı içinde çeki).
 * NEW_COLOR / UNDYED_MOVE: splitBranch → yeni iş emri (sevk orada yapılır).
 * dispatchOnly: parti zaten ayrık → yalnız bulkDispatchStep (split yok).
 */
export function useTebdilWizard({ workOrderId, batchId, open, dispatchOnly = false }: Params) {
  const qc = useQueryClient();

  const [step, setStep] = useState<TebdilStep>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<SplitMode | null>(null);
  const [newColorId, setNewColorId] = useState<string | null>(null);
  const [dispatchNow, setDispatchNow] = useState(true);
  const [subcontractorId, setSubcontractorId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [plate, setPlate] = useState("");
  const [driver, setDriver] = useState("");
  const [result, setResult] = useState<TebdilResult | null>(null);

  const previewQ = useQuery({
    queryKey: ["wo-split-preview", workOrderId, batchId],
    queryFn: () => workOrderService.getSplitPreview(workOrderId, batchId),
    enabled: open && Boolean(batchId),
    staleTime: 0,
  });
  const preview: BatchSplitPreview | undefined = previewQ.data?.data;

  const eligibleRolls = useMemo(() => preview?.rolls.filter((r) => r.eligible) ?? [], [preview]);
  // UNDYED_MOVE partisinde (tümü fasonda) hiçbir top redye-uygun DEĞİL (eligible=false)
  // ama tüm parti taşınabilir → seçilebilir küme uygun toplar, yoksa tüm parti (B3).
  const selectableRolls = useMemo(
    () => (eligibleRolls.length > 0 ? eligibleRolls : (preview?.rolls ?? [])),
    [eligibleRolls, preview],
  );
  const allSelectable = eligibleRolls.length === 0;
  const blocked = Boolean(preview && preview.allowedModes.length === 0);

  // Açılışta temiz başlat; dispatchOnly ise doğrudan sevk adımına atla.
  useEffect(() => {
    if (!open) return;
    setStep(dispatchOnly ? 3 : 1);
    setMode(null);
    setNewColorId(null);
    setDispatchNow(true);
    setSubcontractorId(null);
    setReason("");
    setPlate("");
    setDriver("");
    setResult(null);
  }, [open, dispatchOnly]);

  // Önizleme gelince: seçilebilir toplar seçili + varsayılan mod (öncelik REDYE).
  useEffect(() => {
    if (!preview) return;
    setSelected(new Set((dispatchOnly ? preview.rolls : selectableRolls).map((r) => r.id)));
  }, [preview, selectableRolls, dispatchOnly]);
  useEffect(() => {
    if (dispatchOnly || !preview?.allowedModes.length) return;
    setMode((cur) =>
      cur && preview.allowedModes.includes(cur)
        ? cur
        : preview.allowedModes.includes("REDYE_SAME_COLOR")
          ? "REDYE_SAME_COLOR"
          : (preview.allowedModes[0] ?? null),
    );
  }, [preview, dispatchOnly]);

  const runMut = useMutation({
    mutationFn: async (): Promise<TebdilResult> => {
      const colorStepId = preview?.colorStepId ?? null;
      const rollIds = [...selected];

      // ── dispatchOnly: parti zaten ayrık → yalnız fason sevk ──
      if (dispatchOnly) {
        // Toplar zaten bir fason adımında bekliyor — sevk adımı onların GERÇEK
        // konumu (rota'da birden çok fason adımı olabilir; colorStep her zaman değil).
        const stepIds = [
          ...new Set(
            (preview?.rolls ?? [])
              .filter((r) => selected.has(r.id))
              .map((r) => r.currentStepId)
              .filter((x): x is string => !!x),
          ),
        ];
        const dispatchStepId = stepIds.length === 1 ? stepIds[0] : colorStepId;
        if (!dispatchStepId || !subcontractorId) throw new Error("Boyahane adımı/firması eksik.");
        const disp = await workOrderService.bulkDispatchStep({
          workOrderId,
          stepId: dispatchStepId,
          rollIds,
          subcontractorId,
          instruction: reason.trim() || undefined,
          plateNumber: plate.trim() || undefined,
          driverName: driver.trim() || undefined,
        });
        return {
          mode: "DISPATCH_ONLY",
          dispatched: true,
          dispatchId: disp.data?.id,
          dispatchNo: disp.data?.dispatchNo,
        };
      }

      // ── 1) Partiyi ayır (moda göre) ──
      const activeMode = mode as SplitMode;
      const splitRes = await workOrderService.splitBranch(workOrderId, {
        batchId,
        mode: activeMode,
        newColorId: activeMode === "NEW_COLOR" ? newColorId : undefined,
        orderMode: "stock",
        rollIds: activeMode === "UNDYED_MOVE" ? undefined : rollIds,
        reason: reason.trim() || undefined,
      });
      const d = splitRes.data ?? {};

      // ── 2) REDYE + hemen sevk → aynı toplar boyahaneye (çeki döner) ──
      if (activeMode === "REDYE_SAME_COLOR" && dispatchNow && colorStepId && subcontractorId) {
        try {
          const disp = await workOrderService.bulkDispatchStep({
            workOrderId,
            stepId: colorStepId,
            rollIds,
            subcontractorId,
            instruction: reason.trim() || undefined,
            plateNumber: plate.trim() || undefined,
            driverName: driver.trim() || undefined,
          });
          return {
            mode: activeMode,
            newBatchNumber: d.newBatchNumber,
            dispatched: true,
            dispatchId: disp.data?.id,
            dispatchNo: disp.data?.dispatchNo,
          };
        } catch (e) {
          // Parti oluştu ama sevk başarısız — dürüst sonuç, sevk badge'den tekrar denenir.
          return { mode: activeMode, newBatchNumber: d.newBatchNumber, dispatched: false, dispatchError: errMessage(e) };
        }
      }

      return {
        mode: activeMode,
        newBatchNumber: d.newBatchNumber,
        newWorkOrderId: d.newWorkOrderId,
        newWorkOrderNumber: d.newWorkOrderNumber,
        dispatched: false,
      };
    },
    onSuccess: (res) => {
      setResult(res);
      setStep(4);
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });

  const toggleRoll = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === selectableRolls.length ? new Set() : new Set(selectableRolls.map((r) => r.id)),
    );

  // Adım geçiş kuralları.
  const isNewColor = mode === "NEW_COLOR";
  const isUndyed = mode === "UNDYED_MOVE";
  const canLeaveStep1 = selected.size > 0;
  const canLeaveStep2 = Boolean(mode) && (!isNewColor || Boolean(newColorId));
  const needsFirm = dispatchOnly || (mode === "REDYE_SAME_COLOR" && dispatchNow);
  const canSubmit = !runMut.isPending && (!needsFirm || Boolean(subcontractorId));

  return {
    step,
    setStep,
    previewQ,
    preview,
    blocked,
    eligibleRolls,
    selectableRolls,
    allSelectable,
    selected,
    toggleRoll,
    toggleAll,
    mode,
    setMode,
    isNewColor,
    isUndyed,
    newColorId,
    setNewColorId,
    dispatchNow,
    setDispatchNow,
    subcontractorId,
    setSubcontractorId,
    reason,
    setReason,
    plate,
    setPlate,
    driver,
    setDriver,
    result,
    runMut,
    canLeaveStep1,
    canLeaveStep2,
    needsFirm,
    canSubmit,
    dispatchOnly,
  };
}
