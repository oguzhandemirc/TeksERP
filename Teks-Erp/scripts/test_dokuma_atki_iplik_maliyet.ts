// =============================================================================
// BEKÇİ — Atkı ipliği gerçek maliyeti: norm miktar × gerçek fiyat (devere maliyet K7; plan PLAN-devere-maliyet-1126 §3)
// =============================================================================
// Atkının topa lot bağı yok (tartılmaz): miktar standart sürümün WEFT_YARN satırı (kg/m) × top metresi; fiyat topun
// doğduğu ana kadar son giren lotun mal kabul fiyatı → maliyet kartı (tahmini) → eksik. Müşteri lotu → bilgi.
//   §1 ⭐ el hesabı: norm 0,04 kg/m × 100 m = 4 kg × son lot 100 TL (eski lot 80 TL değil) = 400 TL → 4 TL/m; LOT
//   §2 lot fiyatsız → kart 50 TL/kg → 2 TL/m; MALIYET_FIYATI, tahmini = tamamı
//   §3 fiyat yok → null + ATKI_FIYATI, hücre "eksik" (0 değil)
//   §4 ⭐ son giren lot müşterinin → bilgi MUSTERI_IPLIGI (eksik değil), sayı yok, hücre "müşteri ipliği"
//   §5 iki atkı (lot + kart) → KARMA, tahmini pay ayrı
//   §6 standart sürümde atkı satırı yok → ATKI_NORMU (eksik)
//   §7 iş emri ayrıntısı: ATKI_IPLIGI satırı (standart ↔ gerçekleşen, tahmini rozeti, müşteri ipliği eksiksiz)
//   §8 ⭐ iptal edilen mal kabul fişinin girişi "son giren lot" sayılmaz → bir önceki lot (80 TL) → 3,2 TL/m
//   §9 iplik kapalı → lot okunmaz: kartsız iplik eksik, kartlı iplik kart fiyatı
//   §10 tek kaynak (metin): atkı helper'ı iplik defterine dokunmaz, köprü dinamik import, float yok
// NEGATİF SONDALAR (2026-11-26, hepsi kırmızı verdi, geri alındı):
//   ① giriş okuyucusunda iptal fiş süzgeci kaldırıldı → §8a ❌   ② müşteri dalı kaldırıldı (lot fiyatına düştü) → §4a/§7b ❌
//   ③ son lot yerine ilk lot (orderBy asc) → §1a/§1b/§4a/§5a/§7a/§7b ❌
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döner, kendi kayıtlarını siler.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { GoodsReceiptStatus, ItemType, MachineDataSource, Prisma, RollEntrySource, StationType, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
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

const TAG = `TEST-DAI-${process.pid}`;
const code = (s: string) => `${TAG}-${s}`.slice(0, 32);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const eq = (d: Prisma.Decimal | null | undefined, v: Prisma.Decimal.Value) => d != null && d.toDecimalPlaces(6).eq(D(v).toDecimalPlaces(6));
const s = (d: Prisma.Decimal | null | undefined) => (d == null ? "null" : d.toString());
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

function staticSection(): void {
  console.log("\n§10 — tek kaynak (metin)");
  const src = (f: string) => yorumlariSok(readFileSync(path.join(__dirname, "..", f), "utf8"));
  const weft = src("src/services/helpers/weft-yarn-actual.helper.ts");
  const lot = src("src/services/helpers/warp-yarn-lot-price.helper.ts");
  const bridge = src("src/services/helpers/maliyet-bridge.helper.ts");
  const weaving = src("src/services/helpers/weaving-actual-cost.helper.ts");
  check("§10a atkı helper'ı iplik defterine (`yarnMovement`) DOĞRUDAN dokunmaz; lot girişi/fiyatı aynı lot-fiyat helper'ından (köprüden)",
    !/\b(db|tx|prisma)\.yarnMovement\b/.test(weft) && /export async function readYarnReceiptLots/.test(lot) && !/^import (?!type).*warp-yarn-lot-price/m.test(weft));
  check("§10b köprü atkı helper'ını DİNAMİK import eder, lot okuyucusu `readIplikEnabled` arkasında; dokuma helper'ı köprüden okur",
    /await import\("\.\/weft-yarn-actual\.helper"\)/.test(bridge) && /receipts: iplik\.readYarnReceiptLots/.test(bridge)
      && /loadRollWeftYarnCosts\(/.test(weaving) && !/weft-yarn-actual/.test(weaving));
  check("§10c atkı helper'ında JS sayı aritmetiği yok", !/\bNumber\(|parseFloat|toNumber\(/.test(weft));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== ATKI İPLİĞİ → DOKUMA GERÇEK MALİYETİ ===");
  staticSection();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const whId = await fixtureWarehouseId();
  const inventory = new InventoryService();
  const ids = { yarns: [] as string[], lots: [] as string[], receipts: [] as string[], fabrics: [] as string[], versions: [] as string[], rolls: [] as string[], wos: [] as string[], machines: [] as string[], cards: [] as string[] };
  let stationId: string | null = null;
  let ownerId: string | null = null;
  let mf: MaliyetFikstur | null = null;
  try {
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    for (const k of [SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED]) await setSetting(k, "true");
    mf = await fiksturKur("DAI");
    const paramId = mf.paramId;
    stationId = (await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: code("DK"), type: StationType.INTERNAL, kind: "WEAVING" }, select: { id: true } })).id;
    ownerId = (await prisma.customer.create({ data: { code: code("OWN"), name: `${TAG} kumaş müşterisi` }, select: { id: true } })).id;

    const mkYarn = async (k: string) => {
      const y = (await prisma.item.create({ data: { code: code(k), name: `${TAG} atkı ${k}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
      ids.yarns.push(y);
      return y;
    };
    // Lotlu giriş; `price` verilirse TRY mal kabul fişiyle (fiyat satıra fikstürce yazılır — okuyucuyu ölçmek için).
    const receive = async (yarnId: string, k: string, price: string | null, owner: string | null = null) => {
      const lot = (await prisma.yarnLot.create({ data: { itemId: yarnId, lotNo: code(`L${k}`), ownerCustomerId: owner }, select: { id: true } })).id;
      ids.lots.push(lot);
      const receiptId = (await prisma.goodsReceipt.create({ data: { receiptNo: code(`GR${k}`), warehouseId: whId, currency: "TRY" }, select: { id: true } })).id;
      ids.receipts.push(receiptId);
      const m = await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarnId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 500, lotId: lot, goodsReceiptId: receiptId, reason: `${TAG} giriş` }));
      if (price) await prisma.yarnMovement.update({ where: { id: m.movementId }, data: { unitPrice: D(price) } });
      return { lot, receiptId };
    };
    const fabric = async (k: string, weft: Array<{ yarnId: string; kgPerM: string; std: string }>) => {
      const f = (await prisma.item.create({ data: { code: code(`K${k}`), name: `${TAG} kumaş ${k}`, itemType: ItemType.FABRIC }, select: { id: true } })).id;
      ids.fabrics.push(f);
      const lines = [{ component: "LOOM_MACHINE" as const, label: "Tezgah", amountPerMTry: D(3) }, ...weft.map((w) => ({ component: "WEFT_YARN" as const, label: "Atkı", yarnItemId: w.yarnId, qty: D(w.kgPerM), qtyUnit: "kg", amountPerMTry: D(w.std) }))];
      ids.versions.push((await prisma.standardCostVersion.create({
        data: {
          itemId: f, versionNo: 1, parameterSetId: paramId, rawCostPerMTry: D(7), totalCostPerMTry: D(7), warpKgPerM: D("0.05"), weftKgPerM: D("0.04"),
          loomMPerHour: D(10), fxRates: {}, inputSnapshot: {}, inputHash: "f".repeat(64), warnings: [], lines: { create: lines.map((l, i) => ({ lineNo: i + 1, ...l })) },
        },
        select: { id: true },
      })).id);
      return f;
    };
    // Tezgâh + iş + koşum + doff'lu top (A yolu); devere kapalı → çözgü tüketimi yazılmaz.
    const job = async (k: string, fabricId: string, meters: number) => {
      const m = (await prisma.machine.create({ data: { stationId: stationId!, name: `${TAG} ${k}`, code: code(`M${k}`) }, select: { id: true } })).id;
      ids.machines.push(m);
      const wo = (await prisma.weavingOrder.create({ data: { weavingOrderNumber: code(`W${k}`), itemId: fabricId, executionKind: "IN_HOUSE", status: "COMPLETED" }, select: { id: true } })).id;
      ids.wos.push(wo);
      const run = (await prisma.machineRun.create({ data: { machineId: m, weavingOrderId: wo, startedAt: new Date(Date.now() - 3_600_000) }, select: { id: true } })).id;
      const doff = (await openDoff({ machineId: m, machineRunId: run, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
      const r = await inventory.createInitialEntry({ itemId: fabricId, initialQty: meters }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: doff });
      ids.rolls.push((r.data as { id: string }).id);
      return wo;
    };
    const row = async (woId: string): Promise<WeavingActualCost> => (await weavingActualCostTx(prisma, [woId], "OTURUM"))[0]!;
    const report = (rows: WeavingActualCost[]): WeavingEfficiencyReport => ({ currency: "TRY", fxRate: null, rows, runlessMeters: "0" });
    const cell = (w: WeavingActualCost, key: string) => weavingEfficiencyTable(report([w])).satirlar[0]![key];
    const weftRow = async (woId: string) => (await getWeavingOrderActualCost(woId)).satirlar.find((x) => x.anahtar === "ATKI_IPLIGI");

    const A = await mkYarn("A");
    await receive(A, "A1", "80");
    const A2 = await receive(A, "A2", "100");
    const B = await mkYarn("B");
    await receive(B, "B1", null);
    ids.cards.push((await prisma.yarnCostPrice.create({ data: { yarnItemId: B, currency: "TRY", pricePerKg: D(50) }, select: { id: true } })).id);
    const C = await mkYarn("C");
    await receive(C, "C1", null);
    const M = await mkYarn("M");
    await receive(M, "M1", "90");
    await receive(M, "M2", null, ownerId);

    console.log("\n§1 — el hesabı (son giren lotun fiyatı)");
    const wA = await row(await job("A", await fabric("A", [{ yarnId: A, kgPerM: "0.04", std: "3" }]), 100));
    check("§1a ⭐ 0,04 kg/m × 100 m × 100 TL (son lot; eski lot 80 değil) = 400 TL → 4 TL/m; LOT; tahmini 0; eksik yok",
      eq(wA.weftYarnCostTry, 400) && eq(wA.weftYarnPerMTry, 4) && eq(wA.weftYarnCoveredMeters, 100) && wA.weftYarnSource === "LOT" && eq(wA.weftYarnEstimatedTry, 0) && wA.weftYarnMissing?.length === 0,
      `${s(wA.weftYarnCostTry)} · ${wA.weftYarnSource} · ${wA.weftYarnMissing}`);
    check("§1b tablo: 'Atkı ipliği /m' 4 · kaynak norm miktar etiketli; standart atkı 3, tezgâh standardı atkıyı İÇERMEZ (3)",
      cell(wA, "atkiIplikM") === 4 && cell(wA, "atkiIplikKaynak") === "son giren lotun fiyatı × norm miktar" && eq(wA.standardWeftYarnPerMTry, 3) && eq(wA.standardPerMTry, 3),
      `${cell(wA, "atkiIplikM")} | ${cell(wA, "atkiIplikKaynak")} | ${s(wA.standardPerMTry)}`);

    console.log("\n§2 — maliyet kartı fiyatı (tahmini)");
    const WB = await job("B", await fabric("B", [{ yarnId: B, kgPerM: "0.04", std: "2" }]), 100);
    const wB = await row(WB);
    check("§2a ⭐ lot fiyatsız → kart 50 TL/kg: 4 kg × 50 = 200 TL → 2 TL/m; MALIYET_FIYATI; tahmini = tamamı",
      eq(wB.weftYarnCostTry, 200) && eq(wB.weftYarnPerMTry, 2) && wB.weftYarnSource === "MALIYET_FIYATI" && eq(wB.weftYarnEstimatedTry, 200), `${s(wB.weftYarnCostTry)} · ${wB.weftYarnSource}`);
    check("§2b tablo kaynağı 'maliyet kartı fiyatı × norm miktar (tahmini)'; sunumda atkı tahmin uyarısı",
      cell(wB, "atkiIplikKaynak") === "maliyet kartı fiyatı × norm miktar (tahmini)"
        && buildWeavingEfficiencySunumu(report([wA, wB]), resolveCoreDayRange({}, 30)).uyarilar.some((u) => /atkı ipliği maliyeti.*maliyet kartındaki iplik fiyatından tahmin/.test(u)));

    console.log("\n§3 — fiyat yok");
    const WC = await job("C", await fabric("C", [{ yarnId: C, kgPerM: "0.04", std: "2" }]), 10);
    const wC = await row(WC);
    check("§3a ⭐ lot fiyatsız + kart yok → null + ATKI_FIYATI; hücre 'eksik' (0 değil)",
      wC.weftYarnCostTry === null && wC.weftYarnPerMTry === null && wC.weftYarnMissing?.includes("ATKI_FIYATI") === true && cell(wC, "atkiIplikM") === EKSIK
        && cell(wC, "atkiIplikKaynak") === "eksik: atkı ipliği fiyatı yok", `${cell(wC, "atkiIplikM")} | ${cell(wC, "atkiIplikKaynak")}`);

    console.log("\n§4 — müşteri ipliği");
    const WM = await job("M", await fabric("M", [{ yarnId: M, kgPerM: "0.04", std: "2" }]), 10);
    const wM = await row(WM);
    check("§4a ⭐ son giren lot müşterinin → bilgi MUSTERI_IPLIGI (eksik değil); sayı yok (0 TL değil); hücre 'müşteri ipliği'",
      wM.weftYarnCostTry === null && wM.weftYarnPerMTry === null && wM.weftYarnSource === null && JSON.stringify(wM.weftYarnMissing) === JSON.stringify(["MUSTERI_IPLIGI"])
        && cell(wM, "atkiIplikM") === "müşteri ipliği" && cell(wM, "atkiIplikKaynak") === "müşteri ipliği (maliyetimize girmez)",
      `${s(wM.weftYarnCostTry)} · ${wM.weftYarnMissing} | ${cell(wM, "atkiIplikM")} | ${cell(wM, "atkiIplikKaynak")}`);

    console.log("\n§5 — iki atkı (KARMA)");
    const wAB = await row(await job("AB", await fabric("AB", [{ yarnId: A, kgPerM: "0.02", std: "1" }, { yarnId: B, kgPerM: "0.02", std: "1" }]), 50));
    check("§5a ⭐ 1 kg × 100 + 1 kg × 50 = 150 TL → 3 TL/m; KARMA; tahmini 50",
      eq(wAB.weftYarnCostTry, 150) && eq(wAB.weftYarnPerMTry, 3) && wAB.weftYarnSource === "KARMA" && eq(wAB.weftYarnEstimatedTry, 50) && eq(wAB.standardWeftYarnPerMTry, 2),
      `${s(wAB.weftYarnCostTry)} · ${wAB.weftYarnSource} · ${s(wAB.weftYarnEstimatedTry)}`);

    console.log("\n§6 — atkı normu yok");
    const wN = await row(await job("N", await fabric("N", []), 10));
    check("§6a standart sürümde atkı satırı yok → ATKI_NORMU (eksik), hücre 'eksik'",
      wN.weftYarnCostTry === null && JSON.stringify(wN.weftYarnMissing) === JSON.stringify(["ATKI_NORMU"]) && cell(wN, "atkiIplikM") === EKSIK, `${wN.weftYarnMissing} | ${cell(wN, "atkiIplikM")}`);

    console.log("\n§7 — iş emri ayrıntısı (DTO)");
    const yA = await weftRow(wA.weavingOrderId);
    check("§7a ⭐ Atkı ipliği satırı: standart 3 ↔ gerçekleşen 4; kaynak norm etiketli; tahmini değil",
      yA?.ad === "Atkı ipliği (norm miktar)" && yA.standartTlM === "3" && yA.gercekTlM === "4" && yA.kaynak === "son giren lotun fiyatı × norm miktar" && yA.tahmini === false && yA.eksik.length === 0, JSON.stringify(yA));
    const yB = await weftRow(WB);
    const yC = await weftRow(WC);
    const yM = await weftRow(WM);
    check("§7b tahmini satır rozetli; fiyatsız satır null + eksik metni; müşteri ipliği satırı eksiksiz, kaynak bilgi",
      yB?.tahmini === true && yB.gercekTlM === "2" && yC?.gercekTlM === null && yC.eksik.includes("atkı ipliği fiyatı yok")
        && yM?.gercekTlM === null && yM.eksik.length === 0 && yM.kaynak === "müşteri ipliği (maliyetimize girmez)", `${JSON.stringify(yB)} ${JSON.stringify(yC)} ${JSON.stringify(yM)}`);

    console.log("\n§8 — iptal edilen mal kabul fişi");
    await prisma.goodsReceipt.update({ where: { id: A2.receiptId }, data: { status: GoodsReceiptStatus.CANCELLED, cancelledAt: new Date(), cancelReason: `${TAG} sonda` } });
    const wA8 = await row(wA.weavingOrderId);
    check("§8a ⭐ iptal fişin girişi 'son giren lot' değil → önceki lot 80 TL: 4 kg × 80 = 320 TL → 3,2 TL/m",
      eq(wA8.weftYarnCostTry, 320) && eq(wA8.weftYarnPerMTry, "3.2") && wA8.weftYarnSource === "LOT", `${s(wA8.weftYarnCostTry)} · ${wA8.weftYarnSource}`);
    await prisma.goodsReceipt.update({ where: { id: A2.receiptId }, data: { status: GoodsReceiptStatus.ACTIVE, cancelledAt: null, cancelReason: null } });

    console.log("\n§9 — iplik modülü kapalı");
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "false");
    const [wA9, wB9] = await weavingActualCostTx(prisma, [wA.weavingOrderId, WB], "OTURUM");
    check("§9a iplik kapalı → lot okunmaz: A (kartsız) eksik; B kart fiyatıyla aynı (2)",
      wA9!.weftYarnCostTry === null && wA9!.weftYarnMissing?.includes("ATKI_FIYATI") === true && eq(wB9!.weftYarnPerMTry, 2) && wB9!.weftYarnSource === "MALIYET_FIYATI",
      `${wA9!.weftYarnMissing} · ${s(wB9!.weftYarnPerMTry)}`);
    await setSetting(SETTING_KEYS.IPLIK_ENABLED, "true");
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids.rolls } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.rolls, ...ids.wos] } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: ids.machines } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: ids.wos } } });
    await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: ids.yarns } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: ids.yarns } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
    await prisma.yarnLot.deleteMany({ where: { id: { in: ids.lots } } });
    await prisma.yarnCostPrice.deleteMany({ where: { id: { in: ids.cards } } });
    await prisma.standardCostLine.deleteMany({ where: { versionId: { in: ids.versions } } });
    await prisma.standardCostVersion.deleteMany({ where: { id: { in: ids.versions } } });
    await prisma.item.deleteMany({ where: { id: { in: [...ids.yarns, ...ids.fabrics] } } });
    if (ownerId) await prisma.customer.deleteMany({ where: { id: ownerId } });
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
