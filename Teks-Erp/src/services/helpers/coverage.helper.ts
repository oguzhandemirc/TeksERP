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
import { ACTIVE_MOVEMENT } from "./roll-movement.helper";

type Client = Prisma.TransactionClient | {
  orderLine: Prisma.TransactionClient["orderLine"];
  roll: Prisma.TransactionClient["roll"];
  rollMovement: Prisma.TransactionClient["rollMovement"];
  workOrderStep: Prisma.TransactionClient["workOrderStep"];
  subcontractorReceipt: Prisma.TransactionClient["subcontractorReceipt"];
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

  const finishedByWo = new Map<string, Prisma.Decimal>();

  const steps = await client.workOrderStep.findMany({
    where: { workOrderId: { in: ids } },
    select: { id: true, workOrderId: true },
  });
  const stepToWo = new Map<string, string>();
  for (const s of steps) stepToWo.set(s.id, s.workOrderId);
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

  // committed (üretime giren ham malzeme) — SPLIT (tebdil) WO dahil doğru hesap
  // computeWoInput'ta. Eski "yalnız ilk adım" çapası split WO'yu 0 sayıyordu
  // (toplar reEntry adımında doğar, seq1'e hiç girmez). Girdi-kökü tanımı hem
  // normal hem split WO için tek kaynak → liste/detay/committed birbirinden sapamaz.
  const inputByWo = await computeWoInput(client, ids);

  for (const woId of ids) {
    out.set(woId, {
      committed: inputByWo.get(woId)?.meters ?? D0(),
      finished: finishedByWo.get(woId) ?? D0(),
    });
  }
  return out;
}

export interface WoInput {
  /** Üretime giren KÖK top sayısı (charge-split çocukları sayılmaz). */
  count: number;
  /** Üretime giren toplam metraj (kök initialQty + fasondan-sevk charge-split çocuğu). */
  meters: Prisma.Decimal;
}

/**
 * WO başına "üretime giren" (committed) girdi defteri — NORMAL ve SPLIT (tebdil
 * ile doğmuş) iş emirleri için DOĞRU. Eski "yalnız İLK adım (steps[0])" çapası
 * split WO'yu 0 sayıyordu: split toplar reEntry adımında (boyahane/seq2) doğar,
 * seq1'e hiç girmez. Tanım:
 *
 *   Üye(W)  = W'nin HERHANGİ adımına movement'ı olan VEYA currentStepId'si ∈ W
 *             (detach guard: currentStepId null ∨ ∈ W; status ∉ CANCELLED/STOCK).
 *   Kök(W)  = W dışından gelmiş üye:
 *               • parentRollId bir ÜYE DEĞİL   (Tambur/fasondan-sevk çocuğu değil)
 *               • parentReceiptId'nin makbuzu W'ye AİT DEĞİL (W-içi fason-dönüş
 *                 yeniden-doğumu değil — o, zaten sayılan orijinalin rebirth'ü).
 *   meters  = Σ Kök.initialQty
 *           + Σ fasondan-sevk charge-split çocuğu.initialQty (parent kısmi sevkte
 *             decrement edilir, çocuk shipQty taşır → orijinal charge korunur;
 *             SAYIMda çocuk elenir, yalnız kök sayılır).
 *
 * Normal WO'da sonuç ESKİSİYLE AYNI (tek KK1/supplier kökü; fason-dönüş ve Tambur
 * çocuğu W-içi → elenir). Split WO'da enjekte kök (parentReceipt kaynak WO'ya
 * işaret eder, currentStep/movement yeni WO'ya repoint edilmiştir) artık sayılır.
 * Liste + detay inputRolls + computeWoMaterial.committed hepsi buna dayanır.
 */
export async function computeWoInput(
  client: Client,
  woIds: string[]
): Promise<Map<string, WoInput>> {
  const out = new Map<string, WoInput>();
  const ids = [...new Set(woIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { count: 0, meters: D0() });

  const steps = await client.workOrderStep.findMany({
    where: { workOrderId: { in: ids } },
    select: { id: true, workOrderId: true },
  });
  if (steps.length === 0) return out;
  const stepToWo = new Map<string, string>();
  const woSteps = new Map<string, Set<string>>();
  for (const s of steps) {
    stepToWo.set(s.id, s.workOrderId);
    let set = woSteps.get(s.workOrderId);
    if (!set) {
      set = new Set();
      woSteps.set(s.workOrderId, set);
    }
    set.add(s.id);
  }
  const stepIds = steps.map((s) => s.id);

  // A: bu WO'ların HERHANGİ adımına movement'ı olan toplar → rollId ⇒ {woId}
  const moves = await client.rollMovement.findMany({
    where: { workOrderStepId: { in: stepIds }, ...ACTIVE_MOVEMENT },
    select: { rollId: true, workOrderStepId: true },
    distinct: ["rollId", "workOrderStepId"],
  });
  const rollMoveWos = new Map<string, Set<string>>();
  const candidateIds = new Set<string>();
  for (const m of moves) {
    if (!m.workOrderStepId) continue;
    const wo = stepToWo.get(m.workOrderStepId);
    if (!wo) continue;
    candidateIds.add(m.rollId);
    let set = rollMoveWos.get(m.rollId);
    if (!set) {
      set = new Set();
      rollMoveWos.set(m.rollId, set);
    }
    set.add(wo);
  }
  // B: currentStepId ∈ adımlar (EXTERNAL attach→sevk penceresi; movement'sız)
  const bRolls = await client.roll.findMany({
    where: { currentStepId: { in: stepIds }, status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] } },
    select: { id: true },
  });
  for (const r of bRolls) candidateIds.add(r.id);
  if (candidateIds.size === 0) return out;

  const rolls = await client.roll.findMany({
    where: { id: { in: [...candidateIds] }, status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] } },
    select: {
      id: true,
      initialQty: true,
      currentStepId: true,
      parentRollId: true,
      parentReceiptId: true,
      directShipmentId: true,
    },
  });

  // parentReceiptId → makbuzun WO'su (W-içi fason-dönüş ayrımı için)
  const receiptIds = [
    ...new Set(rolls.map((r) => r.parentReceiptId).filter((x): x is string => Boolean(x))),
  ];
  const receiptWo = new Map<string, string>();
  if (receiptIds.length > 0) {
    const recs = await client.subcontractorReceipt.findMany({
      where: { id: { in: receiptIds } },
      select: { id: true, workOrderId: true },
    });
    // Dokuma işi makbuzunun WO'su yok — o toplar W-içi fason-dönüş ayrımına girmez.
    for (const rec of recs) if (rec.workOrderId) receiptWo.set(rec.id, rec.workOrderId);
  }

  const isMember = (r: (typeof rolls)[number], wo: string): boolean => {
    const cs = r.currentStepId;
    // detach guard: currentStepId başka WO'yu gösteriyorsa üye değil
    if (cs !== null && stepToWo.get(cs) !== wo) return false;
    // üyelik: currentStepId ∈ W  VEYA  W adımında movement
    if (cs !== null && woSteps.get(wo)?.has(cs)) return true;
    return rollMoveWos.get(r.id)?.has(wo) ?? false;
  };

  for (const wo of ids) {
    const members = rolls.filter((r) => isMember(r, wo));
    const memberIds = new Set(members.map((r) => r.id));
    let count = 0;
    let meters = D0();
    for (const r of members) {
      const parentIsMember = r.parentRollId != null && memberIds.has(r.parentRollId);
      const receiptInThisWo = r.parentReceiptId != null && receiptWo.get(r.parentReceiptId) === wo;
      if (!parentIsMember && !receiptInThisWo) {
        // GİRDİ KÖKÜ (W dışından geldi)
        count += 1;
        meters = meters.plus(r.initialQty);
      }
      // ⚠️ Fasondan-sevk charge-split çocuğu İÇİN AYRI DAL YOK: ebeveynin
      // `initialQty`si artık düşürülmüyor (giriş snapshot'ı dokunulmazdır),
      // yani charge zaten kökte tam duruyor — çocuğu eklemek çift sayardı.
    }
    out.set(wo, { count, meters });
  }
  return out;
}
