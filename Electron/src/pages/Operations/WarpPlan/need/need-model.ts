// Çözgü ihtiyacı (D8) saf yardımcıları: URL ↔ sorgu, satır metni, "Devere siparişi aç" bağlantısı.
import { formatQty } from "@/lib/format";
import type { WarpNeedQuery, WarpNeedResult, WarpNeedRow } from "./need-types";

export const fmtNeedM = (v: number | null | undefined): string => (v == null ? "—" : `${formatQty(v, 1, 0)} m`);

/** Çözgü Hesabı'nın ihtiyaç sekmesine giden yol; kaynak dokuma işi ya da sipariş. */
export function needTabHref(src: { weavingOrderId: string } | { orderId: string }): string {
  const sp = new URLSearchParams({ tab: "NEED" });
  if ("weavingOrderId" in src) {
    sp.set("source", "WEAVING_ORDER");
    sp.set("weavingOrderId", src.weavingOrderId);
  } else {
    sp.set("source", "ORDER");
    sp.set("orderId", src.orderId);
  }
  return `/operations/cozgu-hesabi?${sp.toString()}`;
}

/** URL'deki dış kaynak (dokuma işi / sipariş); yoksa ya da eksikse null → sekme kumaş girişini gösterir. */
export function linkedNeedQuery(sp: URLSearchParams): WarpNeedQuery | null {
  const source = sp.get("source");
  const woId = sp.get("weavingOrderId");
  const orderId = sp.get("orderId");
  if (source === "WEAVING_ORDER" && woId) return { source, weavingOrderId: woId };
  if (source === "ORDER" && orderId) return { source, orderId };
  return null;
}

/** Kumaş girişinden sorgu; kumaş yoksa ya da metre geçersizse null (istek atılmaz). */
export function fabricNeedQuery(itemId: string | null, fabricMText: string): WarpNeedQuery | null {
  if (!itemId) return null;
  const t = fabricMText.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const m = Number(t);
  return m > 0 ? { source: "FABRIC", itemId, fabricM: m } : null;
}

export function needQueryString(q: WarpNeedQuery): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) sp.set(k, String(v));
  return sp.toString();
}

const ROLE_LABEL: Record<WarpNeedRow["role"], string> = { GROUND: "Zemin", LENO: "Lino", SECONDARY: "İkincil" };
export function roleLabel(r: WarpNeedRow): string {
  return ROLE_LABEL[r.role] ?? r.role;
}

/** Satırın tek cümlelik durumu (öneri sütunu). */
export function needStatusText(r: WarpNeedRow): string {
  if (r.beamMode === "CREEL") return "Cağlıktan beslenir — levent yok";
  if (!r.ownBeam) return "Zemin leventinde — ayrı devere yok";
  if (r.requiredM == null) return "Plan metresi yok — hesaplanamadı";
  if (r.suggestion) return `${r.suggestion.beamCount} × ${fmtNeedM(r.suggestion.beamLengthM)} levent devere ver`;
  return "Eldeki ve yoldaki çözgü yeter";
}

/** Fason devere sipariş formunu kart, adet × boy, devereci (+ sipariş bağı) dolu açan yol. */
export function needOrderHref(r: WarpNeedRow, salesOrder: WarpNeedResult["salesOrder"]): string | null {
  if (!r.suggestion) return null;
  const sp = new URLSearchParams({
    new: "1",
    warpSpecId: r.warpSpecId,
    beamCount: String(r.suggestion.beamCount),
    beamLengthM: String(r.suggestion.beamLengthM),
  });
  if (r.subcontractor) sp.set("subcontractorId", r.subcontractor.id);
  if (salesOrder) {
    sp.set("salesOrderId", salesOrder.id);
    sp.set("salesOrderLabel", salesOrder.label);
  }
  return `/operations/fason-devere?${sp.toString()}`;
}
