// =============================================================================
// HAM İHTİYAÇ TEK KAYNAĞI — boy çekmesi çözümü + mamul → ham metre (Seyitoğlu temel, 2026-11-11)
// =============================================================================
// "Bu kumaşın boy çekmesi ne?" sorusunu maliyet girdisi (`buildCostInput`), üretim önerisi ve iplik
// ihtiyacı AYNI sırayla cevaplar: ürün yapısı (`CostStructure.lengthShrinkPct`) → terbiye tarifesi
// (`FinishingRate.typicalShrinkPct`) → yok. "Mamul metre kaç ham metre eder" tek formül:
// ham = mamul ÷ (1 − çekme) ÷ (1 − dokuma firesi). Saf, DB'siz; okuma tüketicide.
// =============================================================================
import { Prisma } from "@prisma/client";

type Dec = Prisma.Decimal;
type DecIn = Prisma.Decimal | number | string | null | undefined;
const HUNDRED = new Prisma.Decimal(100);
const ONE = new Prisma.Decimal(1);

const toDec = (v: DecIn): Dec | null => (v === null || v === undefined ? null : new Prisma.Decimal(v));

/** Çekmenin kaynağı — maliyet girdisinin `CostSource` adlarıyla aynı (YAPI = ürün yapısı, KART = tarife). */
export type LengthShrinkSource = "YAPI" | "KART";

/**
 * Boy çekmesi önceliği: ürün yapısı → terbiye tarifesinin tipik çekmesi → null. Hiçbiri yoksa kaynak
 * son katman (`KART`) — maliyet girdisinin bugünkü `firstOf` davranışıyla bayt-aynı.
 */
export function resolveLengthShrinkPct(structurePct: DecIn, finishingRatePct: DecIn): { value: Dec | null; source: LengthShrinkSource } {
  const s = toDec(structurePct);
  if (s !== null) return { value: s, source: "YAPI" };
  return { value: toDec(finishingRatePct), source: "KART" };
}

/** Yüzde etkin mi: 0 < p < 100; aksi (null/0/geçersiz) çarpan uygulanmaz. */
const activePct = (p: Dec | null): Dec | null => (p !== null && p.gt(0) && p.lt(HUNDRED) ? p : null);

/** Ham metre = mamul ÷ (1 − çekme%) ÷ (1 − dokuma firesi%); etkin olmayan yüzde atlanır. */
export function rawMetersFromFinished(finishedM: DecIn, shrinkPct: DecIn, weavingWastePct: DecIn): Dec | null {
  const m = toDec(finishedM);
  if (m === null) return null;
  let raw = m;
  for (const p of [activePct(toDec(shrinkPct)), activePct(toDec(weavingWastePct))]) {
    if (p !== null) raw = raw.div(ONE.minus(p.div(HUNDRED)));
  }
  return raw;
}

/** Herhangi bir çarpan etkin mi (öneri: etkin değilse açık metre yuvarlanmadan aynen döner). */
export function rawNeedFactorsActive(shrinkPct: DecIn, weavingWastePct: DecIn): boolean {
  return activePct(toDec(shrinkPct)) !== null || activePct(toDec(weavingWastePct)) !== null;
}
