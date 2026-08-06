// =============================================================================
// TEST: İŞ EMRİ İPTALİ — karar vererek (ham stok / fire / hatalı kayıt)
// Çalıştır: npx tsx scripts/test_wo_cancel_disposition.ts
// =============================================================================
//   A) LEGACY ÇAPA: gövdesiz `softDelete(id, userId)` → BUGÜNKÜ davranış birebir.
//      (Sahadaki eski mobil APK'lar bu yoldan geçer; kırılırsa iptal ekransız kalır.)
//   B) GEREKÇE: 3 karakterden kısa → 400, iş emri IN_PROGRESS kalır.
//   C) FİRE: SCRAP → status SCRAP, hareket `WO_CANCEL_SCRAP`, qtyOut = qtyIn.
//   D) HATALI KAYIT: CANCELLED → storno (qtyOut = 0) + iptal izi kolonları.
//   E) KARIŞIK: gönderilmeyen toplar toplu yoldan STOCK'a (not `WO_CANCELLED`) —
//      açıkça gönderilen STOCK satırı motora GİTMEZ (aynı karar = aynı satır).
//   F) BAYAT KAPSAM: işlemde olmayan top için karar → 400 + tam rollback.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";

const svc = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
async function expectThrow(
  label: string,
  fn: () => Promise<unknown>,
  msgPart?: string,
): Promise<void> {
  let err: string | null = null;
  try {
    await fn();
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

let ITEM = "";
let ADMIN = "";
let ST_KURSUN = "";
let ST_TAMBUR = "";
const WIDTH = 250;
const woIds: string[] = [];
const rollIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  return `TST-CNC-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`;
}

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(
    await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }),
    "Item PATOS",
  );
  ADMIN = need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin",
  );
  ST_KURSUN = need(
    await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }),
    "KURSUN_KK2",
  );
  ST_TAMBUR = need(
    await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }),
    "TAMBUR_1",
  );
}

async function makeWo(): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-CNC-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      width: WIDTH,
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_KURSUN, stepSequence: 1, status: "PENDING" as const },
          { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" as const },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

/**
 * WO'ya bağlı top. `cut` verilirse `currentQty` düşürülür — Tambur kesimini taklit
 * eder ve `qtyIn` ile `currentQty`yi AYIRIR. Bu ayrım load-bearing: iki formül
 * (`qtyIn` vs `currentQty`) ancak böyle bir topta birbirinden ayırt edilebilir.
 */
async function attachedRoll(woId: string, qty: number, cut?: number): Promise<string> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code,
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      width: WIDTH,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  await svc.attachRolls(woId, [code], ADMIN);
  if (cut !== undefined) {
    await prisma.roll.update({ where: { id: r.id }, data: { currentQty: cut } });
  }
  return r.id;
}

async function movementOf(rollId: string) {
  return prisma.rollMovement.findFirst({
    where: { rollId },
    orderBy: { enteredAt: "desc" },
    select: { qtyIn: true, qtyOut: true, weightOut: true, notes: true, exitedAt: true },
  });
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === A) LEGACY ÇAPA ===
    console.log("\n=== A) Gövdesiz iptal (eski mobil APK yolu) BUGÜNKÜ davranışı korur ===");
    {
      const { woId, stepIds } = await makeWo();
      const r1 = await attachedRoll(woId, 800, 700); // kesik: qtyIn 800, currentQty 700
      await svc.softDelete(woId, ADMIN); // ⚠️ ÜÇÜNCÜ ARGÜMAN YOK

      const wo = await prisma.workOrder.findUnique({
        where: { id: woId },
        select: { status: true },
      });
      const roll = await prisma.roll.findUnique({
        where: { id: r1 },
        select: { status: true, currentStepId: true, cancelReason: true, cancelledAt: true },
      });
      const mv = await movementOf(r1);
      const steps = await prisma.workOrderStep.findMany({
        where: { id: { in: stepIds } },
        select: { status: true, skipReason: true },
      });

      check("WO CANCELLED", wo?.status === WorkOrderStatus.CANCELLED, String(wo?.status));
      check("top STOCK'a döndü", roll?.status === RollStatus.STOCK, String(roll?.status));
      check("currentStepId temizlendi", roll?.currentStepId === null);
      check("iptal izi YAZILMADI (gerekçe yok)", roll?.cancelReason === null && roll?.cancelledAt === null);
      check("hareket WO_CANCELLED notuyla kapandı", mv?.notes === "WO_CANCELLED", String(mv?.notes));
      check(
        "qtyOut = currentQty (toplu süpürme formülü)",
        Number(mv?.qtyOut) === 700,
        `qtyIn=${mv?.qtyIn} qtyOut=${mv?.qtyOut}`,
      );
      check(
        "adımlar SKIPPED(WO_CANCELLED)",
        steps.every((s) => s.status === StepStatus.SKIPPED && s.skipReason === "WO_CANCELLED"),
      );
      const card = await prisma.travelerCard.findFirst({
        where: { workOrderId: woId },
        select: { status: true },
      });
      check("refakat kartı VOIDED", card?.status === "VOIDED", String(card?.status));
    }

    // === B) GEREKÇE ZORUNLU ===
    console.log("\n=== B) Karar varsa gerekçe zorunlu ===");
    {
      const { woId } = await makeWo();
      const r1 = await attachedRoll(woId, 500);
      await expectThrow(
        "3 karakterden kısa gerekçe → 400",
        () => svc.softDelete(woId, ADMIN, { reason: "ab", dispositions: [{ rollId: r1, action: "SCRAP" }] }),
        "en az 3 karakter",
      );
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("iş emri IN_PROGRESS kaldı", wo?.status === WorkOrderStatus.IN_PROGRESS);
    }

    // === C) FİRE ===
    console.log("\n=== C) Fire (SCRAP) — mal vardı, istasyondan GEÇTİ ===");
    {
      const { woId } = await makeWo();
      const r1 = await attachedRoll(woId, 800, 700);
      await svc.softDelete(woId, ADMIN, {
        reason: "Yanıklı parti, fire yazıldı",
        dispositions: [{ rollId: r1, action: "SCRAP" }],
      });
      const roll = await prisma.roll.findUnique({
        where: { id: r1 },
        select: { status: true, currentStepId: true, batchId: true, cancelledAt: true },
      });
      const mv = await movementOf(r1);
      check("top SCRAP", roll?.status === RollStatus.SCRAP, String(roll?.status));
      check("parti üyeliği KORUNDU", roll?.batchId !== null);
      check("iptal izi yazılmadı (fire ≠ iptal)", roll?.cancelledAt === null);
      check(
        "hareket WO_CANCEL_SCRAP + gerekçe",
        (mv?.notes ?? "").startsWith("WO_CANCEL_SCRAP: Yanıklı"),
        String(mv?.notes),
      );
      check(
        "qtyOut = qtyIn (hayalet kayıp yok)",
        Number(mv?.qtyOut) === 800,
        `qtyIn=${mv?.qtyIn} qtyOut=${mv?.qtyOut}`,
      );
    }

    // === D) HATALI KAYIT (STORNO) ===
    console.log("\n=== D) Hatalı kayıt (CANCELLED) — mal HİÇ geçmedi ===");
    {
      const { woId } = await makeWo();
      const r1 = await attachedRoll(woId, 800, 700);
      await svc.softDelete(woId, ADMIN, {
        reason: "Mükerrer kayıt, top hiç yoktu",
        dispositions: [{ rollId: r1, action: "CANCELLED" }],
      });
      const roll = await prisma.roll.findUnique({
        where: { id: r1 },
        select: {
          status: true,
          cancelledAt: true,
          cancelledById: true,
          cancelReason: true,
          preCancelStatus: true,
          batchId: true,
        },
      });
      const mv = await movementOf(r1);
      check("top CANCELLED", roll?.status === RollStatus.CANCELLED, String(roll?.status));
      check("cancelledAt yazıldı", roll?.cancelledAt !== null);
      check("cancelledById yazıldı", roll?.cancelledById === ADMIN);
      check("cancelReason gerekçeyi taşıyor", roll?.cancelReason === "Mükerrer kayıt, top hiç yoktu");
      check(
        "preCancelStatus = IN_PRODUCTION (geri almanın döneceği raf)",
        roll?.preCancelStatus === RollStatus.IN_PRODUCTION,
        String(roll?.preCancelStatus),
      );
      check("parti üyeliği KORUNDU (iz)", roll?.batchId !== null);
      check(
        "STORNO: qtyOut = 0",
        Number(mv?.qtyOut) === 0,
        `qtyIn=${mv?.qtyIn} qtyOut=${mv?.qtyOut}`,
      );
      check("STORNO: weightOut = 0", Number(mv?.weightOut ?? 0) === 0);
      check(
        "hareket WO_CANCEL_CANCELLED + gerekçe",
        (mv?.notes ?? "").startsWith("WO_CANCEL_CANCELLED: Mükerrer"),
        String(mv?.notes),
      );
    }

    // === E) KARIŞIK ===
    console.log("\n=== E) Karışık: gönderilmeyen VE açıkça STOCK gönderilen toplar ===");
    {
      const { woId } = await makeWo();
      const rStockImplicit = await attachedRoll(woId, 400, 350);
      const rStockExplicit = await attachedRoll(woId, 400, 350);
      const rScrap = await attachedRoll(woId, 400, 350);
      await svc.softDelete(woId, ADMIN, {
        reason: "Sipariş iptal oldu",
        dispositions: [
          // ⚠️ Açıkça STOCK gönderilen satır motora GİTMEMELİ — aksi halde aynı
          //    karar, istemci satırı gönderdi mi göndermedi mi diye farklı hareket
          //    üretirdi (sessiz, kalıcı, raporlanamaz).
          { rollId: rStockExplicit, action: "STOCK" },
          { rollId: rScrap, action: "SCRAP" },
        ],
      });
      const a = await prisma.roll.findUnique({ where: { id: rStockImplicit }, select: { status: true } });
      const b = await prisma.roll.findUnique({ where: { id: rStockExplicit }, select: { status: true } });
      const c = await prisma.roll.findUnique({ where: { id: rScrap }, select: { status: true } });
      const mvA = await movementOf(rStockImplicit);
      const mvB = await movementOf(rStockExplicit);
      const mvC = await movementOf(rScrap);

      check("gönderilmeyen top STOCK", a?.status === RollStatus.STOCK, String(a?.status));
      check("açıkça STOCK gönderilen de STOCK", b?.status === RollStatus.STOCK, String(b?.status));
      check("fire topu SCRAP", c?.status === RollStatus.SCRAP, String(c?.status));
      check("gönderilmeyen → WO_CANCELLED notu", mvA?.notes === "WO_CANCELLED", String(mvA?.notes));
      check(
        "açıkça STOCK gönderilen de AYNI notu alır (motora gitmedi)",
        mvB?.notes === "WO_CANCELLED",
        String(mvB?.notes),
      );
      check(
        "iki STOCK topu AYNI qtyOut formülünü kullandı",
        Number(mvA?.qtyOut) === Number(mvB?.qtyOut) && Number(mvA?.qtyOut) === 350,
        `${mvA?.qtyOut} / ${mvB?.qtyOut}`,
      );
      check("fire topu ayrı not aldı", (mvC?.notes ?? "").startsWith("WO_CANCEL_SCRAP:"));
    }

    // === F) BAYAT KAPSAM ===
    console.log("\n=== F) Bayat liste: işlemde olmayan top için karar → 400 + rollback ===");
    {
      const { woId } = await makeWo();
      const inFlight = await attachedRoll(woId, 300);
      // Bu top BAŞKA bir WO'da — bu iş emrinin işlemdeki kümesinde değil.
      const other = await makeWo();
      const foreign = await attachedRoll(other.woId, 300);

      await expectThrow(
        "yabancı top için karar → 400",
        () =>
          svc.softDelete(woId, ADMIN, {
            reason: "Sipariş iptal oldu",
            dispositions: [{ rollId: foreign, action: "SCRAP" }],
          }),
        "artık işlemde değil",
      );
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      const roll = await prisma.roll.findUnique({
        where: { id: inFlight },
        select: { status: true },
      });
      check("iş emri IN_PROGRESS kaldı (tam rollback)", wo?.status === WorkOrderStatus.IN_PROGRESS);
      check("işlemdeki top dokunulmadı", roll?.status === RollStatus.IN_PRODUCTION);
      const foreignRoll = await prisma.roll.findUnique({
        where: { id: foreign },
        select: { status: true },
      });
      check("yabancı top da dokunulmadı", foreignRoll?.status === RollStatus.IN_PRODUCTION);
    }
  } finally {
    // Cleanup — test kendi yarattığını siler.
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { batchId: null } });
    await prisma.travelerCardScan.deleteMany({
      where: { card: { workOrderId: { in: woIds } } },
    });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
