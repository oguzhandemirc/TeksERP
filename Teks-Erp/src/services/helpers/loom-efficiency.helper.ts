// =============================================================================
// RANDIMAN ORANLARI — TEK YAZAR / TEK OKUYUCU (DOKUMA-TEZGAH §5.2, rapor sözleşmesi ①)
// =============================================================================
// A = APT / POT · P = (picks − gapPicks) / capApt · E = (picks − gapPicks) / capPot
// ⚠️ ÜÇ ORAN AYRI SUNULUR, ÇARPILMAZ (E zaten kendi paydasıyla gelir; tek hedefli
//    vardiyada E = A × P birebir çıkar — bekçi bunu ölçer).
// ⚠️ PAYDA 0 → `null` = "ÖLÇÜLEMEDİ" (boş hücre değil BEYAN). Toplamda o satır
//    pay ve paydadan DIŞLANIR ve dışlanan sayısı döner; oranlar ASLA ortalanmaz
//    (`Σpicks / Σcap`), `null` hiçbir yerde 0'a çökertilmez.
// ⚠️ AST TRIPWIRE (`test_machine_efficiency_formula`): `/ potSec`, `/ aptSec`,
//    `/ targetPickCapacity*` bölmesi bu dosya dışında GEÇEMEZ; `…Pct ?? 0` ve
//    `avg(…Pct)` hiçbir yerde. Bu dosya DB'siz ve saf — girdi terimler, çıktı oranlar.
// =============================================================================
import { LOOM_KPI_FORMULA_VERSION } from "../../constants/loom-shift";

/** Oranların girdisi — karne satırının SANİYE/ATKI terimleri (oran değil). */
export interface LoomKpiTerms {
  potSec: number;
  aptSec: number;
  picksActual: number;
  gapPicks: number;
  targetPickCapacityApt: number;
  targetPickCapacityPot: number;
}

/** Yüzde (0–100, 2 hane) ya da `null` = ölçülemedi. */
export interface LoomKpis {
  availabilityPct: number | null;
  performancePct: number | null;
  effectivenessPct: number | null;
  formulaVersion: number;
  /** Hangi oran NEDEN ölçülemedi — rapor bunu "P: ölçülemedi" diye basar. */
  olculemedi: { A?: string; P?: string; E?: string };
  warnings: string[];
}

/** 0–1 oranı yüzdeye çevirir, 2 haneye yuvarlar. Yuvarlama TEK yerde. */
function toPct(ratio: number): number {
  return Math.round(ratio * 10_000) / 100;
}

export function computeMachineKpis(t: LoomKpiTerms): LoomKpis {
  const olculemedi: LoomKpis["olculemedi"] = {};
  const warnings: string[] = [];
  const netPicks = t.picksActual - t.gapPicks;

  const availabilityPct = t.potSec > 0 ? toPct(t.aptSec / t.potSec) : null;
  if (availabilityPct === null) olculemedi.A = "planlı süre (POT) sıfır";

  const performancePct = t.targetPickCapacityApt > 0 ? toPct(netPicks / t.targetPickCapacityApt) : null;
  if (performancePct === null) olculemedi.P = "hedef devir yok (koşum ve künye NULL) ya da çalışma süresi sıfır";
  else if (performancePct > 100) warnings.push(`Performans %${performancePct} > 100 — hedef devir ya da atkı sayacı hatalı olabilir; düzeltilmedi, olduğu gibi basıldı.`);

  const effectivenessPct = t.targetPickCapacityPot > 0 ? toPct(netPicks / t.targetPickCapacityPot) : null;
  if (effectivenessPct === null) olculemedi.E = "hedef devir yok ya da planlı süre sıfır";

  return { availabilityPct, performancePct, effectivenessPct, formulaVersion: LOOM_KPI_FORMULA_VERSION, olculemedi, warnings };
}

/** Toplam oranlar — Σpay / Σpayda; paydası sıfır satır DIŞLANIR ve sayılır. Ortalama YOK. */
export interface LoomKpiAggregate {
  availabilityPct: number | null;
  performancePct: number | null;
  effectivenessPct: number | null;
  /** Oran başına DIŞLANAN (ölçülemeyen) satır sayısı. */
  olculemedi: { A: number; P: number; E: number };
  rowCount: number;
}

export function aggregateMachineKpis(rows: LoomKpiTerms[]): LoomKpiAggregate {
  const sum = { apt: 0, pot: 0, picksA: 0, capA: 0, picksP: 0, capP: 0 };
  const olculemedi = { A: 0, P: 0, E: 0 };
  for (const r of rows) {
    const net = r.picksActual - r.gapPicks;
    if (r.potSec > 0) { sum.apt += r.aptSec; sum.pot += r.potSec; } else olculemedi.A += 1;
    if (r.targetPickCapacityApt > 0) { sum.picksA += net; sum.capA += r.targetPickCapacityApt; } else olculemedi.P += 1;
    if (r.targetPickCapacityPot > 0) { sum.picksP += net; sum.capP += r.targetPickCapacityPot; } else olculemedi.E += 1;
  }
  return {
    availabilityPct: sum.pot > 0 ? toPct(sum.apt / sum.pot) : null,
    performancePct: sum.capA > 0 ? toPct(sum.picksA / sum.capA) : null,
    effectivenessPct: sum.capP > 0 ? toPct(sum.picksP / sum.capP) : null,
    olculemedi,
    rowCount: rows.length,
  };
}
