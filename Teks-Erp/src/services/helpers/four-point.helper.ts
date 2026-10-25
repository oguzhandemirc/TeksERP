// =============================================================================
// 4 PUAN MOTORU — saf hesap (DB'siz, yalnız Prisma.Decimal) · plan §2
// =============================================================================
// puan/100 m² = puan × 10 000 / (en_cm × boy_m); /100 yd² = × 0,83612736. ASTM D5430'un
// puan×36×100/(en_inç×boy_yarda) formülüyle özdeştir (bekçi `test_dort_puan_hesap` ölçer).
// Muayene yazımı, önizleme ve rapor bu dosyadan hesaplar — ikinci formül yazılmaz.
// =============================================================================
import { Prisma, type FourPointSize, type RuleScope, type RunningCap, type ScoreUnit } from "@prisma/client";

type Dec = Prisma.Decimal;
const D = (v: Prisma.Decimal.Value): Dec => new Prisma.Decimal(v);

export const FOUR_POINT_DEFAULTS: { unit: ScoreUnit; runningCap: RunningCap } = { unit: "M2", runningCap: "YARD" };

/** 1 yd² = 0,83612736 m² (tanım gereği tam). */
export const M2_PER_YD2 = D("0.83612736");
/** Koşu birimi (m): ASTM yardası 0,9144 m. */
export const RUNNING_UNIT_M: Record<Exclude<RunningCap, "NONE">, Dec> = { METER: D(1), YARD: D("0.9144") };
/** Tek hata ve tek koşu birimi en fazla 4 puan alır. */
export const MAX_POINTS = 4;

const SIZE_POINTS: Record<FourPointSize, number> = { UP_TO_3IN: 1, IN_3_TO_6: 2, IN_6_TO_9: 3, OVER_9IN: 4 };

/** Sabit puanlı türde puan türden gelir, boyut sorulmaz; aksi boyut sınıfından. Çözülemezse null. */
export function pointsFor(sizeClass: FourPointSize | null | undefined, fixedPoints: number | null | undefined): number | null {
  if (fixedPoints != null) return fixedPoints;
  return sizeClass ? SIZE_POINTS[sizeClass] : null;
}

export interface ScoredDefect {
  points: number;
  startMeter: Dec | null;
}

/**
 * Koşu tavanı: metreli hatalar `floor(m / birim)` kovasında kova başı ≤ 4 puan; metresizler
 * tavansız tam sayılır (konumu bilinmeyen hata kovaya konamaz — rapor dipnotu).
 */
export function applyRunningCap(defects: readonly ScoredDefect[], cap: RunningCap): number {
  if (cap === "NONE") return defects.reduce((s, d) => s + d.points, 0);
  const unit = RUNNING_UNIT_M[cap];
  const buckets = new Map<string, number>();
  let unplaced = 0;
  for (const d of defects) {
    if (d.startMeter == null) { unplaced += d.points; continue; }
    const key = d.startMeter.div(unit).floor().toFixed(0);
    buckets.set(key, (buckets.get(key) ?? 0) + d.points);
  }
  let total = unplaced;
  for (const v of buckets.values()) total += Math.min(v, MAX_POINTS);
  return total;
}

/** Tam hassasiyetli puan/100 m²; en ya da boy bilinmiyorsa null (derece önerilmez). */
export function scorePer100M2(totalPoints: number, widthCm: Dec | null | undefined, lengthM: Dec | null | undefined): Dec | null {
  if (widthCm == null || lengthM == null || widthCm.lte(0) || lengthM.lte(0)) return null;
  return D(totalPoints).mul(10000).div(widthCm.mul(lengthM));
}

/** 100 m² skorunu kural setinin birimine çevirir (yuvarlamasız). */
export function toUnit(scorePerM2: Dec, unit: ScoreUnit): Dec {
  return unit === "YD2" ? scorePerM2.mul(M2_PER_YD2) : scorePerM2;
}

/** Saklanan ve karar veren sayı: 2 hane, ROUND_HALF_UP (kâğıttaki sayı = kararın sayısı). */
export function round2(v: Dec): Dec {
  return v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export interface RuleBand {
  sortOrder: number;
  maxScore: Dec | null;
  label: string;
  accepted: boolean;
  qualityGradeId: string | null;
}

/** Kapsayıcı üst sınır (`score ≤ maxScore`); son bant `maxScore = null` her şeyi alır. */
export function resolveBand<B extends { sortOrder: number; maxScore: Dec | null }>(bands: readonly B[], scoreInUnit: Dec): B | null {
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  return sorted.find((b) => b.maxScore == null || scoreInUnit.lte(b.maxScore)) ?? null;
}

/** Bant seti doğrulaması — Türkçe hata listesi döner (boş = geçerli). */
export function validateBands(bands: readonly RuleBand[], scope: RuleScope): string[] {
  const errs: string[] = [];
  if (bands.length === 0) return ["En az bir bant tanımlanmalı."];
  const sorted = [...bands].sort((a, b) => a.sortOrder - b.sortOrder);
  if (new Set(sorted.map((b) => b.sortOrder)).size !== sorted.length) errs.push("Bant sıraları tekil olmalı.");
  const nulls = sorted.filter((b) => b.maxScore == null).length;
  if (nulls !== 1 || sorted[sorted.length - 1]!.maxScore != null) errs.push("Yalnız son bandın üst sınırı boş (tümü) olmalı.");
  let prev: Dec | null = null;
  for (const b of sorted) {
    if (b.maxScore == null) continue;
    if (b.maxScore.lt(0)) errs.push("Bant üst sınırı negatif olamaz.");
    if (prev != null && !b.maxScore.gt(prev)) { errs.push("Bant üst sınırları artan sırada olmalı."); break; }
    prev = b.maxScore;
  }
  for (const b of sorted) {
    if (!b.label.trim()) { errs.push("Bant etiketi boş olamaz."); break; }
  }
  if (scope === "FACTORY" && sorted.some((b) => !b.qualityGradeId)) errs.push("Fabrika setinde her bandın kalite derecesi seçilmeli.");
  if (scope === "CUSTOMER" && sorted.some((b) => b.qualityGradeId)) errs.push("Müşteri setinde bant kalite derecesine bağlanamaz.");
  return errs;
}

export interface FourPointResult {
  totalPoints: number;
  cappedPoints: number;
  unplaced: number;
  pointsPer100M2: Dec | null;
  gradeScore: Dec | null;
}

/** Muayene + önizlemenin ortak hesabı: tavan → skor → birim → 2 hane. */
export function computeFourPoint(
  defects: readonly ScoredDefect[],
  widthCm: Dec | null,
  lengthM: Dec,
  rule: { unit: ScoreUnit; runningCap: RunningCap },
): FourPointResult {
  const totalPoints = defects.reduce((s, d) => s + d.points, 0);
  const cappedPoints = applyRunningCap(defects, rule.runningCap);
  const raw = scorePer100M2(cappedPoints, widthCm, lengthM);
  return {
    totalPoints,
    cappedPoints,
    unplaced: defects.filter((d) => d.startMeter == null).length,
    pointsPer100M2: raw ? round2(raw) : null,
    gradeScore: raw ? round2(toUnit(raw, rule.unit)) : null,
  };
}
