// =============================================================================
// KUMAŞ KARTI — HESAPLANAN GRAMAJ (salt okuma; Seyitoğlu temel, 2026-11-11)
// =============================================================================
// Yeni formül YOK: kg/m maliyet motorunun `yarnUsagePerM`inden (`includeWaste: false` = çözgü/atkı
// firesi HARİÇ net kumaş), girdi `buildCostInput`tan (tek kurucu; atkı boyu, take-up zinciri aynı).
// Eksik veri → ilgili alan null ("bilinmiyor"), 0 ya da hata DEĞİL. Fiyat sorgusu koşmaz.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildCostInput, loadCostStructureSourcesTx } from "./helpers/cost-assembler.helper";
import { yarnUsagePerM } from "./helpers/fabric-cost.helper";
import { gramsPerLinearMetre, widthOrderWarnings, widthShrinkPct } from "./helpers/fabric-width.helper";

type Dec = Prisma.Decimal;
const KG_TO_G = new Prisma.Decimal(1000);
const HUNDRED = new Prisma.Decimal(100);
const num2 = (v: Dec | null): number | null => (v === null ? null : v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber());

export interface ComputedGsm {
  rawWidthCm: number | null;
  warpGPerM: number | null;
  weftGPerM: number | null;
  totalGPerM: number | null;
  gsm: number | null;
  enteredRawGsm: number | null;
  diffPct: number | null;
  /** Teknik özet (desen kartı şeridi, 2026-11-25) — EK alanlar; eski istemci yok sayar. Yapı yoksa null. */
  endsCount: number | null;
  endsPerCm: number | null;
  picksPerCm: number | null;
  picksInRepeat: number | null;
  repeatCm: number | null;
  repeatsPerM: number | null;
  /** Enler (2026-11-25) — EK alanlar. Mamul en = `Item.widthCm`; tarak eni zemin çözgü kartından. */
  finishedWidthCm: number | null;
  reedWidthCm: number | null;
  /** (ham en − mamul en) ÷ ham en × 100; iki en de yoksa null. */
  widthShrinkPct: number | null;
  /** Girilen gramajın metretül karşılığı: g/m² × en (m) — ham için ham en, mamul için mamul en. */
  rawGPerMt: number | null;
  finishedGPerMt: number | null;
  /** mamul en ≤ ham en ≤ tarak eni sırası bozuksa UYARI (ret değil); eksik değerde karşılaştırma yok. */
  widthWarnings: Array<{ code: string; message: string }>;
}

export interface WidthParts { finishedWidthCm: Dec | null; reedWidthCm: Dec | null; enteredFinishedGsm: Dec | null }
const NO_WIDTH: WidthParts = { finishedWidthCm: null, reedWidthCm: null, enteredFinishedGsm: null };

interface GsmParts { rawWidthCm: Dec | null; warpKgPerM: Dec | null; weftKgPerM: Dec | null; enteredRawGsm: Dec | null }
export interface TechSummaryParts { endsCount: number | null; picksPerCm: Dec | null; picksInRepeat: number | null; repeatCm: Dec | null }
const NO_TECH: TechSummaryParts = { endsCount: null, picksPerCm: null, picksInRepeat: null, repeatCm: null };
const pos = (v: Dec | null): Dec | null => (v && v.gt(0) ? v : null);

/** Ham değerlerden (Decimal) sözleşme alanları — yuvarlama yalnız burada (2 hane). */
export function presentComputedGsm(p: GsmParts, t: TechSummaryParts = NO_TECH, w: WidthParts = NO_WIDTH): ComputedGsm {
  const warpG = p.warpKgPerM?.mul(KG_TO_G) ?? null;
  const weftG = p.weftKgPerM?.mul(KG_TO_G) ?? null;
  const total = warpG && weftG ? warpG.plus(weftG) : null;
  const width = pos(p.rawWidthCm);
  const gsm = total && width ? total.div(width.div(HUNDRED)) : null;
  const diff = gsm && gsm.gt(0) && p.enteredRawGsm ? p.enteredRawGsm.minus(gsm).div(gsm).mul(HUNDRED) : null;
  const ends = t.endsCount && t.endsCount > 0 ? t.endsCount : null;
  const repeat = pos(t.repeatCm);
  return {
    rawWidthCm: num2(p.rawWidthCm),
    warpGPerM: num2(warpG),
    weftGPerM: num2(weftG),
    totalGPerM: num2(total),
    gsm: num2(gsm),
    enteredRawGsm: num2(p.enteredRawGsm),
    diffPct: num2(diff),
    endsCount: ends,
    // Gramajla AYNI en (ham en); tarak eni değil — şerit "toplam tel ÷ ham en" der.
    endsPerCm: num2(ends && width ? new Prisma.Decimal(ends).div(width) : null),
    picksPerCm: num2(pos(t.picksPerCm)),
    picksInRepeat: t.picksInRepeat && t.picksInRepeat > 0 ? t.picksInRepeat : null,
    repeatCm: num2(repeat),
    repeatsPerM: num2(repeat ? HUNDRED.div(repeat) : null),
    finishedWidthCm: num2(pos(w.finishedWidthCm)),
    reedWidthCm: num2(pos(w.reedWidthCm)),
    widthShrinkPct: num2(widthShrinkPct(p.rawWidthCm, w.finishedWidthCm)),
    rawGPerMt: num2(gramsPerLinearMetre(p.enteredRawGsm, p.rawWidthCm)),
    finishedGPerMt: num2(gramsPerLinearMetre(w.enteredFinishedGsm, w.finishedWidthCm)),
    widthWarnings: widthOrderWarnings({ finishedWidthCm: w.finishedWidthCm, rawWidthCm: p.rawWidthCm, reedWidthCm: w.reedWidthCm }),
  };
}

/** Ürün yoksa 404; KUMAŞ değilse ya da yapı eksikse kg alanları null (hata değil). */
export async function computedGsmForItem(itemId: string): Promise<ComputedGsm> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true, itemType: true, rawWidthCm: true, rawGsm: true, widthCm: true, finishedGsm: true,
      weaveDesign: { select: { repeatCm: true } }, warpSpec: { select: { reedWidthCm: true } },
    },
  });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  const base = { rawWidthCm: item.rawWidthCm, enteredRawGsm: item.rawGsm };
  const widths: WidthParts = { finishedWidthCm: item.widthCm, reedWidthCm: item.warpSpec?.reedWidthCm ?? null, enteredFinishedGsm: item.finishedGsm };
  if (item.itemType !== "FABRIC") return presentComputedGsm({ ...base, warpKgPerM: null, weftKgPerM: null }, NO_TECH, widths);
  const src = await loadCostStructureSourcesTx(prisma as unknown as Prisma.TransactionClient, [item.id]);
  const input = buildCostInput(src, { itemId: item.id });
  const usage = yarnUsagePerM(input, { includeWaste: false });
  // Çözgü: zemin + HER ek katman çözülmeli (yarım çözgü gösterilmez). Atkı: boş dizi = çözülemedi.
  const layersOk = usage.warpLayers.length === (input.warpLayers?.length ?? 0);
  const warpKgPerM = usage.warp && layersOk ? usage.warpLayers.reduce((a, l) => a.plus(l.kgPerM), usage.warp.kgPerM) : null;
  const weftKgPerM = usage.weft.length > 0 ? usage.weft.reduce((a, w) => a.plus(w.kgPerM), new Prisma.Decimal(0)) : null;
  // Özet: tel = zemin + ek katmanlar (zemin yoksa bilinmiyor); sıklık/rapor atkısı motorun gördüğü atkıdan.
  const endsCount = input.warp ? (input.warpLayers ?? []).reduce((a, l) => a + l.endsCount, input.warp.endsCount) : null;
  const picksInRepeat = input.weft && input.weft.yarns.length > 0 ? input.weft.yarns.reduce((a, y) => a + y.picksInRepeat, 0) : null;
  return presentComputedGsm(
    { ...base, warpKgPerM, weftKgPerM },
    { endsCount, picksPerCm: input.weft?.picksPerCm.value ?? null, picksInRepeat, repeatCm: item.weaveDesign?.repeatCm ?? null },
    widths,
  );
}
