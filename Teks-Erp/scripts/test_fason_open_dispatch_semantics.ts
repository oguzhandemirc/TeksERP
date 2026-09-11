// TEST: Fason "AÇIK + OUTSTANDING sevk" koşulunun DAVRANIŞI (2026-08-21).
//
// K1 bulgusu: koşulun 22 elle yazılmış kopyası vardı, DÖRDÜ eksikti
// (`directShippedAt` ve/veya `receipt.cancelledAt` süzgeci yok). Koşul artık
// `src/services/helpers/fason-open-dispatch.helper.ts`te TEK KAYNAK; bu dosya
// düzeltmenin GÖZLEMLENEBİLİR sonucunu üç yüzeyde ölçer:
//
//   S1  TAM kabul → cancelReceipt (LIFO) → sevk YENİDEN outstanding
//       (a) WorkOrderService.findAll(excludeWithOpenDispatch=true) WO'yu GİZLER
//       (b) TravelerCardService.findByBarcode → hasOpenDispatch = true
//       (c) FasonQuickService.preview() grubu GÖSTERİR
//       ⚠️ Eski kod üçünde de "kapalı" diyordu: iptal edilmiş makbuzun kalemi
//          hâlâ "dönmüş" sayılıyordu.
//
//   S2  Tamamen DOĞRUDAN-SEVK (DSK) edilmiş dispatch → sevk AÇIK DEĞİLDİR
//       (a) findAll(excludeWithOpenDispatch=true) WO'yu GÖSTERİR
//       (b) hasOpenDispatch = false (hayalet uyarı yok)
//       (c) preview'de hayalet grup YOK
//       (d) WO iptali onu `cancelBulk`'a VERMEZ — doğrudan-sevk edilmiş sevk
//           iptal edilmeden kalır, aynı adımdaki gerçek açık sevk iptal edilir
//       ⚠️ Eski kod dördünde de "açık" diyordu: mal fasondan müşteriye çıkmıştı
//          ama kalem hiç kabul görmediği için outstanding sanılıyordu.
//
//   S3  ALT KÜME tam doğrudan sevk (sevk damgasız kalır) → topu müşteriye giden
//       kalem outstanding DEĞİLDİR
//       (a) diğer top fasondayken kalem-düzeyi sorgu yalnız o topu döndürür
//       (b) diğer top dönünce sevk AÇIK DEĞİLDİR: liste GÖSTERİR, kart uyarısı
//           yok, preview grubu yok
//       ⚠️ Eski kod sevki sonsuza dek "açık" sayıyordu: kalemin topu tüketilmişti
//          ama makbuzu da kalan-kapaması da olmadığı için outstanding kalıyordu.
//
// Çalıştır: npx tsx scripts/test_fason_open_dispatch_semantics.ts
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { OPEN_OUTSTANDING, outstandingItemOfOpenDispatch } from "../src/services/helpers/fason-open-dispatch.helper";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { workOrderFasonQuickService } from "../src/services/workorder-fason-quick.service";
import { RollStatus } from "@prisma/client";
import { randomUUID } from "crypto";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const wos = new WorkOrderService();

let ITEM = "",
  ADMIN = "",
  ST_BOYA = "",
  ST_KURSUN = "",
  SUB_BOYER = "",
  CUSTOMER = "";
const createdWoIds: string[] = [];
const allStepIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .toUpperCase()
    .padStart(6, "0");
  return `TST-FOD-${rand}${bc}`;
}

interface WoFixture {
  woId: string;
  woNumber: string;
  boyaStep: string;
  cardBarcode: string;
}

/**
 * Refakat kartı barkodu = İŞ EMRİ NUMARASI ve `findByBarcode` onu
 * `isDailyCode(code, "IE")` ile doğrular (IE + GGAAYY + NNNN). Bu yüzden test
 * WO numarası "IE-FOD-..." gibi okunaklı bir etiket OLAMAZ — kart yüzeyi 400
 * verir ve ölçüm hiç yapılamaz. Sayısal kalıba uyan benzersiz bir numara üretilir.
 */
function woNumber(): string {
  const gun = `${Date.now()}`.slice(-6);
  const seq = String(1000 + Math.floor(Math.random() * 9000));
  return `IE${gun}${seq}`;
}

async function setup(tag: string): Promise<WoFixture> {
  void tag;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: woNumber(),
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(wo.id);
  const boyaStep = wo.steps[0]!.id;
  allStepIds.push(boyaStep, wo.steps[1]!.id);
  const card = await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const cardRow = await prisma.travelerCard.findFirst({
    where: { workOrderId: wo.id },
    select: { barcode: true },
  });
  void card;
  return {
    woId: wo.id,
    woNumber: wo.workOrderNumber,
    boyaStep,
    cardBarcode: cardRow?.barcode ?? "",
  };
}

async function makeRoll(qty = 100): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(),
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: RollStatus.STOCK,
      width: 250,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  return r.id;
}

// ── Ölçüm yüzeyleri ─────────────────────────────────────────────────────────

/** `excludeWithOpenDispatch=true` listesi bu WO'yu içeriyor mu? */
async function listedWithExclude(woNumber: string): Promise<boolean> {
  const req = {
    query: {
      excludeWithOpenDispatch: "true",
      search: woNumber,
      limit: "50",
      // İptal/tamamlanmış gizleme bayrakları KAPALI — test WO'su her durumda görünsün.
    },
  } as unknown as Request;
  const res = await wos.findAll(req);
  const rows = (res as { data: Array<{ workOrderNumber?: string }> }).data ?? [];
  return rows.some((r) => r.workOrderNumber === woNumber);
}

async function hasOpenDispatchFlag(cardBarcode: string): Promise<boolean | null> {
  const res = await cards.findByBarcode(cardBarcode);
  const data = res.data as { hasOpenDispatch?: boolean } | null;
  return data?.hasOpenDispatch ?? null;
}

async function previewGroupCount(woId: string): Promise<number> {
  const res = await workOrderFasonQuickService.preview(woId);
  const data = res.data as { groups: unknown[] };
  return data.groups.length;
}

async function bornLive(woId: string): Promise<string[]> {
  const rows = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.id);
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const customer = await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun || !customer) {
    throw new Error("Seed fixture eksik — önce 'npm run seed' + 'npm run seed:fixtures'");
  }
  ITEM = item.id;
  ADMIN = admin.id;
  ST_BOYA = boya.id;
  ST_KURSUN = kursun.id;
  SUB_BOYER = boyer.id;
  CUSTOMER = customer.id;

  // ═══════════════════════════════════════════════════════════════════════════
  // S1 — TAM kabul → cancelReceipt (LIFO) → sevk YENİDEN outstanding
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== S1: kabul iptali sevki YENİDEN açar (üç yüzey) ===");
  const a = await setup("S1");
  const rollA = await makeRoll(100);
  await sub.dispatch(
    { workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollA] },
    ADMIN,
  );

  // Sevk AÇIKKEN referans ölçüm (üç yüzey de "açık" demeli).
  check("S1-0a: açık sevkte liste WO'yu GİZLER", (await listedWithExclude(a.woNumber)) === false);
  check("S1-0b: açık sevkte hasOpenDispatch = true", (await hasOpenDispatchFlag(a.cardBarcode)) === true);
  check("S1-0c: açık sevkte preview 1 grup gösterir", (await previewGroupCount(a.woId)) === 1);

  const recRes = await sub.receive(
    {
      workOrderId: a.woId,
      stepId: a.boyaStep,
      subcontractorId: SUB_BOYER,
      clientToken: randomUUID(),
      returns: [{ rollId: rollA }],
      newRolls: [{ qty: 100 }],
    },
    ADMIN,
  );
  const receiptId = (recRes.data as { id: string }).id;

  check("S1-1a: TAM kabul sonrası liste WO'yu GÖSTERİR", (await listedWithExclude(a.woNumber)) === true);
  check("S1-1b: TAM kabul sonrası hasOpenDispatch = false", (await hasOpenDispatchFlag(a.cardBarcode)) === false);
  check("S1-1c: TAM kabul sonrası preview grubu YOK", (await previewGroupCount(a.woId)) === 0);

  // ── KABUL İPTALİ (LIFO) — makbuz cancelledAt alır, kalem YENİDEN outstanding.
  const born = await bornLive(a.woId);
  await sub.cancelReceipt(receiptId, "S1 kabul iptali", ADMIN, born);
  {
    const rec = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      select: { cancelledAt: true },
    });
    check("S1-2 ön koşul: makbuz iptal edildi", rec?.cancelledAt != null);
    const r = await prisma.roll.findUnique({ where: { id: rollA }, select: { status: true } });
    check("S1-2 ön koşul: top yeniden AT_SUBCONTRACTOR", r?.status === RollStatus.AT_SUBCONTRACTOR);
  }

  check(
    "S1-3a: kabul iptalinden SONRA liste WO'yu YENİDEN GİZLER (eski kod GÖSTERİYORDU)",
    (await listedWithExclude(a.woNumber)) === false,
  );
  check(
    "S1-3b: kabul iptalinden SONRA hasOpenDispatch = true (eski kod FALSE derdi)",
    (await hasOpenDispatchFlag(a.cardBarcode)) === true,
  );
  check(
    "S1-3c: kabul iptalinden SONRA preview grubu GÖSTERİR (eski kod GÖSTERMİYORDU)",
    (await previewGroupCount(a.woId)) === 1,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // S2 — Tamamen DOĞRUDAN-SEVK edilmiş dispatch AÇIK DEĞİLDİR
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== S2: doğrudan-sevk edilmiş sevk 'açık' sayılmaz ===");
  const b = await setup("S2");
  const rollB = await makeRoll(100);
  const dispB = await sub.dispatch(
    { workOrderId: b.woId, stepId: b.boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollB] },
    ADMIN,
  );
  const dispBId = (dispB.data as { id: string }).id;
  await sub.executeDirectShip(
    { dispatchId: dispBId, reason: "S2 fasondan doğrudan müşteriye", customerId: CUSTOMER },
    ADMIN,
  );
  {
    const d = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispBId },
      select: { directShippedAt: true, cancelledAt: true },
    });
    check("S2-0 ön koşul: dispatch directShippedAt damgalandı", d?.directShippedAt != null && d.cancelledAt === null);
  }

  check("S2-1a: liste WO'yu GÖSTERİR (eski kod sonsuza dek gizlerdi)", (await listedWithExclude(b.woNumber)) === true);
  check("S2-1b: hasOpenDispatch = false (hayalet uyarı yok)", (await hasOpenDispatchFlag(b.cardBarcode)) === false);
  check("S2-1c: preview'de hayalet grup YOK", (await previewGroupCount(b.woId)) === 0);

  // ── S2-2: WO iptali doğrudan-sevk edilmiş sevki `cancelBulk`'a VERMEZ.
  //    Aynı adımda ikinci bir GERÇEK açık sevk var → iptal yolu gerçekten koşar
  //    (fason top yoksa `prepareFasonCancelDecision` erken döner ve sorgu hiç
  //    çalışmazdı — kontrolü vakumen yeşil bırakırdı).
  console.log("\n=== S2-2: WO iptali — DSK sevki dokunulmaz, açık sevk iptal ===");
  const rollB2 = await makeRoll(80);
  const dispB2 = await sub.dispatch(
    { workOrderId: b.woId, stepId: b.boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollB2] },
    ADMIN,
  );
  const dispB2Id = (dispB2.data as { id: string }).id;

  await wos.softDelete(b.woId, ADMIN, {
    reason: "S2 iptal testi",
    fasonAction: "RETURN_TO_STOCK",
  });
  {
    const dsk = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispBId },
      select: { cancelledAt: true },
    });
    const acik = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispB2Id },
      select: { cancelledAt: true },
    });
    check(
      "S2-2a: doğrudan-sevk edilmiş sevk İPTAL EDİLMEDİ (eski kod onu da verirdi)",
      dsk?.cancelledAt === null,
    );
    check("S2-2b: gerçek açık sevk İPTAL EDİLDİ", acik?.cancelledAt != null);
    const wo = await prisma.workOrder.findUnique({ where: { id: b.woId }, select: { status: true } });
    check("S2-2c: WO iptal edildi", wo?.status === "CANCELLED");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // S3 — ALT KÜME tam doğrudan sevk: topu müşteriye giden kalem kapanmıştır
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n=== S3: alt küme doğrudan sevk — kalem kapanır, sevk damgasız kalır ===");
  const c = await setup("S3");
  const rollC1 = await makeRoll(100);
  const rollC2 = await makeRoll(80);
  const dispC = await sub.dispatch(
    { workOrderId: c.woId, stepId: c.boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollC1, rollC2] },
    ADMIN,
  );
  const dispCId = (dispC.data as { id: string }).id;
  await sub.executeDirectShip(
    { dispatchId: dispCId, reason: "S3 alt küme doğrudan sevk", customerId: CUSTOMER, rollIds: [rollC1] },
    ADMIN,
  );
  {
    const d = await prisma.subcontractorDispatch.findUnique({ where: { id: dispCId }, select: { directShippedAt: true } });
    const r1 = await prisma.roll.findUnique({ where: { id: rollC1 }, select: { status: true, directShipmentId: true } });
    check(
      "S3-0 ön koşul: sevk damgasız, sevk edilen top tüketildi ve DSK'ya bağlandı",
      d?.directShippedAt === null && r1?.status === RollStatus.SUBCONTRACTOR_CONSUMED && r1.directShipmentId !== null,
    );
  }
  const outstanding = await prisma.subcontractorDispatchItem.findMany({
    where: { dispatchId: dispCId, ...outstandingItemOfOpenDispatch() },
    select: { rollId: true },
  });
  check(
    "S3-1a: diğer top fasondayken outstanding kalem YALNIZ o top (eski kod müşteriye gideni de sayardı)",
    outstanding.length === 1 && outstanding[0]!.rollId === rollC2,
    `gelen: ${outstanding.map((o) => (o.rollId === rollC1 ? "C1" : "C2")).join(",")}`,
  );
  check("S3-1b: diğer top fasondayken sevk hâlâ AÇIK (liste gizler)", (await listedWithExclude(c.woNumber)) === false);

  await sub.receive(
    {
      workOrderId: c.woId,
      stepId: c.boyaStep,
      subcontractorId: SUB_BOYER,
      clientToken: randomUUID(),
      returns: [{ rollId: rollC2 }],
      newRolls: [{ qty: 80 }],
    },
    ADMIN,
  );
  check(
    "S3-2a: diğer top dönünce sevk OPEN_OUTSTANDING DEĞİL (eski kod sonsuza dek açık sayardı)",
    (await prisma.subcontractorDispatch.count({ where: { id: dispCId, ...OPEN_OUTSTANDING } })) === 0,
  );
  check("S3-2b: liste WO'yu GÖSTERİR", (await listedWithExclude(c.woNumber)) === true);
  check("S3-2c: hasOpenDispatch = false (hayalet uyarı yok)", (await hasOpenDispatchFlag(c.cardBarcode)) === false);
  check("S3-2d: preview'de hayalet grup YOK", (await previewGroupCount(c.woId)) === 0);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: allStepIds } },
          { producedInStepId: { in: allStepIds } },
          { parentReceipt: { workOrderId: { in: createdWoIds } } },
          { barcode: { startsWith: "TST-FOD-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const dispatchIds = dispatches.map((d) => d.id);
    const directShipments = await prisma.directShipment.findMany({
      where: { dispatchId: { in: dispatchIds } },
      select: { id: true },
    });
    const directShipmentIds = directShipments.map((d) => d.id);

    await prisma.printedDocument.deleteMany({
      where: { sourceId: { in: [...dispatchIds, ...directShipmentIds, ...createdWoIds] } },
    });
    // DirectShipment sökümü: önce roll bağı, sonra allocation, sonra kayıt
    // (DirectShipment.dispatchId RESTRICT → dispatch'ten ÖNCE silinmeli).
    await prisma.roll.updateMany({
      where: { directShipment: { dispatchId: { in: dispatchIds } } },
      data: { directShipmentId: null },
    });
    await prisma.subcontractorDirectShipAllocation.deleteMany({
      where: { dispatchId: { in: dispatchIds } },
    });
    await prisma.directShipment.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (fason kabulünde
    // giden↔dönen farkı deftere yazılıyor). Silinmezse temizlik 23001 ile yarıda kalır.
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: { in: createdWoIds } } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } },
    });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
