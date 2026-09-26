// =============================================================================
// TEST: PARTİ EKLE — açık iş emrine yeni parti, ilk adımdan (hareket defteri D8)
// Çalıştır: npx tsx scripts/test_wo_batch_add.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §6.5. İlk parti gerçek bağlama yolundan (`attachRolls`
// = boğazın hoşgörülü kipi), ikinci parti `addBatch` ucundan:
//   §1 yeni parti: toplar ilk adımda üretimde, açık giriş hareketi + üretime giriş defter satırı; BATCH_ADDED
//      olayı partiyi taşır (ilk parti açılışın parçası — olay YAZMAZ)
//   §2 aynı istek anahtarı: önceki sonuç (replay), ikinci parti doğmaz; anahtar başka iş emrinde 409
//   §3 tek uygunsuz barkod bütün isteği düşürür (400 BATCH_ADD_REJECTED), uygun top yerinde kalır
//   §4 farklı kumaş 400 ITEM_MISMATCH
//   §5 tamamlanmış iş emri: Parti Ekle, attachRolls ve elle taşıma aynı 409 WO_COMPLETED_NO_ADD; iş emri kapalı kalır
//   §6 R1 — fason ilk adım: sevk bekleyen yeni parti varken bitmiş ilk adım COMPLETED kalmaz
//   §7 R2 — sonraki bitmiş adımlar da yeniden hesaplanır (bayat COMPLETED kalmaz)
//   §8 hedef aşımı UYARIDIR (engel değil)
//   §9 Hareketler: "Parti eklendi · N top · M" tek satır; aynı parti ikinci kez "Parti açıldı" diye basılmaz
//   §10 R6 numara doluluğu: boş parti ve canlı topu olan parti DOLU; topları hepsi ölü ve birleşmiş parti BOŞTA
// NEGATİF SONDA (elle, 2026-09-26): `recomputeStepStatus`un sevk bekleyen dalı sıfırlanınca §6 kırmızı;
// boğaz yalnız ilk adımı yeniden hesaplayınca §7 kırmızı; boğazın tamamlanmış kapısı kaldırılınca §5 kırmızı
// (kod WORKORDER_TERMINAL_DURING_ATTACH'a düşer); elle taşımanın iki kapısı kaldırılınca §5 kırmızı (taşıma geçer).
// §10 (2026-09-26): yüklemden boş-parti dalı düşürülünce kırmızı. §9b: BATCH_ADD etiketi silinince ya da
// createBatchTx açanı yazmayınca kırmızı. Yedek kopyadan geri alındı.
// =============================================================================

import { randomUUID } from "node:crypto";
import prisma from "../src/lib/prisma";
import { RollStatus, StepStatus } from "@prisma/client";
import { WorkOrderService } from "../src/services/workorder.service";
import { addBatch } from "../src/services/workorder-batch-add.service";
import { BATCH_NUMBER_TAKEN_WHERE } from "../src/services/batch.service";
import { recomputeStepStatus } from "../src/services/helpers/roll-step.helper";
import { WorkOrderTimelineService } from "../src/services/workorder-timeline.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
const TAG = `TST-WOBA-${Date.now()}`;

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ITEM2 = "", ADMIN = "", ST_KURSUN = "", ST_TAMBUR = "", ST_BOYA = "", WAREHOUSE = "";
const woIds: string[] = [];
const rollIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Fikstür eksik: ${label} (önce 'npm run seed' + 'seed:fixtures' + varsayılan depo)`);
    return v;
  };
  ITEM = need(await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ITEM2 = need(await prisma.item.findUnique({ where: { code: "POLAR" }, select: { id: true } }), "Item POLAR").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  WAREHOUSE = need(await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } }), "varsayılan depo").id;
}

async function top(suffix: string, itemId = ITEM): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `${TAG}-${suffix}`, itemId, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, warehouseId: WAREHOUSE, entrySource: "SUPPLIER_RECEIPT" },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

/** İş emri + ilk parti (hoşgörülü kip — quickStart'ın bağlama yolu). */
async function isEmri(stations: string[], first: string[], targetQuantity?: number): Promise<{ wo: string; steps: string[] }> {
  const res = await svc.create({ type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, targetQuantity, steps: stations.map((stationId) => ({ stationId })) }, ADMIN);
  const wo = (res.data as { id: string }).id;
  woIds.push(wo);
  for (const s of first) await top(s);
  await svc.attachRolls(wo, first.map((s) => `${TAG}-${s}`), ADMIN);
  const steps = (await prisma.workOrderStep.findMany({ where: { workOrderId: wo }, orderBy: { stepSequence: "asc" }, select: { id: true } })).map((x) => x.id);
  return { wo, steps };
}

async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try { await fn(); return null; }
  catch (e) { const x = e as { statusCode?: number; details?: { code?: string } }; return { status: x.statusCode, code: x.details?.code }; }
}

const rollOf = (suffix: string) => prisma.roll.findUniqueOrThrow({ where: { barcode: `${TAG}-${suffix}` }, select: { id: true, status: true, currentStepId: true, batchId: true } });
const stepStatus = async (id: string) => (await prisma.workOrderStep.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const woStatus = async (id: string) => (await prisma.workOrder.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

/** Topun bir adımı bitirip sonrakine geçtiğini simüle eder (hareket kapanır, sonraki açılır). */
async function gecir(rollId: string, from: string, to: string | null): Promise<void> {
  await prisma.rollMovement.updateMany({ where: { rollId, workOrderStepId: from, exitedAt: null }, data: { exitedAt: new Date() } });
  if (to) {
    await prisma.rollMovement.create({ data: { rollId, workOrderStepId: to, qtyIn: 100 } });
    await prisma.roll.update({ where: { id: rollId }, data: { currentStepId: to } });
  }
}

async function bolum1to4(): Promise<void> {
  const { wo, steps } = await isEmri([ST_KURSUN, ST_TAMBUR], ["A"]);
  await top("B"); await top("C");
  const token = randomUUID();
  const res = await addBatch(wo, { clientToken: token, rollBarcodes: [`${TAG}-B`, `${TAG}-C`], reason: "ek sipariş" }, ADMIN);
  const [a, b, c] = [await rollOf("A"), await rollOf("B"), await rollOf("C")];
  const acik = await prisma.rollMovement.count({ where: { rollId: { in: [b.id, c.id] }, workOrderStepId: steps[0], exitedAt: null, revokedAt: null } });
  const defter = await prisma.warehouseMovement.count({ where: { rollId: { in: [b.id, c.id] }, reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE } });
  const olaylar = await prisma.workOrderEvent.findMany({ where: { workOrderId: wo, type: "BATCH_ADDED" } });
  const payload = olaylar[0]?.payload as { rollIds?: string[] } | null;
  check("§1 yeni parti ilk adımda (hareket + üretime giriş satırı); BATCH_ADDED yalnız eklenen parti için",
    b.batchId === res.data.batch?.id && c.batchId === b.batchId && b.batchId !== a.batchId && b.currentStepId === steps[0]
      && b.status === RollStatus.IN_PRODUCTION && acik === 2 && defter === 2 && olaylar.length === 1
      && olaylar[0].toValue === b.batchId && olaylar[0].reason === "ek sipariş" && payload?.rollIds?.length === 2,
    `${res.data.batch?.batchNumber} · hareket ${acik} · defter ${defter} · olay ${olaylar.length}`);

  const again = await addBatch(wo, { clientToken: token, rollBarcodes: [`${TAG}-B`, `${TAG}-C`] }, ADMIN);
  const partiSayisi = await prisma.batch.count({ where: { workOrderId: wo } });
  const { wo: wo2 } = await isEmri([ST_KURSUN, ST_TAMBUR], ["D"]);
  const carpisma = await hata(() => addBatch(wo2, { clientToken: token, rollBarcodes: [`${TAG}-D`] }, ADMIN));
  check("§2 aynı anahtar: replay, ikinci parti yok; başka iş emrinde 409 CLIENT_TOKEN_COLLISION",
    again.data.replay === true && again.data.batch?.id === res.data.batch?.id && partiSayisi === 2 && carpisma?.code === "CLIENT_TOKEN_COLLISION",
    `replay=${again.data.replay} · parti ${partiSayisi} · ${carpisma?.code}`);

  await top("E");
  const red = await hata(() => addBatch(wo, { clientToken: randomUUID(), rollBarcodes: [`${TAG}-E`, `${TAG}-A`] }, ADMIN));
  check("§3 tek uygunsuz barkod (üretimdeki top) bütün isteği düşürür, uygun top stokta kalır",
    red?.status === 400 && red.code === "BATCH_ADD_REJECTED" && (await rollOf("E")).status === RollStatus.STOCK, `${red?.status} ${red?.code}`);

  await top("F", ITEM2);
  const kumas = await hata(() => addBatch(wo, { clientToken: randomUUID(), rollBarcodes: [`${TAG}-F`] }, ADMIN));
  check("§4 farklı kumaş 400 ITEM_MISMATCH", kumas?.status === 400 && kumas.code === "ITEM_MISMATCH", `${kumas?.status} ${kumas?.code}`);
}

async function bolum5(): Promise<void> {
  const { wo, steps } = await isEmri([ST_KURSUN, ST_TAMBUR], ["G"]);
  await prisma.workOrder.update({ where: { id: wo }, data: { status: "COMPLETED" } });
  await top("H");
  const h = await rollOf("H");
  const uc = await hata(() => addBatch(wo, { clientToken: randomUUID(), rollBarcodes: [`${TAG}-H`] }, ADMIN));
  const hosgoru = await hata(() => svc.attachRolls(wo, [`${TAG}-H`], ADMIN));
  const tasima = await hata(() => svc.manualMove(wo, { rollIds: [h.id], targetStepId: steps[1], reason: "mal geri geldi" }, ADMIN));
  check("§5 tamamlanmış iş emri: üç yoldan 409 WO_COMPLETED_NO_ADD, top stokta, iş emri kapalı",
    [uc, hosgoru, tasima].every((x) => x?.status === 409 && x.code === "WO_COMPLETED_NO_ADD")
      && (await rollOf("H")).status === RollStatus.STOCK && (await woStatus(wo)) === "COMPLETED",
    [uc, hosgoru, tasima].map((x) => `${x?.status}/${x?.code}`).join(" · "));
}

async function bolum6to8(): Promise<void> {
  // §6 R1: ilk adım fason — ilk parti sevk edilip döndü (ilk adım bitti), yeni parti sevk bekliyor.
  const f = await isEmri([ST_BOYA, ST_TAMBUR], ["J"]);
  const j = await rollOf("J");
  await prisma.rollMovement.create({ data: { rollId: j.id, workOrderStepId: f.steps[0], qtyIn: 100, exitedAt: new Date() } });
  await gecir(j.id, f.steps[0], f.steps[1]);
  await recomputeStepStatus(prisma as never, f.steps[0]);
  const once = await stepStatus(f.steps[0]);
  await top("K");
  await addBatch(f.wo, { clientToken: randomUUID(), rollBarcodes: [`${TAG}-K`] }, ADMIN);
  const k = await rollOf("K");
  const kHareket = await prisma.rollMovement.count({ where: { rollId: k.id } });
  check("§6 R1 fason ilk adım: yeni parti sevk bekliyor (hareketsiz), ilk adım COMPLETED'dan çıktı",
    once === StepStatus.COMPLETED && kHareket === 0 && k.currentStepId === f.steps[0] && (await stepStatus(f.steps[0])) !== StepStatus.COMPLETED,
    `önce ${once} · sonra ${await stepStatus(f.steps[0])} · hareket ${kHareket}`);

  // §7 R2: iç ilk adım — ilk parti iki adımı da bitirdi; yeni parti ikinci adımı yeniden açmalı.
  const g = await isEmri([ST_KURSUN, ST_TAMBUR], ["L"], 150);
  const l = await rollOf("L");
  await gecir(l.id, g.steps[0], g.steps[1]);
  await gecir(l.id, g.steps[1], null);
  for (const s of g.steps) await recomputeStepStatus(prisma as never, s);
  const once2 = await stepStatus(g.steps[1]);
  await top("M");
  const res = await addBatch(g.wo, { clientToken: randomUUID(), rollBarcodes: [`${TAG}-M`] }, ADMIN);
  check("§7 R2 bitmiş sonraki adım yeni partiyle bayat COMPLETED kalmaz",
    once2 === StepStatus.COMPLETED && (await stepStatus(g.steps[1])) !== StepStatus.COMPLETED && (await stepStatus(g.steps[0])) === StepStatus.ACTIVE,
    `önce ${once2} · sonra ${await stepStatus(g.steps[1])}`);
  check("§8 hedef aşımı uyarı (engel değil)", res.data.warnings.some((w) => w.startsWith("Hedef 150")), res.data.warnings.join(" | "));

  const satirlar = (await new WorkOrderTimelineService().list(g.wo, { limit: 200 })).data;
  const eklendi = satirlar.filter((x) => x.title === "Parti eklendi");
  const acildi = satirlar.filter((x) => x.title === "Parti açıldı");
  check("§9 Hareketler: 'Parti eklendi · 1 top · 100 m' tek satır; ilk parti 'açıldı', eklenen parti bir daha basılmaz",
    eklendi.length === 1 && (eklendi[0].detail ?? "").includes("1 top") && acildi.length === 1 && acildi[0].detail !== res.data.batch?.batchNumber,
    `${eklendi.map((x) => x.detail).join(",")} · açıldı ${acildi.length}`);
  // Panel e2e (2026-09-26) ham tetik kodunu ve aktörsüz "Parti açıldı"yı yakaladı.
  check("§9b tetik Türkçe ('Parti Ekle', ham kod değil); 'Parti açıldı' satırında açan kullanıcı var",
    eklendi[0]?.trigger === "Parti Ekle" && !!acildi[0]?.actor, `${eklendi[0]?.trigger} · ${acildi[0]?.actor}`);
}

async function bolum10(): Promise<void> {
  const { wo } = await isEmri([ST_KURSUN, ST_TAMBUR], []);
  const mk = async (n: string, mergedIntoId?: string) =>
    (await prisma.batch.create({ data: { batchNumber: `${TAG}-${n}`, workOrderId: wo, mergedIntoId }, select: { id: true } })).id;
  const [bos, canli, olu, karma] = [await mk("BOS"), await mk("CANLI"), await mk("OLU"), await mk("KARMA")];
  const yutulan = await mk("YUTULAN", canli);
  const bagla = async (suffix: string, batchId: string, status: RollStatus) =>
    prisma.roll.update({ where: { id: await top(suffix) }, data: { batchId, status } });
  await bagla("T1", canli, RollStatus.IN_PRODUCTION);
  await bagla("T2", olu, RollStatus.CANCELLED);
  await bagla("T3", karma, RollStatus.CANCELLED);
  await bagla("T4", karma, RollStatus.WAREHOUSE);
  await bagla("T5", yutulan, RollStatus.IN_PRODUCTION);
  const dolu = (await prisma.batch.findMany({ where: { workOrderId: wo, ...BATCH_NUMBER_TAKEN_WHERE }, select: { id: true } })).map((b) => b.id);
  check("§10 R6 doluluk: boş + canlı + karma DOLU; hepsi ölü ve birleşmiş BOŞTA",
    dolu.length === 3 && [bos, canli, karma].every((id) => dolu.includes(id)) && !dolu.includes(olu) && !dolu.includes(yutulan), `${dolu.length} dolu`);
}

async function main(): Promise<void> {
  console.log("=== Parti Ekle ===");
  await fikstur();
  try {
    await bolum1to4();
    await bolum5();
    await bolum6to8();
    await bolum10();
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((x) => x.id);
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((x) => x.id);
  const batchIds = (await prisma.batch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((x) => x.id);
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...woIds, ...stepIds, ...batchIds] } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
