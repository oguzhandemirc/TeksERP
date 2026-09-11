// =============================================================================
// Test: KALAN KAPAMASI GERİ ALMA KAPISI (reopenRemainder)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_fason_reopen_remainder_guard
// =============================================================================
// Geri alma yolu topu `SUBCONTRACTOR_CONSUMED` → `AT_SUBCONTRACTOR` çeker ve
// `stepId` İSTEK GÖVDESİNDEN gelir. Kapı yalnız topun DURUMUNA bakarsa (eski
// hali) şunlar da "geri alınabilir" olur ve sistemde olmayan mal fasonda
// bekliyor görünür:
//   • TAM KABULLE tüketilmiş top (kapama kararı hiç verilmemiş),
//   • fasondan doğrudan MÜŞTERİYE sevk edilmiş top (mal fabrikada değil),
//   • başka bir adımın stepId'si (top o adıma hiç uğramamış olabilir).
// Kapı bu yüzden topun GEÇMİŞİNDEN kurulur: bu adımda o topun `remainderClosedAt`
// damgalı sevk kalemi VAR MI? Damga aynı zamanda atomik claim'dir (iki eşzamanlı
// geri almadan biri 409 alır).
// =============================================================================
import { RollStatus } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { OPEN_OUTSTANDING } from "../src/services/helpers/fason-open-dispatch.helper";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { VARIANCE_SOURCES } from "../src/constants/variance-reasons";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const TAG = `TEST-RRG-${`${Date.now()}`.slice(-7)}`;
const ctx = { item: "", admin: "", stBoya: "", stKursun: "", sub: "", customer: "" };
const ids = { wos: [] as string[], dispatches: [] as string[] };
let bc = 0;

/** Servis hatasının 409 + `details.code` kimliği — mesaj metnine yaslanmaz. */
function hataKimligi(e: unknown): { status: number | null; code: string | null; message: string } {
  const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
  return {
    status: typeof err?.statusCode === "number" ? err.statusCode : null,
    code: typeof err?.details?.code === "string" ? err.details.code : null,
    message: typeof err?.message === "string" ? err.message : String(e),
  };
}

async function reopenHatasi(stepId: string, rollId: string): Promise<{ status: number | null; code: string | null; message: string } | null> {
  try {
    await sub.reopenRemainder({ stepId, rollId }, ctx.admin);
    return null;
  } catch (e) {
    return hataKimligi(e);
  }
}

async function kurSevk(qtys: number[]): Promise<{ woId: string; stepId: string; kursunStepId: string; dispatchId: string; rollIds: string[] }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-WO${ids.wos.length}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ctx.item,
      steps: { create: [{ stationId: ctx.stBoya, stepSequence: 1, status: "PENDING" }, { stationId: ctx.stKursun, stepSequence: 2, status: "PENDING" }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  ids.wos.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ctx.admin));
  const rollIds: string[] = [];
  for (const q of qtys) {
    bc++;
    const r = await prisma.roll.create({
      data: { barcode: `TST-RRG-${`${Date.now()}`.slice(-7)}${bc}`, itemId: ctx.item, initialQty: q, currentQty: q, status: RollStatus.STOCK, width: 250, createdById: ctx.admin },
      select: { id: true },
    });
    rollIds.push(r.id);
  }
  const stepId = wo.steps[0]!.id;
  const d = await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: ctx.sub, rollIds }, ctx.admin);
  const dispatchId = (d.data as { id: string }).id;
  ids.dispatches.push(dispatchId);
  return { woId: wo.id, stepId, kursunStepId: wo.steps[1]!.id, dispatchId, rollIds };
}

const durum = async (rollId: string): Promise<{ status: RollStatus; stepId: string | null; dsId: string | null }> => {
  const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, currentStepId: true, directShipmentId: true } });
  return { status: r!.status, stepId: r!.currentStepId, dsId: r!.directShipmentId };
};

async function main(): Promise<void> {
  console.log("\n=== Kalan kapaması geri alma kapısı ===\n");
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} — önce 'npm run seed:fixtures'`);
    return v.id;
  };
  ctx.item = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  ctx.admin = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ctx.stBoya = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ctx.stKursun = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ctx.customer = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
  ctx.sub = (await ensureTestDyeHouse()).id;

  // ── G1) MEŞRU GERİ ALMA — korunan davranış ───────────────────────────────
  console.log("── G1) Kapama yapılmış top geri alınabilir (korunan davranış) ──");
  {
    const z = await kurSevk([100]);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G1a: geri alma çalışır (hata yok)", hata === null, hata?.message ?? "");
    const d = await durum(z.rollIds[0]!);
    check("G1b: top yeniden fasonda ve adımda", d.status === RollStatus.AT_SUBCONTRACTOR && d.stepId === z.stepId, `${d.status}`);
    const kalem = await prisma.subcontractorDispatchItem.findFirst({ where: { dispatchId: z.dispatchId }, select: { remainderClosedAt: true } });
    check("G1c: kapama damgası kalktı", kalem?.remainderClosedAt === null);
    const sapma = await prisma.rollVariance.findMany({ where: { rollId: z.rollIds[0]!, source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER }, select: { reversedAt: true } });
    check("G1d: fire satırı silinmedi, terslendi", sapma.length > 0 && sapma.every((v) => v.reversedAt !== null), `${sapma.length} satır`);
    check("G1e: sevk yeniden OPEN_OUTSTANDING", (await prisma.subcontractorDispatch.count({ where: { id: z.dispatchId, ...OPEN_OUTSTANDING } })) === 1);

    const ikinci = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G1f: ikinci geri alma 409 (kapama zaten kalkmış)", ikinci?.status === 409, `${ikinci?.status} ${ikinci?.code ?? ""}`);
  }

  // ── G2) DOĞRUDAN MÜŞTERİYE SEVK EDİLMİŞ TOP ──────────────────────────────
  console.log("\n── G2) Müşteriye giden top fasona diriltilemez ──");
  {
    const z = await kurSevk([200, 200]);
    await sub.executeDirectShip({ dispatchId: z.dispatchId, reason: "kapı bekçisi alt küme", customerId: ctx.customer, rollIds: [z.rollIds[0]!] }, ctx.admin);
    const oncesi = await durum(z.rollIds[0]!);
    check("G2a ön koşul: top tüketildi ve DSK'ya bağlandı", oncesi.status === RollStatus.SUBCONTRACTOR_CONSUMED && oncesi.dsId !== null);
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G2b: 409 ROLL_DIRECT_SHIPPED (eski kapı topu fasona geri alırdı)",
      hata?.status === 409 && hata.code === "ROLL_DIRECT_SHIPPED", `${hata?.status} ${hata?.code ?? ""}`);
    const sonrasi = await durum(z.rollIds[0]!);
    check("G2c: top değişmedi", sonrasi.status === RollStatus.SUBCONTRACTOR_CONSUMED && sonrasi.stepId === null && sonrasi.dsId !== null, `${sonrasi.status}`);
  }

  // ── G3) TAM KABULLE TÜKETİLMİŞ TOP ───────────────────────────────────────
  console.log("\n── G3) Kabul edilmiş top 'kapama geri alma' ile diriltilemez ──");
  {
    const z = await kurSevk([150]);
    await sub.receive({ workOrderId: z.woId, stepId: z.stepId, subcontractorId: ctx.sub, returns: [{ rollId: z.rollIds[0]! }], newRolls: [{ qty: 150 }] }, ctx.admin);
    const oncesi = await durum(z.rollIds[0]!);
    check("G3a ön koşul: kaynak top tam kabulle tüketildi", oncesi.status === RollStatus.SUBCONTRACTOR_CONSUMED);
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G3b: 409 REMAINDER_NOT_CLOSED (kapama kararı hiç verilmemiş)",
      hata?.status === 409 && hata.code === "REMAINDER_NOT_CLOSED", `${hata?.status} ${hata?.code ?? ""}`);
    const sonrasi = await durum(z.rollIds[0]!);
    check("G3c: top tüketilmiş kaldı", sonrasi.status === RollStatus.SUBCONTRACTOR_CONSUMED && sonrasi.stepId === null);
  }

  // ── G4) GÖVDEDEN GELEN YANLIŞ ADIM ───────────────────────────────────────
  console.log("\n── G4) Kapama başka adımda: gövdedeki stepId kanıt değildir ──");
  {
    const z = await kurSevk([120]);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    const hata = await reopenHatasi(z.kursunStepId, z.rollIds[0]!);
    check("G4a: yanlış adımla 409 (eski kapı topu O adıma taşırdı)",
      hata?.status === 409 && hata.code === "REMAINDER_NOT_CLOSED", `${hata?.status} ${hata?.code ?? ""}`);
    const d = await durum(z.rollIds[0]!);
    check("G4b: top kapalı kaldı, kurşun adımına taşınmadı", d.status === RollStatus.SUBCONTRACTOR_CONSUMED && d.stepId === null, `${d.status} · step ${d.stepId ? "DOLU" : "null"}`);
    const kalem = await prisma.subcontractorDispatchItem.findFirst({ where: { dispatchId: z.dispatchId }, select: { remainderClosedAt: true } });
    check("G4c: kapama damgası duruyor", kalem?.remainderClosedAt !== null);
  }
}

async function temizle(): Promise<void> {
  if (ids.wos.length === 0) return;
  try {
    const woIds = ids.wos;
    const dispatchIds = ids.dispatches;
    const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
    const dsIds = (await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } })).map((d) => d.id);
    const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
    const taban = (await prisma.roll.findMany({
      where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceiptId: { in: receiptIds } }, { directShipmentId: { in: dsIds } }, { barcode: { startsWith: "TST-RRG-" } }] },
      select: { id: true },
    })).map((r) => r.id);
    const cocuk = (await prisma.roll.findMany({ where: { parentRollId: { in: taban } }, select: { id: true } })).map((r) => r.id);
    const rollIds = [...new Set([...taban, ...cocuk])];
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds, ...dsIds, ...receiptIds] } } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.directShipment.deleteMany({ where: { id: { in: dsIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    const cardIds = (await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((c) => c.id);
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds, ...dsIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  } catch (e) {
    console.error("temizlik hatası:", e instanceof Error ? e.message : e);
    fail++;
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
