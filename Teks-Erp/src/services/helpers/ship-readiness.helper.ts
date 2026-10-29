// =============================================================================
// SEVKE HAZIRLIK — TEK YÜKLEM (D4-J1; DALGA4 §11.5, 1e kararları K25–K26)
// =============================================================================
// "Bu iş sevke hazır mı" sorusunun TEK cevabı. Hazırlık SAKLANMAZ, toplardan türetilir:
// WAREHOUSE'a yazan 10+ yol ve geri düşüren yollar var; saklanan kolon sessiz sapardı (K25).
//   · Top sınıfı: `readinessClassOf` (bellek) ↔ `readinessClassSql` (SQL) — BOĞAZ-İKİZ, aynı kümelerden.
//   · Birim durumu: `classifyShipReadiness` (READY · PARTIAL · NONE), kural `effectiveShipReadyPolicy`den.
// İkinci bir hazırlık yüklemi yazılmaz; `test_sevke_hazir` §AST bölümü korur.
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { K18_DEAD_STATUSES } from "../batch.service";
import { READY_STATUSES } from "../roll-owner.service";
import { readShippingReadyRule, readShippingReadyTolerancePct, type ShipReadyRule } from "../system-setting.service";

/** HAZIR — Bitmiş Depo kümesi (P1a `READY_STATUSES` tek kaynak); çuvalda / PLANNED sevkte de hazırdır (statü değişmez). */
export const SHIP_READY_READY_STATUSES: readonly RollStatus[] = READY_STATUSES;
/** İŞLEMDE — henüz bitmemiş, beklenen top. */
export const SHIP_READY_IN_PROCESS_STATUSES: readonly RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.IN_PRODUCTION,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.AT_KARTELA,
];
/** GİTTİ — sevk edildi; birim tamamen GİTTİ ise listeden düşer. */
export const SHIP_READY_GONE_STATUSES: readonly RollStatus[] = [RollStatus.SHIPPED];
/** FİRE — paydadan (hedef metreden) düşer. */
export const SHIP_READY_SCRAP_STATUSES: readonly RollStatus[] = [RollStatus.SCRAP];
/**
 * CANLI KÜME DIŞI — metrajı başka topa geçmiş ya da kayıt geri alınmış: K18 ölü kümesi (tüketildi/iptal)
 * + fason dönüşünde kapanmış eski barkod (RETURNED_FROM_SUBCONTRACTOR; P1a `NOT_INSIDE_STATUSES` ile aynı).
 */
export const SHIP_READY_OUT_OF_SET_STATUSES: readonly RollStatus[] = [
  ...K18_DEAD_STATUSES,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

export type ReadinessClass = "READY" | "IN_PROCESS" | "GONE" | "SCRAP";
export type ShipReadyState = "READY" | "PARTIAL" | "NONE";
export const SHIP_READY_STATES: readonly ShipReadyState[] = ["READY", "PARTIAL", "NONE"];

const CLASS_TABLE: ReadonlyArray<[ReadinessClass, readonly RollStatus[]]> = [
  ["READY", SHIP_READY_READY_STATUSES],
  ["IN_PROCESS", SHIP_READY_IN_PROCESS_STATUSES],
  ["GONE", SHIP_READY_GONE_STATUSES],
  ["SCRAP", SHIP_READY_SCRAP_STATUSES],
];

/** Topun hazırlık sınıfı; canlı küme dışıysa null. SQL ikizi `readinessClassSql`. */
export function readinessClassOf(status: RollStatus): ReadinessClass | null {
  for (const [cls, statuses] of CLASS_TABLE) if (statuses.includes(status)) return cls;
  return null;
}

/** `readinessClassOf`un SQL ikizi — `<alias>.status`tan sınıf metni (canlı küme dışı → NULL). */
export function readinessClassSql(alias: string): Prisma.Sql {
  const col = Prisma.raw(`${alias}.status::text`);
  const whens = CLASS_TABLE.map(([cls, statuses]) => Prisma.sql`WHEN ${col} IN (${Prisma.join(statuses.map((s) => s as string))}) THEN ${cls}`);
  return Prisma.sql`(CASE ${Prisma.join(whens, " ")} ELSE NULL END)`;
}

export interface ShipReadyPolicy {
  rule: ShipReadyRule;
  tolerancePct: number;
}

/** Kural + tolerans — `shipping.ready.*` ayarlarının TEK okuyucusu (tüketici okuyucuları doğrudan çağırmaz). */
export async function effectiveShipReadyPolicy(tx?: Pick<typeof prisma, "systemSetting">): Promise<ShipReadyPolicy> {
  const rule = await readShippingReadyRule(tx);
  return { rule, tolerancePct: rule === "METER_THRESHOLD" ? await readShippingReadyTolerancePct(tx) : 0 };
}

export interface ReadinessTotals {
  readyCount: number;
  readyMeters: Prisma.Decimal;
  inProcessCount: number;
  inProcessMeters: Prisma.Decimal;
  shippedMeters: Prisma.Decimal;
  scrapMeters: Prisma.Decimal;
  /** İE `targetQuantity` ya da belge Σ satır metresi; yoksa null (METER_THRESHOLD → ALL_DONE'a düşer). */
  targetMeters: Prisma.Decimal | null;
}

export interface ReadinessVerdict {
  state: ShipReadyState;
  /** Fiilen uygulanan kural — METER_THRESHOLD seçili ama hedef yoksa ALL_DONE (K26: sessiz geçiş yok). */
  appliedRule: ShipReadyRule;
  /** Birim listede görünür mü: canlı (HAZIR ∪ İŞLEMDE) top yoksa — tamamı GİTTİ/FİRE — düşer. */
  visible: boolean;
}

/**
 * Birimin sevke hazırlığı.
 *  · ALL_DONE: İŞLEMDE = 0 ∧ HAZIR > 0 → READY; HAZIR > 0 → PARTIAL; HAZIR = 0 → NONE.
 *  · METER_THRESHOLD: (HAZIR m + GİTTİ m) ≥ (hedef − FİRE m) × (1 − tol/100) ∧ HAZIR > 0 → READY; ayrıca ALL_DONE
 *    koşulu da READY verir (işlemde top kalmadıysa beklenecek metre yok). Hedef yok/0 → ALL_DONE.
 */
export function classifyShipReadiness(t: ReadinessTotals, policy: ShipReadyPolicy): ReadinessVerdict {
  const visible = t.readyCount + t.inProcessCount > 0;
  const hasTarget = t.targetMeters !== null && t.targetMeters.gt(0);
  const appliedRule: ShipReadyRule = policy.rule === "METER_THRESHOLD" && hasTarget ? "METER_THRESHOLD" : "ALL_DONE";
  if (t.readyCount === 0) return { state: "NONE", appliedRule, visible };
  if (t.inProcessCount === 0) return { state: "READY", appliedRule, visible };
  if (appliedRule === "METER_THRESHOLD") {
    const base = Prisma.Decimal.max(t.targetMeters!.minus(t.scrapMeters), 0);
    const threshold = base.times(new Prisma.Decimal(100).minus(policy.tolerancePct)).div(100);
    if (t.readyMeters.plus(t.shippedMeters).gte(threshold)) return { state: "READY", appliedRule, visible };
  }
  return { state: "PARTIAL", appliedRule, visible };
}
