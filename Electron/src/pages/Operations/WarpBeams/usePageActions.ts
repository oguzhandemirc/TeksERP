import { useMemo, useState } from "react";
import type { WarpBeamPlanValues } from "./schema";
import type { WarpBeamPlanPayload } from "./service";
import type { WarpBeam } from "./types";

export type BeamActionKind = "mount" | "dismount" | "consume" | "adjust" | "exhaust" | "scrap" | "undo";
export type PageDialog = { kind: "new" } | { kind: "edit" | "delete" | "wind" | "cancel" | BeamActionKind; target: WarpBeam } | null;

/** Form METİN taşır; uç sayı/null bekler ("" → null). Sahip (G3) DOĞUM niteliği: düzenlemede gövdeye GİRMEZ (PATCH strict 400 verirdi). */
export function toPlanPayload(v: WarpBeamPlanValues, opts: { forUpdate?: boolean } = {}): WarpBeamPlanPayload {
  return {
    warpSpecId: v.warpSpecId,
    plannedLengthM: Number(v.plannedLengthM),
    originKind: v.originKind,
    subcontractorId: v.subcontractorId || null,
    supplierId: v.supplierId || null,
    ...(opts.forUpdate ? {} : { ownerCustomerId: v.ownerCustomerId || null }),
    physicalBeamNo: v.physicalBeamNo?.trim() || null,
    notes: v.notes?.trim() || null,
  };
}

export function usePageDialog() {
  const [dialog, setDialog] = useState<PageDialog>(null);
  const actions = useMemo(
    () => ({
      onEdit: (r: WarpBeam) => setDialog({ kind: "edit", target: r }),
      onDelete: (r: WarpBeam) => setDialog({ kind: "delete", target: r }),
      onWind: (r: WarpBeam) => setDialog({ kind: "wind", target: r }),
      onCancel: (r: WarpBeam) => setDialog({ kind: "cancel", target: r }),
      // Faz 3 tezgah bağı — tek açıcı, tür menüden gelir.
      onBeamAction: (kind: BeamActionKind, r: WarpBeam) => setDialog({ kind, target: r }),
    }),
    [],
  );
  return { dialog, setDialog, actions };
}
