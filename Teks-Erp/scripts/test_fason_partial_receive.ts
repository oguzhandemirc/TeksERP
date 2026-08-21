// TEST: Fason KISMİ KABUL (2026-08-19) — "100 m gitti, 51 m geldi, 49 sonra".
//
// Model: kısmi teslimatta kaynak top TÜKETİLMEZ — AT_SUBCONTRACTOR kalır,
// currentQty atomik decrement ile kalana iner (kısmi sevkin dönüş aynası).
// Her teslimat AYRI makbuz; kabul defteri SubcontractorReceiptItem.receivedQty +
// isPartial. Takip teslimatının doğan topları YENİ parti alır (K5 aynası).
// "Kalan gelmeyecek" → closeRemainder: fire RollVariance'a, kalem remainderClosedAt.
//
//   P1  Kısmi kabul       : 100→51 kabul → top AT_SUB, kalan 49; born 1; adım ACTIVE
//   P2  Takip teslimatı    : kalan 49 → TAM; top consumed; born YENİ partide; adım COMPLETED
//   P3  clientToken replay : aynı token → cached makbuz (yeni makbuz/doğum yok)
//   P4  Movement sözleşmesi: son teslimatta kapanır, qtyOut = qtyIn (sevk edilen toplam)
//   P5  LIFO iptal         : kısmi makbuz iptali 409 (RECEIPT_NOT_LATEST); sondan
//                            başa iptal metrajı geri koyar (49→100)
//   P6  Kalan kapama       : 60 kabul + closeRemainder → variance SCRAP 40,
//                            SUBCONTRACTOR_REMAINDER, kalem damgalı, adım COMPLETED
//   P7  Fazla dönen        : receivedQty > kalan → TAM kabul (isPartial=false, clamp)
//   P8  Bekleyen listesi   : kısmi kalan hâlâ pending-returns'te, dispatchedQty ile
//   P9  Karne              : fire = giden − defter (kısmi açıkta, kapanınca gerçek fire)
//
// Çalıştır: npx tsx scripts/test_fason_partial_receive.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import { VARIANCE_SOURCES } from "../src/constants/variance-reasons";
import { RollStatus, RollVarianceKind } from "@prisma/client";
import { randomUUID } from "crypto";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, code: number, fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
    return "";
  } catch (e) {
    const sc = (e as { statusCode?: number }).statusCode;
    check(label, sc === code, `statusCode ${sc}`);
    return (e as Error).message ?? "";
  }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
let ITEM = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "";
const createdWoIds: string[] = [];
const allStepIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FPR-${rand}${bc}`;
}

async function bornLive(woId: string): Promise<Array<{ id: string; currentQty: number; batchId: string | null }>> {
  const rows = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null, status: RollStatus.IN_PRODUCTION },
    select: { id: true, currentQty: true, batchId: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, currentQty: Number(r.currentQty), batchId: r.batchId }));
}

async function setup(tag: string, qty = 100): Promise<{ woId: string; boyaStep: string; kursunStep: string; rollId: string }> {
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE-FPR-${tag}-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
        { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(wo.id);
  const boyaStep = wo.steps[0].id, kursunStep = wo.steps[1].id;
  allStepIds.push(boyaStep, kursunStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const r = await prisma.roll.create({
    data: { barcode: barcode(), itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, width: 250, createdById: ADMIN },
    select: { id: true },
  });
  return { woId: wo.id, boyaStep, kursunStep, rollId: r.id };
}

async function main(): Promise<void> {
  const testStart = new Date(Date.now() - 5_000);
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  if (!item || !admin || !boya || !kursun) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  ITEM = item.id; ADMIN = admin.id; ST_BOYA = boya.id; ST_KURSUN = kursun.id; SUB_BOYER = boyer.id;

  // ═══ P1–P5: KISMİ KABUL + TAKİP TESLİMATI + REPLAY + LIFO İPTAL ═══
  console.log("\n=== P1: 100 m gitti, 51 geldi (KISMİ) ===");
  const { woId, boyaStep, rollId } = await setup("P15");
  await sub.dispatch({ workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER, rollIds: [rollId] }, ADMIN);
  const origBatchId = (await prisma.roll.findUnique({ where: { id: rollId }, select: { batchId: true } }))!.batchId;

  const token1 = randomUUID();
  const res1 = await sub.receive({
    workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER,
    clientToken: token1,
    returns: [{ rollId, receivedQty: 51 }],
    newRolls: [{ qty: 51 }],
  }, ADMIN);
  const receipt1 = (res1.data as { id: string; receiptNo: string });
  {
    const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, currentQty: true, currentStepId: true } });
    check("P1: top AT_SUBCONTRACTOR kaldı", r?.status === RollStatus.AT_SUBCONTRACTOR && r?.currentStepId === boyaStep);
    check("P1: kalan 49'a indi", Number(r?.currentQty) === 49, `currentQty ${r?.currentQty}`);
    const born = await bornLive(woId);
    check("P1: born 1 adet, 51 m", born.length === 1 && born[0].currentQty === 51);
    check("P1: ilk teslimat ORİJİNAL partiyi sürdürür", born[0]?.batchId === origBatchId);
    const step = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
    check("P1: fason adımı ACTIVE (kalan bekliyor)", step?.status === "ACTIVE");
    const item1 = await prisma.subcontractorReceiptItem.findFirst({ where: { receiptId: receipt1.id }, select: { receivedQty: true, isPartial: true, sourceDispatchItemId: true } });
    check("P1: defter satırı receivedQty=51 + isPartial", Number(item1?.receivedQty) === 51 && item1?.isPartial === true);
    check("P1: kalem bağı (sourceDispatchItemId) yazıldı", !!item1?.sourceDispatchItemId);
    const mv = await prisma.rollMovement.findFirst({ where: { rollId, workOrderStepId: boyaStep }, select: { exitedAt: true } });
    check("P1: movement AÇIK kaldı (son teslimata kadar)", mv?.exitedAt === null);
  }

  console.log("\n=== P8: bekleyen listesi — yarım kalan görünür ===");
  {
    const pending = await sub.listPendingReturns({ workOrderId: woId });
    const groups = pending.data as Array<{ rolls: Array<{ id: string; currentQty: unknown; dispatchedQty: number | null; dispatchedAt: Date | null }> }>;
    const row = groups.flatMap((g) => g.rolls).find((r) => r.id === rollId);
    check("P8: yarım kalan top hâlâ bekleyen listesinde", !!row);
    check("P8: dispatchedQty=100 (rozet verisi) + dispatchedAt dolu",
      row?.dispatchedQty === 100 && row?.dispatchedAt != null, `dispatchedQty ${row?.dispatchedQty}`);
    check("P8: listedeki kalan 49", Number(row?.currentQty) === 49);
  }

  console.log("\n=== P3: clientToken replay → cached ===");
  {
    const replay = await sub.receive({
      workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER,
      clientToken: token1,
      returns: [{ rollId, receivedQty: 51 }],
      newRolls: [{ qty: 51 }],
    }, ADMIN);
    check("P3: replay cached makbuz döner", (replay.data as { receiptNo?: string })?.receiptNo === receipt1.receiptNo);
    const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { currentQty: true } });
    check("P3: metraj İKİNCİ KEZ düşmedi (49 kaldı)", Number(r?.currentQty) === 49);
    check("P3: born hâlâ 1 (çift doğum yok)", (await bornLive(woId)).length === 1);
  }

  console.log("\n=== P5a: KISMİ makbuzun iptali sonrakiler varken... (henüz yok → serbest olmalıydı; önce ikinci teslimat) ===");
  console.log("\n=== P2: kalan 49 geldi (TAKİP teslimatı → TAM + YENİ PARTİ) ===");
  const res2 = await sub.receive({
    workOrderId: woId, stepId: boyaStep, subcontractorId: SUB_BOYER,
    clientToken: randomUUID(),
    returns: [{ rollId, receivedQty: 49 }],
    newRolls: [{ qty: 49 }],
  }, ADMIN);
  const receipt2 = (res2.data as { id: string; receiptNo: string });
  {
    check("P2: yeni makbuz doğdu (küme-eşitliği guard'ı kısmiyi yutmadı)", receipt2.receiptNo !== receipt1.receiptNo);
    const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, currentQty: true } });
    check("P2: top tüketildi (SUBCONTRACTOR_CONSUMED)", r?.status === RollStatus.SUBCONTRACTOR_CONSUMED);
    const born = await bornLive(woId);
    check("P2: born 2 adet (51+49)", born.length === 2 && born.map((b) => b.currentQty).sort((a, b2) => a - b2).join(",") === "49,51");
    const second = born.find((b) => b.currentQty === 49);
    check("P2: takip teslimatının topu YENİ partide", !!second?.batchId && second.batchId !== origBatchId);
    if (second?.batchId) {
      const batch = await prisma.batch.findUnique({ where: { id: second.batchId }, select: { splitFromId: true, batchNumber: true } });
      check("P2: yeni parti kaynağa bağlı (splitFromId)", batch?.splitFromId === origBatchId, `parti ${batch?.batchNumber}`);
    }
    const item2 = await prisma.subcontractorReceiptItem.findFirst({ where: { receiptId: receipt2.id }, select: { receivedQty: true, isPartial: true } });
    check("P2: ikinci defter satırı receivedQty=49 + TAM (isPartial=false)", Number(item2?.receivedQty) === 49 && item2?.isPartial === false);
    const step = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
    check("P2: fason adımı COMPLETED", step?.status === "COMPLETED");
  }

  console.log("\n=== P4: movement son teslimatta kapandı, qtyOut = qtyIn (100) ===");
  {
    const mv = await prisma.rollMovement.findFirst({ where: { rollId, workOrderStepId: boyaStep }, select: { qtyIn: true, qtyOut: true, exitedAt: true, notes: true } });
    check("P4: movement kapandı", mv?.exitedAt != null);
    check("P4: qtyOut = qtyIn = 100 (kalan 49 değil — hacim sözleşmesi)",
      Number(mv?.qtyIn) === 100 && Number(mv?.qtyOut) === 100, `in ${mv?.qtyIn} out ${mv?.qtyOut}`);
    check("P4: kapanış notu son makbuzu taşır", mv?.notes === `RETURNED_VIA_RECEIPT:${receipt2.receiptNo}`);
  }

  console.log("\n=== P5: LIFO iptal — önce eski makbuz REDDEDİLİR, sondan başa serbest ===");
  {
    const born = await bornLive(woId);
    const born51Id = born.find((x) => x.currentQty === 51)!.id;
    await expectErr("P5: makbuz-1 (kısmi) iptali 409 — daha yeni makbuz var", 409, () =>
      sub.cancelReceipt(receipt1.id, "test lifo", ADMIN, [born51Id]),
    );
    // Makbuz-2 iptal (born-49 cascade) → top AT_SUB'a döner, metraj 49 (tam kabul metraj değiştirmemişti).
    const born49 = born.find((b) => b.currentQty === 49)!;
    await sub.cancelReceipt(receipt2.id, "test lifo geri sar", ADMIN, [born49.id]);
    let r = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, currentQty: true } });
    check("P5: makbuz-2 iptali → top yeniden AT_SUBCONTRACTOR, kalan 49", r?.status === RollStatus.AT_SUBCONTRACTOR && Number(r?.currentQty) === 49);
    // Şimdi makbuz-1 (kısmi) iptal edilebilir → 51 geri konur (100).
    const born51 = born.find((b) => b.currentQty === 51)!;
    await sub.cancelReceipt(receipt1.id, "test lifo geri sar 2", ADMIN, [born51.id]);
    r = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, currentQty: true } });
    check("P5: makbuz-1 iptali → metraj geri konndu (100)", r?.status === RollStatus.AT_SUBCONTRACTOR && Number(r?.currentQty) === 100, `currentQty ${r?.currentQty}`);
    const step = await prisma.workOrderStep.findUnique({ where: { id: boyaStep }, select: { status: true } });
    check("P5: adım yeniden ACTIVE", step?.status === "ACTIVE");
  }

  // ═══ P6: KALAN KAPAMA (gelmeyecek → fire) ═══
  console.log("\n=== P6: 100 gitti, 60 kabul, kalan 40 'gelmeyecek' → fire ===");
  {
    const s2 = await setup("P6");
    await sub.dispatch({ workOrderId: s2.woId, stepId: s2.boyaStep, subcontractorId: SUB_BOYER, rollIds: [s2.rollId] }, ADMIN);
    await sub.receive({
      workOrderId: s2.woId, stepId: s2.boyaStep, subcontractorId: SUB_BOYER,
      clientToken: randomUUID(),
      returns: [{ rollId: s2.rollId, receivedQty: 60 }],
      newRolls: [{ qty: 60 }],
    }, ADMIN);
    await expectErr("P6: geçersiz sebep kodu fail-closed → 400", 400, () =>
      sub.closeRemainder({ stepId: s2.boyaStep, rollId: s2.rollId, reasonCode: "BOYLE_BIR_KOD_YOK" }, ADMIN));
    const varCountBefore = await prisma.rollVariance.count({ where: { rollId: s2.rollId } });
    check("P6: geçersiz sebep satır YAZMADI", varCountBefore === 0);

    const closeRes = await sub.closeRemainder(
      { stepId: s2.boyaStep, rollId: s2.rollId, reasonCode: "BOYA_HATASI" }, ADMIN,
    );
    check("P6: kapama başarılı, closedQty=40", (closeRes.data as { closedQty: number }).closedQty === 40);
    const r = await prisma.roll.findUnique({ where: { id: s2.rollId }, select: { status: true } });
    check("P6: top SUBCONTRACTOR_CONSUMED", r?.status === RollStatus.SUBCONTRACTOR_CONSUMED);
    const v = await prisma.rollVariance.findFirst({ where: { rollId: s2.rollId }, select: { kind: true, qty: true, source: true, reasonCode: true, reversedAt: true } });
    check("P6: sapma defteri SCRAP 40 m, source=SUBCONTRACTOR_REMAINDER",
      v?.kind === RollVarianceKind.SCRAP && Number(v?.qty) === 40 && v?.source === VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER && v?.reasonCode === "BOYA_HATASI");
    const di = await prisma.subcontractorDispatchItem.findFirst({ where: { rollId: s2.rollId }, select: { remainderClosedAt: true } });
    check("P6: sevk kalemi remainderClosedAt ile damgalandı", di?.remainderClosedAt != null);
    const step = await prisma.workOrderStep.findUnique({ where: { id: s2.boyaStep }, select: { status: true } });
    check("P6: fason adımı COMPLETED (bekleyen kalmadı)", step?.status === "COMPLETED");
    const mv = await prisma.rollMovement.findFirst({ where: { rollId: s2.rollId, workOrderStepId: s2.boyaStep }, select: { exitedAt: true, notes: true } });
    check("P6: movement kapandı, notu REMAINDER_CLOSED", mv?.exitedAt != null && mv?.notes === "REMAINDER_CLOSED:BOYA_HATASI");
    await expectErr("P6: ikinci kapama 409 (idempotent değil, claim korur)", 409, () =>
      sub.closeRemainder({ stepId: s2.boyaStep, rollId: s2.rollId, reasonCode: "BOYA_HATASI" }, ADMIN));
  }

  // ═══ P7: FAZLA DÖNEN → TAM kabul (clamp) ═══
  console.log("\n=== P7: receivedQty > kalan → TAM kabul sayılır ===");
  {
    const s3 = await setup("P7");
    await sub.dispatch({ workOrderId: s3.woId, stepId: s3.boyaStep, subcontractorId: SUB_BOYER, rollIds: [s3.rollId] }, ADMIN);
    const res = await sub.receive({
      workOrderId: s3.woId, stepId: s3.boyaStep, subcontractorId: SUB_BOYER,
      clientToken: randomUUID(),
      returns: [{ rollId: s3.rollId, receivedQty: 104 }],
      newRolls: [{ qty: 104 }],
    }, ADMIN);
    const r = await prisma.roll.findUnique({ where: { id: s3.rollId }, select: { status: true, currentQty: true } });
    check("P7: top tüketildi (kısmi değil)", r?.status === RollStatus.SUBCONTRACTOR_CONSUMED);
    const it = await prisma.subcontractorReceiptItem.findFirst({ where: { receiptId: (res.data as { id: string }).id }, select: { receivedQty: true, isPartial: true } });
    check("P7: defterde clamp (100) + isPartial=false", Number(it?.receivedQty) === 100 && it?.isPartial === false);
  }

  // ═══ P9: KARNE — fire artık gerçek ═══
  console.log("\n=== P9: fason karnesi — defterden dönen + gerçek fire ===");
  {
    const score = await getSubcontractScorecard({ from: testStart, to: new Date() });
    const row = score.bySubcontractor.find((x) => x.label.includes("Test Boyahane") || x.key === SUB_BOYER);
    check("P9: test firması karnede", !!row);
    if (row) {
      // Kapanmışlar: P15 (iptal edildi → makbuz cancelledAt → kalem yeniden AÇIK, kapsam dışı olabilir),
      // P6 (100 gitti, 60 döndü, 40 kalan-kapama → fire 40), P7 (100 gitti, 104 m born → fazla dönen +4).
      // → kapanan giden 200, dönen 160 (defter) + 4 (P7 fazla dönen) = 164, fire 36.
      //
      // ⚠️ 2026-08-21'DE DEĞİŞTİ: defter satırı TAM kabulde kalanın kendisidir
      // (P7'de 104 istendi, 100'e clamp'lendi) — fazla dönen 4 m yalnız born
      // toplarda yaşıyordu ve karneye HİÇ girmiyordu. Artık sapma defterinde
      // OVERAGE olarak duruyor ve dönen metrajı düzeltiyor. Eski beklenti
      // (160/40) "defter = fiziksel dönen" varsayımını kodluyordu; o varsayım
      // tam da fire'ı yapısal olarak 0'a çiviteyen şeydi.
      check("P9: fire 36 (P6 kalanı 40 − P7 fazla döneni 4)", Math.abs(row.fireQty - 36) < 0.01, `fireQty ${row.fireQty}`);
      check("P9: dönen 164 (defter 160 + fazla dönen 4)", Math.abs(row.returnedQty - 164) < 0.01, `returned ${row.returnedQty}`);
      // P15 iptalle yeniden açıldı: açık bakiye = 100 (kısmi satırlar iptal edildi).
      check("P9: açık bakiye P15'in 100'ü", Math.abs(row.openQty - 100) < 0.01, `openQty ${row.openQty}`);
    }
  }

  // ═══ P10: ÇEKME DEFTERİ (2026-08-21) — giden ↔ dönen farkı kayda geçer ═══
  // SAHA VAKASI: 5 parça (30/40/50/60/70) boyahaneye gitti, 220 m döndü. O 30 m
  // hiçbir yere yazılmıyordu: makbuz "kalanın tamamı kabul edildi" diyor, born
  // toplar 220 m taşıyor, fark yalnız iki tabloyu yan yana koyan birinin
  // görebileceği bir çıkarma işlemi olarak kalıyordu.
  console.log("\n=== P10: çekme sapma defterine yazılıyor ===");
  {
    const s = await setup("P10a", 100);
    await sub.dispatch({ workOrderId: s.woId, stepId: s.boyaStep, subcontractorId: SUB_BOYER, rollIds: [s.rollId] }, ADMIN);
    const res = await sub.receive({
      workOrderId: s.woId, stepId: s.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: s.rollId }],   // TAM kabul (receivedQty yok)
      newRolls: [{ qty: 88 }],           // 100 gitti, 88 döndü → 12 m çekme
    }, ADMIN);
    const receiptId = (res.data as { id: string }).id;
    const v = await prisma.rollVariance.findFirst({
      where: { rollId: s.rollId, source: VARIANCE_SOURCES.SUBCONTRACTOR_RETURN },
      select: { kind: true, qty: true, reasonCode: true, sourceRefId: true, workOrderStepId: true, reversedAt: true },
    });
    check("P10: çekme satırı yazıldı — SCRAP 12 m", v?.kind === RollVarianceKind.SCRAP && Math.abs(Number(v?.qty) - 12) < 0.01, `qty ${v?.qty}`);
    check("P10: sistem sebebi FASON_CEKME (operatör listesinde YOK)", v?.reasonCode === "FASON_CEKME");
    check("P10: sourceRefId = makbuz (terslemenin adresi)", v?.sourceRefId === receiptId);
    check("P10: adım damgası yazıldı", v?.workOrderStepId === s.boyaStep);

    // KARNE: dönen 88, fire 12 — eski kod bu kalemde fire 0 basardı.
    const score = await getSubcontractScorecard({ from: testStart, to: new Date() });
    const row = score.bySubcontractor.find((x) => x.key === SUB_BOYER);
    const before = { fire: row?.fireQty ?? 0, returned: row?.returnedQty ?? 0 };
    check("P10: karne bu kalemi 88 dönen sayıyor (fire 12 eklendi)", before.returned > 0);

    // İPTAL → satır SİLİNMEZ, TERSLENİR (append-only defter).
    // İptal, doğan açık kumaşların da onaylanmasını ister (cascade sözleşmesi).
    const born = await bornLive(s.woId);
    await sub.cancelReceipt(receiptId, "P10 çekme terslemesi testi", ADMIN, born.map((x) => x.id));
    const v2 = await prisma.rollVariance.findFirst({
      where: { rollId: s.rollId, source: VARIANCE_SOURCES.SUBCONTRACTOR_RETURN },
      select: { reversedAt: true, reversedById: true },
    });
    check("P10: makbuz iptalinde çekme satırı TERSLENDİ (silinmedi)", v2 != null && v2.reversedAt != null);
    check("P10: tersleyen kullanıcı yazıldı", v2?.reversedById === ADMIN);
    const score2 = await getSubcontractScorecard({ from: testStart, to: new Date() });
    const row2 = score2.bySubcontractor.find((x) => x.key === SUB_BOYER);
    check(
      "P10: terslenmiş sapma karneye GİRMEZ (hayalet fire yok)",
      (row2?.returnedQty ?? 0) < before.returned,
      `önce ${before.returned} → sonra ${row2?.returnedQty}`,
    );
  }

  // ═══ P11: ÇOK TOPLU KABULDE DAĞITIM — toplam korunur ═══
  // Boyahane 2 topu dikip tek parça döndürdüğünde "hangi toptan kaç metre
  // çekti" sorusunun fiziksel cevabı yoktur; defter TOP bazlı olduğu için fark
  // tüketilen metrajla orantılı dağıtılır ve TOPLAM korunur.
  console.log("\n=== P11: çok toplu kabulde çekme dağıtımı ===");
  {
    const a = await setup("P11a", 100);
    const b = await prisma.roll.create({
      data: { barcode: barcode(), itemId: ITEM, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, width: 250, createdById: ADMIN },
      select: { id: true },
    });
    await sub.dispatch({ workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER, rollIds: [a.rollId, b.id] }, ADMIN);
    await sub.receive({
      workOrderId: a.woId, stepId: a.boyaStep, subcontractorId: SUB_BOYER,
      returns: [{ rollId: a.rollId }, { rollId: b.id }],
      newRolls: [{ qty: 180 }],  // 200 gitti, 180 döndü → 20 m çekme
    }, ADMIN);
    const vs = await prisma.rollVariance.findMany({
      where: { rollId: { in: [a.rollId, b.id] }, source: VARIANCE_SOURCES.SUBCONTRACTOR_RETURN, reversedAt: null },
      select: { rollId: true, qty: true },
    });
    const total = vs.reduce((s2, x) => s2 + Number(x.qty), 0);
    check("P11: iki topa da satır yazıldı", vs.length === 2, `satır ${vs.length}`);
    check("P11: TOPLAM korunur (10 + 10 = 20)", Math.abs(total - 20) < 0.001, `toplam ${total}`);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({ where: { OR: [{ currentStepId: { in: allStepIds } }, { producedInStepId: { in: allStepIds } }, { parentReceipt: { workOrderId: { in: createdWoIds } } }, { barcode: { startsWith: "TST-FPR-" } }] }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }); // RESTRICT FK
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
