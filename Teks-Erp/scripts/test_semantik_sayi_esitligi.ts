// =============================================================================
// SEMANTİK SAYI EŞİTLİĞİ — her küp ölçüsü = kaynak raporun aynı alanı (Raporlar v2 R1-SEMKUP, plan §3.1 / §7 risk 1)
// =============================================================================
// Küp kendi SQL'ini yazar; kaynak rapordan AYRIŞIRSA iki ekran iki sayı söyler. Bu bekçi her ölçüyü
// aynı aralık/süzgeçle kaynak servise karşı koşar: toplam + desteklenen boyut değerleri + en az bir
// süzgeçli vaka. Para 2 hane, oran/metre 1–2 hane (kaynak yuvarlaması). K-KUP: boş paydada küp
// `null` ("ölçülemedi") döner, kaynağın 0'ı bu durumda null kabul edilir.
// Kayıt (iki yönlü): her ölçü `parity` taşır ve burada karşılaştırıcısı vardır (muaf ise gerekçeli);
// temel raporların ana sayısı (`mainFigure = metricFigure("<id>"`) bir küp ölçüsünde olmalıdır.
// Ayrıca: "Diğer" kovası toplamı bozmaz · allowlist dışı boyut 400 · `users`a bağlanan boyut `kisiAdi` taşır.
//
// Hata küpü yalnız saha tespiti (K4P #148: kaynak karne `ACTIONABLE_ROLL_ERROR_SQL`); fikstürdeki muayene
// satırı iki tarafta da sayılmaz. Fikstür `scripts/lib/fixture-semantik.ts` (pencere 2098-03, `TSE-FIX`; levent kapanışı kurulmaz → levent
// ölçüleri iki tarafta da boş veriyle eşitlenir, not düşülür).
//
// NEGATİF SONDALAR (2026-10-25; hepsi md5 ile birebir geri alındı; bugün 83/0):
//   ① `uretim` küpünden K18 dışlaması kaldırıldı → 9 ❌ (biten/birinci metre + birinci yüzde: toplam, kumaş, renk, kalite, süzgeç)
//   ② istasyon küpü `operator` boyutundan `personName` kaldırıldı → 2 ❌ (§K1 işaret + §G4 sonuç bayrağı)
//   ③ `siparis.metre` karşılaştırıcısı silindi (anahtar değişti) → 2 ❌ (§R1 karşılaştırıcısız ölçü + §R3 ölü vaka)
//   ④ küp kaynağına çıplak DATE_TRUNC('day', …) → `test_report_day_boundary` 1 ❌ (fabrika günü bekçisi sahibi;
//      `test_raw_sql_hygiene` bu deseni ölçmez — yeşil kaldı)
//
// Koşum: npx tsx scripts/test_semantik_sayi_esitligi.ts
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { FIXTURE_DAYS, FIXTURE_RANGE as R, setupSemanticFixture, teardownSemanticFixture, type SemanticFixture } from "./lib/fixture-semantik";
import { AppError } from "../src/utils/app-error";
import { semanticQuerySchema, type SemanticQueryInput } from "../src/services/reports/semantik/derleyici";
import { runSemanticQuery, type RunDeps, type SemanticResult } from "../src/services/reports/semantik/calistirici";
import { SEMANTIC_CUBES } from "../src/services/reports/semantik/katalog";
import { ResultCache } from "../src/services/reports/semantik/onbellek";
import { ReportSemaphore } from "../src/services/reports/semantik/semafor";
import type { AccessContext } from "../src/services/reports/semantik/izin";
import { MODULE_SETTING_KEY_BY_FLAG } from "../src/services/system-setting.service";
import { shippedGrossTotal } from "../src/services/reports/_shipped";
import { getDestinationMix } from "../src/services/reports/destination-mix.report.service";
import { getOrderIntake } from "../src/services/reports/order-intake.report.service";
import { getShipmentScorecard } from "../src/services/reports/shipment-scorecard.report.service";
import { getOrderLeadTime } from "../src/services/reports/order-leadtime.report.service";
import { getOrderCancellationScorecard } from "../src/services/reports/order-cancellation.report.service";
import { getReturnScorecard } from "../src/services/reports/return-scorecard.report.service";
import { getQualityScorecard } from "../src/services/reports/quality-scorecard.report.service";
import { getScrapScorecard } from "../src/services/reports/scrap-scorecard.report.service";
import { getWipScorecard } from "../src/services/reports/wip-scorecard.report.service";
import { yarnNeedReport } from "../src/services/reports/yarn-need.report.service";
import { getStockScorecard } from "../src/services/reports/stock-scorecard.report.service";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import { durusParetoReport, efficiencyReport } from "../src/services/reports/dokuma.report.service";
import { beamResultReport } from "../src/services/reports/levent-sonucu.report.service";
import { beamBalance } from "../src/services/reports/temel/levent-dengesi.temel";
import { secondsToMinutes } from "../src/services/reports/temel/duruslar.temel";
import { buildLossReport } from "../src/services/reports/temel/kayip.temel";
import { resolveCoreCompare } from "../src/services/reports/temel/_common";
import { getAgingReport } from "../src/services/reports/finance-aging.report";
import { listInspections } from "../src/services/quality-inspection-query.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;
/** K-KUP: küp null ↔ kaynak 0 yalnız boş paydada (`emptyIsNull`). */
function same(cube: number | null | undefined, src: number | null | undefined, digits: number, emptyIsNull = false): boolean {
  if (cube === null || cube === undefined) return src === null || src === undefined || (emptyIsNull && src === 0);
  return src !== null && src !== undefined && round(cube, digits) === round(src, digits);
}

// Koşu kaydı (`report_runs.userId`) gerçek kullanıcı ister → fikstür operatörü.
let CTX: AccessContext = { userId: "", permissions: ["*"], openModuleKeys: new Set(Object.values(MODULE_SETTING_KEY_BY_FLAG)) };
const deps = (): RunDeps => ({ cubes: SEMANTIC_CUBES, semaphore: new ReportSemaphore(), cache: new ResultCache(), readTimeoutSec: async () => 15 });

interface Filter { alan: string; islec: string; deger: string | string[] }
async function run(kup: string, olcu: string, boyutlar: string[] = [], suzgec: Filter[] = [], extra: Record<string, unknown> = {}): Promise<SemanticResult> {
  const input: SemanticQueryInput = semanticQuerySchema.parse({ kup, olculer: [olcu], boyutlar, suzgec, dateFrom: R.from.toISOString(), dateTo: R.to.toISOString(), ...extra });
  return runSemanticQuery(input, CTX, undefined, deps());
}
const total = (r: SemanticResult, olcu: string): number | null => r.toplam.degerler[olcu] ?? null;
function byKey(r: SemanticResult, dim: string, olcu: string): Map<string | null, number | null> {
  return new Map(r.satirlar.map((s) => [s.anahtarlar[dim]?.deger ?? null, s.degerler[olcu] ?? null]));
}

/** Boyut eşitliği: kaynak kırılımının her anahtarı küpte aynı değerle, küpte fazla anahtar yok. */
function sameBreakdown(label: string, cube: Map<string | null, number | null>, src: Map<string | null, number>, digits: number): void {
  const bad: string[] = [];
  for (const [k, v] of src) if (!same(cube.get(k) ?? null, v, digits)) bad.push(`${k}: küp ${cube.get(k)} · kaynak ${v}`);
  for (const k of cube.keys()) if (!src.has(k)) bad.push(`${k}: yalnız küpte`);
  check(label, bad.length === 0 && src.size > 0, bad.join(" | ") || `${src.size} değer`);
}
const sumBy = <T>(rows: readonly T[], key: (r: T) => string | null, val: (r: T) => number): Map<string | null, number> => {
  const m = new Map<string | null, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
  return m;
};

type Case = (fx: SemanticFixture) => Promise<void>;
const show = (a: unknown, b: unknown): string => `küp ${JSON.stringify(a)} · kaynak ${JSON.stringify(b)}`;
async function totalCase(kup: string, olcu: string, src: number | null, digits: number, emptyIsNull = false): Promise<void> {
  const c = total(await run(kup, olcu), olcu);
  check(`§E ${kup}/${olcu} toplam = kaynak`, same(c, src, digits, emptyIsNull), show(c, src));
}

// Ölçü kimliği → karşılaştırıcı. Kayıt bekçisi (§R) bu tabloyu küp listesine karşı ölçer.
const CASES: Record<string, Case> = {
  "sevk.brutMetre": async (fx) => {
    await totalCase("sevk", "sevk.brutMetre", await shippedGrossTotal(R), 2);
    const mix = await getDestinationMix(R);
    sameBreakdown("§E sevk/sevk.brutMetre × müşteri = Yurtiçi/Yurtdışı Satış byCustomer", byKey(await run("sevk", "sevk.brutMetre", ["musteri"]), "musteri", "sevk.brutMetre"),
      sumBy(mix.byCustomer, (r) => r.key, (r) => r.meters), 2);
    const k1 = total(await run("sevk", "sevk.brutMetre", [], [{ alan: "musteri", islec: "=", deger: fx.customers[0] }]), "sevk.brutMetre");
    const srcK1 = mix.byCustomer.filter((r) => r.key === fx.customers[0]).reduce((a, r) => a + r.meters, 0);
    check("§E sevk/sevk.brutMetre süzgeçli (müşteri = K1) = kaynak satırı", same(k1, srcK1, 2) && srcK1 > 0, show(k1, srcK1));
  },
  "sevk.tutar": async () => {
    const r = await run("sevk", "sevk.tutar");
    const mix = await getDestinationMix(R);
    const src = sumBy(mix.buckets.flatMap((b) => b.money.amounts), (a) => a.currency, (a) => a.amount);
    const cube = new Map((r.toplam.paraBirimleri ?? []).map((p) => [p.paraBirimi, p.deger]));
    const bad = [...src].filter(([c, v]) => !same(cube.get(c ?? "") ?? null, v, 2));
    check("§E sevk/sevk.tutar para birimi başına = kaynak kovaların tutarı (fikstürde fiyat yok → boş küme)", bad.length === 0 && cube.size === src.size, show([...cube], [...src]));
  },
  "siparis.metre": async (fx) => {
    const intake = await getOrderIntake(R);
    await totalCase("siparis", "siparis.metre", intake.summary.totalQty, 2);
    sameBreakdown("§E siparis/siparis.metre × müşteri = Sipariş Alımı byCustomer", byKey(await run("siparis", "siparis.metre", ["musteri"]), "musteri", "siparis.metre"),
      sumBy(intake.byCustomer, (r) => r.key, (r) => r.qty), 2);
    sameBreakdown("§E siparis/siparis.metre × kumaş = byItem", byKey(await run("siparis", "siparis.metre", ["kumas"]), "kumas", "siparis.metre"),
      sumBy(intake.byItem, (r) => r.key, (r) => r.qty), 2);
    const k2 = total(await run("siparis", "siparis.metre", [], [{ alan: "musteri", islec: "=", deger: fx.customers[1] }]), "siparis.metre");
    const srcK2 = intake.byCustomer.find((r) => r.key === fx.customers[1])?.qty ?? null;
    check("§E siparis/siparis.metre süzgeçli (müşteri = K2) = kaynak satırı", same(k2, srcK2, 2) && (srcK2 ?? 0) > 0, show(k2, srcK2));
  },
  "siparis.tutar": async () => {
    const src = new Map((await getOrderIntake(R)).summary.amounts.map((a) => [a.currency, a.amount]));
    const cube = new Map(((await run("siparis", "siparis.tutar")).toplam.paraBirimleri ?? []).map((p) => [p.paraBirimi, p.deger]));
    const bad = [...src].filter(([c, v]) => !same(cube.get(c), v, 2));
    check("§E siparis/siparis.tutar para birimi başına = Sipariş Karnesi `amounts` (iki para birimi, toplanmaz)", bad.length === 0 && cube.size === src.size && src.size >= 2, show([...cube], [...src]));
  },
  "termin.zamanindaYuzde": async () => totalCase("siparis", "termin.zamanindaYuzde", (await getShipmentScorecard(R)).summary.onTimePct, 2, true),
  "termin.yariSureGun": async () => totalCase("siparis", "termin.yariSureGun", (await getOrderLeadTime(R)).fullClose.medianDays, 2),
  "termin.dokuzdaDokuzGun": async () => totalCase("siparis", "termin.dokuzdaDokuzGun", (await getOrderLeadTime(R)).fullClose.p90Days, 2),
  "siparis.iptalOrani": async () => totalCase("siparis", "siparis.iptalOrani", (await getOrderCancellationScorecard(R)).summary.cancelRatePct, 2),
  "iade.oran": async () => totalCase("siparis", "iade.oran", (await getReturnScorecard(R)).summary.returnPct, 2, true),
  "kalite.bitenMetre": async (fx) => {
    const q = await getQualityScorecard(R);
    await totalCase("uretim", "kalite.bitenMetre", q.summary.totalQty, 1);
    sameBreakdown("§E uretim/kalite.bitenMetre × kumaş = Kalite Karnesi byItem", byKey(await run("uretim", "kalite.bitenMetre", ["kumas"]), "kumas", "kalite.bitenMetre"),
      sumBy(q.byItem, (r) => r.key, (r) => r.totalQty), 1);
    sameBreakdown("§E uretim/kalite.bitenMetre × renk = byColor", byKey(await run("uretim", "kalite.bitenMetre", ["renk"]), "renk", "kalite.bitenMetre"),
      sumBy(q.byColor, (r) => r.key, (r) => r.totalQty), 1);
    sameBreakdown("§E uretim/kalite.bitenMetre × kalite = grades", byKey(await run("uretim", "kalite.bitenMetre", ["kalite"]), "kalite", "kalite.bitenMetre"),
      sumBy(q.grades.filter((g) => g.qty > 0), (g) => g.gradeId, (g) => g.qty), 1);
    const i1 = total(await run("uretim", "kalite.bitenMetre", [], [{ alan: "kumas", islec: "=", deger: fx.items[0] }]), "kalite.bitenMetre");
    const srcI1 = q.byItem.find((r) => r.key === fx.items[0])?.totalQty ?? null;
    check("§E uretim/kalite.bitenMetre süzgeçli (kumaş = I1) = kaynak satırı", same(i1, srcI1, 1) && (srcI1 ?? 0) > 0, show(i1, srcI1));
  },
  "kalite.birinciMetre": async () => {
    const q = await getQualityScorecard(R);
    await totalCase("uretim", "kalite.birinciMetre", q.summary.topGrade?.qty ?? null, 1);
    sameBreakdown("§E uretim/kalite.birinciMetre × renk = byColor topGradeQty",
      new Map([...byKey(await run("uretim", "kalite.birinciMetre", ["renk"]), "renk", "kalite.birinciMetre")].map(([k, v]) => [k, v ?? 0])),
      new Map(q.byColor.map((r) => [r.key, r.topGradeQty])), 1);
  },
  "kalite.birinciYuzde": async () => {
    const q = await getQualityScorecard(R);
    await totalCase("uretim", "kalite.birinciYuzde", q.summary.topGrade?.pct ?? null, 1, true);
    // Oran ortalanmaz: kumaş satırı kendi pay/paydasından (kaynak satır yüzdesi 1 hane).
    sameBreakdown("§E uretim/kalite.birinciYuzde × kumaş = byItem topGradePct", byKey(await run("uretim", "kalite.birinciYuzde", ["kumas"]), "kumas", "kalite.birinciYuzde"),
      new Map(q.byItem.map((r) => [r.key, r.topGradePct])), 1);
  },
  "fire.hurdaMetre": async () => {
    const s = await getScrapScorecard(R);
    await totalCase("uretim", "fire.hurdaMetre", s.summary.scrapQty, 1);
    sameBreakdown("§E uretim/fire.hurdaMetre × kumaş = Hurda Karnesi byItem",
      // Hurdası olmayan kumaş grubu küpte 0 döner (SUM FILTER → COALESCE), kaynakta satır yoktur.
      new Map([...byKey(await run("uretim", "fire.hurdaMetre", ["kumas"]), "kumas", "fire.hurdaMetre")].filter(([, v]) => (v ?? 0) !== 0)),
      sumBy(s.byItem, (r) => r.key, (r) => r.qty), 1);
  },
  "fire.metre": async () => {
    const { mode, compareRange } = resolveCoreCompare({}, R);
    const loss = (await buildLossReport({ range: R, compareRange, compareMode: mode })).sunum.anaSayi.deger;
    await totalCase("uretim", "fire.metre", loss, 1);
  },
  "uretim.gecenMetre": async (fx) => {
    const w = await getWipScorecard(R);
    await totalCase("istasyon", "uretim.gecenMetre", w.summary.passedQty, 1);
    const cube = byKey(await run("istasyon", "uretim.gecenMetre", ["istasyon"]), "istasyon", "uretim.gecenMetre");
    sameBreakdown("§E istasyon/uretim.gecenMetre × istasyon = İş Akışı byStation", cube, new Map(w.byStation.filter((s) => s.passedCount > 0).map((s) => [s.key, s.passedQty])), 1);
    const s1 = total(await run("istasyon", "uretim.gecenMetre", [], [{ alan: "istasyon", islec: "=", deger: fx.stations[0] }]), "uretim.gecenMetre");
    const src = w.byStation.find((s) => s.key === fx.stations[0])?.passedQty ?? null;
    check("§E istasyon/uretim.gecenMetre süzgeçli (istasyon = S1) = kaynak satırı", same(s1, src, 1) && (src ?? 0) > 0, show(s1, src));
  },
  "uretim.gecenTop": async () => {
    const w = await getWipScorecard(R);
    await totalCase("istasyon", "uretim.gecenTop", w.summary.passedCount, 0);
    sameBreakdown("§E istasyon/uretim.gecenTop × istasyon = byStation", byKey(await run("istasyon", "uretim.gecenTop", ["istasyon"]), "istasyon", "uretim.gecenTop"),
      new Map(w.byStation.filter((s) => s.passedCount > 0).map((s) => [s.key, s.passedCount])), 0);
  },
  "uretim.bekleyenTop": async () => {
    const w = await getWipScorecard(R);
    await totalCase("istasyon", "uretim.bekleyenTop", w.summary.waitingCount, 0);
    sameBreakdown("§E istasyon/uretim.bekleyenTop × istasyon = byStation bekleyen",
      new Map([...byKey(await run("istasyon", "uretim.bekleyenTop", ["istasyon"]), "istasyon", "uretim.bekleyenTop")].filter(([, v]) => v !== 0)),
      new Map(w.byStation.filter((s) => s.waitingCount > 0).map((s) => [s.key, s.waitingCount])), 0);
  },
  // K4P-RAPOR: kaynak Muayeneler ekranının özet şeridi (aynı where, fabrika günü penceresi).
  "kalite.muayeneAdedi": async () => {
    const days = { from: FIXTURE_DAYS.from, to: FIXTURE_DAYS.to };
    const src = (await listInspections(days)).summary.total;
    await totalCase("muayene", "kalite.muayeneAdedi", src, 0);
    check("§E muayene/kalite.muayeneAdedi fikstür dolu (iptal ve pencere dışı sayılmaz → 3)", src === 3, String(src));
    const cube = byKey(await run("muayene", "kalite.muayeneAdedi", ["asama"]), "asama", "kalite.muayeneAdedi");
    const byPhase = new Map<string | null, number>();
    for (const phase of ["RAW", "FINAL"]) {
      const n = (await listInspections({ ...days, phase })).summary.total;
      if (n > 0) byPhase.set(phase, n);
    }
    sameBreakdown("§E muayene/kalite.muayeneAdedi × aşama = liste aşama süzgeci", cube, byPhase, 0);
  },
  "kalite.muayeneOrtalamaPuan": async (fx) => {
    const days = { from: FIXTURE_DAYS.from, to: FIXTURE_DAYS.to };
    const num = (v: { toNumber(): number } | null) => (v == null ? null : v.toNumber());
    const src = num((await listInspections(days)).summary.avgPointsPer100M2);
    await totalCase("muayene", "kalite.muayeneOrtalamaPuan", src, 2, true);
    check("§E muayene/kalite.muayeneOrtalamaPuan fikstür: (12,5 + 20,25) / 2, puansız ve iptal dışarıda", src === 16.38, String(src));
    const cube = byKey(await run("muayene", "kalite.muayeneOrtalamaPuan", ["kumas"]), "kumas", "kalite.muayeneOrtalamaPuan");
    for (const itemId of fx.items) {
      const s = num((await listInspections({ ...days, itemId })).summary.avgPointsPer100M2);
      check(`§E muayene/kalite.muayeneOrtalamaPuan × kumaş (${fx.items.indexOf(itemId) + 1}) = liste kumaş süzgeci`, same(cube.get(itemId) ?? null, s, 2, true), show(cube.get(itemId), s));
    }
  },
  "kalite.hataAdedi": async (fx) => {
    const s = await getScrapScorecard(R);
    await totalCase("hata", "kalite.hataAdedi", s.summary.defectsDetected, 0);
    sameBreakdown("§E hata/kalite.hataAdedi × hata türü = detectionByDefect", byKey(await run("hata", "kalite.hataAdedi", ["hataTuru"]), "hataTuru", "kalite.hataAdedi"),
      sumBy(s.detectionByDefect, (r) => r.key, (r) => r.count), 0);
    sameBreakdown("§E hata/kalite.hataAdedi × istasyon = detectionByStation", byKey(await run("hata", "kalite.hataAdedi", ["istasyon"]), "istasyon", "kalite.hataAdedi"),
      sumBy(s.detectionByStation, (r) => r.key, (r) => r.count), 0);
    const d1 = total(await run("hata", "kalite.hataAdedi", [], [{ alan: "hataTuru", islec: "=", deger: fx.defectTypes[0] }]), "kalite.hataAdedi");
    const src = s.detectionByDefect.find((r) => r.key === fx.defectTypes[0])?.count ?? null;
    check("§E hata/kalite.hataAdedi süzgeçli (hata türü = D1) = kaynak satırı", same(d1, src, 0) && (src ?? 0) > 0, show(d1, src));
  },
  "kalite.binMetredeHata": async () => totalCase("hata", "kalite.binMetredeHata", (await getScrapScorecard(R)).summary.defectsPerThousandM, 2, true),
  "dokuma.durusSure": async (fx) => {
    const p = await durusParetoReport(FIXTURE_DAYS);
    await totalCase("durus", "dokuma.durusSure", secondsToMinutes(p.toplam.stopSec), 2);
    const cube = byKey(await run("durus", "dokuma.durusSure", ["tezgah"]), "tezgah", "dokuma.durusSure");
    for (const loom of fx.looms) {
      const src = secondsToMinutes((await durusParetoReport({ ...FIXTURE_DAYS, machineId: loom })).toplam.stopSec);
      check("§E durus/dokuma.durusSure × tezgah = Duruş Pareto (machineId)", same(cube.get(loom), src, 2) && (src ?? 0) > 0, show(cube.get(loom), src));
    }
    const night = total(await run("durus", "dokuma.durusSure", [], [{ alan: "vardiya", islec: "=", deger: fx.shiftCode }]), "dokuma.durusSure");
    const srcNight = secondsToMinutes((await durusParetoReport({ ...FIXTURE_DAYS, shiftDefinitionIds: [fx.shiftDefinitionId] })).toplam.stopSec);
    check("§E durus/dokuma.durusSure süzgeçli (vardiya = gece, gece yarısı aşar) = Pareto shiftDefinitionIds", same(night, srcNight, 2) && (srcNight ?? 0) > 0, show(night, srcNight));
    const reasons = byKey(await run("durus", "dokuma.durusSure", ["sebep"]), "sebep", "dokuma.durusSure");
    const cozgu = p.sebepler.filter((s) => s.reasonCode === "COZGU_KOPUSU").reduce((a, s) => a + s.stopSec, 0);
    check("§E durus/dokuma.durusSure × sebep: sebepli · kısa (MIKRO) · sınıfsız (null) = Pareto kovaları",
      same(reasons.get("COZGU_KOPUSU"), secondsToMinutes(cozgu), 2) && same(reasons.get("MIKRO"), secondsToMinutes(p.mikroDuruslar.stopSec), 2)
        && same(reasons.get(null), secondsToMinutes(p.siniflandirilmamis.stopSec), 2),
      show(Object.fromEntries(reasons), { cozgu, mikro: p.mikroDuruslar.stopSec, sinifsiz: p.siniflandirilmamis.stopSec }));
  },
  "dokuma.durusSayisi": async (fx) => {
    await totalCase("durus", "dokuma.durusSayisi", (await durusParetoReport(FIXTURE_DAYS)).toplam.stopCount, 0);
    const cube = byKey(await run("durus", "dokuma.durusSayisi", ["tezgah"]), "tezgah", "dokuma.durusSayisi");
    const src = (await durusParetoReport({ ...FIXTURE_DAYS, machineId: fx.looms[0] })).toplam.stopCount;
    check("§E durus/dokuma.durusSayisi × tezgah (L1) = Pareto machineId", same(cube.get(fx.looms[0]), src, 0) && src > 0, show(cube.get(fx.looms[0]), src));
  },
  "dokuma.randimanYuzde": async (fx) => {
    await totalCase("dokuma-vardiya", "dokuma.randimanYuzde", (await efficiencyReport({ ...FIXTURE_DAYS, limit: 1 })).toplam.effectivenessPct, 2, true);
    const cube = byKey(await run("dokuma-vardiya", "dokuma.randimanYuzde", ["tezgah"]), "tezgah", "dokuma.randimanYuzde");
    for (const loom of fx.looms) {
      const src = (await efficiencyReport({ ...FIXTURE_DAYS, machineId: loom, limit: 1 })).toplam.effectivenessPct;
      check("§E dokuma-vardiya/dokuma.randimanYuzde × tezgah = Randıman (machineId) — oran yeniden hesaplanır", same(cube.get(loom), src, 2) && (src ?? 0) > 0, show(cube.get(loom), src));
    }
  },
  "levent.dengeYuzde": async () => {
    const src = beamBalance((await beamResultReport(FIXTURE_DAYS)).data.kapananlar).balancePct;
    await totalCase("dokuma-vardiya", "levent.dengeYuzde", src, 2, true);
  },
  "fire.leventMetre": async () => {
    const lev = (await beamResultReport(FIXTURE_DAYS)).data;
    const measured = beamBalance(lev.kapananlar).balancePct === null ? 0 : lev.ozet.fireM;
    await totalCase("dokuma-vardiya", "fire.leventMetre", measured, 1);
  },
  // MAL-7: iplik kesiti — kaynak `yarnNeedReport().ozet` (dize kg, 3 hane); küp satır Σ'sı.
  "iplik.ihtiyacKg": async () => totalCase("iplik", "iplik.ihtiyacKg", Number((await yarnNeedReport()).ozet.ihtiyacKg), 2),
  "iplik.eksikKg": async () => totalCase("iplik", "iplik.eksikKg", Number((await yarnNeedReport()).ozet.eksikKg), 2),
  "stok.oluMetre": async () => totalCase("stok", "stok.oluMetre", (await getStockScorecard()).summary.deadQty, 1),
  "stok.yasiBilinmeyenMetre": async () => totalCase("stok", "stok.yasiBilinmeyenMetre", (await getStockScorecard()).summary.unagedQty, 1),
  "stok.bitmisMetre": async (fx) => {
    const s = await getStockScorecard();
    await totalCase("stok", "stok.bitmisMetre", s.summary.finishedQty, 1);
    const i2 = total(await run("stok", "stok.bitmisMetre", [], [{ alan: "kumas", islec: "=", deger: fx.items[1] }]), "stok.bitmisMetre");
    const src = s.byItem.find((r) => r.key === fx.items[1])?.qty ?? null;
    check("§E stok/stok.bitmisMetre süzgeçli (kumaş = I2) = byItem satırı", same(i2, src, 1) && (src ?? 0) > 0, show(i2, src));
  },
  "fason.ortalamaDonusGun": async () => subcontractCase("fason.ortalamaDonusGun", (f) => f.avgTurnaroundDays),
  "fire.fasonMetre": async () => subcontractCase("fire.fasonMetre", (f) => f.fireQty),
  "fason.gonderilenMetre": async () => subcontractCase("fason.gonderilenMetre", (f) => f.dispatchedQty),
  "fason.bekleyenMetre": async () => subcontractCase("fason.bekleyenMetre", (f) => f.openQty),
  "alacak.vadesiGecmis": async () => agingCase("alacak.vadesiGecmis", "overdueTotal"),
  "alacak.acikToplam": async () => agingCase("alacak.acikToplam", "openTotal"),
};

let fixture: SemanticFixture;
type SubFigures = { avgTurnaroundDays: number | null; fireQty: number; dispatchedQty: number; openQty: number };
async function subcontractCase(olcu: string, pick: (f: SubFigures) => number | null): Promise<void> {
  const s = await getSubcontractScorecard(R);
  await totalCase("fason", olcu, pick(s.summary), 2);
  const cube = byKey(await run("fason", olcu, ["fasoncu"]), "fasoncu", olcu);
  const bad = s.bySubcontractor.filter((r) => !same(cube.get(r.key), pick(r), 2)).map((r) => `${r.label}: ${show(cube.get(r.key), pick(r))}`);
  check(`§E fason/${olcu} × fasoncu = Fason Karnesi bySubcontractor`, bad.length === 0 && s.bySubcontractor.length >= 2, bad.join(" | ") || `${s.bySubcontractor.length} fasoncu`);
  const fa = fixture.subcontractors[0];
  const filtered = total(await run("fason", olcu, [], [{ alan: "fasoncu", islec: "=", deger: fa }]), olcu);
  const src = pick((await getSubcontractScorecard(R, null, { subcontractorId: [fa] })).summary);
  check(`§E fason/${olcu} süzgeçli (fasoncu = A) = kaynak süzgeçli özet`, same(filtered, src, 2), show(filtered, src));
}

async function agingCase(olcu: string, field: "overdueTotal" | "openTotal"): Promise<void> {
  const aging = await getAgingReport({ asOf: R.to });
  const src = new Map(aging.blocks.map((b) => [b.currency as string, Number(b.totals[field])]));
  const cube = new Map(((await run("finans", olcu)).toplam.paraBirimleri ?? []).map((p) => [p.paraBirimi, p.deger]));
  const bad = [...src].filter(([c, v]) => !same(cube.get(c), v, 2) && !(v === 0 && !cube.has(c)));
  check(`§E finans/${olcu} para birimi başına = Cari Yaşlandırma blok toplamı (iki para birimi, toplanmaz)`, bad.length === 0 && src.has("TRY") && src.has("USD"), show([...cube], [...src]));
  const usd = (await run("finans", olcu, [], [{ alan: "paraBirimi", islec: "=", deger: "USD" }])).toplam.paraBirimleri ?? [];
  check(`§E finans/${olcu} süzgeçli (para birimi = USD) yalnız USD bloğu`, usd.length === 1 && usd[0]!.paraBirimi === "USD" && same(usd[0]!.deger, src.get("USD"), 2), JSON.stringify(usd));
}

/** Temel raporların ana sayısında görünen ama küpte ölçüsü olmayan kimlikler (gerekçeli). */
const MAIN_FIGURE_EXEMPT: Record<string, string> = {};

function sectionRegistry(): void {
  console.log("\n§R kayıt (iki yönlü)");
  const measures = SEMANTIC_CUBES.flatMap((c) => c.measures.map((m) => ({ cube: c.id, m })));
  const missing = measures.filter(({ m }) => !("exempt" in m.parity) && !CASES[m.id]).map(({ cube, m }) => `${cube}/${m.id}`);
  check("§R1 her eşitlik beyanlı ölçünün karşılaştırıcısı var", missing.length === 0, missing.join(", ") || `${measures.length} ölçü`);
  const exempt = measures.filter(({ m }) => "exempt" in m.parity);
  const unjustified = exempt.filter(({ m }) => "exempt" in m.parity && m.parity.exempt.trim().length < 20).map(({ m }) => m.id);
  check("§R2 muaf ölçü gerekçeli (≥20 karakter)", unjustified.length === 0, unjustified.join(", ") || `${exempt.length} muaf`);
  const orphan = Object.keys(CASES).filter((id) => !measures.some(({ m }) => m.id === id));
  check("§R3 karşılaştırıcısı olup küpte olmayan ölçü yok (ölü vaka)", orphan.length === 0, orphan.join(", ") || "temiz");

  const dir = join(__dirname, "../src/services/reports/temel");
  const ids = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".temel.ts"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/mainFigure(?:\s*:\s*\w+)?\s*=\s*(?:[^;]*?\?\s*)?metricFigure\("([^"]+)"/g)) ids.add(m[1]!);
  }
  check("§R4 tarayıcı canlı (temel ana sayılarının en az 9'u bulundu)", ids.size >= 9, [...ids].join(", "));
  const uncovered = [...ids].filter((id) => !MAIN_FIGURE_EXEMPT[id] && !measures.some(({ m }) => m.id === id));
  const deadExempt = Object.keys(MAIN_FIGURE_EXEMPT).filter((id) => !ids.has(id));
  check("§R6 ölü muafiyet yok (muaf kimlik temel ana sayılarda bulunur)", deadExempt.length === 0, deadExempt.join(", ") || "temiz");
  check("§R5 her temel ana sayı bir küp ölçüsünde (ya da gerekçeli muaf)", uncovered.length === 0, uncovered.join(", ") || "kapsandı");
}

function sectionPersonName(): void {
  console.log("\n§K kişi adı işareti");
  const bad = SEMANTIC_CUBES.flatMap((c) => c.dimensions
    .filter((d) => /\busers\b/.test([d.joins, d.labelSql, d.keySql].filter(Boolean).map((s) => s!.sql).join(" ")) && !d.personName)
    .map((d) => `${c.id}/${d.id}`));
  const any = SEMANTIC_CUBES.some((c) => c.dimensions.some((d) => d.personName));
  check("§K1 `users`a bağlanan her boyut `kisiAdi` (personName) taşır", bad.length === 0 && any, bad.join(", ") || "işaretli");
}

async function sectionGuards(fx: SemanticFixture): Promise<void> {
  console.log("\n§G tavan · allowlist · kişi adı · boş payda");
  const full = await run("istasyon", "uretim.gecenMetre", ["istasyon"]);
  const capped = await run("istasyon", "uretim.gecenMetre", ["istasyon"], [], { tavan: 1 });
  const rowsSum = capped.satirlar.reduce((a, s) => a + (s.degerler["uretim.gecenMetre"] ?? 0), 0);
  check("§G1 \"Diğer\" kovası toplamı bozmaz (tavan 1: toplam aynı, satırlar toplama eşit, Diğer var)",
    same(total(capped, "uretim.gecenMetre"), total(full, "uretim.gecenMetre"), 2) && same(rowsSum, total(full, "uretim.gecenMetre"), 2)
      && capped.satirlar.some((s) => s.anahtarlar.istasyon?.diger === true),
    show(total(capped, "uretim.gecenMetre"), total(full, "uretim.gecenMetre")));
  const status = async (fn: () => Promise<unknown>): Promise<string> => {
    try { await fn(); return "200"; } catch (e) { return e instanceof AppError ? `${e.statusCode} ${(e.details as { code?: string } | undefined)?.code}` : "500"; }
  };
  const sqlOut = await status(() => run("uretim", "kalite.bitenMetre", ["operator"]));
  check("§G2 küpün allowlist'inde olmayan boyut (uretim × operator) → 400", sqlOut.startsWith("400"), sqlOut);
  const helperOut = await status(() => run("dokuma-vardiya", "dokuma.randimanYuzde", ["cozguKarti"]));
  check("§G3 helper ölçünün beyan etmediği boyut (randıman × çözgü kartı) → 400", helperOut.startsWith("400"), helperOut);
  const person = await run("istasyon", "uretim.gecenTop", ["operator"]);
  check("§G4 operatör boyutlu sonuç `kisiAdi` bayrağı taşır (buluta gitmez)", person.kisiAdi === true && person.boyutlar.some((b) => b.kisiAdi === true),
    JSON.stringify(person.boyutlar));
  check("§G5 operatör kırılımı dolu (fikstür operatörü)", byKey(person, "operator", "uretim.gecenTop").get(fx.operatorId) !== undefined);
  const empty = semanticQuerySchema.parse({ kup: "siparis", olculer: ["iade.oran"], dateFrom: "2099-01-01T00:00:00.000Z", dateTo: "2099-01-31T20:59:59.999Z" });
  const emptyRes = await runSemanticQuery(empty, CTX, undefined, deps());
  const srcEmpty = (await getReturnScorecard({ from: new Date(empty.dateFrom!), to: new Date(empty.dateTo!) })).summary.returnPct;
  check("§G6 K-KUP boş payda: küp null (ölçülemedi), kaynak 0 → eşlenir", total(emptyRes, "iade.oran") === null && same(null, srcEmpty, 2, true), show(total(emptyRes, "iade.oran"), srcEmpty));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("\n=== Semantik sayı eşitliği ===");
  sectionRegistry();
  sectionPersonName();
  try {
    fixture = await setupSemanticFixture();
    CTX = { ...CTX, userId: fixture.operatorId };
    console.log("\n§E küp × ölçü = kaynak (pencere 2098-03, dolu fikstür)");
    for (const [id, c] of Object.entries(CASES)) {
      try { await c(fixture); } catch (e) { check(`§E ${id} koştu`, false, e instanceof Error ? e.message : String(e)); }
    }
    await sectionGuards(fixture);
    console.log("\nNot: levent kapanışı fikstürde yok — levent ölçüleri iki tarafta boş veriyle eşitlendi (ölçülemedi ↔ boş).");
  } finally {
    await teardownSemanticFixture();
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
