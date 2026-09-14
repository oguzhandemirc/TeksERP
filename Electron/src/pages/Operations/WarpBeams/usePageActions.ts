import { useMemo, useState } from "react";
import type { WarpBeamPlanValues } from "./schema";
import type { WarpBeamPlanPayload } from "./service";
import type { WarpBeam } from "./types";

export type PageDialog = { kind: "new" } | { kind: "edit" | "delete" | "wind" | "cancel"; target: WarpBeam } | null;

/** Form METİN taşır; uç sayı/null bekler ("" → null). */
export function toPlanPayload(v: WarpBeamPlanValues): WarpBeamPlanPayload {
  return {
    warpSpecId: v.warpSpecId,
    plannedLengthM: Number(v.plannedLengthM),
    originKind: v.originKind,
    subcontractorId: v.subcontractorId || null,
    supplierId: v.supplierId || null,
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
    }),
    [],
  );
  return { dialog, setDialog, actions };
}
