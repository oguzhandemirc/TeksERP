// Panel "Parti Ekle" saf kuralları (hareket defteri D8c) — ekransız sınanır.
import { isAmbiguousFailure } from "@/lib/fasonReceiveAttempt";
import type { PickedRoll } from "@/components/operations/roll-picker/pickable-rolls";
import type { RollPickerScope } from "@/components/operations/roll-picker/RollPickerDialog";

/** Seçici kapsamları — tablet `RollPickerModal` sekmeleriyle aynı süzgeçler; kumaş iş emrinin kumaşına kilitli. */
export function addBatchScopes(targetItemId: string | null): RollPickerScope[] {
  const item: Record<string, string> = targetItemId ? { "filter[itemId]": targetItemId } : {};
  return [
    { key: "raw", label: "Ham Stok", filters: { "filter[rollScope]": "RAW_STOCK", "filter[rollKind]": "WOUND_ROLL", ...item } },
    { key: "finished", label: "Bitmiş Depo", filters: { "filter[status]": "WAREHOUSE,A1_STOCK", "filter[shipmentScope]": "free", "filter[rollKind]": "WOUND_ROLL", ...item } },
  ];
}

export function addBatchPreview(rolls: readonly PickedRoll[], firstStepName: string | null): string {
  const m = Math.round(rolls.reduce((acc, r) => acc + r.qty, 0)).toLocaleString("tr-TR");
  return `Yeni parti açılacak · ${rolls.length} top · ${m} m${firstStepName ? ` · ilk adım: ${firstStepName}` : ""}`;
}

/** Sunucunun ret listesi (400 BATCH_ADD_REJECTED / ITEM_MISMATCH) ve mesajı. */
export function addBatchError(err: unknown): { message: string; rejects: { barcode: string; reason: string }[] } {
  const e = err as { response?: { data?: { message?: string; details?: { rejects?: unknown } } }; message?: string } | null;
  const raw = e?.response?.data?.details?.rejects;
  const rejects = Array.isArray(raw)
    ? raw.filter((r): r is { barcode: string; reason: string } => typeof r?.barcode === "string" && typeof r?.reason === "string")
    : [];
  return { message: e?.response?.data?.message ?? e?.message ?? "Parti eklenemedi", rejects };
}

/** İstek anahtarı: aynı top kümesi = aynı mantıksal deneme; belirsiz hatada yapışır, kesin hatada ve başarıda düşer. */
export interface TokenSlot {
  token: string;
  key: string;
}

export function tokenFor(slot: TokenSlot | null, barcodes: readonly string[], fresh: () => string): TokenSlot {
  const key = [...barcodes].sort().join("|");
  return slot && slot.key === key ? slot : { token: fresh(), key };
}

export function slotAfterFailure(slot: TokenSlot | null, err: unknown): TokenSlot | null {
  return isAmbiguousFailure(err) ? slot : null;
}
