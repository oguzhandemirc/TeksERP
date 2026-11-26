// =============================================================================
// BEKÇİ — KÂRLILIK: KUMAŞ SATIŞI SATIRLARI (K1 dilim 1; PLAN-karlilik-dokuma-1126 §2, §3 DİLİM 1)
// =============================================================================
//   §1 el hesabı — tek fatura (USD × 2), iki dokuma işinden dört top: gelir metre payıyla (Σ pay = satır × kur),
//      maliyet = işin gerçek TL/m ("Dokuma maliyeti" tablosu, `weavingActualCostTx`) × satılan metre; hizmet satırı
//      ve metin satırı kumaş gelirine girmez
//   §2 iade edilmiş top brütte KALIR (gelir payı + maliyet), `IADE_DUSULMEDI` bilgisi
//   §3 emanet top evrene girmez (metre payına da)
//   §4 iptal İPTAL AYINDA eksi satır, fatura ayı değişmez; taslak `productDraftRows`ta, katkısız
//   §5 dokunmamış top `DOKUMA_ISI_YOK`, sevksiz fatura `SEVK_BAGI_YOK` — gelir görünür, katkı null
//   §6 tambur çocuğu atanın dokuma işine çözülür; boyahaneden doğan top (ata bağı yok) `DIS_FASON`
//   §7 iplik maliyeti yokken katkı null (0 değil) + `IPLIK_MALIYETI`
//   §8 hizmet satırları bayt-aynı (`includeProducts` ile/siz); dokuma kapalı → kumaş alanı yok
//   §9 tek kaynak (AST): ürün helper'ında ücret çarpımı / number aritmetiği yok; satılan top kümesi tek helper'dan
//
// ⭐ NEGATİF SONDA: bkz. `docs/bekci-harita/maliyet.md` satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Fikstür 2022-04/05 aylarında; satırlar fikstür faturalarına süzülür.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as ts from "typescript";
import { Currency, InvoiceStatus, ItemType, ItemUnit, Prisma, RollEntrySource, RollStatus, StationKind, StationType, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestSander } from "./fixture-subcontractor";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { ensureCariAccountTx } from "../src/services/helpers/finance.helper";
import { computeProfitability, type ProductProfitRow } from "../src/services/helpers/profitability.helper";

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
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.COST_PROFIT_MACHINE_TIME,
];
const T = (s: string, hh = "09:00") => new Date(`${s}T${hh}:00+03:00`);
const f2 = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? "null" : d.toFixed(2));

const ids = {
  customers: [] as string[], items: [] as string[], rolls: [] as string[], invoices: [] as string[], shipments: [] as string[], returns: [] as string[],
  orders: [] as string[], machines: [] as string[], stations: [] as string[], receipts: [] as string[], wos: [] as string[], steps: [] as string[], svc: [] as string[],
};

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
async function invoice(spec: {
  cariId: string; docNo: string; issue: Date; status: InvoiceStatus; shipmentId?: string | null; rate?: string; cancelledAt?: Date;
  lines: Array<{ kind: "PRODUCT" | "SERVICE" | "TEXT"; id?: string; qty: string; total: string }>;
}): Promise<string> {
  const inv = await prisma.invoice.create({
    data: {
      docNo: `${P}-${spec.docNo}`, type: "SALES", status: spec.status, cariId: spec.cariId, currency: spec.rate ? Currency.USD : Currency.TRY,
      exchangeRate: spec.rate ?? "1", issueDate: spec.issue, confirmedAt: spec.status === InvoiceStatus.DRAFT ? null : spec.issue,
      cancelledAt: spec.cancelledAt ?? null, shipmentId: spec.shipmentId ?? null,
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
    for (const k of AYARLAR.slice(0, 5)) await setSetting(k, true);
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
    await roll("D", F3, 25, { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN, parentReceiptId: rc.id, shipmentId: sh.id });
    const ret = await prisma.rollReturn.create({ data: { rollId: R2, fromShipmentId: sh.id, customerId: c.id, itemId: F1, qty: "100", receivedById: admin.id }, select: { id: true } });
    ids.returns.push(ret.id);

    // INV1: F1 1500 USD × 2 = 3000 TL / 300 m (R1 100 · R2 100 iade · R3 60 · C 40) = 10 TL/m; F2 200 × 2 = 400; F3 50 × 2 = 100.
    // Hizmet (999) ve metin satırı kumaş gelirine GİRMEZ.
    await invoice({ cariId: cari.id, docNo: "F1", issue: T("2022-04-15"), status: InvoiceStatus.CONFIRMED, shipmentId: sh.id, rate: "2", lines: [
      { kind: "PRODUCT", id: F1, qty: "300", total: "1500.00" }, { kind: "PRODUCT", id: F2, qty: "50", total: "200.00" },
      { kind: "PRODUCT", id: F3, qty: "25", total: "50.00" }, { kind: "SERVICE", id: svc.id, qty: "1", total: "999.00" }, { kind: "TEXT", qty: "1", total: "0.00" },
    ] });
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

    // ── §5 dokunmamış / sevksiz ──
    check("§5a ⭐ al-sat top `DOKUMA_ISI_YOK`, gelir 400,00 görünür, maliyet ve katkı null",
      !!al && al.missing.includes("DOKUMA_ISI_YOK") && f2(al.revenueTry) === "400.00" && al.weavingTry === null && al.contributionTry === null, al?.missing.join(","));
    const inv2 = rows.find((r) => r.docNo === `${P}-F2`);
    check("§5b sevksiz fatura `SEVK_BAGI_YOK`, gelir 70,00, katkı null", !!inv2 && inv2.missing.includes("SEVK_BAGI_YOK") && f2(inv2.revenueTry) === "70.00" && inv2.contributionTry === null, inv2?.missing.join(","));

    // ── §6 tambur çocuğu / boyahane ──
    check("§6a ⭐ tambur çocuğu (C) atanın işine (WO2) çözülür: WO2 iki top (R3 + C)", w2?.rollCount === 2, String(w2?.rollCount));
    check("§6b boyahaneden doğan top `DIS_FASON` (dokuma işi yok DEĞİL), iş null, katkı null",
      !!dye && dye.missing.includes("DIS_FASON") && !dye.missing.includes("DOKUMA_ISI_YOK") && dye.weavingOrderId === null && dye.contributionTry === null, dye?.missing.join(","));

    // ── §7 iplik yok ──
    check("§7a ⭐ iplik maliyeti yokken katkı null (0 değil) + `IPLIK_MALIYETI`; dış fasonsuz zincirde dış fason 0",
      !!w1 && w1.contributionTry === null && w1.yarnTry === null && w1.missing.includes("IPLIK_MALIYETI") && f2(w1.subcontractTry) === "0.00", w1?.missing.join(","));

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
  await q(prisma.roll.updateMany({ where: { id: { in: ids.rolls } }, data: { parentRollId: null } }));
  await q(prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }));
  await q(prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } }));
  await q(prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } }));
  await q(prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } }));
  await q(prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } }));
  await q(prisma.machineRun.deleteMany({ where: { machineId: { in: ids.machines } } }));
  await q(prisma.machineCostRate.deleteMany({ where: { machineId: { in: ids.machines } } }));
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
