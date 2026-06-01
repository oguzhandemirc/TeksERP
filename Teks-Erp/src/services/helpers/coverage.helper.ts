// =============================================================================
// Sipariş kalemi kapsama (coverage) — GEVŞEK / HİBRİT MODEL
// =============================================================================
// Top→sipariş bağı yok; kumaş spec (ürün+renk+en) bazında fungible havuz. Bir
// sipariş kaleminin "kapsaması" yalnız GERÇEKLEŞEN sevkten türetilir:
//   coverage(L) = shipped(L) = OrderLine.shippedQty  (= Σ ShipmentAllocation.qty)
//   open(L)     = quantity(L) − shipped(L)
//
// ESKİ pro-rata "plan rezervesi" KALDIRILDI. WorkOrderToOrderLine.allocatedQty
// payına göre bölmek "saçma ondalık" (…,3714) üretiyordu ve sipariş üretime
// girince "kapanıp" yeniden iş emrine bağlanamıyordu. Artık WO↔sipariş bağı
// yalnız "bu iş emri hangi siparişler için" niyetini taşır (Tambur bunu
// kullanır); metraj muhasebesi taşımaz. "Ne kadar üretmeliyim" sorusu
// spec-toplam dengesinden gelir → production-balance.service (Ürün Dengesi) +
// order.service.getCoverageForLines (kapsama paneli).
//
// Bu dosya iki şey sağlar:
//   1) computeLineCoverage — satır başına sevk (open = quantity − shipped)
//   2) computeWoMaterial   — WO başına committed/finished malzeme defteri
//      (Ürün Dengesi "üretimde" + kapsama paneli "in-flight" için tek kaynak)
// =============================================================================

import { Prisma, RollStatus } from "@prisma/client";

type Client = Prisma.TransactionClient | {
  orderLine: Prisma.TransactionClient["orderLine"];
  roll: Prisma.TransactionClient["roll"];
  rollMovement: Prisma.TransactionClient["rollMovement"];
  workOrderStep: Prisma.TransactionClient["workOrderStep"];
};

// Terminal çıktı statüleri — "bu metraj artık üretildi/karara bağlandı".
const FINISHED_OUTPUT: RollStatus[] = [
  RollStatus.WAREHOUSE,
  RollStatus.A1_STOCK,
  RollStatus.SHIPPED,
  RollStatus.SCRAP,
];

export interface LineCoverage {
  shipped: Prisma.Decimal;
  /** Geriye uyumluluk için 0 — pro-rata plan rezervesi kaldırıldı. */
  reserved: Prisma.Decimal;
  /** shipped + reserved (= shipped). */
  coverage: Prisma.Decimal;
}

const D0 = () => new Prisma.Decimal(0);

/**
 * Verilen sipariş satırları için kapsama (yalnız sevk) döner.
 * open = quantity − coverage = quantity − shipped. WO bağı kapsamayı ETKİLEMEZ
 * (gevşek model: sipariş ancak sevk edilince kapanır, üretime girince değil).
 */
export async function computeLineCoverage(
  client: Client,
  lineIds: string[]
): Promise<Map<string, LineCoverage>> {
  const result = new Map<string, LineCoverage>();
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) return result;

  // Sevk edilen — satır bazlı denormalize alan (ShipmentAllocation toplamı).
  const lineRows = await client.orderLine.findMany({
    where: { id: { in: ids } },
    select: { id: true, shippedQty: true },
  });
  for (const l of lineRows) {
    const shipped = new Prisma.Decimal(l.shippedQty);
    result.set(l.id, { shipped, reserved: D0(), coverage: shipped });
  }
  return result;
}

export interface WoMaterial {
  /** WO ilk adımına giren ham malzeme (initialQty toplamı, CANCELLED/STOCK hariç). */
  committed: Prisma.Decimal;
  /** WO adımlarında üretilip terminal çıktıya ulaşan metraj (currentQty toplamı). */
  finished: Prisma.Decimal;
}

/**
 * Verilen WO'lar için "üretime giren malzeme (committed)" ve "üretilen terminal
 * çıktı (finished)" defterini döner. committed RollMovement (append-only, ilk
 * adıma giriş) üzerinden — INTERNAL + EXTERNAL/boyahane ilk adımda çalışır;
 * top sonra fasona/tambura geçse, producedInStepId null kalsa bile sabit.
 * Hem kapsama paneli "in-flight" (order.service) hem Ürün Dengesi "üretimde"
 * hesabı (production-balance.service) bunu kullanır → tek kaynak.
 */
export async function computeWoMaterial(
  client: Client,
  woIds: string[]
): Promise<Map<string, WoMaterial>> {
  const out = new Map<string, WoMaterial>();
  const ids = [...new Set(woIds)];
  if (ids.length === 0) return out;

  const committedByWo = new Map<string, Prisma.Decimal>();
  const finishedByWo = new Map<string, Prisma.Decimal>();

  const steps = await client.workOrderStep.findMany({
    where: { workOrderId: { in: ids } },
    select: { id: true, workOrderId: true, stepSequence: true },
  });
  const stepToWo = new Map<string, string>();
  // WO başına ilk (en düşük stepSequence) adım — malzeme girişi buraya yazılır.
  const firstStepByWo = new Map<string, { id: string; seq: number }>();
  for (const s of steps) {
    stepToWo.set(s.id, s.workOrderId);
    const cur = firstStepByWo.get(s.workOrderId);
    if (!cur || s.stepSequence < cur.seq) {
      firstStepByWo.set(s.workOrderId, { id: s.id, seq: s.stepSequence });
    }
  }
  const stepIds = steps.map((s) => s.id);

  if (stepIds.length > 0) {
    // finished: producedInStepId ∈ W.steps ve status terminal çıktı.
    const finishedRows = await client.roll.groupBy({
      by: ["producedInStepId"],
      where: { producedInStepId: { in: stepIds }, status: { in: FINISHED_OUTPUT } },
      _sum: { currentQty: true },
    });
    for (const r of finishedRows) {
      if (!r.producedInStepId) continue;
      const woId = stepToWo.get(r.producedInStepId);
      if (!woId) continue;
      finishedByWo.set(woId, (finishedByWo.get(woId) ?? D0()).plus(r._sum.currentQty ?? 0));
    }
  }

  // committed: ilk adıma RollMovement ile giren ayrık topların initialQty toplamı.
  const firstStepToWo = new Map<string, string>();
  for (const [woId, s] of firstStepByWo) firstStepToWo.set(s.id, woId);
  const firstStepIds = [...firstStepToWo.keys()];
  if (firstStepIds.length > 0) {
    const moves = await client.rollMovement.findMany({
      where: { workOrderStepId: { in: firstStepIds } },
      select: { rollId: true, workOrderStepId: true },
    });
    const rollIdsByStep = new Map<string, Set<string>>();
    const allRollIds = new Set<string>();
    for (const m of moves) {
      if (!m.workOrderStepId) continue;
      allRollIds.add(m.rollId);
      let set = rollIdsByStep.get(m.workOrderStepId);
      if (!set) {
        set = new Set();
        rollIdsByStep.set(m.workOrderStepId, set);
      }
      set.add(m.rollId);
    }
    if (allRollIds.size > 0) {
      const rolls = await client.roll.findMany({
        where: {
          id: { in: [...allRollIds] },
          status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
        },
        select: { id: true, initialQty: true },
      });
      const qtyByRoll = new Map<string, Prisma.Decimal>();
      for (const r of rolls) qtyByRoll.set(r.id, new Prisma.Decimal(r.initialQty));
      for (const [stepId, rollSet] of rollIdsByStep) {
        const woId = firstStepToWo.get(stepId);
        if (!woId) continue;
        let sum = committedByWo.get(woId) ?? D0();
        for (const rid of rollSet) sum = sum.plus(qtyByRoll.get(rid) ?? 0);
        committedByWo.set(woId, sum);
      }
    }
  }

  for (const woId of ids) {
    out.set(woId, {
      committed: committedByWo.get(woId) ?? D0(),
      finished: finishedByWo.get(woId) ?? D0(),
    });
  }
  return out;
}
