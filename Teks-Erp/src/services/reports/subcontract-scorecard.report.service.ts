// =============================================================================
// FASON KARNESİ — "hangi boyahane iyi çalışıyor"
// =============================================================================
// Mevcut iki fason raporu (performans + açık sevkler) süre ve adet veriyordu.
// Sahada asıl tartışılan rakam ise hiç yoktu: **FASON FİRESİ** — giden metraj
// ile dönen metraj arasındaki fark. Boyahaneye 1000 m gönderip 960 m almak
// %4 fire demektir ve bu, fatura itirazının da firma seçiminin de dayanağıdır.
//
// ── FİRE YALNIZ KAPANMIŞ KALEMLERDEN HESAPLANIR ─────────────────────────────
// Naif hesap — Σgiden − Σdönen — henüz DÖNMEMİŞ malı fire sayar ve dün sevk
// edilmiş bir partiyi %100 fire gösterir. Bu yüzden her sevk kalemi ikiye
// ayrılır:
//   • KAPANMIŞ (en az bir kabul satırı var) → fire hesabına girer
//   • AÇIK     (hiç dönüş yok)              → ayrı "açık bakiye" olarak raporlanır
// Oran da yalnız kapanmışların paydasıyla hesaplanır. İki kümeyi karıştırmak
// raporu sistematik olarak firmaların aleyhine yanlışlardı.
//
// ── DÖNEN METRAJ: TÜM kabul satırları toplanır (DISTINCT ON DEĞİL) ──────────
// ⚠️ Mevcut `subcontract.report.service` dönüş satırlarını `DISTINCT ON
// (sourceDispatchItemId)` ile TEKE indiriyor — orada doğru, çünkü soru "bu kalem
// kapandı mı" (bool) ve süre. Ama METRAJ için yanlış olurdu: 100 m'lik bir top
// fasondan 2×48 m olarak dönebilir; DISTINCT ON yalnız birini sayıp 52 m'yi
// sahte fire yazardı. Burada SUM edilir.
//
// ── MÜŞTERİYE GİDEN METRE "BAŞARILI TESLİM"DİR ─────────────────────────────
// Fasondan doğrudan müşteriye çıkan metre fabrikaya dönmez ama fasoncunun
// işleyip teslim ettiği sağlam iştir: FİRE = giden − dönen − müşteriye giden,
// payda giden metrenin TAMAMIDIR (küçültülmez). Üç şekli aynı kural kapsar:
//   • tam doğrudan sevk (`directShippedAt` dolu) → kalemin tamamı teslim,
//   • alt kümeyle sevk edilen top (topun `directShipmentId`si dolu) → kalem
//     KAPANMIŞTIR, tamamı teslim (sevk damgasız kalsa da),
//   • kısmi metre (bölünme çocuğu, `parentRollId` = kalem topu) → çocuğun
//     metresi teslim, kalan parça normal kabul/kapama yolundan döner.
// Doğrudan sevki evrenden dışlamak yalnız TAM sevki görür; kısmi sevkte
// müşteriye giden metre fire ya da hiç kapanmayan açık bakiye olur.
// Karar ve gerekçe: docs/kurallar/fason.md.
// =============================================================================

import type { DateRange } from "./_shared";
import { pctOf, round1 } from "./_breakdown";
import type { ReportFilterInput } from "./_filters";
import { optionList, hasFilters, type Secenekler, type WithSecenekler } from "./_secenekler";
import { queryOldestOpenDispatches, queryScorecardItems } from "../helpers/subcontract-scorecard-query.helper";
import { avgTurnaround, fireOf, groupBySubcontractor, sumCells, type SubCell } from "../helpers/subcontract-scorecard-calc.helper";

// ---------- Tipler -----------------------------------------------------------

export interface SubcontractScorecardRow {
  key: string;
  label: string;
  /** Dönemde sevk edilen kalem adedi. */
  dispatchItems: number;
  dispatchedQty: number;
  /** Kapanmış (dönüşü gelmiş) kalemlerin giden metrajı — fire paydası. */
  closedDispatchedQty: number;
  returnedQty: number;
  /** Kapanmış kalemlerden fasondan doğrudan müşteriye giden metre (başarılı teslim). */
  deliveredQty: number;
  /** closedDispatchedQty − returnedQty − deliveredQty (negatif olabilir: fazla dönmüş). */
  fireQty: number;
  firePct: number;
  /** Henüz dönmemiş kalem adedi ve metrajı. */
  openItems: number;
  openQty: number;
  /** Topu BAŞKA sevkin DSK'sıyla çıkmış (ölçülemez) kalem adedi ve metrajı. */
  unattributedItems: number;
  unattributedQty: number;
  /** Kapanmış kalemlerde ortalama dönüş süresi (gün). */
  avgTurnaroundDays: number | null;
  prevFirePct?: number;
  prevDispatchedQty?: number;
}

export interface SubcontractScorecard extends WithSecenekler {
  summary: {
    dispatchedQty: number;
    closedDispatchedQty: number;
    returnedQty: number;
    deliveredQty: number;
    fireQty: number;
    firePct: number;
    openItems: number;
    openQty: number;
    unattributedItems: number;
    unattributedQty: number;
    avgTurnaroundDays: number | null;
    prevFirePct?: number;
    prevDispatchedQty?: number;
  };
  bySubcontractor: SubcontractScorecardRow[];
  /** Dönemde AÇIK kalan en yaşlı sevkler — operasyonel takip listesi. */
  oldestOpen: Array<{
    dispatchId: string;
    dispatchNo: string;
    subcontractorName: string;
    dispatchedAt: string;
    daysOpen: number;
    openItems: number;
    openQty: number;
  }>;
}

// ---------- Ana giriş --------------------------------------------------------

function toRow(c: SubCell): SubcontractScorecardRow {
  const fire = fireOf(c);
  return {
    key: c.subId,
    label: c.subName,
    dispatchItems: c.dispatchItems,
    dispatchedQty: round1(c.dispatchedQty),
    closedDispatchedQty: round1(c.closedDispatchedQty),
    returnedQty: round1(c.returnedQty),
    deliveredQty: round1(c.deliveredQty),
    fireQty: round1(fire),
    firePct: pctOf(fire, c.closedDispatchedQty),
    openItems: c.openItems,
    openQty: round1(c.openQty),
    unattributedItems: c.unattributedItems,
    unattributedQty: round1(c.unattributedQty),
    avgTurnaroundDays: avgTurnaround(c),
  };
}

export async function getSubcontractScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
  filters: ReportFilterInput = {},
): Promise<SubcontractScorecard> {
  const [itemRows, prevItemRows, openRows, unfiltered] = await Promise.all([
    queryScorecardItems(range, filters),
    compareRange ? queryScorecardItems(compareRange, filters) : Promise.resolve([]),
    queryOldestOpenDispatches(filters),
    // R5b-c3: seçici kaynağı süzgeçten bağımsız — süzgeçli istek kalem sorgusunu bir kez daha süzgeçsiz koşar (beyanlı ×2).
    hasFilters(filters) ? queryScorecardItems(range, {}) : Promise.resolve(null),
  ]);
  const source = unfiltered ?? itemRows;
  const secenekler: Secenekler = {
    subcontractorId: optionList(source.map((r) => ({ id: r.subId, ad: r.subName }))),
    itemId: optionList(source.map((r) => ({ id: r.itemId, ad: r.itemName, kod: r.itemCode }))),
    colorId: optionList(source.map((r) => ({ id: r.colorId, ad: r.colorName }))),
  };
  const cells = groupBySubcontractor(itemRows);
  const prevCells = groupBySubcontractor(prevItemRows);

  const bySubcontractor = cells.map(toRow).sort((a, b) => b.dispatchedQty - a.dispatchedQty);

  if (compareRange) {
    const prev = new Map(prevCells.map((c) => [c.subId, toRow(c)]));
    for (const row of bySubcontractor) {
      const p = prev.get(row.key);
      row.prevFirePct = p ? p.firePct : 0;
      row.prevDispatchedQty = p ? p.dispatchedQty : 0;
    }
  }

  const t = sumCells(cells);
  const fire = fireOf(t);
  const summary: SubcontractScorecard["summary"] = {
    dispatchedQty: round1(t.dispatchedQty),
    closedDispatchedQty: round1(t.closedDispatchedQty),
    returnedQty: round1(t.returnedQty),
    deliveredQty: round1(t.deliveredQty),
    fireQty: round1(fire),
    firePct: pctOf(fire, t.closedDispatchedQty),
    openItems: t.openItems,
    openQty: round1(t.openQty),
    unattributedItems: t.unattributedItems,
    unattributedQty: round1(t.unattributedQty),
    avgTurnaroundDays: avgTurnaround(t),
  };
  if (compareRange) {
    const p = sumCells(prevCells);
    summary.prevFirePct = pctOf(fireOf(p), p.closedDispatchedQty);
    summary.prevDispatchedQty = round1(p.dispatchedQty);
  }

  return {
    summary,
    bySubcontractor,
    oldestOpen: openRows.map((r) => ({
      dispatchId: r.dispatchId,
      dispatchNo: r.dispatchNo,
      subcontractorName: r.subcontractorName,
      dispatchedAt: r.dispatchedAt.toISOString(),
      daysOpen: Math.round(Number(r.daysOpen) * 10) / 10,
      openItems: Number(r.openItems),
      openQty: round1(Number(r.openQty ?? 0)),
    })),
    secenekler,
  };
}
