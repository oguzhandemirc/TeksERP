// =============================================================================
// LEVENT GÖVDESİ — backend `services/beam-body/{read,transition,returns}.ts` DTO aynası (devere ek B4)
// =============================================================================
// Etiketler sunucudan gelir (`statusLabel`, `owner.label`, olay `label`); buradaki sözlükler yalnız süzgeç
// seçenekleri ve rozet rengi içindir — gösterimde sunucunun cümlesi önce okunur.
// =============================================================================

export type BeamBodyStatus = "EMPTY_STOCK" | "AT_SUBCONTRACTOR" | "FULL_STOCK" | "MOUNTED" | "FULL_OUT" | "MAINTENANCE" | "SCRAPPED" | "RETURNED_TO_OWNER";
export type BeamBodyOwnerKind = "OURS" | "WARPER" | "CUSTOMER" | "OTHER";
export type BeamBodyManualKind = "SHIP_EMPTY" | "RETURN_EMPTY" | "MAINTENANCE_IN" | "MAINTENANCE_OUT" | "SCRAP";

export const BEAM_BODY_STATUSES: readonly BeamBodyStatus[] = ["EMPTY_STOCK", "AT_SUBCONTRACTOR", "FULL_STOCK", "MOUNTED", "FULL_OUT", "MAINTENANCE", "SCRAPPED", "RETURNED_TO_OWNER"];
export const BEAM_BODY_OWNER_KINDS: readonly BeamBodyOwnerKind[] = ["OURS", "WARPER", "CUSTOMER", "OTHER"];

const TONE = {
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
} as const;

export const BEAM_BODY_STATUS_META: Record<BeamBodyStatus, { label: string; badgeClass: string }> = {
  EMPTY_STOCK: { label: "Depoda boş", badgeClass: TONE.sky },
  AT_SUBCONTRACTOR: { label: "Deverecide", badgeClass: TONE.amber },
  FULL_STOCK: { label: "Dolu bekliyor", badgeClass: TONE.emerald },
  MOUNTED: { label: "Tezgâhta", badgeClass: TONE.violet },
  FULL_OUT: { label: "Dolu dışarıda", badgeClass: TONE.amber },
  MAINTENANCE: { label: "Bakımda", badgeClass: TONE.rose },
  SCRAPPED: { label: "Hurda", badgeClass: TONE.slate },
  RETURNED_TO_OWNER: { label: "Sahibine iade edildi", badgeClass: TONE.slate },
};

export const BEAM_BODY_OWNER_LABELS: Record<BeamBodyOwnerKind, string> = {
  OURS: "Bizim",
  WARPER: "Devereci",
  CUSTOMER: "Müşteri (emanet)",
  OTHER: "Başka firma",
};

export interface Ref { id: string; name: string }
export interface CodedRef extends Ref { code: string }
export interface BeamBodyPlace { warehouse: Ref | null; subcontractor: Ref | null; machine: CodedRef | null }

export interface BeamBody {
  id: string;
  bodyNo: string;
  owner: { kind: BeamBodyOwnerKind; label: string; customer: CodedRef | null };
  widthCm: string | null;
  flangeDiameterCm: string | null;
  tareKg: string | null;
  status: BeamBodyStatus;
  statusLabel: string;
  place: BeamBodyPlace;
  /** Bizim olmayan, boş ve bizde duran gövde. */
  ownerReturnDue: boolean;
  machineFits: CodedRef[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BeamBodySummary {
  count: number;
  byOwner: Record<BeamBodyOwnerKind, number>;
  byStatus: Record<BeamBodyStatus, number>;
  ownerReturnDue: number;
}

export interface BeamBodyEvent {
  id: string;
  kind: string;
  label: string;
  isReversal: boolean;
  reversesId: string | null;
  reversed: boolean;
  fromStatus: BeamBodyStatus | null;
  toStatus: BeamBodyStatus;
  toStatusLabel: string;
  place: BeamBodyPlace;
  warpBeam: { id: string; beamNo: string } | null;
  document: { kind: "DISPATCH" | "OWNER_RETURN"; id: string; no: string } | null;
  undoable: boolean;
  reasonCode: string | null;
  reason: string | null;
  createdAt: string;
}

export interface BeamBodyOwnerInput { kind: BeamBodyOwnerKind; customerId?: string | null; subcontractorId?: string | null }

export interface BeamBodyCreateBody {
  bodyNo?: string | null;
  owner: BeamBodyOwnerInput;
  widthCm?: number | null;
  flangeDiameterCm?: number | null;
  tareKg?: number | null;
  initialStatus?: "EMPTY_STOCK" | "AT_SUBCONTRACTOR";
  warehouseId?: string | null;
  subcontractorId?: string | null;
  machineIds?: string[];
  notes?: string | null;
}

export type BeamBodyPatchBody = Partial<Omit<BeamBodyCreateBody, "bodyNo" | "initialStatus" | "warehouseId" | "subcontractorId">> & { isActive?: boolean };

export interface BeamBodyTransitionInput { kind: BeamBodyManualKind; subcontractorId?: string | null; warehouseId?: string | null; reason?: string | null }

export interface BeamBodyTransitionPlan {
  body: BeamBody;
  kind: BeamBodyManualKind;
  kindLabel: string;
  from: BeamBodyStatus;
  to: BeamBodyStatus;
  toLabel: string;
  place: { warehouseId: string | null; subcontractorId: string | null; machineId: string | null };
  warnings: string[];
}

export interface BeamBodyUndoPreview {
  body: BeamBody;
  event: { id: string; kind: string; label: string; createdAt: string };
  undoable: boolean;
  blocker: string | null;
  restoresTo: { status: BeamBodyStatus; label: string } | null;
}

export interface BeamBodyCancelRegistrationPreview { body: BeamBody; cancellable: boolean; blocker: string | null; laterEventCount: number }

export interface BeamBodyReturnDoc {
  id: string;
  docNo: string;
  status: "ACTIVE" | "CANCELLED";
  owner: CodedRef;
  returnedAt: string;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  items: Array<{ bodyId: string; bodyNo: string; ownerRoleLabel: string; widthCm: string | null; tareKg: string | null; eventId: string; reversed: boolean }>;
}

export interface OwnerReturnCandidateGroup { owner: CodedRef; bodies: BeamBody[] }

export interface BeamBodyReturnCreateBody {
  ownerCustomerId: string;
  bodyIds: string[];
  returnedAt?: string | null;
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface BeamBodyReturnCancelPreview {
  doc: BeamBodyReturnDoc;
  cancellable: boolean;
  blocker: string | null;
  items: Array<{ bodyId: string; bodyNo: string; currentStatusLabel: string; blocker: string | null }>;
}

/** Durum rozeti: sunucu etiketi önce, sözlük yedek (eski/yeni sürüm farkında boş kalmasın). */
export function beamBodyStatusMeta(s: string, serverLabel?: string | null): { label: string; badgeClass: string } {
  const m = BEAM_BODY_STATUS_META[s as BeamBodyStatus];
  return { label: serverLabel || m?.label || s, badgeClass: m?.badgeClass ?? TONE.slate };
}
