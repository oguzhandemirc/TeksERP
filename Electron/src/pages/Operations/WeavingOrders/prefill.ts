// =============================================================================
// DOKUMA İŞ EMRİ ↔ LEVENT ↔ SİPARİŞ KALEMİ — ÖN DOLDURMA (saf; yalnız istemci, sözleşme değişmez)
// =============================================================================
// Ön doldurma ÖNERİDİR: alan düzenlenebilir kalır, seçim tek seferlik yazar (efekt değil — elle
// değişiklik ezilmez). Metre hesabı YAPILMAZ (dokuma.md: metre↔levent çevrimi take-up ister):
// hedef metre hiçbir yoldan otomatik DOLMAZ; take-up kartta varsa yalnız ipucu üretilir.
// =============================================================================
import { num, type AvailableOrderLine } from "@/pages/Operations/Orders/availableLines";
import type { WarpBeam, WarpBeamOrigin } from "@/pages/Operations/WarpBeams/types";
import type { WeavingOrder } from "./types";

/** Sipariş kalemi seçilince: kumaş BOŞSA ilk kalemin kumaşı; renk BOŞSA kalemlerin ortak rengi (tek renk değilse dokunulmaz). */
export function orderLinePrefill(current: { itemId: string; colorId: string }, rows: Pick<AvailableOrderLine, "itemId" | "colorId">[]): { itemId?: string; colorId?: string } {
  const first = rows[0];
  if (!first) return {};
  const out: { itemId?: string; colorId?: string } = {};
  const itemId = current.itemId || first.itemId;
  if (!current.itemId) out.itemId = itemId;
  const sameItem = rows.filter((r) => r.itemId === itemId);
  const colors = new Set(sameItem.map((r) => r.colorId));
  const only = colors.size === 1 ? [...colors][0] : null;
  if (!current.colorId && only) out.colorId = only;
  return out;
}

/** Levent seçilince (iş emri formu): çözgü kartı + (leventte varsa) fasoncu. Hedef metreye DOKUNMAZ. */
export function beamPrefillForOrder(beam: Pick<WarpBeam, "warpSpecId" | "subcontractorId">): { warpSpecId: string; executionKind?: "SUBCONTRACTED"; subcontractorId?: string } {
  const out: { warpSpecId: string; executionKind?: "SUBCONTRACTED"; subcontractorId?: string } = { warpSpecId: beam.warpSpecId };
  if (beam.subcontractorId) {
    out.executionKind = "SUBCONTRACTED";
    out.subcontractorId = beam.subcontractorId;
  }
  return out;
}

/** Kumaş metresi ÖNERİSİ: `çözgü × (1 − takeUp/100)`; take-up yoksa/geçersizse null (öneri yok — çevrim uydurulmaz). */
export function fabricSuggestionM(warpLengthM: number | string | null | undefined, takeUpPct: number | string | null | undefined): number | null {
  const warp = num(warpLengthM);
  const t = num(takeUpPct);
  if (warp === null || warp <= 0 || t === null || t < 0 || t >= 100) return null;
  return Math.round(warp * (1 - t / 100));
}

/** İş emri seçilince (levent formu): çözgü kartı · fasoncu · not. Fasoncu yalnız kökeni fasoncu taşıyabilecek
 *  durumdaysa yazılır: köken elle seçilmemişse (İçeride varsayılanı) "Fasona sardırıldı"ya geçer; emanette/tedarikçili hazırda yazılmaz. */
export function orderPrefillForBeam(
  wo: Pick<WeavingOrder, "warpSpecId" | "executionKind" | "subcontractorId" | "notes">,
  current: { originKind: WarpBeamOrigin; originTouched: boolean; supplierId: string; notes: string },
): { warpSpecId?: string; originKind?: WarpBeamOrigin; subcontractorId?: string; notes?: string } {
  const out: { warpSpecId?: string; originKind?: WarpBeamOrigin; subcontractorId?: string; notes?: string } = {};
  if (wo.warpSpecId) out.warpSpecId = wo.warpSpecId;
  if (wo.executionKind === "SUBCONTRACTED" && wo.subcontractorId) {
    if (current.originKind === "IN_HOUSE" && !current.originTouched) {
      out.originKind = "SUBCONTRACT";
      out.subcontractorId = wo.subcontractorId;
    } else if (current.originKind === "SUBCONTRACT" || (current.originKind === "PURCHASED" && !current.supplierId)) {
      out.subcontractorId = wo.subcontractorId;
    }
  }
  if (!current.notes.trim() && wo.notes?.trim()) out.notes = wo.notes;
  return out;
}
