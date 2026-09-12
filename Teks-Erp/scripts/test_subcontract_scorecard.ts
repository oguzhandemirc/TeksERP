// =============================================================================
// Test: FASON KARNESİ
// Çalıştır: npx tsx scripts/test_subcontract_scorecard.ts
// =============================================================================
// ÜÇ KRİTİK KURAL, üçü de sessizce bozulabilir ve üçü de firmanın ALEYHİNE
// yanlışlar (yani rapor haksız bir suçlama üretir):
//   1. AÇIK KALEM FİRE DEĞİLDİR. Henüz dönmemiş mal fire sayılırsa dün sevk
//      edilmiş bir parti %100 fire görünür.
//   2. DÖNEN METRAJ TÜM kabul satırlarının TOPLAMIDIR. 100 m'lik top 2×48 m
//      olarak dönebilir; `DISTINCT ON` ile teke indirmek 52 m'yi sahte fire yazar.
//   3. MÜŞTERİYE GİDEN METRE BAŞARILI TESLİMDİR: fire = giden − dönen −
//      müşteriye giden, payda giden metrenin tamamı. Tam, kısmi (bölünme) ve
//      alt küme doğrudan sevkin üçü de aynı kuralla ölçülür (§3, §7, §8);
//      yalnız tam sevki tanıyan eski evren süzgeci kısmi sevkte müşteriye giden
//      metreyi fire ya da hiç kapanmayan açık bakiye yazıyordu.
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { OPEN_OUTSTANDING } from "../src/services/helpers/fason-open-dispatch.helper";
import { getSubcontractScorecard, type SubcontractScorecardRow } from "../src/services/reports/subcontract-scorecard.report.service";
import { resolveCompareRange, type DateRange } from "../src/services/reports/_shared";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/**
 * ÖLÇÜLEMEYEN kontrol — kırmızı DEĞİL, GÖRÜNÜR atlama.
 * (Koşucu özet satırındaki "N atlandı"yı okuyup raporlar.)
 */
let atlanan = 0;
function atla(label: string, neden: string): void {
  atlanan++;
  console.log(`⏭️  ATLANDI — ${label}\n      ↳ ${neden}`);
}

const TAG = `TEST-FSC-${Date.now()}`;
const RANGE: DateRange = {
  from: new Date("2096-04-01T00:00:00.000Z"),
  to: new Date("2096-04-30T23:59:59.999Z"),
};
const SENT = new Date("2096-04-10T08:00:00.000Z");
const BACK = new Date("2096-04-14T08:00:00.000Z"); // 4 gün sonra
const PREV_SENT = new Date("2096-03-10T08:00:00.000Z");
const PREV_BACK = new Date("2096-03-20T08:00:00.000Z");

const ids = {
  receiptItems: [] as string[], receipts: [] as string[],
  dispatchItems: [] as string[], dispatches: [] as string[],
  rolls: [] as string[], batches: [] as string[], steps: [] as string[],
  wos: [] as string[], stations: [] as string[], subs: [] as string[],
};

async function main(): Promise<void> {
  console.log("\n=== Fason Karnesi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) { console.log("❌ Ön koşul yok (aktif kumaş gerekli)"); fail++; return; }

  // ── Zincir ────────────────────────────────────────────────────────────────
  const station = await prisma.station.create({
    data: { code: `${TAG}-STN`, name: "Fason testi", type: "EXTERNAL" }, select: { id: true },
  });
  ids.stations.push(station.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true },
  });
  ids.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true },
  });
  ids.steps.push(step.id);
  const batch = await prisma.batch.create({
    data: { batchNumber: `${TAG}-B`, workOrderId: wo.id }, select: { id: true },
  });
  ids.batches.push(batch.id);
  const subA = await prisma.subcontractor.create({ data: { code: `${TAG}-A`, name: `Boyahane A ${TAG}` }, select: { id: true } });
  const subB = await prisma.subcontractor.create({ data: { code: `${TAG}-B`, name: `Boyahane B ${TAG}` }, select: { id: true } });
  ids.subs.push(subA.id, subB.id);

  const mkRoll = async (qty: number): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: qty, currentQty: qty, status: "AT_SUBCONTRACTOR",
        entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-R${ids.rolls.length}`,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };

  const mkDispatch = async (o: {
    subId: string; at: Date; direct?: boolean; cancelled?: boolean; qtys: number[];
  }): Promise<string[]> => {
    const d = await prisma.subcontractorDispatch.create({
      data: {
        dispatchNo: `${TAG}-SD${ids.dispatches.length}`,
        workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: o.subId,
        dispatchedAt: o.at,
        ...(o.direct ? { directShippedAt: o.at, directShipReason: "test" } : {}),
        ...(o.cancelled ? { cancelledAt: o.at, cancelReason: "test" } : {}),
      },
      select: { id: true },
    });
    ids.dispatches.push(d.id);
    const itemIds: string[] = [];
    for (const q of o.qtys) {
      const rid = await mkRoll(q);
      const di = await prisma.subcontractorDispatchItem.create({
        data: { dispatchId: d.id, rollId: rid, dispatchedQty: q }, select: { id: true },
      });
      ids.dispatchItems.push(di.id);
      itemIds.push(di.id);
    }
    return itemIds;
  };

  const mkReceipt = async (o: { subId: string; at: Date; back: Array<{ srcItemId: string; qty: number }> }) => {
    const r = await prisma.subcontractorReceipt.create({
      data: {
        receiptNo: `${TAG}-SR${ids.receipts.length}`,
        subcontractorId: o.subId, workOrderId: wo.id, stepId: step.id, receivedAt: o.at,
      },
      select: { id: true },
    });
    ids.receipts.push(r.id);
    for (const b of o.back) {
      const newRoll = await mkRoll(b.qty);
      const ri = await prisma.subcontractorReceiptItem.create({
        data: { receiptId: r.id, newRollId: newRoll, sourceDispatchItemId: b.srcItemId },
        select: { id: true },
      });
      ids.receiptItems.push(ri.id);
    }
  };

  // ── FIXTURE ────────────────────────────────────────────────────────────────
  // Boyahane A:
  //   • 100 m gitti → 48 + 48 = 96 m döndü (ÇOK SATIRLI dönüş, kural 2)
  //   • 200 m gitti → HİÇ dönmedi (AÇIK, kural 1 — fireye girmemeli)
  const [a1, a2] = await mkDispatch({ subId: subA.id, at: SENT, qtys: [100, 200] });
  await mkReceipt({ subId: subA.id, at: BACK, back: [{ srcItemId: a1!, qty: 48 }, { srcItemId: a1!, qty: 48 }] });
  void a2;
  // Boyahane B: 500 m DOĞRUDAN müşteriye sevk edildi (kural 3 — fireye girmemeli)
  await mkDispatch({ subId: subB.id, at: SENT, direct: true, qtys: [500] });
  // İptal edilmiş sevk — hiçbir yerde sayılmamalı
  await mkDispatch({ subId: subB.id, at: SENT, cancelled: true, qtys: [700] });
  // Önceki dönem (A): 100 m gitti → 90 m döndü → %10 fire
  const [p1] = await mkDispatch({ subId: subA.id, at: PREV_SENT, qtys: [100] });
  await mkReceipt({ subId: subA.id, at: PREV_BACK, back: [{ srcItemId: p1!, qty: 90 }] });

  const compareRange = resolveCompareRange({ compare: "prev" }, RANGE);
  const sc = await getSubcontractScorecard(RANGE, compareRange);
  const rowA = sc.bySubcontractor.find((r) => r.key === subA.id);

  // ── 1) AÇIK KALEM FİRE DEĞİL ──────────────────────────────────────────────
  console.log("── 1) Açık kalem fire sayılmaz ──");
  check("A: giden metraj 300 m", rowA?.dispatchedQty === 300, `gelen: ${rowA?.dispatchedQty}`);
  check(
    "A: fire PAYDASI yalnız kapanmış kalem (100 m), 300 değil",
    rowA?.closedDispatchedQty === 100,
    `gelen: ${rowA?.closedDispatchedQty}`,
  );
  check("A: açık bakiye 200 m / 1 kalem", rowA?.openQty === 200 && rowA?.openItems === 1,
    `gelen: ${rowA?.openQty} m / ${rowA?.openItems} kalem`);
  check(
    "A: fire %4 (100−96)/100 — açık kalem paydaya girseydi %68 çıkardı",
    rowA?.firePct === 4,
    `gelen: ${rowA?.firePct}`,
  );

  // ── 2) ÇOK SATIRLI DÖNÜŞ TOPLANIR ─────────────────────────────────────────
  console.log("\n── 2) Çok satırlı dönüşte metraj TOPLANIR ──");
  check(
    "A: dönen metraj 96 m (48+48)",
    rowA?.returnedQty === 96,
    `gelen: ${rowA?.returnedQty} — DISTINCT ON ile 48 çıkar ve fire %52 görünürdü`,
  );
  check("A: fire metrajı 4 m", rowA?.fireQty === 4, `gelen: ${rowA?.fireQty}`);

  // ── 3) TAM DOĞRUDAN SEVK = TESLİM, İPTAL DIŞARIDA ─────────────────────────
  console.log("\n── 3) Tam doğrudan sevk başarılı teslimdir, iptal sayılmaz ──");
  const rowB = sc.bySubcontractor.find((r) => r.key === subB.id);
  check("B: giden 500 m (700 m iptal sayılmaz)", rowB?.dispatchedQty === 500,
    `gelen: ${rowB?.dispatchedQty}`);
  check("B: 500 m kapanmış VE müşteriye teslim", rowB?.closedDispatchedQty === 500 && rowB?.deliveredQty === 500,
    `gelen: kapanmış ${rowB?.closedDispatchedQty} / teslim ${rowB?.deliveredQty}`);
  check("B: fire 0 m / %0 (dönmeyen ama teslim edilen metre fire DEĞİL)", rowB?.fireQty === 0 && rowB?.firePct === 0,
    `gelen: ${rowB?.fireQty} m / %${rowB?.firePct}`);
  check("B: açık bakiye yok", rowB?.openItems === 0 && rowB?.openQty === 0,
    `gelen: ${rowB?.openItems} kalem / ${rowB?.openQty} m`);
  check("toplam giden 800 m (300 + 500 teslim; 700 iptal değil)", sc.summary.dispatchedQty === 800,
    `gelen: ${sc.summary.dispatchedQty}`);
  check("özet: teslim 500 m, fire 4 m", sc.summary.deliveredQty === 500 && sc.summary.fireQty === 4,
    `gelen: teslim ${sc.summary.deliveredQty} / fire ${sc.summary.fireQty}`);

  // ── 4) SÜRE ───────────────────────────────────────────────────────────────
  console.log("\n── 4) Dönüş süresi ──");
  check("A: ortalama dönüş 4 gün", rowA?.avgTurnaroundDays === 4, `gelen: ${rowA?.avgTurnaroundDays}`);

  // ── 5) AÇIK SEVK LİSTESİ ──────────────────────────────────────────────────
  console.log("\n── 5) Açık sevk takip listesi ──");
  // ⚠️ `oldestOpen` DÖNEM SÜZGECİNDEN GEÇMEZ ve BİLEREK: açık sevk takibi "şu an
  // fasonda ne var" sorusudur; rapor aralığından önce çıkmış bir sevk tam da
  // görülmek istenendir. Liste EN ESKİ 25 satırdır (report service `LIMIT 25`).
  // Bu bekçinin fixture'ı 2096 tarihli, yani mümkün olan EN YENİ sevk → veritabanında
  // 25'ten fazla açık sevk varken listeye ASLA giremez. Kontrol o yüzden koşula bağlı:
  // ölçülebiliyorsa ölçülür, ölçülemiyorsa SESSİZCE GEÇMEZ, görünür şekilde ATLANIR.
  // (2026-09-05: dev DB'de 260 açık sevk vardı ve kontrol kırmızıya düştü — kod
  // doğruydu, bekçinin varsayımı ortamdaki veriye yaslanmıştı.)
  const acikSevkSayisi = sc.oldestOpen.length;
  const openRow = sc.oldestOpen.find((r) => r.subcontractorName === `Boyahane A ${TAG}`);
  if (openRow === undefined && acikSevkSayisi >= 25) {
    atla(
      "açık sevk listede",
      `liste EN ESKİ 25 ile sınırlı ve dolu (${acikSevkSayisi} satır); 2096 tarihli fixture ` +
        `sevki listeye giremez. Ölçüm ancak açık sevk sayısı 25'in altındayken yapılabilir.`,
    );
  } else {
    check("açık sevk listede", openRow !== undefined && openRow.openQty === 200,
      `gelen: ${openRow?.openQty}`);
  }
  // Bu kontrol HER ZAMAN anlamlıdır: iptal/doğrudan sevkin listede OLMAMASI,
  // listenin dolu olmasından bağımsız bir invariant.
  check(
    "iptal/doğrudan sevkler açık listesine girmez",
    !sc.oldestOpen.some((r) => r.subcontractorName === `Boyahane B ${TAG}`),
  );
  // Listenin kendi sözleşmesi — fixture'dan bağımsız, her koşumda ölçülür.
  check("açık liste EN ESKİDEN yeniye sıralı", 
    sc.oldestOpen.every((r, i) => i === 0 || sc.oldestOpen[i - 1]!.daysOpen >= r.daysOpen),
    `ilk 3: ${sc.oldestOpen.slice(0, 3).map((r) => r.daysOpen).join(", ")}`);
  check("açık liste 25 satırı aşmaz", sc.oldestOpen.length <= 25, `${sc.oldestOpen.length}`);

  // ── 6) KARŞILAŞTIRMA ──────────────────────────────────────────────────────
  console.log("\n── 6) Dönem karşılaştırma ──");
  check("A: önceki dönem fire %10", rowA?.prevFirePct === 10, `gelen: ${rowA?.prevFirePct}`);
  check("A: önceki dönem giden 100 m", rowA?.prevDispatchedQty === 100, `gelen: ${rowA?.prevDispatchedQty}`);
  check("özet önceki dönem fire %10", sc.summary.prevFirePct === 10, `gelen: ${sc.summary.prevFirePct}`);

  await kismiVeAltKumeSenaryolari();
  await damgaVeYabanciSenaryolari();
}

// =============================================================================
// §7–§8 — GERÇEK SERVİSLERLE kısmi ve alt küme doğrudan sevk
// =============================================================================
// Bölünme çocuğu ve alt küme damgası `executeDirectShip`in yan ürünüdür; elle
// kurulan fixture servisin hangi kolonu yazdığını ancak TAHMİN ederdi. Her senaryo
// kendi ayına taşınır ve karne yalnız o ayı okur (yıl koşuma özgü: çökmüş eski
// koşumun artığı aynı pencereye düşmesin).
const svc = new SubcontractorService();
const cardSvc = new TravelerCardService();
const YIL = 2200 + (Date.now() % 700);
const svcIds = { wos: [] as string[], dispatches: [] as string[] };
let svcBc = 0;
const ctx = { item: "", admin: "", stBoya: "", stKursun: "", sub: "", customer: "" };

async function kurSevk(qtys: number[]): Promise<{ woId: string; stepId: string; dispatchId: string; rollIds: string[] }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-SVC${svcIds.wos.length}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ctx.item,
      steps: { create: [{ stationId: ctx.stBoya, stepSequence: 1, status: "PENDING" }, { stationId: ctx.stKursun, stepSequence: 2, status: "PENDING" }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  svcIds.wos.push(wo.id);
  await prisma.$transaction((tx) => cardSvc.createForWorkOrder(tx, wo.id, ctx.admin));
  const rollIds: string[] = [];
  for (const q of qtys) {
    svcBc++;
    const r = await prisma.roll.create({
      data: { barcode: `TST-FSC-${`${Date.now()}`.slice(-7)}${svcBc}`, itemId: ctx.item, initialQty: q, currentQty: q, status: RollStatus.STOCK, width: 250, createdById: ctx.admin },
      select: { id: true },
    });
    rollIds.push(r.id);
  }
  const stepId = wo.steps[0]!.id;
  const d = await svc.dispatch({ workOrderId: wo.id, stepId, subcontractorId: ctx.sub, rollIds }, ctx.admin);
  const dispatchId = (d.data as { id: string }).id;
  svcIds.dispatches.push(dispatchId);
  return { woId: wo.id, stepId, dispatchId, rollIds };
}

let sonAcikListe: Awaited<ReturnType<typeof getSubcontractScorecard>>["oldestOpen"] = [];

/** Sevki `ay`a taşır ve karnede firmanın o aydaki satırını okur. */
async function ayKarnesi(dispatchId: string, ay: number): Promise<SubcontractScorecardRow | undefined> {
  await prisma.subcontractorDispatch.update({ where: { id: dispatchId }, data: { dispatchedAt: new Date(Date.UTC(YIL, ay, 10)) } });
  const k = await getSubcontractScorecard({ from: new Date(Date.UTC(YIL, ay, 1)), to: new Date(Date.UTC(YIL, ay + 1, 1) - 1) });
  sonAcikListe = k.oldestOpen;
  return k.bySubcontractor.find((x) => x.key === ctx.sub);
}

/** Açık sevk listesi dönemden bağımsız EN ESKİ 25'tir — liste doluysa fixture giremez, görünür atlanır (§5). */
async function acikListeMetraji(dispatchId: string, label: string, beklenen: number): Promise<void> {
  const no = (await prisma.subcontractorDispatch.findUnique({ where: { id: dispatchId }, select: { dispatchNo: true } }))?.dispatchNo;
  const row = sonAcikListe.find((r) => r.dispatchNo === no);
  if (row === undefined && sonAcikListe.length >= 25) {
    atla(label, `açık sevk listesi dolu (${sonAcikListe.length}); uzak-gelecek fixture sevki listeye giremez`);
    return;
  }
  check(label, row?.openQty === beklenen, `gelen: ${row?.openQty}`);
}

const ozet = (r: SubcontractScorecardRow | undefined): string =>
  `giden ${r?.dispatchedQty} · kapanmış ${r?.closedDispatchedQty} · dönen ${r?.returnedQty} · teslim ${r?.deliveredQty} · fire ${r?.fireQty} (%${r?.firePct}) · açık ${r?.openItems}/${r?.openQty}`;

async function kismiVeAltKumeSenaryolari(): Promise<void> {
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

  // ── 7) KISMİ DOĞRUDAN SEVK (bölünme) ─────────────────────────────────────
  console.log("\n── 7) Kısmi doğrudan sevk: müşteriye kesilen metre teslimdir ──");
  {
    // 7a: 300 gitti → 100 m müşteriye → kalan 200 m TAM döndü.
    const z = await kurSevk([300]);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci kismi", customerId: ctx.customer, rollIds: z.rollIds, rollShipQtys: { [z.rollIds[0]!]: 100 } }, ctx.admin);
    const cocuk = await prisma.roll.count({ where: { parentRollId: z.rollIds[0]!, directShipmentId: { not: null } } });
    check("7a ön koşul: 100 m bölünme çocuğu doğdu, sevk damgasız", cocuk === 1 &&
      (await prisma.subcontractorDispatch.count({ where: { id: z.dispatchId, directShippedAt: null } })) === 1);
    await svc.receive({ workOrderId: z.woId, stepId: z.stepId, subcontractorId: ctx.sub, returns: [{ rollId: z.rollIds[0]! }], newRolls: [{ qty: 200 }] }, ctx.admin);
    const r = await ayKarnesi(z.dispatchId, 0);
    check("7a: 300 → 100 müşteriye → 200 döndü = fire 0 (eski: 100 m / %33,3)",
      r?.dispatchedQty === 300 && r.closedDispatchedQty === 300 && r.returnedQty === 200 && r.deliveredQty === 100 && r.fireQty === 0 && r.firePct === 0 && r.openItems === 0,
      ozet(r));
  }
  {
    // 7b: KARAR ÖRNEĞİ — 300 gitti → 100 müşteriye → kalan 200'den 180 döndü.
    const z = await kurSevk([300]);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci kismi", customerId: ctx.customer, rollIds: z.rollIds, rollShipQtys: { [z.rollIds[0]!]: 100 } }, ctx.admin);
    await svc.receive({ workOrderId: z.woId, stepId: z.stepId, subcontractorId: ctx.sub, returns: [{ rollId: z.rollIds[0]! }], newRolls: [{ qty: 180 }] }, ctx.admin);
    const r = await ayKarnesi(z.dispatchId, 1);
    check("7b: 300 → 100 müşteriye → 180 döndü = fire 20 m / %6,7 (payda 300, küçültülmez)",
      r?.closedDispatchedQty === 300 && r.returnedQty === 180 && r.deliveredQty === 100 && r.fireQty === 20 && r.firePct === 6.7,
      ozet(r));
  }
  {
    // 7c: 300 gitti → 100 müşteriye → 100 kısmi kabul → kalan 100 "gelmeyecek".
    const z = await kurSevk([300]);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci kismi", customerId: ctx.customer, rollIds: z.rollIds, rollShipQtys: { [z.rollIds[0]!]: 100 } }, ctx.admin);
    await svc.receive({ workOrderId: z.woId, stepId: z.stepId, subcontractorId: ctx.sub, returns: [{ rollId: z.rollIds[0]!, receivedQty: 100 }], newRolls: [{ qty: 100 }] }, ctx.admin);
    await svc.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    const r = await ayKarnesi(z.dispatchId, 2);
    check("7c: 100 müşteriye + 100 kısmi kabul + 100 kapama = fire 100 m / %33,3 (eski: 200 m / %66,7)",
      r?.closedDispatchedQty === 300 && r.returnedQty === 100 && r.deliveredQty === 100 && r.fireQty === 100 && r.firePct === 33.3 && r.openItems === 0,
      ozet(r));
  }
  {
    // 7d: 300 gitti → 100 müşteriye → kalan 200 hâlâ fasonda.
    const z = await kurSevk([300]);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci kismi", customerId: ctx.customer, rollIds: z.rollIds, rollShipQtys: { [z.rollIds[0]!]: 100 } }, ctx.admin);
    const r = await ayKarnesi(z.dispatchId, 3);
    check("7d: kalan fasondayken açık 1 kalem / 200 m (eski: 300 m), fire payında değil",
      r?.openItems === 1 && r.openQty === 200 && r.closedDispatchedQty === 0 && r.fireQty === 0,
      ozet(r));
    await acikListeMetraji(z.dispatchId, "7d: açık sevk listesi de 200 m der (müşteriye kesilen düşülür)", 200);
  }

  // ── 8) ALT KÜME TAM SEVK ──────────────────────────────────────────────────
  console.log("\n── 8) Alt küme: topu tamamen müşteriye giden kalem KAPANMIŞTIR ──");
  {
    const z = await kurSevk([200, 200]);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci altkume", customerId: ctx.customer, rollIds: [z.rollIds[0]!] }, ctx.admin);
    check("8 ön koşul: sevk damgasız kaldı (alt küme)",
      (await prisma.subcontractorDispatch.count({ where: { id: z.dispatchId, directShippedAt: null } })) === 1);
    const once = await ayKarnesi(z.dispatchId, 4);
    check("8a: diğer top fasondayken — 200 m teslim kapanmış, 200 m açık",
      once?.closedDispatchedQty === 200 && once.deliveredQty === 200 && once.fireQty === 0 && once.openItems === 1 && once.openQty === 200,
      ozet(once));
    await acikListeMetraji(z.dispatchId, "8a: açık sevk listesi 200 m der (müşteriye giden top sayılmaz)", 200);
    await svc.receive({ workOrderId: z.woId, stepId: z.stepId, subcontractorId: ctx.sub, returns: [{ rollId: z.rollIds[1]! }], newRolls: [{ qty: 200 }] }, ctx.admin);
    const r = await ayKarnesi(z.dispatchId, 4);
    check("8b: diğer top döndükten sonra açık 0 (eski: sonsuza dek 200 m açık), fire 0",
      r?.closedDispatchedQty === 400 && r.returnedQty === 200 && r.deliveredQty === 200 && r.fireQty === 0 && r.openItems === 0 && r.openQty === 0,
      ozet(r));
    const acik = await prisma.subcontractorDispatch.count({ where: { id: z.dispatchId, ...OPEN_OUTSTANDING } });
    check("8c: sevk artık OPEN_OUTSTANDING değil (helper karneyle aynı cevabı verir)", acik === 0, `gelen: ${acik}`);
  }
}

// =============================================================================
// §9 — DAMGA × KALAN-KAPAMASI ve YABANCI DSK
// =============================================================================
// Denetim bulgusu (2026-09-12): teslim atfı SEVK düzeyinden başlıyordu
// (`directShippedAt IS NOT NULL OR …`), yani damga kalemin kendi topuna
// bakmadan uygulanıyordu. İki sonucu vardı: (1) kalan-kapamasıyla yazılan FİRE
// damga basılınca siliniyor, (2) aynı iki işlem TERS SIRADA yapılınca karne
// farklı rakam veriyordu — yani oran operatörün tuş sırasına bağlıydı.
async function damgaVeYabanciSenaryolari(): Promise<void> {
  console.log("\n── 9) Damga × kalan-kapaması: işlem SIRASI sonucu değiştirmez ──");
  /** 2×200: biri müşteriye, diğeri 'kalan gelmeyecek' → fire 200 / teslim 200. */
  const bekle = (r: SubcontractScorecardRow | undefined, etiket: string): void => {
    check(etiket,
      r?.dispatchedQty === 400 && r.closedDispatchedQty === 400 && r.returnedQty === 0 &&
      r.deliveredQty === 200 && r.fireQty === 200 && r.firePct === 50 && r.openItems === 0,
      ozet(r));
  };
  // Damga durumu iki blok arasında karşılaştırılır (blok kapsamı dışında tutulur).
  let damga9a: Date | null = null;
  {
    // 9a: ÖNCE kapama, SONRA doğrudan sevk.
    const z = await kurSevk([200, 200]);
    await svc.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[1]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci damga sonra", customerId: ctx.customer, rollIds: [z.rollIds[0]!] }, ctx.admin);
    damga9a = (await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: z.dispatchId }, select: { directShippedAt: true } })).directShippedAt;
    // Damga ölçütü kalemlerin TOPUNDAN okunur: kalan-kapamasıyla kapanmış kalem
    // varken sevk "tamamen müşteriye çıkmış" değildir → damga BASILMAZ ve bu karar
    // işlem sırasından bağımsızdır (9b aynı sonucu verir).
    bekle(await ayKarnesi(z.dispatchId, 5), "9a: kapama + damga → fire 200 m / %50 (eski: damga fireyi siliyordu, 0)");
  }
  {
    // 9b: TERS SIRA — önce doğrudan sevk (damgasız), sonra kapama.
    const z = await kurSevk([200, 200]);
    await svc.executeDirectShip({ dispatchId: z.dispatchId, reason: "bekci damga once", customerId: ctx.customer, rollIds: [z.rollIds[0]!] }, ctx.admin);
    await svc.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[1]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    const damga2 = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: z.dispatchId }, select: { directShippedAt: true } });
    bekle(await ayKarnesi(z.dispatchId, 6), "9b: TERS SIRA aynı rakamı verir (eski: %40 ↔ %0 ayrışıyordu)");
    check("9c: damga da işlem sırasından bağımsız (iki sırada da basılmaz)",
      damga9a === null && damga2.directShippedAt === null,
      `9a ${damga9a ? "DOLU" : "null"} · 9b ${damga2.directShippedAt ? "DOLU" : "null"}`);
  }

  console.log("\n── 10) Yabancı DSK: başka sevkten çıkmış top ÖLÇÜLEMEZ ──");
  {
    // Topun DSK'sı BAŞKA sevke ait (ardışık fason / tarihsel kalem taşıması).
    // Kapanmışa yazmak firmaya %100 fire, açığa yazmak "fasonda bekliyor" yalanı
    // olurdu → ayrı kova, sayısı basılır.
    const yabanci = await kurSevk([100]);
    await svc.executeDirectShip({ dispatchId: yabanci.dispatchId, reason: "bekci yabanci dsk", customerId: ctx.customer, rollIds: yabanci.rollIds }, ctx.admin);
    const yabanciDsk = await prisma.directShipment.findFirstOrThrow({ where: { dispatchId: yabanci.dispatchId }, select: { id: true } });

    const z = await kurSevk([300]);
    await prisma.roll.update({ where: { id: z.rollIds[0]! }, data: { directShipmentId: yabanciDsk.id } });
    const r = await ayKarnesi(z.dispatchId, 7);
    check("10a: ölçülemez kovaya yazıldı (1 kalem / 300 m)",
      r?.unattributedItems === 1 && r.unattributedQty === 300, `ölçülemez ${r?.unattributedItems}/${r?.unattributedQty}`);
    check("10b: ne kapanmışa ne açığa girdi (fire ve açık bakiye temiz)",
      r?.closedDispatchedQty === 0 && r.fireQty === 0 && r.openItems === 0 && r.openQty === 0, ozet(r));
  }
}

async function svcTemizle(): Promise<void> {
  if (svcIds.wos.length === 0) return;
  const woIds = svcIds.wos;
  const dispatchIds = svcIds.dispatches;
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
  const dsIds = (await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } })).map((d) => d.id);
  const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
  const taban = (await prisma.roll.findMany({
    where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceiptId: { in: receiptIds } }, { directShipmentId: { in: dsIds } }, { barcode: { startsWith: "TST-FSC-" } }] },
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
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    try {
      await svcTemizle();
    } catch (e) {
      console.error("§7-§8 temizlik hatası:", e instanceof Error ? e.message : e);
      fail++;
    }
    if (ids.receiptItems.length) await prisma.subcontractorReceiptItem.deleteMany({ where: { id: { in: ids.receiptItems } } });
    if (ids.receipts.length) await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
    if (ids.dispatchItems.length) await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: ids.dispatchItems } } });
    if (ids.dispatches.length) await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.batches.length) await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } });
    if (ids.steps.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } });
    if (ids.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
    if (ids.subs.length) await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
    if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${atlanan > 0 ? `, ${atlanan} atlandı` : ""} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
