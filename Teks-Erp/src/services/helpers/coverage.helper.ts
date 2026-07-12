// =============================================================================
// Sipariş kalemi kapsama (coverage) — GEVŞEK / HİBRİT MODEL
// =============================================================================
// Top→sipariş bağı yok; kumaş spec (ürün+renk+en) bazında fungible havuz. Bir sipariş
// kaleminin "kapsaması" = sevk EDİLEN (rezerv/çuvallanmış YOK — düşüş yalnız sevkte):
//   coverage(L) = shipped(L)   (OrderLine.shippedQty)
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
  /** Rezerv YOK (çuval depo modeli) — her zaman 0. Geriye uyum için tutulur. */
  reserved: Prisma.Decimal;
  /** = shipped (rezerv yok). */
  coverage: Prisma.Decimal;
}

const D0 = () => new Prisma.Decimal(0);

/**
 * Verilen sipariş satırları için kapsama (yalnız SEVK) döner. open = quantity − shipped.
 * Rezerv/çuvallanmış YOK (çuval depo modeli). WO bağı kapsamayı ETKİLEMEZ (gevşek model:
 * sipariş ancak sevkle kapanır, üretime/çuvallamaya girince değil).
 */
export async function computeLineCoverage(
  client: Client,
  lineIds: string[]
): Promise<Map<string, LineCoverage>> {
  const result = new Map<string, LineCoverage>();
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) return result;

  // Sevk — satır bazlı denormalize alan (DISPATCHED SackAllocation toplamı).
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

  // committed: ilk adıma girmiş ayrık topların initialQty toplamı (distinct rollId).
  // İki kaynak: A) ilk adıma RollMovement'ı olanlar (append-only kalıcı; consumed
  // olsa da sayılır) — mevcut davranış. B) currentStepId = ilk adım olanlar —
  // EXTERNAL (boyahane) ilk adımda attach anında movement YAZILMAZ (sevkte açılır),
  // bu top "eklendi ama sevk edilmedi" aralığında yalnız B ile yakalanır.
  // GUARD (currentStepId null VEYA bu WO'ya ait): top detach edilip başka WO'ya
  // bağlandıysa A'daki bayat movement bu WO'ya saydırmasın. Born roll (currentStepId
  // = sonraki adım) ve tambur çıktısı (ilk adıma movement'sız) doğal olarak hariç.
  const firstStepToWo = new Map<string, string>();
  for (const [woId, s] of firstStepByWo) firstStepToWo.set(s.id, woId);
  const firstStepIds = [...firstStepToWo.keys()];
  if (firstStepIds.length > 0) {
    const rollIdsByStep = new Map<string, Set<string>>();
    const allRollIds = new Set<string>();
    const addToStep = (stepId: string, rollId: string) => {
      allRollIds.add(rollId);
      let set = rollIdsByStep.get(stepId);
      if (!set) {
        set = new Set();
        rollIdsByStep.set(stepId, set);
      }
      set.add(rollId);
    };
    // A: ilk adıma hareketi olan toplar
    const moves = await client.rollMovement.findMany({
      where: { workOrderStepId: { in: firstStepIds } },
      select: { rollId: true, workOrderStepId: true },
    });
    for (const m of moves) {
      if (m.workOrderStepId) addToStep(m.workOrderStepId, m.rollId);
    }
    // B: currentStepId ilk adımı gösteren toplar (EXTERNAL attach→sevk penceresi)
    const bRolls = await client.roll.findMany({
      where: {
        currentStepId: { in: firstStepIds },
        status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
      },
      select: { id: true, currentStepId: true },
    });
    for (const r of bRolls) {
      if (r.currentStepId) addToStep(r.currentStepId, r.id);
    }
    if (allRollIds.size > 0) {
      const rolls = await client.roll.findMany({
        where: {
          id: { in: [...allRollIds] },
          status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
        },
        select: { id: true, initialQty: true, currentStepId: true },
      });
      const qtyByRoll = new Map<string, Prisma.Decimal>();
      const curStepByRoll = new Map<string, string | null>();
      for (const r of rolls) {
        qtyByRoll.set(r.id, new Prisma.Decimal(r.initialQty));
        curStepByRoll.set(r.id, r.currentStepId);
      }
      for (const [stepId, rollSet] of rollIdsByStep) {
        const woId = firstStepToWo.get(stepId);
        if (!woId) continue;
        let sum = committedByWo.get(woId) ?? D0();
        for (const rid of rollSet) {
          const q = qtyByRoll.get(rid);
          if (q == null) continue; // CANCELLED/STOCK elendi
          // GUARD: başka WO'nun adımına taşınan top (detach→reattach) sayılmaz.
          const cs = curStepByRoll.get(rid) ?? null;
          if (cs !== null && stepToWo.get(cs) !== woId) continue;
          sum = sum.plus(q);
        }
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
