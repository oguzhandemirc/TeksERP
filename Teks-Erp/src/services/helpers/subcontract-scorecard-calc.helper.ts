// =============================================================================
// FASON KARNESİ — saf hesap (DB yok). Satırları firmaya toplar, fireyi tek
// formülden türetir. Sorgu `subcontract-scorecard-query.helper.ts`.
// =============================================================================

import type { ScorecardItemRow } from "./subcontract-scorecard-query.helper";

export interface SubCell {
  subId: string;
  subName: string;
  dispatchItems: number;
  dispatchedQty: number;
  closedItems: number;
  closedDispatchedQty: number;
  returnedQty: number;
  deliveredQty: number;
  openItems: number;
  openQty: number;
  /** Topu BAŞKA sevkin DSK'sıyla çıkmış kalemler — ne kapanmış ne açık (ölçülemez). */
  unattributedItems: number;
  unattributedQty: number;
  turnaroundSum: number;
  turnaroundCount: number;
}

export type ScorecardTotals = Omit<SubCell, "subId" | "subName" | "dispatchItems" | "closedItems">;

/** Kalem satırlarını firma hücrelerine toplar (kapanmış ↔ açık ayrımı burada). */
export function groupBySubcontractor(rows: ScorecardItemRow[]): SubCell[] {
  const map = new Map<string, SubCell>();
  for (const r of rows) {
    let cell = map.get(r.subId);
    if (!cell) {
      cell = {
        subId: r.subId, subName: r.subName,
        dispatchItems: 0, dispatchedQty: 0,
        closedItems: 0, closedDispatchedQty: 0, returnedQty: 0, deliveredQty: 0,
        openItems: 0, openQty: 0, unattributedItems: 0, unattributedQty: 0,
        turnaroundSum: 0, turnaroundCount: 0,
      };
      map.set(r.subId, cell);
    }
    const disp = Number(r.dispatchedQty);
    cell.dispatchItems += 1;
    cell.dispatchedQty += disp;
    // ÖLÇÜLEMEZ kova: topun DSK'sı BAŞKA sevke ait (ardışık fason / tarihsel
    // kalem taşıması). Ne kapanmışa ne açığa yazılır — kapanmışa yazmak firmaya
    // %100 fire, açığa yazmak "fasonda bekliyor" yalanı olurdu. Sayısı basılır.
    if (r.foreignDirectShip) {
      cell.unattributedItems += 1;
      cell.unattributedQty += disp;
      continue;
    }
    // Topu bu sevkin DSK'sıyla çıkan kalemin TAMAMI teslimdir (bölünme çocukları
    // dahil: doğrudan sevk kabulden önce gelir). Yalnız bölünme olduysa teslim =
    // çocukların metresi.
    const fullyDelivered = r.ownDirectShip || r.legacyStampDelivered;
    const delivered = fullyDelivered ? disp : Number(r.splitDeliveredQty ?? 0);
    // "Kapandı" ölçütü: TAM makbuz satırı VAR, kalan "gelmeyecek" kararıyla
    // kapatıldı (remainderClosedAt) ya da topun kendisi doğrudan sevk edildi.
    // Kısmi satırlar kalemi kapatmaz — kalan hâlâ fasondadır, açık bakiyede
    // görünür. Sıfır metrajlı tam dönüş de kapanıştır ve firesi %100'dür.
    if (r.hasFull === true || r.remainderClosed || fullyDelivered) {
      cell.closedItems += 1;
      cell.closedDispatchedQty += disp;
      // Dönen metraj = defter (düşülen) + çekme düzeltmesi (fiziksel fark).
      cell.returnedQty += Number(r.returnedQty ?? 0) + Number(r.returnAdjQty ?? 0);
      cell.deliveredQty += delivered;
      // Süre = ilk dönüş anı; yalnız kalan-kapamayla kapanan (hiç dönüşsüz)
      // kalemin süresi ölçülmez (dönüş yok — kapama tarihi teslim süresi değildir).
      if (r.firstReceivedAt !== null) {
        cell.turnaroundSum += (r.firstReceivedAt.getTime() - r.dispatchedAt.getTime()) / 86_400_000;
        cell.turnaroundCount += 1;
      }
    } else {
      cell.openItems += 1;
      // Açık bakiye = giden − kısmen dönen − müşteriye giden (kalan fasonda
      // bekleyen gerçek metraj).
      // ⚠️ Çekme düzeltmesi BURAYA GİRMEZ ve bu bilinçli: fasonda bekleyen bakiye,
      // onun hesabından DÜŞÜLMEMİŞ metrajdır. Çekme düşülen kısımda yaşandı —
      // bakiyeden de indirmek, gelmemiş malı gelmiş saymak olurdu.
      cell.openQty += Math.max(0, disp - Number(r.returnedQty ?? 0) - delivered);
    }
  }
  return [...map.values()];
}

/** FİRE tek formülü — satır, özet ve önceki dönem aynı yerden okur. */
export function fireOf(c: { closedDispatchedQty: number; returnedQty: number; deliveredQty: number }): number {
  return c.closedDispatchedQty - c.returnedQty - c.deliveredQty;
}

export function sumCells(list: SubCell[]): ScorecardTotals {
  return list.reduce<ScorecardTotals>(
    (a, c) => ({
      dispatchedQty: a.dispatchedQty + c.dispatchedQty,
      closedDispatchedQty: a.closedDispatchedQty + c.closedDispatchedQty,
      returnedQty: a.returnedQty + c.returnedQty,
      deliveredQty: a.deliveredQty + c.deliveredQty,
      openItems: a.openItems + c.openItems,
      openQty: a.openQty + c.openQty,
      unattributedItems: a.unattributedItems + c.unattributedItems,
      unattributedQty: a.unattributedQty + c.unattributedQty,
      turnaroundSum: a.turnaroundSum + c.turnaroundSum,
      turnaroundCount: a.turnaroundCount + c.turnaroundCount,
    }),
    { dispatchedQty: 0, closedDispatchedQty: 0, returnedQty: 0, deliveredQty: 0, openItems: 0, openQty: 0, unattributedItems: 0, unattributedQty: 0, turnaroundSum: 0, turnaroundCount: 0 },
  );
}

export function avgTurnaround(c: { turnaroundSum: number; turnaroundCount: number }): number | null {
  return c.turnaroundCount > 0 ? Math.round((c.turnaroundSum / c.turnaroundCount) * 10) / 10 : null;
}
