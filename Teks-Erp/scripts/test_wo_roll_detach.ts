// =============================================================================
// TEST: TOP ÇIKAR — işlem görmemiş top iş emrinden geri alınır (hareket defteri D6)
// Çalıştır: npx tsx scripts/test_wo_roll_detach.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §6.2. Fikstür GERÇEK bağlama yolundan
// (`attachRolls`: statü claim + PRODUCTION_ISSUE + giriş hareketi + parti) geçer:
//   §1 önizleme: iki yeni top çıkarılabilir, sebep listesi boş
//   §2 çıkarma: top üretime girişten ÖNCEKİ durumuna (defterin `from` ucu) döner, adım/parti bağı düşer
//   §3 stok defteri: giriş satırı SİLİNMEZ, `ROLL_DETACH` bağlı ters satır (reversesMovementId) yazılır
//   §4 giriş hareketi damgalanır (revokedAt), silinmez; iş emrinde top kaldığı için statü yerinde
//   §5 Hareketler çizelgesinde "Top çıkarıldı" satırı, sebep ve aktörle
//   §6 son top da çıkınca adım PENDING'e, iş emri Planlandı'ya döner (STATUS_CHANGED, tetik ROLL_DETACH)
//   §7 işlem görmüş top (kapanmış hareket) önizlemede sebebiyle görünür; çıkarma 409 ROLL_DETACH_PROCESSED, top yerinde
//   §8 aynı top ikinci kez çıkarılamaz (404); sebepsiz çıkarma 400
//   §9 iş emri DEVRİ: taşınan açık üretime alma satırı yeni iş emrinin adımına bağlanır (eski satır bağlı
//      ters `PRODUCTION_ISSUE_TRANSFER`le kapanır, yeni ileri satır, net 0); yeni iş emrinden Top Çıkar
//      tersini yazar, açık satır kalmaz (ölçüldü 2026-09-26: devirden sonra Top Çıkar tersi YAZMIYORDU)
//   §9c Hareketler: eski iş emrinde "İş emrine devredildi → yeni", yenide "Devirle üretime alındı ← eski";
//      devir hiçbir iş emrinde "Top çıkarıldı" DEĞİLDİR (yalnız gerçek Top Çıkar)
// NEGATİF SONDA (elle, 2026-09-25): `detachBlockers` boş dizi dönünce §7 kırmızı; ters satır yazımı
// kaldırılınca §3 kırmızı. Yedek kopyadan geri alındı. (2026-09-26, md5 ile geri alındı) `repointRollsTx`teki
// `rebindProductionIssuesTx` çağrısı kaldırılınca §9 + §9b kırmızı; devir tersi `ROLL_DETACH` yazınca §9 + §9b +
// §9c kırmızı; çizelgenin devir satırları kaldırılınca §9c kırmızı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderRollDetachService } from "../src/services/workorder-roll-detach.service";
import { WorkOrderTimelineService } from "../src/services/workorder-timeline.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
const detach = new WorkOrderRollDetachService();
const TAG = `TST-WORD-${Date.now()}`;

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_KURSUN = "", ST_TAMBUR = "", WAREHOUSE = "";
const woIds: string[] = [];
const rollIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Fikstür eksik: ${label} (önce 'npm run seed' + 'seed:fixtures' + varsayılan depo)`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  WAREHOUSE = need(await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } }), "varsayılan depo").id;
}

async function top(suffix: string, status: RollStatus): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `${TAG}-${suffix}`, itemId: ITEM, initialQty: 100, currentQty: 100, status, warehouseId: WAREHOUSE, entrySource: "SUPPLIER_RECEIPT" },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function isEmriVeToplar(suffixes: [string, RollStatus][]): Promise<{ wo: string; rolls: string[] }> {
  const res = await svc.create({ type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: [{ stationId: ST_KURSUN }, { stationId: ST_TAMBUR }] }, ADMIN);
  const wo = (res.data as { id: string }).id;
  woIds.push(wo);
  const rolls: string[] = [];
  for (const [s, st] of suffixes) rolls.push(await top(s, st));
  await svc.attachRolls(wo, suffixes.map(([s]) => `${TAG}-${s}`), ADMIN);
  return { wo, rolls };
}

async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try { await fn(); return null; }
  catch (e) { const x = e as { statusCode?: number; details?: { code?: string } }; return { status: x.statusCode, code: x.details?.code }; }
}

const durum = (id: string) => prisma.roll.findUniqueOrThrow({ where: { id }, select: { status: true, currentStepId: true, batchId: true } });

async function main(): Promise<void> {
  console.log("=== Top Çıkar ===");
  await fikstur();
  try {
    const { wo, rolls: [a, b] } = await isEmriVeToplar([["A", RollStatus.STOCK], ["B", RollStatus.WAREHOUSE]]);
    const aday = (await detach.listCandidates(wo)).data;
    check("§1 önizleme: iki yeni top çıkarılabilir", aday.length === 2 && aday.every((x) => x.detachable && x.blockers.length === 0), JSON.stringify(aday.map((x) => x.blockers)));

    const res = await detach.detachRoll(wo, a, "Yanlış okutuldu", ADMIN);
    const aSon = await durum(a);
    check("§2 top önceki durumuna döndü (STOCK), adım ve parti bağı düştü",
      aSon.status === RollStatus.STOCK && aSon.currentStepId === null && aSon.batchId === null && res.data.workOrderReverted === false, JSON.stringify(aSon));
    const defter = await prisma.warehouseMovement.findMany({ where: { rollId: a }, orderBy: { createdAt: "asc" } });
    const ileri = defter.find((x) => x.reasonCode === STOCK_MOVE_REASON.PRODUCTION_ISSUE);
    const ters = defter.find((x) => x.reasonCode === STOCK_MOVE_REASON.ROLL_DETACH);
    check("§3 giriş satırı duruyor, ROLL_DETACH bağlı ters satırı yazıldı (depo ve durum aynalı)",
      !!ileri && ters?.reversesMovementId === ileri.id && ters.toStatus === RollStatus.STOCK && ters.toWarehouseId === WAREHOUSE && ters.notes === "Yanlış okutuldu",
      `${defter.length} satır`);
    const hareket = await prisma.rollMovement.findMany({ where: { rollId: a } });
    const woDurum = (await prisma.workOrder.findUniqueOrThrow({ where: { id: wo }, select: { status: true } })).status;
    check("§4 giriş hareketi damgalı duruyor; iş emrinde top kaldığı için statü yerinde",
      hareket.length === 1 && hareket[0].revokedAt !== null && woDurum === "IN_PROGRESS", `${hareket.length} · ${woDurum}`);

    const satir = (await new WorkOrderTimelineService().list(wo, { limit: 200 })).data.find((x) => x.title === "Top çıkarıldı");
    check("§5 Hareketler'de 'Top çıkarıldı', sebep ve aktörle", !!satir && satir.reason === "Yanlış okutuldu" && (satir.detail ?? "").startsWith(`${TAG}-A`) && !!satir.actor,
      `${satir?.detail} · ${satir?.actor}`);

    const son = await detach.detachRoll(wo, b, "Yanlış iş emri", ADMIN);
    const woSon = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo }, select: { status: true, steps: { select: { status: true } } } });
    const olay = await prisma.workOrderEvent.findFirst({ where: { workOrderId: wo, type: "STATUS_CHANGED", trigger: "ROLL_DETACH" } });
    check("§6 son top çıkınca adımlar PENDING, iş emri Planlandı'ya döndü (STATUS_CHANGED, tetik ROLL_DETACH)",
      son.data.workOrderReverted && woSon.status === "PLANNED" && woSon.steps.every((s) => s.status === "PENDING")
        && olay?.fromValue === "IN_PROGRESS" && olay.toValue === "PLANNED" && (await durum(b)).status === RollStatus.WAREHOUSE,
      `${woSon.status} · ${olay?.fromValue}→${olay?.toValue}`);

    const { wo: wo2, rolls: [c] } = await isEmriVeToplar([["C", RollStatus.STOCK]]);
    await prisma.rollMovement.updateMany({ where: { rollId: c, revokedAt: null }, data: { exitedAt: new Date() } });
    const aday2 = (await detach.listCandidates(wo2)).data.find((x) => x.id === c);
    const islenmis = await hata(() => detach.detachRoll(wo2, c, "Yanlış okutuldu", ADMIN));
    check("§7 işlem görmüş top: önizlemede sebebiyle, çıkarma 409 ROLL_DETACH_PROCESSED, top yerinde",
      aday2?.detachable === false && aday2.blockers.includes("istasyonda işlem gördü")
        && islenmis?.code === "ROLL_DETACH_PROCESSED" && (await durum(c)).status === RollStatus.IN_PRODUCTION,
      `${JSON.stringify(aday2?.blockers)} · ${islenmis?.code}`);

    const { wo: wo3, rolls: [d] } = await isEmriVeToplar([["D", RollStatus.STOCK]]);
    await svc.completeWorkOrder(wo3, { reason: "devir sondası", dispositions: [{ rollId: d, action: "TRANSFER" }], transferOrderMode: "stock" }, ADMIN);
    const wo4 = await prisma.workOrder.findFirstOrThrow({
      where: { splitFromId: wo3 },
      select: { id: true, workOrderNumber: true, splitFrom: { select: { workOrderNumber: true } }, steps: { orderBy: { stepSequence: "asc" }, select: { id: true } } },
    });
    woIds.push(wo4.id);
    const acik = (rollId: string) => prisma.warehouseMovement.findMany({
      where: { rollId, reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE, reversesMovementId: null, reversedBy: { none: {} } },
      select: { workOrderStepId: true },
    });
    const devirSonrasi = await acik(d);
    const devirTersi = await prisma.warehouseMovement.findFirst({ where: { rollId: d, reasonCode: STOCK_MOVE_REASON.PRODUCTION_ISSUE_TRANSFER }, select: { notes: true } });
    const devirDetach = await prisma.warehouseMovement.count({ where: { rollId: d, reasonCode: STOCK_MOVE_REASON.ROLL_DETACH } });
    check("§9 devir: açık üretime alma satırı YENİ iş emrinin ilk adımına bağlandı, eskisi devir tersiyle (ROLL_DETACH değil) kapandı",
      devirSonrasi.length === 1 && devirSonrasi[0]?.workOrderStepId === wo4.steps[0]?.id && (devirTersi?.notes ?? "").startsWith("İş emri devri") && devirDetach === 0,
      `${devirSonrasi.length} açık · ${devirTersi?.notes} · ROLL_DETACH ${devirDetach}`);
    const cikar = await detach.detachRoll(wo4.id, d, "Devirden sonra yanlış", ADMIN);
    const dSon = await prisma.roll.findUniqueOrThrow({ where: { id: d }, select: { status: true, warehouseId: true } });
    const tersSayisi = await prisma.warehouseMovement.count({ where: { rollId: d, reasonCode: STOCK_MOVE_REASON.ROLL_DETACH } });
    check("§9b ⭐ devirden sonra Top Çıkar tersini yazar: açık üretime alma satırı KALMAZ, top rafında (STOCK, depo)",
      cikar.data.status === RollStatus.STOCK && dSon.status === RollStatus.STOCK && dSon.warehouseId === WAREHOUSE
        && tersSayisi === 1 && (await acik(d)).length === 0,
      `${dSon.status} · ters ${tersSayisi} · açık ${(await acik(d)).length}`);
    const cizelge = async (id: string) => (await new WorkOrderTimelineService().list(id, { limit: 200 })).data
      .filter((x) => (x.detail ?? "").startsWith(`${TAG}-D`)).map((x) => `${x.title}|${x.detail}`);
    const [eski, yeni] = [await cizelge(wo3), await cizelge(wo4.id)];
    check("§9c ⭐ Hareketler: eskide 'İş emrine devredildi → yeni', yenide 'Devirle üretime alındı ← eski'; devir 'Top çıkarıldı' sayılmaz",
      eski.length === 1 && eski[0]!.startsWith("İş emrine devredildi|") && eski[0]!.endsWith(`→ ${wo4.workOrderNumber}`)
        && yeni.length === 2 && yeni.some((x) => x.startsWith("Devirle üretime alındı|") && x.endsWith(`← ${wo4.splitFrom?.workOrderNumber}`))
        && yeni.some((x) => x.startsWith("Top çıkarıldı|")),
      `eski ${JSON.stringify(eski)} · yeni ${JSON.stringify(yeni)}`);

    const ikinci = await hata(() => detach.detachRoll(wo, a, "tekrar", ADMIN));
    const sebepsiz = await hata(() => detach.detachRoll(wo2, c, " ", ADMIN));
    check("§8 aynı top ikinci kez 404, sebepsiz 400", ikinci?.status === 404 && sebepsiz?.status === 400, `${ikinci?.status}/${sebepsiz?.status}`);
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
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...woIds, ...stepIds] } } });
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
