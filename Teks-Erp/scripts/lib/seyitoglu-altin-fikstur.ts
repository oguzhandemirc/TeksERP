// =============================================================================
// SEYİTOĞLU ALTIN FİKSTÜRÜ (SY-H3, tasarım §9.5 md. 4) — TÜL MALİYET.xlsx'in iki sayfası
// =============================================================================
// Fabrika Excel'inin iki ürün ailesi (3000 SERİSİ · 20Lİ DÖNER 350 CM) dönüştürücünün (SY-H1)
// üreteceği normalize değerlerle: şişirilmiş denye → nominal denye + fire % (2 hane, §4.5),
// fiyat $/kg, atkı/cm, en 350 cm. `excel` = sayfanın hesapladığı hücre değerleri ($/m, ham);
// `expectedDiffs` = Excel HATASININ düzeltildiği satırlar (beklenen fark listesi, gerekçeli).
// Motor (maliyet.dokumaStandartYontemi=ATKI_UCRETI · terbiyeKgTabani=IPLIK_TUKETIMI · sunum USD ·
// genel gider %3 · kalite firesi 0) her bileşende Excel'e 4 hanede eşit olmalı (fark < 0,00005).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { hedefDbEngeli } from "./hedef-db-kapisi";
import type { CostInput, CostOutcome, Sourced } from "../../src/services/helpers/fabric-cost.helper";

type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);

export interface GoldenYarn { key: string; name: string; denier: string; priceUsd: string }
export type GoldenComponent = string; // WARP:<yarn> · WEFT:<yarn> · YARN_TOTAL · WEAVING · FINISHING · KURSUN · DEVERE · SUBTOTAL · TOTAL
export interface ExpectedDiff { component: GoldenComponent; errorClass: string; corrected: string; note: string }
export interface GoldenCase {
  key: string;
  sheet: string;
  warp: { yarn: GoldenYarn; endsCount: number; takeUpPct: string; wastePct: string; reedWidthCm: string };
  weft: { picksPerCm: string; wastePct: string; yarns: Array<{ yarn: GoldenYarn; picksInRepeat: number }> };
  pickRateUsd: string;
  finishingKgUsd: string;
  kursunUsd: string;
  devereUsd: string;
  excel: Record<GoldenComponent, string>;
  expectedDiffs: ExpectedDiff[];
}

/** Sayfa "3000 SERİSİ": 300 İMG çözgü (Excel 360 den → %16,67 fire) · 165 TTM atkı (Excel 185 den → %10,81). */
export const SERIES_3000: GoldenCase = {
  key: "S3000",
  sheet: "3000 SERİSİ",
  warp: { yarn: { key: "IMG300", name: "300 İMG ÇÖZGÜ", denier: "300", priceUsd: "2.5" }, endsCount: 3500, takeUpPct: "0", wastePct: "16.67", reedWidthCm: "350" },
  weft: { picksPerCm: "17", wastePct: "10.81", yarns: [{ yarn: { key: "TTM165", name: "165 TTM 350 TUR", denier: "165", priceUsd: "3.6" }, picksInRepeat: 1 }] },
  pickRateUsd: "0.02", // H2 = 2,0 sent / atkı/cm
  finishingKgUsd: "0.9",
  kursunUsd: "0.15",
  devereUsd: "0.05",
  excel: {
    "WARP:IMG300": "0.35", // G3/100
    "WEFT:TTM165": "0.4403", // G25/100
    YARN_TOTAL: "0.7903", // G66
    WEAVING: "0.34", // G68
    FINISHING: "0.236075", // G70 = F75 × 0,9 / 1000
    KURSUN: "0.15", // G71
    DEVERE: "0.05", // G73
    SUBTOTAL: "1.566375", // G74
    TOTAL: "1.61336625", // G75 = G74 × 1,03
  },
  expectedDiffs: [],
};

/** Sayfa "20Lİ DÖNER 350 CM": üç atkı ipliği ayrı şişirme oranında → Excel'in çalışma denyesi, fire 0 (S3 ertelendi). */
const DONER_WEFT_7080: GoldenYarn = { key: "D7080", name: "70/800 ATKI", denier: "80", priceUsd: "3.6" };
export const DONER_20: GoldenCase = {
  key: "DONER20",
  sheet: "20Lİ DÖNER 350 CM",
  warp: { yarn: { key: "D7080C", name: "70/800 ÇÖZGÜ", denier: "80", priceUsd: "3.6" }, endsCount: 7000, takeUpPct: "0", wastePct: "0", reedWidthCm: "350" },
  weft: {
    picksPerCm: "10.5",
    wastePct: "0",
    yarns: [
      { yarn: DONER_WEFT_7080, picksInRepeat: 3 }, // 450 atkı/m
      { yarn: { key: "CELIK5", name: "5 KAT ÇELİK MAHİR", denier: "1850", priceUsd: "4.3" }, picksInRepeat: 3 }, // 450 atkı/m
      { yarn: { key: "SIM", name: "SİM/ŞEFFAF", denier: "120", priceUsd: "6.5" }, picksInRepeat: 1 }, // 150 atkı/m
    ],
  },
  pickRateUsd: "0.08", // H2 = 8,0 sent
  finishingKgUsd: "0.9",
  kursunUsd: "0.15",
  devereUsd: "0.03",
  excel: {
    "WARP:D7080C": "0.224",
    "WEFT:D7080": "0.04752", // F8 = 450 × 80 × 3,3 / 9000 → EN 3,3 m (sayfa 350 cm)
    "WEFT:CELIK5": "1.392125",
    "WEFT:SIM": "0.0455",
    YARN_TOTAL: "1.709145",
    WEAVING: "0.84",
    FINISHING: "0.365555",
    KURSUN: "0.15",
    DEVERE: "0.03",
    SUBTOTAL: "3.0947",
    TOTAL: "3.187541",
  },
  // EN_TUTARSIZ (SY-H1 hata sınıfı): F8 atkıyı 3,3 m enle hesaplar; aynı sayfanın diğer atkıları ve sayfa adı 3,5 m.
  // Düzeltilmiş 70/800 atkı = 450 × 3,5 × 80 / 9000 = 14,0 g → +0,8 g; iplik +0,00288 $, apre +0,00072 $.
  expectedDiffs: [
    { component: "WEFT:D7080", errorClass: "EN_TUTARSIZ", corrected: "0.0504", note: "F8 en 3,3 m; sayfa 350 cm → 14,0 g × 3,6 $/kg" },
    { component: "YARN_TOTAL", errorClass: "EN_TUTARSIZ", corrected: "1.712025", note: "70/800 atkı düzeltmesi (+0,00288)" },
    { component: "FINISHING", errorClass: "EN_TUTARSIZ", corrected: "0.366275", note: "toplam gram 406,9722 × 0,9 / 1000 (+0,00072)" },
    { component: "SUBTOTAL", errorClass: "EN_TUTARSIZ", corrected: "3.0983", note: "iplik + apre düzeltmesi" },
    { component: "TOTAL", errorClass: "EN_TUTARSIZ", corrected: "3.191249", note: "3,0983 × 1,03 (Excel 3,1875 → 3,1912)" },
  ],
};

export const GOLDEN_CASES = [SERIES_3000, DONER_20];
/** 4 hane eşleşme eşiği: |motor − beklenen| < 0,00005 $/m. */
export const GOLDEN_TOLERANCE = D("0.00005");

const s = (v: string, source: Sourced<Dec>["source"] = "KART"): Sourced<Dec> => ({ value: D(v), source });
const usd = (amount: string) => ({ amount: D(amount), currency: "USD" as const, source: "KART" as const });

/** DB'siz girdi — DB yolunda derleyicinin üreteceği girdinin aynası (yarnItemId = iplik anahtarı). */
export function goldenPureInput(c: GoldenCase): CostInput {
  const yarn = (y: GoldenYarn) => ({ yarnItemId: y.key, name: y.name, denier: s(y.denier), price: usd(y.priceUsd) });
  return {
    schemaVersion: 1,
    parameterSetId: "golden",
    warp: { warpSpecId: `${c.key}-W`, endsCount: c.warp.endsCount, takeUpPct: s(c.warp.takeUpPct), wastePct: s(c.warp.wastePct), yarn: yarn(c.warp.yarn) },
    weft: {
      weftSpecId: `${c.key}-F`, picksPerCm: s(c.weft.picksPerCm), lengthCm: s(c.warp.reedWidthCm), wastePct: s(c.weft.wastePct, "YAPI"),
      yarns: c.weft.yarns.map((w) => ({ ...yarn(w.yarn), picksInRepeat: w.picksInRepeat })),
    },
    loom: {
      rpm: s("500", "PARAMETRE"), efficiencyPct: s("80", "PARAMETRE"), machineRateTry: s("120", "PARAMETRE"), laborRateTry: s("250", "PARAMETRE"),
      loomsPerOperator: s("8", "PARAMETRE"), energyKwhPerHour: s("6", "PARAMETRE"), energyPriceTry: s("3.2", "PARAMETRE"),
    },
    beam: { prepCostTry: s("0", "PARAMETRE"), lengthM: s("3000", "PARAMETRE") },
    finishing: { code: "APRE", name: "APRE-BOYA", basis: "KG", kgBase: "IPLIK_TUKETIMI", price: usd(c.finishingKgUsd) },
    processes: [
      { code: "KURSUN", name: "KURŞUN-TAMBUR", basis: "FINISHED_M", price: usd(c.kursunUsd) },
      { code: "DEVERE", name: "DEVERE", basis: "FINISHED_M", price: usd(c.devereUsd) },
    ],
    lengthShrinkPct: s("0", "YAPI"),
    fabricWastePct: s("0", "YAPI"),
    overheadPct: s("3", "PARAMETRE"),
    extra: null,
    loomPick: { rate: { ...usd(c.pickRateUsd), source: "YAPI" } },
  };
}

/** Motor sonucunu Excel bileşenlerine ayırır ($/m, yuvarlamasız). `yarnKeyOf` DB kimliğini iplik anahtarına çevirir. */
export function goldenComponents(out: CostOutcome, usdRate: Dec, yarnKeyOf: (id: string | null) => string): Map<GoldenComponent, Dec> {
  const m = new Map<GoldenComponent, Dec>();
  const r = out.result;
  if (!r) return m;
  const add = (k: GoldenComponent, v: Dec) => m.set(k, (m.get(k) ?? D(0)).plus(v.div(usdRate)));
  let proc = 0;
  for (const l of r.lines) {
    if (l.component === "WARP_YARN") add(`WARP:${yarnKeyOf(l.yarnItemId)}`, l.amountPerMTry);
    if (l.component === "WEFT_YARN") add(`WEFT:${yarnKeyOf(l.yarnItemId)}`, l.amountPerMTry);
    if (l.component === "WARP_YARN" || l.component === "WEFT_YARN") add("YARN_TOTAL", l.amountPerMTry);
    if (l.component === "WEAVING_PICK") add("WEAVING", l.amountPerMTry);
    if (l.component === "FINISHING") add("FINISHING", l.amountPerMTry);
    if (l.component === "PROCESS") add(proc++ === 0 ? "KURSUN" : "DEVERE", l.amountPerMTry);
  }
  add("SUBTOTAL", r.soundCostPerMTry);
  add("TOTAL", r.totalCostPerMTry);
  return m;
}

export interface GoldenRow { component: GoldenComponent; excel: Dec; expected: Dec; actual: Dec | null; diffToExcel: Dec | null; status: "EŞİT" | "BEKLENEN_FARK" | "SAPMA"; reason: string }

/** Bileşen bileşen fark raporu: beklenen = Excel, beklenen fark listesindeyse düzeltilmiş değer. */
export function compareGolden(c: GoldenCase, actual: Map<GoldenComponent, Dec>): GoldenRow[] {
  return Object.entries(c.excel).map(([component, excelStr]) => {
    const excel = D(excelStr);
    const diff = c.expectedDiffs.find((d) => d.component === component);
    const expected = diff ? D(diff.corrected) : excel;
    const a = actual.get(component) ?? null;
    const ok = a !== null && a.minus(expected).abs().lt(GOLDEN_TOLERANCE);
    const status = !ok ? "SAPMA" : diff ? "BEKLENEN_FARK" : "EŞİT";
    const reason = diff ? `Excel hatası ${diff.errorClass}: ${diff.note}` : ok && a && !a.eq(excel) ? "yöntem: fire % 2 hane yuvarlama (4 hane altı)" : "";
    return { component, excel, expected, actual: a, diffToExcel: a ? a.minus(excel) : null, status, reason };
  });
}

/** Rapor satırı (6 hane): bileşen | Excel | motor | fark | durum | gerekçe. */
export function formatGoldenRow(r: GoldenRow): string {
  const f6 = (v: Dec | null) => (v === null ? "—" : v.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toFixed(6));
  return `  ${r.component.padEnd(14)} Excel ${f6(r.excel)} · motor ${f6(r.actual)} · fark ${f6(r.diffToExcel)} · ${r.status}${r.reason ? ` (${r.reason})` : ""}`;
}

/**
 * Excel kalıbının parametre seti (genel gider %3, kalite firesi 0, hazırlık 0 — devere tarife satırı):
 * yürürlükteki set kenara alınır (tek ACTIVE), sonda `restoreGoldenParameterSet` geri getirir. Yalnız bekçi DB'sinde.
 */
export async function activateGoldenParameterSet(tag: string): Promise<{ paramId: string; parkedParamId: string | null }> {
  const block = hedefDbEngeli();
  if (block) throw new Error(`altın parametre seti durduruldu — ${block}`);
  const active = await prisma.costParameterSet.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (active) await prisma.costParameterSet.update({ where: { id: active.id }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
  const maxNo = await prisma.costParameterSet.aggregate({ _max: { versionNo: true } });
  const created = await prisma.costParameterSet.create({
    data: {
      versionNo: (maxNo._max.versionNo ?? 0) + 1, status: "ACTIVE", activatedAt: new Date(), note: tag,
      loomHourRateTry: D("120"), laborHourRateTry: D("250"), loomsPerOperator: D("8"), energyKwhPerLoomHour: D("6"), energyPriceTryPerKwh: D("3.2"),
      overheadPct: D("3"), defaultTakeUpPct: D("0"), defaultWarpWastePct: D("0"), defaultWeftWastePct: D("0"), defaultFabricWastePct: D("0"),
      defaultLoomRpm: 500, defaultEfficiencyPct: D("80"), beamPrepCostTry: D("0"), defaultBeamLengthM: D("3000"), weftSelvedgeAllowanceCm: D("0"), defaultMarkupPct: D("0"),
    },
    select: { id: true },
  });
  return { paramId: created.id, parkedParamId: active?.id ?? null };
}

export async function restoreGoldenParameterSet(ids: { paramId: string | null; parkedParamId: string | null }): Promise<void> {
  if (ids.paramId) await prisma.costParameterSet.delete({ where: { id: ids.paramId } });
  if (ids.parkedParamId) await prisma.costParameterSet.update({ where: { id: ids.parkedParamId }, data: { status: "ACTIVE", supersededAt: null } });
}
