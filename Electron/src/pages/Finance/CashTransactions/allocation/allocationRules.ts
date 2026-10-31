// =============================================================================
// MASRAF BAĞI — saf kurallar (D4-H3). Bileşen ve API buradan okur; vitest burayı ölçer.
// =============================================================================
// Hedef tam olarak biri (makine · iş emri · hizmet kalemi); pay 0 < x ≤ 100, en çok 2 ondalık — backend
// `parseSharePct` + DB CHECK ile aynı sınır. Kalan pay sunucudan gelir (`remainingPct`); istemci Σ hesaplamaz.
// =============================================================================

export type AllocationTargetType = "MACHINE" | "WORK_ORDER" | "SERVICE_ITEM";

export const TARGET_TYPE_LABEL: Record<AllocationTargetType, string> = {
  MACHINE: "Makine",
  WORK_ORDER: "İş emri",
  SERVICE_ITEM: "Hizmet kalemi",
};

export interface AllocationDraft {
  targetType: AllocationTargetType;
  targetId: string | null;
  sharePct: string;
}

/** Gövde — backend `allocationFieldsSchema` (strict) ile aynı alanlar. */
export interface AllocationBody {
  machineId?: string;
  workOrderId?: string;
  serviceItemId?: string;
  sharePct: string;
}

export const emptyAllocationDraft = (): AllocationDraft => ({ targetType: "MACHINE", targetId: null, sharePct: "100" });

/** "12,5" → "12.5"; geçersizse null. */
export function parseSharePct(raw: string): string | null {
  const t = raw.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0) || n > 100) return null;
  return t;
}

export function shareHint(raw: string): string | null {
  if (raw.trim() === "") return "Pay (%) yazın.";
  return parseSharePct(raw) ? null : "Pay 0'dan büyük, en çok 100 ve en çok 2 ondalık olmalı.";
}

/** Taslak eksikse null — form bağı göndermez (bağ isteğe bağlıdır). */
export function buildAllocationBody(d: AllocationDraft): AllocationBody | null {
  const pct = parseSharePct(d.sharePct);
  if (!d.targetId || !pct) return null;
  if (d.targetType === "MACHINE") return { machineId: d.targetId, sharePct: pct };
  if (d.targetType === "WORK_ORDER") return { workOrderId: d.targetId, sharePct: pct };
  return { serviceItemId: d.targetId, sharePct: pct };
}

/** Hedef seçilmiş ama pay bozuksa kaydı durdurur (sessizce bağsız kaydetmesin). */
export function draftBlocksSave(d: AllocationDraft | null): boolean {
  return !!d && !!d.targetId && parseSharePct(d.sharePct) === null;
}

/** Bağ alanı formda görünür mü — yalnız masraf satırında ve ayar OPTIONAL iken (OFF → form bayt-aynı). */
export function allocationFieldVisible(mode: string | undefined, kind: string): boolean {
  return mode === "OPTIONAL" && kind === "EXPENSE";
}
