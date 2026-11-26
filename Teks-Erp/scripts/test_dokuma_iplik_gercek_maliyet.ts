// =============================================================================
// BEKÇİ — Çözgü ipliği gerçek maliyeti lot fiyatından (devere maliyet dilim 3; plan PLAN-devere-maliyet-1126 §3)
// =============================================================================
// Uçtan uca: iplik lotu (mal kabul fiyatı) → fason devere sevki → kabul (sevk kalemi lot tahsisi) → levent tezgâha →
// top doğar (CONSUMED) → dokuma gerçek maliyetinde "Çözgü ipliği /m" + iş emri ayrıntısı satırı.
//   §1 ⭐ el hesabı: 3000 tel × 150 den × 1000 m = 50 kg/levent × lot 100 TL/kg = 5000 TL → 5 TL/çözgü m;
//      top 100 m kumaş, take-up %20 → 125 m → 625 TL → 6,25 TL/m; kaynak LOT
//   §2 lot fiyatsız → maliyet kartı iplik fiyatı (50 TL/kg) → 2,5 TL/çözgü m → 3,125 TL/m; tahmini = tamamı
//   §3 ⭐ sipariş kapanış firesi 10 kg × 100 = 1000 TL, siparişin 2000 m sarımına → +0,5 TL/çözgü m → 6,875 TL/m
//   §4 iki levent tek top (lot + kart) → KARMA, tahmini pay ayrı
//   §5 fiyat yok (lot fiyatsız, kart yok) → null + IPLIK_FIYATI, hücre "eksik" (0 değil)
//   §6 kendi devere leventi → WARP_ISSUE lotundan fiyat (LOT)
//   §7 iş emri ayrıntısı DTO: standart (WARP_YARN satırı) ↔ gerçekleşen, kaynak, tahmini rozeti
//   §8 ⭐ iptal edilen mal kabul fişinin fiyatı lot fiyatı değildir → kart fiyatına / eksiğe düşer
//   §9 iplik kapalı → lot okunmaz, kart fiyatı (tahmini) ya da eksik; devere kapalı → alanlar null
//   §10 tek kaynak (metin): devere tarafı iplik defterine dokunmaz (köprüden okuyucu), dinamik import, float yok
// NEGATİF SONDALAR (2026-11-26, hepsi kırmızı verdi, geri alındı):
//   ① lot okuyucusunda fiş süzgeci `status: ACTIVE` → `goodsReceiptId not null` (iptal fiş de sayılır) → §8a ❌
//   ② fire payı levente eklenmedi → §3a/§4a/§7a ❌   ③ lot fiyatı yok sayıldı → §1a/§1b/§3a/§4a/§6a/§7a ❌
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döner, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GoodsReceiptStatus, MachineDataSource, Prisma, RollEntrySource, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { dispatchWarpingOrder } from "../src/services/warping-order/dispatch";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { settleWarpingOrder } from "../src/services/warping-order/settle";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { applyWarpBeamEventTx } from "../src/services/helpers/warp-beam-event.helper";
import { weavingActualCostTx, type WeavingActualCost } from "../src/services/helpers/weaving-actual-cost.helper";
import { buildWeavingEfficiencySunumu, EKSIK, weavingEfficiencyTable, type WeavingEfficiencyReport } from "../src/services/reports/weaving-efficiency.report";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { getWeavingOrderActualCost } from "../src/services/weaving-order-actual-cost.service";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-DIM-${process.pid}`;
const code = (s: string) => `${TAG}-${s}`.slice(0, 32);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const eq = (d: Prisma.Decimal | null | undefined, v: Prisma.Decimal.Value) => d != null && d.toDecimalPlaces(6).eq(D(v).toDecimalPlaces(6));
const s = (d: Prisma.Decimal | null | undefined) => (d == null ? "null" : d.toString());
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED,
  SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

function staticSection(): void {
  console.log("\n§10 — tek kaynak (metin)");
  const src = (f: string) => yorumlariSok(readFileSync(path.join(__dirname, "..", f), "utf8"));
  const yarn = src("src/services/helpers/warp-yarn-actual.helper.ts");
  const lot = src("src/services/helpers/warp-yarn-lot-price.helper.ts");
  const bridge = src("src/services/helpers/maliyet-bridge.helper.ts");
  const weaving = src("src/services/helpers/weaving-actual-cost.helper.ts");
  check("§10a devere tarafı iplik defterine (`yarnMovement`) DOĞRUDAN dokunmaz; lot fiyatı/WARP_ISSUE köprünün verdiği okuyucudan",
    !/\b(db|tx|prisma)\.yarnMovement\b/.test(yarn) && /\bdb\.yarnMovement\b/.test(lot) && !/^import (?!type).*warp-yarn-lot-price/m.test(yarn));
  check("§10b köprü iki dosyayı DİNAMİK import eder; iplik okuyucusu `readIplikEnabled` arkasında; dokuma helper'ı köprüden okur",
    /await import\("\.\/warp-yarn-actual\.helper"\)/.test(bridge) && /readIplikEnabled\(\)\) \? await import\("\.\/warp-yarn-lot-price\.helper"\)/.test(bridge)
      && /loadRollWarpYarnCosts\(/.test(weaving) && !/warp-yarn-(actual|lot-price)/.test(weaving));
  check("§10c yeni helper'larda JS sayı aritmetiği yok", ![yarn, lot].some((t) => /\bNumber\(|parseFloat|toNumber\(/.test(t)));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== ÇÖZGÜ İPLİĞİ → DOKUMA GERÇEK MALİYETİ ===");
  staticSection();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const whId = await fixtureWarehouseId();
  const inventory = new InventoryService();
  const ids = { yarns: [] as string[], lots: [] as string[], receipts: [] as string[], specs: [] as string[], orders: [] as string[], beams: [] as string[], rolls: [] as string[], wos: [] as string[], machines: [] as string[], cards: [] as string[] };
  let stationId: string | null = null;
  let versionId: string | null = null;
  let mf: MaliyetFikstur | null = null;
  try {
    for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await reconcileReasonPresets();
    mf = await fiksturKur("DIM");
    const fabricId = mf.fabricId;
    versionId = (await prisma.standardCostVersion.create({
      data: {
        itemId: fabricId, versionNo: 1, parameterSetId: mf.paramId, rawCostPerMTry: D("7"), totalCostPerMTry: D("7"),
        warpKgPerM: D("0.05"), weftKgPerM: D("0.05"), loomMPerHour: D("10"), fxRates: {}, inputSnapshot: {}, inputHash: "e".repeat(64), warnings: [],
        lines: { create: [["WARP_YARN", "4"], ["LOOM_MACHINE", "3"]].map(([component, amount], i) => ({ lineNo: i + 1, component: component as "WARP_YARN", label: component, amountPerMTry: D(amount) })) },
      },
      select: { id: true },
    })).id;
    stationId = (await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: code("DK"), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } })).id;

    // İplik + lot; `price` verilirse lot TRY mal kabul fişiyle (fiyat satıra fikstürce yazılır — okuyucuyu ölçmek için).
    const mkYarn = async (k: string, price: string | null) => {
      const y = (await prisma.item.create({ data: { code: code(k), name: `${TAG} iplik ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
      ids.yarns.push(y);
      const lot = (await prisma.yarnLot.create({ data: { itemId: y, lotNo: code(`${k}L`) }, select: { id: true } })).id;
      ids.lots.push(lot);
      const receiptId = price ? (await prisma.goodsReceipt.create({ data: { receiptNo: code(`GR${k}`), warehouseId: whId, currency: "TRY" }, select: { id: true } })).id : null;
      if (receiptId) ids.receipts.push(receiptId);
      const m = await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: y, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 1000, lotId: lot, goodsReceiptId: receiptId, reason: `${TAG} giriş` }));
      if (price) await prisma.yarnMovement.update({ where: { id: m.movementId }, data: { unitPrice: D(price) } });
      const spec = (await prisma.warpSpec.create({ data: { code: code(`S${k}`), name: `${TAG} ${k}`, yarnItemId: y, endsCount: 3000, takeUpPct: 20, yarns: { create: [{ yarnItemId: y, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
      ids.specs.push(spec);
      return { id: y, lot, spec, receiptId };
    };
    const X = await mkYarn("X", "100");
    const Y = await mkYarn("Y", null);
    const Z = await mkYarn("Z", null);
    ids.cards.push((await prisma.yarnCostPrice.create({ data: { yarnItemId: Y.id, currency: "TRY", pricePerKg: D(50) }, select: { id: true } })).id);

    const order = async (yarn: { id: string; lot: string; spec: string }, beams: number) => {
      const o = (await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: yarn.spec, beamLines: [{ beamCount: beams, beamLengthM: 1000 }] }, U)).data.id;
      ids.orders.push(o);
      const d = await dispatchWarpingOrder(o, { clientToken: randomUUID(), lines: [{ yarnItemId: yarn.id, warehouseId: whId, lotId: yarn.lot, qtyKg: beams * 50 + 10 }] }, U);
      const key = (await receiveWarpingOrder(o, { clientToken: randomUUID(), deliveryNoteNo: `IRS-${ids.orders.length}`, beams: Array.from({ length: beams }, () => ({ lengthM: 1000 })) }, U)).receiptKey;
      const beamIds = (await prisma.warpBeam.findMany({ where: { warpingReceiptKey: key }, select: { id: true }, orderBy: { beamNo: "asc" } })).map((b) => b.id);
      return { id: o, itemId: d.yarnItems[0]!.dispatchItemId, beamIds };
    };
    const loomFor = async (n: string, beamIds: string[]) => {
      const m = (await prisma.machine.create({ data: { stationId: stationId!, name: `${TAG} ${n}`, code: code(n), warpBeamSlots: Math.max(1, beamIds.length) }, select: { id: true } })).id;
      ids.machines.push(m);
      const wo = (await prisma.weavingOrder.create({ data: { weavingOrderNumber: code(`W${n}`), itemId: fabricId, executionKind: "IN_HOUSE", status: "COMPLETED" }, select: { id: true } })).id;
      ids.wos.push(wo);
      const run = (await prisma.machineRun.create({ data: { machineId: m, weavingOrderId: wo, startedAt: new Date(Date.now() - 3_600_000) }, select: { id: true } })).id;
      for (const [i, b] of beamIds.entries()) await mountBeam(b, { machineId: m, position: i + 1 });
      return { machineId: m, woId: wo, runId: run };
    };
    const top = async (loom: { machineId: string; runId: string }, meters: number) => {
      const doff = (await openDoff({ machineId: loom.machineId, machineRunId: loom.runId, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
      const r = await inventory.createInitialEntry({ itemId: fabricId, initialQty: meters }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: doff });
      ids.rolls.push((r.data as { id: string }).id);
    };
    const row = async (woId: string): Promise<WeavingActualCost> => (await weavingActualCostTx(prisma, [woId], "OTURUM"))[0]!;
    const report = (rows: WeavingActualCost[]): WeavingEfficiencyReport => ({ currency: "TRY", fxRate: null, rows, runlessMeters: "0" });
    const cell = (w: WeavingActualCost, key: string) => weavingEfficiencyTable(report([w])).satirlar[0]![key];

    const A = await order(X, 2);
    const B = await order(Y, 2);
    const C = await order(Z, 1);
    const allocs = await prisma.warpBeamYarnAllocation.findMany({ where: { warpingOrderId: A.id }, select: { kg: true, dispatchItem: { select: { lotId: true } } } });
    check("§0 fikstür: A'nın iki leventi sevk kalemi lotundan 50'şer kg tahsis aldı", allocs.length === 2 && allocs.every((a) => eq(a.kg, 50) && a.dispatchItem.lotId === X.lot), JSON.stringify(allocs));

    console.log("\n§1 — el hesabı (lot fiyatı)");
    const LA = await loomFor("TA", [A.beamIds[0]!]);
    await top(LA, 100);
    const wA = await row(LA.woId);
    check("§1a ⭐ 125 m × (50 kg × 100 TL ÷ 1000 m) = 625 TL → 6,25 TL/m; kaynak LOT; tahmini 0; eksik yok",
      eq(wA.warpYarnCostTry, 625) && eq(wA.warpYarnPerMTry, "6.25") && eq(wA.warpYarnCoveredMeters, 100) && wA.warpYarnSource === "LOT" && eq(wA.warpYarnEstimatedTry, 0) && wA.warpYarnMissing?.length === 0,
      `${s(wA.warpYarnCostTry)} · ${wA.warpYarnSource} · ${wA.warpYarnMissing}`);
    check("§1b tablo: 'Çözgü ipliği /m' 6,25 · kaynak 'lot fiyatı'; tezgâh standardı çözgü ipliğini İÇERMEZ (3), çözgü standardı 4",
      cell(wA, "cozguIplikM") === 6.25 && cell(wA, "cozguIplikKaynak") === "lot fiyatı" && eq(wA.standardPerMTry, 3) && eq(wA.standardWarpYarnPerMTry, 4),
      `${cell(wA, "cozguIplikM")} | ${cell(wA, "cozguIplikKaynak")} | ${s(wA.standardPerMTry)}`);

    console.log("\n§2 — maliyet kartı fiyatı (tahmini)");
    const LB = await loomFor("TB", [B.beamIds[0]!]);
    await top(LB, 100);
    const wB = await row(LB.woId);
    check("§2a ⭐ lot fiyatsız → kart 50 TL/kg: 125 × 2,5 = 312,5 TL → 3,125 TL/m; MALIYET_FIYATI, tahmini = tamamı",
      eq(wB.warpYarnCostTry, "312.5") && eq(wB.warpYarnPerMTry, "3.125") && wB.warpYarnSource === "MALIYET_FIYATI" && eq(wB.warpYarnEstimatedTry, "312.5"),
      `${s(wB.warpYarnCostTry)} · ${wB.warpYarnSource}`);
    check("§2b tablo kaynağı 'maliyet kartı fiyatı (tahmini)'; sunumda tahmin uyarısı",
      cell(wB, "cozguIplikKaynak") === "maliyet kartı fiyatı (tahmini)" && buildWeavingEfficiencySunumu(report([wA, wB]), resolveCoreDayRange({}, 30)).uyarilar.some((u) => /maliyet kartındaki iplik fiyatından tahmin/.test(u)));

    console.log("\n§3 — sipariş firesi");
    await settleWarpingOrder(A.id, { clientToken: randomUUID(), lines: [{ dispatchItemId: A.itemId, wasteKg: 10 }] }, U);
    const wasteRows = await prisma.warpingYarnWaste.count({ where: { warpingOrderId: A.id, kind: "WASTE" } });
    const wA3 = await row(LA.woId);
    check("§3a ⭐ fire 10 kg × 100 TL = 1000 TL ÷ 2000 m = +0,5 TL/çözgü m → 125 × 5,5 = 687,5 TL → 6,875 TL/m",
      wasteRows === 1 && eq(wA3.warpYarnCostTry, "687.5") && eq(wA3.warpYarnPerMTry, "6.875") && wA3.warpYarnSource === "LOT", `fire=${wasteRows} · ${s(wA3.warpYarnCostTry)}`);

    console.log("\n§4 — iki levent tek top (KARMA)");
    const LAB = await loomFor("TAB", [A.beamIds[1]!, B.beamIds[1]!]);
    await top(LAB, 40);
    const wAB = await row(LAB.woId);
    check("§4a ⭐ 50 m × 5,5 + 50 m × 2,5 = 400 TL → 10 TL/m; KARMA; tahmini 125",
      eq(wAB.warpYarnCostTry, 400) && eq(wAB.warpYarnPerMTry, 10) && wAB.warpYarnSource === "KARMA" && eq(wAB.warpYarnEstimatedTry, 125) && cell(wAB, "cozguIplikKaynak") === "karma (kısmen tahmini)",
      `${s(wAB.warpYarnCostTry)} · ${wAB.warpYarnSource} · ${s(wAB.warpYarnEstimatedTry)}`);

    console.log("\n§5 — fiyat yok");
    const LC = await loomFor("TC", [C.beamIds[0]!]);
    await top(LC, 10);
    const wC = await row(LC.woId);
    check("§5a ⭐ lot fiyatsız + kart yok → null + IPLIK_FIYATI; hücre 'eksik' (0 değil); devere payı etkilenmez",
      wC.warpYarnCostTry === null && wC.warpYarnPerMTry === null && wC.warpYarnMissing?.includes("IPLIK_FIYATI") === true && cell(wC, "cozguIplikM") === EKSIK
        && cell(wC, "cozguIplikKaynak") === "eksik: çözgü ipliği fiyatı yok", `${cell(wC, "cozguIplikM")} | ${cell(wC, "cozguIplikKaynak")}`);

    console.log("\n§6 — kendi devere leventi");
    const own = (await createWarpBeam({ warpSpecId: X.spec, plannedLengthM: 1000, originKind: WarpBeamOrigin.IN_HOUSE })).data.id;
    ids.beams.push(own);
    await prisma.$transaction((tx) => applyWarpBeamEventTx(tx, { beamId: own, kind: "WOUND", from: WarpBeamStatus.PLANNED, to: WarpBeamStatus.READY, data: { lengthM: 1000, endsCount: 3000, denier: 150, theoreticalKg: 50, kgSource: WarpKgSource.THEORETICAL } }));
    // Sarım servisinin kırılımı ve iplik çıkışı: maliyet sorusu yalnız bu iki satırı okur → doğrudan kurulur.
    const wound = await prisma.warpBeamEvent.findFirstOrThrow({ where: { beamId: own, kind: "WOUND" }, select: { id: true } });
    await prisma.warpBeamEventYarn.create({ data: { eventId: wound.id, yarnItemId: X.id, endsCount: 3000, denier: 150, theoreticalKg: 50 } });
    await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: X.id, warehouseId: whId, kind: YarnMovementKind.WARP_ISSUE, qtyKg: 50, lotId: X.lot, warpBeamId: own, reason: `${TAG} sarım` }));
    const LH = await loomFor("TH", [own]);
    await top(LH, 10);
    const wH = await row(LH.woId);
    check("§6a kendi leventi: WARP_ISSUE lotunun fiyatı → 12,5 m × 5 = 62,5 TL → 6,25 TL/m; LOT",
      eq(wH.warpYarnCostTry, "62.5") && eq(wH.warpYarnPerMTry, "6.25") && wH.warpYarnSource === "LOT", `${s(wH.warpYarnCostTry)} · ${wH.warpYarnSource} · ${wH.warpYarnMissing}`);

    console.log("\n§7 — iş emri ayrıntısı (DTO)");
    const dA = await getWeavingOrderActualCost(LA.woId);
    const yA = dA.satirlar.find((x) => x.anahtar === "COZGU_IPLIGI");
    const tA = dA.satirlar.find((x) => x.anahtar === "TEZGAH");
    check("§7a ⭐ Çözgü ipliği satırı: standart 4 (WARP_YARN) ↔ gerçekleşen 6,875; kaynak 'lot fiyatı'; tahmini değil; tezgâh standardı 3",
      yA?.standartTlM === "4" && yA.gercekTlM === "6.875" && yA.kaynak === "lot fiyatı" && yA.tahmini === false && yA.eksik.length === 0 && tA?.standartTlM === "3", JSON.stringify(yA));
    const yB = (await getWeavingOrderActualCost(LB.woId)).satirlar.find((x) => x.anahtar === "COZGU_IPLIGI");
    const yC = (await getWeavingOrderActualCost(LC.woId)).satirlar.find((x) => x.anahtar === "COZGU_IPLIGI");
    check("§7b tahmini satır rozetli; fiyatsız satır gerçekleşen null + eksik metni", yB?.tahmini === true && yB.gercekTlM === "3.125" && yC?.gercekTlM === null && yC.eksik.includes("çözgü ipliği fiyatı yok"), `${JSON.stringify(yB)} ${JSON.stringify(yC)}`);

    console.log("\n§8 — iptal edilen mal kabul fişi");
    await prisma.goodsReceipt.update({ where: { id: X.receiptId! }, data: { status: GoodsReceiptStatus.CANCELLED, cancelledAt: new Date(), cancelReason: `${TAG} sonda` } });
    const wA8 = await row(LA.woId);
    check("§8a ⭐ iptal fişin fiyatı sayılmaz → X'in kartı da yok → null + IPLIK_FIYATI", wA8.warpYarnCostTry === null && wA8.warpYarnMissing?.includes("IPLIK_FIYATI") === true, `${s(wA8.warpYarnCostTry)} · ${wA8.warpYarnMissing}`);
    await prisma.goodsReceipt.update({ where: { id: X.receiptId! }, data: { status: GoodsReceiptStatus.ACTIVE, cancelledAt: null, cancelReason: null } });

    console.log("\n§9 — modül kapıları");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    const [wA9, wB9] = await weavingActualCostTx(prisma, [LA.woId, LB.woId], "OTURUM");
    check("§9a iplik kapalı → lot okunmaz: X (kartsız) eksik; Y kart fiyatıyla aynı (3,125)",
      wA9!.warpYarnCostTry === null && wA9!.warpYarnMissing?.includes("IPLIK_FIYATI") === true && eq(wB9!.warpYarnPerMTry, "3.125") && wB9!.warpYarnSource === "MALIYET_FIYATI");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const wOff = await row(LA.woId);
    check("§9b devere kapalı → çözgü ipliği alanları null; kolon var hücre boş",
      wOff.warpYarnCostTry === null && wOff.warpYarnMissing === null && cell(wOff, "cozguIplikM") === null && cell(wOff, "cozguIplikKaynak") === null);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
  } finally {
    const orderBeams = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: ids.orders } }, select: { id: true } })).map((b) => b.id);
    const beamIds = [...orderBeams, ...ids.beams];
    const dids = (await prisma.subcontractorDispatch.findMany({ where: { warpingOrderId: { in: ids.orders } }, select: { id: true } })).map((d) => d.id);
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: ids.rolls }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: ids.rolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: ids.orders }, reversesId: { not: null } } });
    await prisma.warpingYarnWaste.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: ids.orders }, reversesId: { not: null } } });
    await prisma.warpingOrderSettlement.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpBeamEventYarn.deleteMany({ where: { event: { beamId: { in: beamIds } } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: [...dids, ...beamIds] } } }).catch(() => undefined);
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: ids.yarns } } });
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: ids.yarns } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dids } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dids } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: ids.orders } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: ids.orders } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.orders, ...dids, ...beamIds, ...ids.wos] } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: ids.wos } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: ids.specs } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: ids.lots } } });
    await prisma.yarnCostPrice.deleteMany({ where: { id: { in: ids.cards } } });
    await prisma.item.deleteMany({ where: { id: { in: ids.yarns } } });
    if (versionId) {
      await prisma.standardCostLine.deleteMany({ where: { versionId } });
      await prisma.standardCostVersion.deleteMany({ where: { id: versionId } });
    }
    if (mf) await fiksturSil(mf);
    for (const key of SETTING_FOTO) {
      const f = foto.find((x) => x.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
