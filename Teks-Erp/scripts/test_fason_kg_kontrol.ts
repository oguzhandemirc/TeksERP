// =============================================================================
// FASON SEVK KG KONTROLÜ BEKÇİSİ (SY-E2) — beklenen boyahane tutarı = Σ sevk kg × aktif KG tarifesi
// =============================================================================
// Tasarım §6.5 "isteğe bağlı kontrol" + §16.1 SY-E2 kabulü: "tarife yok → satır yok (0 değil)".
// Ölçülenler:
//   §1 saf hesap: 12,5 + 7,5 kg × 0,90 $ = 18,00 $; tartılmamış top sayılır ama toplanmaz;
//      tarife yok / metre tabanı / başka firmanın tarifesi / kg yok / top yok → line null + sebep
//   §2 tarife kodu tek kaynak: varyant > ürün yapısı (⭐ negatif sondanın hedefi); satırlar ayrı
//      koda çözülürse belirsiz → satır yok
//   §3 fatura farkı: aynı para birimi ve sevke özgü → fark; farklı para / başka sevkleri de
//      kapsayan kabul → fark null (uydurulmaz)
//   §4 DB: metre tabanlı tarifede (bugünkü dokuma/Adnan Şahin kurulumu) satır YOK; KG tarifesinde
//      satır = el hesabı; başka firmaya bağlı tarife → satır yok; bağlı ALIŞ faturası farkı;
//      iptal faturası sayılmaz; bilinmeyen sevk 404
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_fason_kg_kontrol.ts
// NEGATİF SONDA — 2026-11-01: `resolveFinishingRateCode` önceliği `structureCode ?? variantCode`
//   olarak TERS çevrilince §2a ❌; `computeDispatchFinishingCheck`te NOT_KG_BASIS dalı silinince
//   §1c ve §4a ❌ (metre tarifesi kg ile çarpıldı). İkisi de geri alındı.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import {
  computeDispatchFinishingCheck,
  pickDispatchRateCode,
  type FinishingCheckInput,
  type FinishingCheckRate,
} from "../src/services/helpers/dispatch-finishing-check.helper";
import { resolveFinishingRateCode } from "../src/services/helpers/finishing-rate-code.helper";
import { getDispatchFinishingCheck } from "../src/services/dispatch-finishing-check.service";
import { AppError } from "../src/utils/app-error";
import { altinYapiYaz, fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

const SUB = "sub-boya";
const kgRate = (over: Partial<FinishingCheckRate> = {}): FinishingCheckRate => ({
  code: "BOYA-R", name: "Boya renkli", basis: "KG", currency: "USD", pricePerM: D("0.9"), subcontractorId: null, ...over,
});
const inp = (over: Partial<FinishingCheckInput> = {}): FinishingCheckInput => ({
  subcontractorId: SUB, fabricWeights: [D("12.5"), D("7.5")], rateCodes: ["BOYA-R"], rate: kgRate(),
  invoices: [], invoicesCoverOtherDispatches: false, ...over,
});

function bolum1(): void {
  const ok = computeDispatchFinishingCheck(inp());
  check("§1a 20 kg × 0,90 $ = 18,00 $", ok.line?.expectedAmount === "18.00" && ok.line.totalKg === "20.000" && ok.line.currency === "USD", JSON.stringify(ok.line));
  const partial = computeDispatchFinishingCheck(inp({ fabricWeights: [D("12.5"), null] }));
  check("§1b tartılmamış top sayılır, toplanmaz", partial.line?.expectedAmount === "11.25" && partial.line.unweighedCount === 1 && partial.line.weighedCount === 1);
  check("§1c metre tabanlı tarife → satır yok (NOT_KG_BASIS)", computeDispatchFinishingCheck(inp({ rate: kgRate({ basis: "RAW_M" }) })).reason === "NOT_KG_BASIS");
  check("§1d tarife yok → satır yok, 0 DEĞİL", (() => { const r = computeDispatchFinishingCheck(inp({ rate: null })); return r.line === null && r.reason === "RATE_NOT_FOUND"; })());
  check("§1e kod yok → NO_RATE_CODE", computeDispatchFinishingCheck(inp({ rateCodes: [null], rate: null })).reason === "NO_RATE_CODE");
  check("§1f başka firmanın tarifesi → OTHER_SUBCONTRACTOR", computeDispatchFinishingCheck(inp({ rate: kgRate({ subcontractorId: "baska" }) })).reason === "OTHER_SUBCONTRACTOR");
  check("§1g aynı firmaya bağlı tarife → satır var", computeDispatchFinishingCheck(inp({ rate: kgRate({ subcontractorId: SUB }) })).line !== null);
  check("§1h hiç kg yok → NO_WEIGHT", computeDispatchFinishingCheck(inp({ fabricWeights: [null, null] })).reason === "NO_WEIGHT");
  check("§1i kumaş topu yok (levent/iplik fasonu) → NO_FABRIC_ITEMS", computeDispatchFinishingCheck(inp({ fabricWeights: [] })).reason === "NO_FABRIC_ITEMS");
}

function bolum2(): void {
  check("§2a varyant kodu ürün yapısı kodunu ezer", resolveFinishingRateCode("VARYANT", "YAPI") === "VARYANT");
  check("§2b varyant boşsa ürün yapısı", resolveFinishingRateCode(null, "YAPI") === "YAPI" && resolveFinishingRateCode(undefined, null) === null);
  check("§2c aynı kod iki satırda → tek kod", pickDispatchRateCode(["A", "A"]) === "A");
  check("§2d farklı kodlar → belirsiz", pickDispatchRateCode(["A", "B"]) === "AMBIGUOUS" && pickDispatchRateCode(["A", null]) === "AMBIGUOUS");
  check("§2e belirsiz kod → satır yok", computeDispatchFinishingCheck(inp({ rateCodes: ["BOYA-R", "BOYA-E"] })).reason === "AMBIGUOUS_RATE_CODE");
}

function bolum3(): void {
  const inv = (currency: "USD" | "TRY", net: string, status: "DRAFT" | "CONFIRMED" = "CONFIRMED") => ({ docNo: `F-${currency}-${net}`, status, currency, net: D(net) });
  const r = computeDispatchFinishingCheck(inp({ invoices: [inv("USD", "20")] }));
  check("§3a fatura 20 − beklenen 18 = 2,00", r.line?.invoice?.difference === "2.00" && r.line.invoice.netAmount === "20.00");
  const tl = computeDispatchFinishingCheck(inp({ invoices: [inv("TRY", "700")] }));
  check("§3b farklı para birimi → fark null", tl.line?.invoice?.difference === null && tl.line.invoice.netAmount === "700.00");
  const shared = computeDispatchFinishingCheck(inp({ invoices: [inv("USD", "20")], invoicesCoverOtherDispatches: true }));
  check("§3c başka sevkleri de kapsayan fatura → fark null", shared.line?.invoice?.difference === null && shared.line.invoice.coversOtherDispatches);
  const draft = computeDispatchFinishingCheck(inp({ invoices: [inv("USD", "10", "DRAFT"), inv("USD", "9")] }));
  check("§3d taslak işaretlenir, iki fatura toplanır", draft.line?.invoice?.hasDraft === true && draft.line.invoice.difference === "1.00");
  check("§3e fatura yoksa invoice null", computeDispatchFinishingCheck(inp()).line?.invoice === null);
}

interface Created { rollIds: string[]; woId?: string; batchId?: string; stationId?: string; stepId?: string; dispatchId?: string; receiptId?: string; invoiceIds: string[]; cariId?: string; rateCodes: string[] }

async function bolum4(): Promise<void> {
  const f = await fiksturKur("FKG");
  const c: Created = { rollIds: [], invoiceIds: [], rateCodes: [] };
  const dye = await ensureTestDyeHouse();
  const sander = await ensureTestSander();
  try {
    await altinYapiYaz(f); // ürün yapısı → fikstürün RAW_M TRY apre tarifesi
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${f.tag}-WO`, status: "IN_PROGRESS", targetItemId: f.fabricId }, select: { id: true } });
    c.woId = wo.id;
    c.batchId = (await prisma.batch.create({ data: { batchNumber: `${f.tag}-P`, workOrderId: wo.id }, select: { id: true } })).id;
    c.stationId = (await prisma.station.create({ data: { code: `${f.tag}-STN`, name: `${f.tag} boyahane`, type: "EXTERNAL" }, select: { id: true } })).id;
    c.stepId = (await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: c.stationId, stepSequence: 1 }, select: { id: true } })).id;
    const roll = async (n: string) => {
      const r = await prisma.roll.create({ data: { itemId: f.fabricId, initialQty: D(100), currentQty: D(100), status: "AT_SUBCONTRACTOR", entrySource: "SUPPLIER_RECEIPT", barcode: `${f.tag}-R${n}` }, select: { id: true } });
      c.rollIds.push(r.id);
      return r.id;
    };
    const r1 = await roll("1");
    const r2 = await roll("2");
    const disp = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${f.tag}-SD`, workOrderId: wo.id, batchId: c.batchId, stepId: c.stepId, subcontractorId: dye.id }, select: { id: true } });
    c.dispatchId = disp.id;
    await prisma.subcontractorDispatchItem.create({ data: { dispatchId: disp.id, rollId: r1, dispatchedQty: D(100), dispatchedWeight: D("12.5") } });
    const di2 = await prisma.subcontractorDispatchItem.create({ data: { dispatchId: disp.id, rollId: r2, dispatchedQty: D(100), dispatchedWeight: D("7.5") }, select: { id: true } });

    const a = await getDispatchFinishingCheck(disp.id);
    check("§4a metre tabanlı tarife (bugünkü kurulum) → satır YOK", a.line === null && a.reason === "NOT_KG_BASIS", JSON.stringify(a));

    const kg = `${f.tag}-KG`.slice(0, 32);
    c.rateCodes.push(kg);
    await prisma.finishingRate.create({ data: { code: kg, name: `${f.tag} boya renkli`, basis: "KG", currency: "USD", pricePerM: D("0.9") } });
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: kg } });
    const b = await getDispatchFinishingCheck(disp.id);
    check("§4b KG tarifesi → 20 kg × 0,90 = 18,00 USD", b.line?.expectedAmount === "18.00" && b.line.totalKg === "20.000" && b.line.rateCode === kg && b.line.invoice === null, JSON.stringify(b));

    const bound = `${f.tag}-KGZ`.slice(0, 32);
    c.rateCodes.push(bound);
    await prisma.finishingRate.create({ data: { code: bound, name: `${f.tag} zımpara`, basis: "KG", currency: "USD", pricePerM: D("0.5"), subcontractorId: sander.id } });
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: bound } });
    check("§4c başka firmaya bağlı tarife → satır yok", (await getDispatchFinishingCheck(disp.id)).reason === "OTHER_SUBCONTRACTOR");
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: kg } });

    const existingCari = await prisma.cariAccount.findUnique({ where: { subcontractorId: dye.id }, select: { id: true } });
    const cari = existingCari ?? (await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: dye.id }, select: { id: true } }));
    if (!existingCari) c.cariId = cari.id;
    const newRoll = await roll("3");
    const rec = await prisma.subcontractorReceipt.create({ data: { receiptNo: `${f.tag}-SR`, subcontractorId: dye.id, workOrderId: c.woId, stepId: c.stepId }, select: { id: true } });
    c.receiptId = rec.id;
    await prisma.subcontractorReceiptItem.create({ data: { receiptId: rec.id, newRollId: newRoll, sourceDispatchItemId: di2.id } });
    const mkInv = async (n: string, status: "CONFIRMED" | "CANCELLED", subtotal: string) => {
      const i = await prisma.invoice.create({
        data: { docNo: `${f.tag}-F${n}`, type: "PURCHASE", status, cariId: cari.id, currency: "USD", issueDate: new Date(), subtotal: D(subtotal), discountTotal: D(0), subcontractorReceiptId: rec.id, confirmedAt: new Date(), ...(status === "CANCELLED" ? { cancelledAt: new Date() } : {}) },
        select: { id: true },
      });
      c.invoiceIds.push(i.id);
    };
    await mkInv("1", "CONFIRMED", "19.40");
    await mkInv("2", "CANCELLED", "500");
    const d = await getDispatchFinishingCheck(disp.id);
    check("§4d bağlı ALIŞ faturası: 19,40 − 18,00 = 1,40; iptal sayılmaz", d.line?.invoice?.difference === "1.40" && d.line.invoice.docNos.length === 1, JSON.stringify(d.line?.invoice));

    let code: unknown = null;
    try { await getDispatchFinishingCheck("00000000-0000-4000-8000-000000000000"); } catch (e) { code = e instanceof AppError ? e.details?.code : String(e); }
    check("§4e bilinmeyen sevk → 404 DISPATCH_NOT_FOUND", code === "DISPATCH_NOT_FOUND");
  } finally {
    await prisma.invoice.deleteMany({ where: { id: { in: c.invoiceIds } } });
    if (c.receiptId) {
      await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: c.receiptId } });
      await prisma.subcontractorReceipt.delete({ where: { id: c.receiptId } });
    }
    if (c.cariId) await prisma.cariAccount.delete({ where: { id: c.cariId } });
    if (c.dispatchId) {
      await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: c.dispatchId } });
      await prisma.subcontractorDispatch.delete({ where: { id: c.dispatchId } });
    }
    await prisma.roll.deleteMany({ where: { id: { in: c.rollIds } } });
    if (c.stepId) await prisma.workOrderStep.delete({ where: { id: c.stepId } });
    if (c.stationId) await prisma.station.delete({ where: { id: c.stationId } });
    if (c.batchId) await prisma.batch.delete({ where: { id: c.batchId } });
    if (c.woId) await prisma.workOrder.delete({ where: { id: c.woId } });
    await prisma.costStructure.updateMany({ where: { itemId: f.fabricId }, data: { finishingRateCode: f.rateCode } });
    await prisma.finishingRate.deleteMany({ where: { code: { in: c.rateCodes } } });
    await fiksturSil(f);
  }
}

async function main(): Promise<void> {
  bolum1();
  bolum2();
  bolum3();
  assertGelistirmeVeritabani("test_fason_kg_kontrol");
  await bolum4();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
