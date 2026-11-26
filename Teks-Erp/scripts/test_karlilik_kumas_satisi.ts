// =============================================================================
// BEKÇİ — KÂRLILIK: KUMAŞ SATIŞI SATIRLARI (K1 dilim 1; PLAN-karlilik-dokuma-1126 §2, §3 DİLİM 1)
// =============================================================================
//   §1 el hesabı — tek fatura (USD × 2), iki dokuma işinden dört top: gelir metre payıyla (Σ pay = satır × kur),
//      maliyet = işin gerçek TL/m ("Dokuma maliyeti" tablosu, `weavingActualCostTx`) × satılan metre; hizmet satırı
//      ve metin satırı kumaş gelirine girmez
//   §2 iade edilmiş top brütte KALIR (gelir payı + maliyet), `IADE_DUSULMEDI` bilgisi
//   §3 emanet top evrene girmez (metre payına da); satır miktarı emanet metresini de taşıyorsa (hizmet faturası kapalı
//      taslak) emanet payı gelirden düşer, yalnız emanet taşıyan satır evrene hiç girmez (inceleme B4)
//   §4 iptal İPTAL AYINDA eksi satır, fatura ayı değişmez; taslak `productDraftRows`ta, katkısız
//   §5 dokunmamış top `DOKUMA_ISI_YOK`, sevksiz fatura `SEVK_BAGI_YOK` — gelir görünür, katkı null
//   §6 tambur çocuğu atanın dokuma işine çözülür; boyahaneden doğan top (ata bağı yok, dilim 3) makbuz kalemindeki ham
//      topun işine çözülür, ham metre çekme oranıyla (Σ giren ÷ Σ doğan), boya/apre = onaylı fason faturası × metre payı
//   §7 iplik (dilim 3): bağlı satırda katkı dolu, kart fiyatı "tahmini"; eksik iplik → katkı null (0 değil); müşteri
//      ipliği 0 pay + bilgi (eksik değil); devere kapalı → çözgü ipliği okunmadı bilgisi
//   §8 hizmet satırları bayt-aynı (`includeProducts` ile/siz); dokuma kapalı → kumaş alanı yok
//   §9 tek kaynak (AST): ürün helper'ında ücret çarpımı / number aritmetiği yok; satılan top kümesi tek helper'dan;
//      top → iş zinciri `weavingOriginsOfRolls`ten (ürün helper'ı makbuz/ata kolonunu kendisi okumaz)
//   §10 K1.1 AYNI SAYI: aynı iş için Kârlılık dokuma + devere + iplik = iş emri Gerçekleşen Σ TL/m × top metresi
//
// ⭐ NEGATİF SONDA: bkz. `docs/bekci-harita/maliyet.md` satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Fikstür 2022-04/05 aylarında; satırlar fikstür faturalarına süzülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as ts from "typescript";
import { Currency, InvoiceStatus, ItemType, ItemUnit, Prisma, RollEntrySource, RollStatus, StationKind, StationType, StepStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestSander } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { computeProfitability, type ProductProfitRow } from "../src/services/helpers/profitability.helper";
import { getWeavingOrderActualCost } from "../src/services/weaving-order-actual-cost.service";
import { productBadge } from "../src/services/reports/profitability-product.sunum";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const P = `TEST-KKS-${process.pid}`;
const AYARLAR = [
  SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MALIYET_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.DOKUMA_ENABLED,
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.COST_PROFIT_MACHINE_TIME, SETTING_KEYS.IPLIK_ENABLED,
];
const T = (s: string, hh = "09:00") => new Date(`${s}T${hh}:00+03:00`);
const f2 = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? "null" : d.toFixed(2));

const ids = {
  customers: [] as string[], items: [] as string[], rolls: [] as string[], invoices: [] as string[], shipments: [] as string[], returns: [] as string[],
  orders: [] as string[], machines: [] as string[], stations: [] as string[], receipts: [] as string[], wos: [] as string[], steps: [] as string[], svc: [] as string[],
  versions: [] as string[], yarns: [] as string[], lots: [] as string[], goods: [] as string[], cards: [] as string[], salesOrders: [] as string[],
};
let mf: MaliyetFikstur | null = null;

// ── §9 statik ────────────────────────────────────────────────────────────────
function scan(file: string) {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const calls: string[] = [];
  const props: string[] = [];
  const ops: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) calls.push(ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : n.expression.getText(src));
    if (ts.isPropertyAccessExpression(n)) props.push(n.name.text);
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.MinusToken].includes(n.operatorToken.kind)) ops.push(n.getText(src));
    ts.forEachChild(n, visit);
  };
  visit(src);
  return { calls, props, ops };
}
function bolum9(): void {
  const product = scan(path.join(ROOT, "src/services/helpers/profitability-product.helper.ts"));
  const draft = scan(path.join(ROOT, "src/services/helpers/shipment-auto-draft.helper.ts"));
  const rate = product.calls.filter((c) => ["machineRateAt", "normHours", "machineHourCostTry", "weavingActualCostTx", "Number", "parseFloat", "toNumber"].includes(c));
  check("§9a ⭐ ürün helper'ı ücret çarpımı yazmaz, gerçek maliyeti köprüden okur (number aritmetiği yok)",
    rate.length === 0 && product.ops.length === 0 && product.calls.includes("loadWeavingActualCosts"), [...rate, ...product.ops].join(", ") || "temiz");
  const own = [...product.props, ...draft.props].filter((p) => p === "rollReturn");
  check("§9b ⭐ satılan top kümesi tek helper'dan — taslak üretici ve ürün helper'ı `collectShipmentGrossRolls` çağırır, iadeyi kendisi okumaz",
    own.length === 0 && product.calls.includes("collectShipmentGrossRolls") && draft.calls.includes("collectShipmentGrossRolls"), own.join(", ") || "temiz");
  const chain = product.props.filter((p) => ["subcontractorReceiptItem", "subcontractorReceipt", "parentReceiptId", "parentRollId"].includes(p));
  check("§9c ⭐ top → iş zinciri (tambur atası, boyahane makbuzu) `weavingOriginsOfRolls`ten; ürün helper'ı makbuz/ata kolonunu okumaz",
    chain.length === 0 && product.calls.includes("weavingOriginsOfRolls") && product.calls.includes("subcontractShareResolver"), chain.join(", ") || "temiz");
}

// ── Fikstür ──────────────────────────────────────────────────────────────────
async function item(code: string): Promise<string> {
  const r = await prisma.item.create({ data: { code: `${P}-${code}`, name: `TEST kumaş kârlılık ${code} ${process.pid}`, unit: ItemUnit.MT, itemType: ItemType.FABRIC }, select: { id: true } });
  ids.items.push(r.id);
  return r.id;
}
async function roll(n: string, itemId: string, qty: number, extra: Partial<Prisma.RollUncheckedCreateInput> = {}): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `${P}-R${n}`.slice(0, 40), itemId, initialQty: qty, currentQty: qty, status: RollStatus.SHIPPED, entrySource: RollEntrySource.WEAVING, ...extra },
    select: { id: true },
  });
  ids.rolls.push(r.id);
  return r.id;
}
async function weavingOrder(n: string, itemId: string, machineId: string, hours: number): Promise<string> {
  const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${P}-W${n}`.slice(0, 32), itemId, executionKind: "IN_HOUSE", status: "COMPLETED" }, select: { id: true } });
  ids.orders.push(wo.id);
  const startedAt = T(`2022-03-2${n}`, "08:00"); // iş başına ayrı gün: tezgâhta koşumlar çakışmaz
  await prisma.machineRun.create({ data: { machineId, weavingOrderId: wo.id, startedAt, endedAt: new Date(startedAt.getTime() + hours * 3_600_000), producedM: 100, stopSecAtClose: 0 } as never });
  return wo.id;
}
/** İplik kartı + standart sürüm (yalnız atkı satırı, kg/m norm). */
async function yarn(code: string): Promise<string> {
  const y = await prisma.item.create({ data: { code: `${P}-${code}`, name: `TEST kumaş kârlılık iplik ${code} ${process.pid}`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } });
  ids.yarns.push(y.id);
  return y.id;
}
async function weftVersion(itemId: string, yarnItemId: string, kgPerM: string, paramId: string): Promise<void> {
  const v = await prisma.standardCostVersion.create({
    data: {
      itemId, versionNo: 1, parameterSetId: paramId, rawCostPerMTry: "1", totalCostPerMTry: "1", warpKgPerM: "0.05", weftKgPerM: kgPerM, loomMPerHour: "10",
      fxRates: {}, inputSnapshot: {}, inputHash: "a".repeat(64), warnings: [],
      lines: { create: [{ lineNo: 1, component: "WEFT_YARN", label: "Atkı", yarnItemId, qty: kgPerM, qtyUnit: "kg", amountPerMTry: "1" }] },
    },
    select: { id: true },
  });
  ids.versions.push(v.id);
}
/** Müşteri malı lotlu iplik girişi (atkı fiyatında son giren lot müşterinin → bilgi `MUSTERI_IPLIGI`). */
async function customerLot(yarnItemId: string, ownerCustomerId: string): Promise<void> {
  const whId = await fixtureWarehouseId();
  const lot = await prisma.yarnLot.create({ data: { itemId: yarnItemId, lotNo: `${P}-LM`, ownerCustomerId }, select: { id: true } });
  ids.lots.push(lot.id);
  const gr = await prisma.goodsReceipt.create({ data: { receiptNo: `${P}-GR`, warehouseId: whId, currency: "TRY" }, select: { id: true } });
  ids.goods.push(gr.id);
  await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarnItemId, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 100, lotId: lot.id, goodsReceiptId: gr.id, reason: `${P} müşteri ipliği` }));
}
async function invoice(spec: {
  cariId: string; docNo: string; issue: Date; status: InvoiceStatus; shipmentId?: string | null; rate?: string; cancelledAt?: Date;
  type?: "SALES" | "PURCHASE"; receiptId?: string;
  lines: Array<{ kind: "PRODUCT" | "SERVICE" | "TEXT"; id?: string; qty: string; total: string }>;
}): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      docNo: `${P}-${spec.docNo}`, type: spec.type ?? "SALES", status: spec.status, cariId: spec.cariId, currency: spec.rate ? Currency.USD : Currency.TRY,
      exchangeRate: spec.rate ?? "1", issueDate: spec.issue, confirmedAt: spec.status === InvoiceStatus.DRAFT ? null : spec.issue,
      cancelledAt: spec.cancelledAt ?? null, shipmentId: spec.shipmentId ?? null, subcontractorReceiptId: spec.receiptId ?? null,
      // Üretim yolu `subtotal`ı Σ satır neti yazar (`computeInvoiceTotals`); fason tutarı `invoiceNetExVat` ondan okur.
      subtotal: spec.lines.reduce((a, l) => a.plus(l.total), new Prisma.Decimal(0)),
      lines: { create: spec.lines.map((l, i) => ({
        lineNo: i + 1, lineType: l.kind, itemId: l.kind === "PRODUCT" ? l.id! : null, serviceItemId: l.kind === "SERVICE" ? l.id! : null,
        description: "TEST", qty: l.qty, unitPrice: new Prisma.Decimal(l.total).div(l.qty), lineTotal: l.total, vatAmount: "0",
      })) },
    },
    select: { id: true },
  });
  ids.invoices.push(inv.id);
  return inv.id;
}

const mine = (rows: ProductProfitRow[] | undefined) => (rows ?? []).filter((r) => ids.invoices.includes(r.invoiceId));
async function report(from: string, to = from, includeProducts = true) {
  const r = await computeProfitability({ fromMonth: from, toMonth: to, includeProducts });
  if (!r) throw new Error("kârlılık null döndü (modül kapalı?)");
  return r;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(engel); process.exitCode = 1; return; }
  bolum9();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const setSetting = (key: string, v: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  try {
    for (const k of [...AYARLAR.slice(0, 5), SETTING_KEYS.IPLIK_ENABLED]) await setSetting(k, true);
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, false); // devere payı bu bekçinin konusu değil (devere bekçileri ölçer)
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COST_PROFIT_MACHINE_TIME } }); // OTURUM → koşum süresi

    const admin = await ensureTestAdmin();
    const c = await prisma.customer.create({ data: { code: `${P}-A`, name: `TEST kumaş kârlılık müşteri ${process.pid}` }, select: { id: true } });
    ids.customers.push(c.id);
    const cari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: c.id, subcontractorId: null }));
    const F1 = await item("F1"); // dokunan kumaş
    const F2 = await item("F2"); // al-sat
    const F3 = await item("F3"); // boyahaneden dönen
    const svc = await prisma.serviceItem.create({ data: { code: `${P}-S`, name: `TEST hizmet ${process.pid}`, unit: ItemUnit.MT }, select: { id: true } });
    ids.svc.push(svc.id);

    const st = await prisma.station.create({ data: { name: `${P}-ST`, code: `${P}-ST`.slice(0, 32), type: StationType.INTERNAL, kind: StationKind.WEAVING, isActive: true }, select: { id: true } });
    ids.stations.push(st.id);
    const m = await prisma.machine.create({ data: { stationId: st.id, name: `${P} T1`, code: `${P}-T1`.slice(0, 32), isActive: true }, select: { id: true } });
    ids.machines.push(m.id);
    await prisma.machineCostRate.create({ data: { machineId: m.id, hourRateTry: "100.0000", normMPerHour: "50.00", clientToken: randomUUID(), createdAt: T("2022-03-01") } });
    // WO1: 10 sa × 100 TL = 1000 TL / 200 m = 5 TL/m · WO2: 6 sa = 600 TL / (60 + 40) m = 6 TL/m
    const WO1 = await weavingOrder("1", F1, m.id, 10);
    const WO2 = await weavingOrder("2", F1, m.id, 6);

    const sh = await prisma.shipment.create({ data: { shipmentNo: `${P}-SH1`, customerId: c.id }, select: { id: true } });
    ids.shipments.push(sh.id);
    const R1 = await roll("1", F1, 100, { weavingOrderId: WO1, shipmentId: sh.id });
    const R2 = await roll("2", F1, 100, { weavingOrderId: WO1, status: RollStatus.STOCK }); // iade edildi (shipmentId NULL)
    await roll("3", F1, 60, { weavingOrderId: WO2, shipmentId: sh.id });
    const PAR = await roll("P", F1, 40, { weavingOrderId: WO2, status: RollStatus.TAMBUR_CONSUMED });
    const CH = await roll("C", F1, 40, { parentRollId: PAR, entrySource: RollEntrySource.TAMBUR_SPLIT, shipmentId: sh.id });
    await roll("E", F1, 30, { entrySource: RollEntrySource.MANUAL_ENTRY, ownerCustomerId: c.id, shipmentId: sh.id }); // emanet: satış değil
    await roll("S", F2, 50, { entrySource: RollEntrySource.MANUAL_ENTRY, shipmentId: sh.id });
    // Boyahane dönüşü: makbuzdan doğan top `parentReceiptId` taşır, ata (`parentRollId`) taşımaz (ölçüm a).
    const sander = await ensureTestSander();
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-WO`, status: "IN_PROGRESS" }, select: { id: true } });
    ids.wos.push(wo.id);
    const fst = await prisma.station.create({ data: { code: `${P}-FS`.slice(0, 32), name: `${P} fason`, type: StationType.EXTERNAL }, select: { id: true } });
    ids.stations.push(fst.id);
    const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: fst.id, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
    ids.steps.push(step.id);
    const rc = await prisma.subcontractorReceipt.create({ data: { receiptNo: `${P}-RC`, subcontractorId: sander.id, receivedAt: T("2022-04-02"), workOrderId: wo.id, stepId: step.id }, select: { id: true } });
    ids.receipts.push(rc.id);
    // Dilim 3: makbuz kalemi ham topu (WO3, 30 m) gösterir; doğan 25 m → çekme oranı 30/25. WO3 3 sa = 300 TL / 30 m = 10 TL/m.
    const WO3 = await weavingOrder("3", F3, m.id, 3);
    const H = await roll("H", F3, 30, { weavingOrderId: WO3, status: RollStatus.SUBCONTRACTOR_CONSUMED });
    await prisma.subcontractorReceiptItem.create({ data: { receiptId: rc.id, newRollId: H } });
    await roll("D", F3, 25, { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, parentReceiptId: rc.id, shipmentId: sh.id });
    const supplierCari = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: null, subcontractorId: sander.id }));
    // Onaylı fason faturası 75 TL / makbuz 25 m → satılan 25 m'ye 75,00.
    await invoice({ cariId: supplierCari.id, docNo: "AF", issue: T("2022-04-03"), status: InvoiceStatus.CONFIRMED, type: "PURCHASE", receiptId: rc.id,
      lines: [{ kind: "SERVICE", id: svc.id, qty: "25", total: "75.00" }] });
    const ret = await prisma.rollReturn.create({ data: { rollId: R2, fromShipmentId: sh.id, customerId: c.id, itemId: F1, qty: "100", receivedById: admin.id }, select: { id: true } });
    ids.returns.push(ret.id);

    // İplik: F1 atkısı 0,01 kg/m × kart 100 TL/kg = 1 TL/m (lot yok → kart, "tahmini"); F3'ün sürümü yok (ATKI_NORMU);
    // F4 atkısının son giren lotu müşterinin → 0 pay + bilgi. WO4 2 sa = 200 TL / 50 m = 4 TL/m.
    mf = await fiksturKur("KKS");
    const Y1 = await yarn("Y1");
    ids.cards.push((await prisma.yarnCostPrice.create({ data: { yarnItemId: Y1, currency: "TRY", pricePerKg: "100", createdAt: T("2022-01-01") }, select: { id: true } })).id);
    await weftVersion(F1, Y1, "0.01", mf.paramId);
    const YM = await yarn("YM");
    await customerLot(YM, c.id);
    const F4 = await item("F4");
    await weftVersion(F4, YM, "0.01", mf.paramId);
    const WO4 = await weavingOrder("4", F4, m.id, 2);
    // Müşteri ipliği yalnız işin müşterisinin lotuysa (inceleme B3): WO4 c'nin siparişini besler.
    const so4 = await prisma.order.create({ data: { orderNumber: `${P}-SO4`, customerId: c.id, lines: { create: [{ itemId: F4, quantity: 50 }] } }, select: { id: true, lines: { select: { id: true } } } });
    ids.salesOrders.push(so4.id);
    await prisma.weavingOrderToOrderLine.create({ data: { weavingOrderId: WO4, orderLineId: so4.lines[0]!.id } });
    const sh2 = await prisma.shipment.create({ data: { shipmentNo: `${P}-SH2`, customerId: c.id }, select: { id: true } });
    ids.shipments.push(sh2.id);
    await roll("4", F4, 50, { weavingOrderId: WO4, shipmentId: sh2.id });
    await invoice({ cariId: cari.id, docNo: "F4", issue: T("2022-04-16"), status: InvoiceStatus.CONFIRMED, shipmentId: sh2.id, lines: [{ kind: "PRODUCT", id: F4, qty: "50", total: "500.00" }] });

    // INV1: F1 1500 USD × 2 = 3000 TL / 300 m (R1 100 · R2 100 iade · R3 60 · C 40) = 10 TL/m; F2 200 × 2 = 400; F3 50 × 2 = 100.
    // Hizmet (999) ve metin satırı kumaş gelirine GİRMEZ.
    await invoice({ cariId: cari.id, docNo: "F1", issue: T("2022-04-15"), status: InvoiceStatus.CONFIRMED, shipmentId: sh.id, rate: "2", lines: [
      { kind: "PRODUCT", id: F1, qty: "300", total: "1500.00" }, { kind: "PRODUCT", id: F2, qty: "50", total: "200.00" },
      { kind: "PRODUCT", id: F3, qty: "25", total: "50.00" }, { kind: "SERVICE", id: svc.id, qty: "1", total: "999.00" }, { kind: "TEXT", qty: "1", total: "0.00" },
    ] });
    // İnceleme B4 (hizmet faturası kapalı → taslak emanet topu ürün satırına yazar): SH4 kendi 50 m + emanet 50 m, satır 100 m
    // × 10 TL; SH5 yalnız emanet 20 m. INV1'de satır (300 m) emanetsiz metreye eşit → bugünkü bölüşüm (§1b).
    const sh4 = await prisma.shipment.create({ data: { shipmentNo: `${P}-SH4`, customerId: c.id }, select: { id: true } });
    const sh5 = await prisma.shipment.create({ data: { shipmentNo: `${P}-SH5`, customerId: c.id }, select: { id: true } });
    ids.shipments.push(sh4.id, sh5.id);
    await roll("O2", F2, 50, { entrySource: RollEntrySource.MANUAL_ENTRY, shipmentId: sh4.id });
    await roll("E2", F2, 50, { entrySource: RollEntrySource.MANUAL_ENTRY, ownerCustomerId: c.id, shipmentId: sh4.id });
    await roll("E3", F2, 20, { entrySource: RollEntrySource.MANUAL_ENTRY, ownerCustomerId: c.id, shipmentId: sh5.id });
    await invoice({ cariId: cari.id, docNo: "F6", issue: T("2022-04-16"), status: InvoiceStatus.CONFIRMED, shipmentId: sh4.id, lines: [{ kind: "PRODUCT", id: F2, qty: "100", total: "1000.00" }] });
    await invoice({ cariId: cari.id, docNo: "F7", issue: T("2022-04-17"), status: InvoiceStatus.CONFIRMED, shipmentId: sh5.id, lines: [{ kind: "PRODUCT", id: F2, qty: "20", total: "200.00" }] });
    // INV2: sevksiz elle satış, Mayıs'ta iptal. INV3: taslak.
    await invoice({ cariId: cari.id, docNo: "F2", issue: T("2022-04-20"), status: InvoiceStatus.CANCELLED, cancelledAt: T("2022-05-05"), lines: [{ kind: "PRODUCT", id: F1, qty: "10", total: "70.00" }] });
    await invoice({ cariId: cari.id, docNo: "F3", issue: T("2022-04-25"), status: InvoiceStatus.DRAFT, lines: [{ kind: "PRODUCT", id: F1, qty: "300", total: "900.00" }] });

    const apr = await report("2022-04");
    const rows = mine(apr.productRows);
    const inv1 = rows.filter((r) => r.docNo === `${P}-F1`);
    const w1 = inv1.find((r) => r.weavingOrderId === WO1);
    const w2 = inv1.find((r) => r.weavingOrderId === WO2);
    const al = inv1.find((r) => r.itemId === F2);
    const dye = inv1.find((r) => r.itemId === F3);

    // ── §1 el hesabı ──
    check("§1a ⭐ INV1 tam dört satır (F1×WO1, F1×WO2, F2 al-sat, F3 boyahane); hizmet/metin satırı kumaş satırı doğurmaz",
      inv1.length === 4 && inv1.every((r) => [F1, F2, F3].includes(r.itemId)), inv1.map((r) => `${String(r.itemId).slice(0, 4)}:${r.weavingOrderId?.slice(0, 4) ?? "-"}`).join(" "));
    check("§1b ⭐ gelir metre payıyla: WO1 200 m → 2000,00 · WO2 100 m → 1000,00 TL (USD × 2)",
      f2(w1?.revenueTry) === "2000.00" && f2(w1?.meters) === "200.00" && f2(w2?.revenueTry) === "1000.00" && f2(w2?.meters) === "100.00", `${f2(w1?.revenueTry)} / ${f2(w2?.revenueTry)}`);
    const sum = inv1.reduce((a, r) => a.plus(r.revenueTry), new Prisma.Decimal(0));
    check("§1c Σ satır geliri = Σ ürün satırı × kur (1750 × 2 = 3500,00)", f2(sum) === "3500.00", f2(sum));
    check("§1d ⭐ dokuma maliyeti = işin gerçek TL/m × satılan metre: WO1 5 × 200 = 1000,00 · WO2 6 × 100 = 600,00",
      f2(w1?.weavingTry) === "1000.00" && f2(w2?.weavingTry) === "600.00", `${f2(w1?.weavingTry)} / ${f2(w2?.weavingTry)}`);
    check("§1e müşteri faturanın carisinden, ay fatura ayı, iş bitti (ongoing false)",
      inv1.every((r) => r.customerId === c.id && r.month === "2022-04" && r.kind === "INVOICED") && !w1?.ongoing);

    // ── §2 iade brütte ──
    check("§2a ⭐ iade edilmiş top (R2) brütte kalır: WO1 iki top, biri iade; tablo `IADE_DUSULMEDI` der",
      w1?.rollCount === 2 && w1?.returnedRollCount === 1 && (apr.productNotices ?? []).includes("IADE_DUSULMEDI"), `${w1?.rollCount}/${w1?.returnedRollCount} ${apr.productNotices?.join(",")}`);
    check("§2b genel gider dağıtılmadı bilgisi her zaman", (apr.productNotices ?? []).includes("GENEL_GIDER_DAGITILMADI"));

    // ── §3 emanet ──
    check("§3a ⭐ emanet top (30 m) evrene girmez: F1 satılan metre 300 (330 değil)", f2(inv1.filter((r) => r.itemId === F1).reduce((a, r) => a.plus(r.meters), new Prisma.Decimal(0))) === "300.00");
    const f6 = rows.filter((r) => r.docNo === `${P}-F6`);
    check("§3b ⭐ satır emanet metresini de taşıyor (100 m = 50 kendi + 50 emanet): kendi topun geliri 500,00 (1000 değil), metre 50",
      f6.length === 1 && f2(f6[0]!.revenueTry) === "500.00" && f2(f6[0]!.meters) === "50.00", f6.map((r) => `${f2(r.revenueTry)}/${f2(r.meters)}`).join(","));
    check("§3c yalnız emanet top taşıyan satır kumaş evrenine girmez (SEVK_BAGI_YOK geliri DEĞİL)", !rows.some((r) => r.docNo === `${P}-F7`),
      rows.filter((r) => r.docNo === `${P}-F7`).map((r) => r.missing.join("+")).join(","));

    // ── §5 dokunmamış / sevksiz ──
    check("§5a ⭐ al-sat top `DOKUMA_ISI_YOK`, gelir 400,00 görünür, maliyet ve katkı null",
      !!al && al.missing.includes("DOKUMA_ISI_YOK") && f2(al.revenueTry) === "400.00" && al.weavingTry === null && al.contributionTry === null, al?.missing.join(","));
    const inv2 = rows.find((r) => r.docNo === `${P}-F2`);
    check("§5b sevksiz fatura `SEVK_BAGI_YOK`, gelir 70,00, katkı null", !!inv2 && inv2.missing.includes("SEVK_BAGI_YOK") && f2(inv2.revenueTry) === "70.00" && inv2.contributionTry === null, inv2?.missing.join(","));

    // ── §6 tambur çocuğu / boyahane ──
    check("§6a ⭐ tambur çocuğu (C) atanın işine (WO2) çözülür: WO2 iki top (R3 + C)", w2?.rollCount === 2, String(w2?.rollCount));
    check("§6b ⭐ boyahaneden doğan top makbuz kalemindeki ham topun işine (WO3) çözülür, `DOKUMA_ISI_YOK` değil",
      !!dye && dye.weavingOrderId === WO3 && !dye.missing.includes("DOKUMA_ISI_YOK") && dye.rollCount === 1, `${dye?.weavingOrderId === WO3} ${dye?.missing.join(",")}`);
    check("§6c ⭐ ham metre çekme oranıyla: satılan 25 m → ham 30 m; dokuma 10 TL/m × 30 = 300,00",
      f2(dye?.meters) === "25.00" && f2(dye?.hamMeters) === "30.00" && f2(dye?.weavingTry) === "300.00", `${f2(dye?.hamMeters)} / ${f2(dye?.weavingTry)}`);
    check("§6d ⭐ boya/apre = onaylı fason faturası × metre payı: 75 × 25 / 25 = 75,00 (tahmini değil)",
      f2(dye?.subcontractTry) === "75.00" && dye?.subcontractEstimated === false, f2(dye?.subcontractTry));

    // ── §7 iplik ──
    const w4 = rows.find((r) => r.docNo === `${P}-F4`);
    check("§7a ⭐ iplik bağlı satırda katkı DOLU: WO1 iplik 1 × 200 = 200,00 (kart → tahmini); katkı 2000 − 1000 − 200 − 0 = 800,00; eksik yok",
      !!w1 && f2(w1.yarnTry) === "200.00" && w1.yarnEstimated && w1.missing.length === 0 && f2(w1.contributionTry) === "800.00" && f2(w1.subcontractTry) === "0.00",
      `${f2(w1?.yarnTry)} / ${f2(w1?.contributionTry)} ${w1?.missing.join(",")}`);
    check("§7b ⭐ iplik okunamayan satırda (F3 atkı normu yok) iplik ve katkı null (0 değil), eksik kodu taşır",
      !!dye && dye.yarnTry === null && dye.contributionTry === null && dye.missing.includes("ATKI_NORMU"), dye?.missing.join(","));
    check("§7c ⭐ müşteri ipliği maliyete girmez ama satırı eksik yapmaz: iplik 0,00 + bilgi, katkı 500 − 200 = 300,00",
      !!w4 && w4.weavingOrderId === WO4 && f2(w4.yarnTry) === "0.00" && w4.customerYarn && w4.missing.length === 0 && f2(w4.contributionTry) === "300.00",
      `${f2(w4?.yarnTry)} / ${f2(w4?.contributionTry)} ${w4?.missing.join(",")}`);
    check("§7d devere kapalı → `COZGU_IPLIGI_OKUNMADI` bilgisi; rozet iplik kaynağını söyler",
      (apr.productNotices ?? []).includes("COZGU_IPLIGI_OKUNMADI")
        && productBadge({ missing: new Set(), estimated: false, ongoing: false, yarnEstimated: true, customerYarn: true }) === "iplik tahmini · müşteri ipliği");

    // ── §10 K1.1 aynı sayı ──
    for (const [wo, label] of [[WO1, "WO1"], [WO4, "WO4"]] as const) {
      const actual = await getWeavingOrderActualCost(wo);
      const perM = actual.satirlar.reduce((a, s) => a.plus(s.gercekTlM ?? "0"), new Prisma.Decimal(0));
      const expected = perM.mul(actual.topMetre);
      const mineRows = rows.filter((r) => r.weavingOrderId === wo);
      const got = mineRows.reduce((a, r) => a.plus(r.weavingTry ?? 0).plus(r.warpingTry ?? 0).plus(r.yarnTry ?? 0), new Prisma.Decimal(0));
      const ham = mineRows.reduce((a, r) => a.plus(r.hamMeters ?? 0), new Prisma.Decimal(0));
      check(`§10 ⭐ K1.1 ${label}: Kârlılık dokuma + devere + iplik = iş emri Gerçekleşen Σ TL/m × top metresi (iş tümüyle satıldı)`,
        mineRows.length > 0 && ham.eq(actual.topMetre) && got.minus(expected).abs().lt("0.01"), `${f2(got)} ↔ ${f2(expected)} (${actual.satirlar.map((s) => `${s.anahtar}:${s.gercekTlM}`).join(" ")})`);
    }

    // ── §4 iptal / taslak ──
    const may = await report("2022-05");
    const mayRows = mine(may.productRows);
    check("§4a ⭐ iptal İPTAL AYINDA eksi satır (Mayıs −70,00), Nisan satırı değişmez",
      mayRows.length === 1 && mayRows[0]!.kind === "CANCELLED" && f2(mayRows[0]!.revenueTry) === "-70.00" && f2(inv2?.revenueTry) === "70.00", mayRows.map((r) => `${r.kind}:${f2(r.revenueTry)}`).join(" "));
    const drafts = mine(apr.productDraftRows);
    check("§4b taslak `productDraftRows`ta (rows'ta yok), katkı null", drafts.length > 0 && drafts.every((r) => r.kind === "DRAFT" && r.contributionTry === null) && !rows.some((r) => r.docNo === `${P}-F3`), String(drafts.length));

    // ── §8 hizmet bayt-aynı ──
    const plain = await report("2022-04", "2022-04", false);
    const pick = (r: typeof apr) => JSON.stringify({ rows: r.rows, draftRows: r.draftRows, months: r.months, idle: r.idleMachineDays, settings: r.settings });
    check("§8a ⭐ hizmet satırları / ay özeti `includeProducts` ile ve siz BAYT-AYNI; bayraksız yanıtta kumaş alanı yok",
      pick(apr) === pick(plain) && !("productRows" in plain) && !("productNotices" in plain));
    await setSetting(SETTING_KEYS.DOKUMA_ENABLED, false);
    const off = await report("2022-04");
    check("§8b dokuma kapalı → kumaş alanı yok (evren sorgulanmaz)", !("productRows" in off));
  } finally {
    await temizle(foto);
  }
}

async function temizle(foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const q = (p: Promise<unknown>) => p.catch((e) => { fail++; console.error("❌ temizlik:", (e as Error).message); });
  await q(prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: ids.invoices } } }));
  await q(prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } }));
  await q(prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } }));
  await q(prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: ids.receipts } } }));
  await q(prisma.roll.updateMany({ where: { id: { in: ids.rolls } }, data: { parentRollId: null } }));
  await q(prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }));
  await q(prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } }));
  await q(prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } }));
  await q(prisma.standardCostLine.deleteMany({ where: { versionId: { in: ids.versions } } }));
  await q(prisma.standardCostVersion.deleteMany({ where: { id: { in: ids.versions } } }));
  await q(prisma.yarnMovement.deleteMany({ where: { itemId: { in: ids.yarns } } }));
  await q(prisma.yarnStock.deleteMany({ where: { itemId: { in: ids.yarns } } }));
  await q(prisma.goodsReceipt.deleteMany({ where: { id: { in: ids.goods } } }));
  await q(prisma.yarnLot.deleteMany({ where: { id: { in: ids.lots } } }));
  await q(prisma.yarnCostPrice.deleteMany({ where: { id: { in: ids.cards } } }));
  await q(prisma.item.deleteMany({ where: { id: { in: ids.yarns } } }));
  if (mf) await q(fiksturSil(mf));
  await q(prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } }));
  await q(prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } }));
  await q(prisma.machineRun.deleteMany({ where: { machineId: { in: ids.machines } } }));
  await q(prisma.machineCostRate.deleteMany({ where: { machineId: { in: ids.machines } } }));
  await q(prisma.weavingOrderToOrderLine.deleteMany({ where: { weavingOrderId: { in: ids.orders } } }));
  await q(prisma.orderLine.deleteMany({ where: { orderId: { in: ids.salesOrders } } }));
  await q(prisma.order.deleteMany({ where: { id: { in: ids.salesOrders } } }));
  await q(prisma.weavingOrder.deleteMany({ where: { id: { in: ids.orders } } }));
  await q(prisma.machine.deleteMany({ where: { id: { in: ids.machines } } }));
  await q(prisma.station.deleteMany({ where: { id: { in: ids.stations } } }));
  await q(prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.customers } } }));
  await q(prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }));
  await q(prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
  await q(prisma.serviceItem.deleteMany({ where: { id: { in: ids.svc } } }));
  await q(prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.items, ...ids.customers] } } }));
  for (const key of AYARLAR) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
