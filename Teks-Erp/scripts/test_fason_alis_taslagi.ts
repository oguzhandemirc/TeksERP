// =============================================================================
// FASON KABULÜNDEN ALIŞ FATURASI TASLAĞI BEKÇİSİ (F6)
// =============================================================================
// Ölçülenler:
//   §1 tarife köprüsü: `serviceItemId` yazılır; alan verilmeden fiyat değişimi köprüyü TAŞIR; pasif kart 400
//   §2 metre tabanı (RAW_M): miktar = fasonun hesabından DÜŞÜLEN metre (tam + kısmi kalem), kalem = hizmet kartı
//   §3 tarife as-of: sevk gününde geçerli sürüm (sonradan zamlanan değil); iki sevke yayılan makbuz iki fiyat
//   §4 FINISHED_M = doğan topların metresi · KG = sevk tartısı × kabul oranı, tartısız kalem uyarı · köprüsüz → TEXT + uyarı
//   §5 fiyatsız durumlar SESSİZ DEĞİL: başka firmanın tarifesi / tarife yok → fiyat 0 + uyarı
//   §6 yaratım: kabul başına TEK aktif fatura (409 SUBCONTRACTOR_RECEIPT_ALREADY_INVOICED), token replay aynı fatura,
//      iptal faturadan sonra yeniden; bağsız kart / iptal kabul / İE'siz kabul 409 kodlarıyla
//   §8 kabul iptali faturalı kabulde 409; taslak yaratımı kabul satırını FOR SHARE tutar (eşzamanlı iptal yarışı)
//   §7 vergi: fason kabul bağlamı çift rollü (fason rolü işaretsiz) kartta da alış tevkifatını önerir;
//      bilinmeyen İE 404 (tax-defaults `workOrderId`)
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_fason_alis_taslagi.ts
// NEGATİF SONDA — 2026-11-08: (a) `shareOf`ta `item.receivedQty ?? …` yerine hep `newRoll.currentQty` → §2a ❌;
//   (b) `pickFinishingRateAtDispatch(versions, new Date())` (aktif tarife) → §3a ❌; (c) `assertSourceFree`in fason
//   kodu kaldırılınca §6b2 ❌; (d) `purchaseContext` dalı kaldırılınca §7a ❌; (e) `changeFinishingRate`te köprü
//   taşıma (`input.serviceItemId === undefined ? current…`) kaldırılınca §1b ❌; (f) canlı ref listesinden
//   `FINISHING_RATE_MAP` sayımı 0'a çekilince §1d ❌; (g) taşınan köprünün kilidi (`lockId` carryHint) kaldırılınca §1e ❌;
//   (h) `receipt-cancel` ön kontrolü + tx-içi fatura kapısı kaldırılınca §8b ❌; (i) `assertSourceFree`teki kabul
//   FOR SHARE kilidi kaldırılınca §8c ❌; (j) `RECEIPT_SELECT.bornRolls` iptal süzgeci kaldırılınca §4a ❌. Hepsi geri alındı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { changeFinishingRate } from "../src/services/finishing-rate.service";
import { createSubcontractorPurchaseDraft, previewSubcontractorPurchaseDraft } from "../src/services/subcontractor-purchase-draft.service";
import { resolveInvoiceTaxDefaults } from "../src/services/helpers/invoice-tax-defaults.helper";
import { countServiceItemLiveRefs, transitionServiceItemLifecycleTx } from "../src/services/helpers/service-item-lifecycle.helper";
import { altinYapiYaz, fiksturKur, fiksturSil } from "./lib/maliyet-fikstur";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SubcontractorService } from "../src/services/subcontractor.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const DAY = 86_400_000;
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String(e.details?.code ?? "")}` : String(e);
  }
};

const SETTING_KEYS_TOUCHED = [
  SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED,
  SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR,
  SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR,
];

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exitCode = 1;
    return;
  }
  assertGelistirmeVeritabani("test_fason_alis_taslagi");
  const f = await fiksturKur("FAT");
  const dye = await ensureTestDyeHouse();
  const sander = await ensureTestSander();
  const dyeSnap = await prisma.subcontractor.findUniqueOrThrow({ where: { id: dye.id }, select: { customerId: true } });
  const settingSnap = await prisma.systemSetting.findMany({ where: { key: { in: SETTING_KEYS_TOUCHED } }, select: { key: true, value: true } });
  const ids = { rolls: [] as string[], receipts: [] as string[], dispatches: [] as string[], services: [] as string[], codes: [] as string[] };
  let woId: string | null = null;
  let stationId: string | null = null;
  let stepId: string | null = null;
  let batchId: string | null = null;
  let cardId: string | null = null;
  let weavingId: string | null = null;
  try {
    await altinYapiYaz(f);
    // Kart bilerek fason rolü İŞARETSİZ (çift rollü tedarikçi gibi): §7 bağlamın etkisini ölçer.
    cardId = (await prisma.customer.create({ data: { code: `${f.tag}-C`.slice(0, 32), name: `${f.tag} boyahane kartı` }, select: { id: true } })).id;
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { customerId: cardId } });
    const svc = (await prisma.serviceItem.create({ data: { code: `${f.tag}-SV`.slice(0, 32), name: `${f.tag} Boya işçiliği` }, select: { id: true } })).id;
    const svcOff = (await prisma.serviceItem.create({ data: { code: `${f.tag}-SX`.slice(0, 32), name: `${f.tag} Pasif hizmet`, lifecycleStatus: "ARCHIVED", isActive: false }, select: { id: true } })).id;
    ids.services.push(svc, svcOff);

    // ── §1 tarife köprüsü ─────────────────────────────────────────────────────
    const base = { code: f.rateCode, name: `${f.tag} apre`, basis: "RAW_M" as const, currency: "TRY" as const, pricePerM: "18", typicalShrinkPct: "4" };
    const w1 = await changeFinishingRate({ ...base, serviceItemId: svc });
    check("§1a köprü yazıldı (yeni sürüm, serviceItemId dolu)", w1.wrote && w1.row.serviceItemId === svc && w1.row.serviceItem?.id === svc, JSON.stringify(w1.row.serviceItem));
    const w2 = await changeFinishingRate({ ...base, pricePerM: "18" });
    check("§1b ⭐ alan verilmeden aynı değerler → no-op (köprü taşındı, düşmedi)", !w2.wrote && w2.row.serviceItemId === svc);
    check("§1c pasif hizmet kartı → 400", (await codeOf(() => changeFinishingRate({ ...base, serviceItemId: svcOff }))).startsWith("400"));
    const refs = (await countServiceItemLiveRefs(prisma, svc)).find((c) => c.kind === "FINISHING_RATE_MAP");
    check("§1d ⭐ aktif tarife köprüsü canlı referanstır (1) → kart arşivlenemez", refs?.count === 1 &&
      (await codeOf(() => prisma.$transaction((tx) => transitionServiceItemLifecycleTx(tx, { serviceItemId: svc, to: "ARCHIVED" })))).endsWith("ITEM_HAS_LIVE_REFERENCES"));
    // Eski (köprü canlı ref sayılmadan önce) arşivlenmiş kart: alansız fiyat değişimi köprüyü yeni sürüme TAŞIYAMAZ.
    const svcLegacy = (await prisma.serviceItem.create({ data: { code: `${f.tag}-SL`.slice(0, 32), name: `${f.tag} Eski hizmet` }, select: { id: true } })).id;
    ids.services.push(svcLegacy);
    const legacyCode = `${f.rateCode}-L`;
    ids.codes.push(legacyCode);
    await changeFinishingRate({ ...base, code: legacyCode, serviceItemId: svcLegacy });
    await prisma.serviceItem.update({ where: { id: svcLegacy }, data: { lifecycleStatus: "ARCHIVED", isActive: false } });
    check("§1e ⭐ taşınan köprü kilitlenir: arşivli kart → 400, yeni sürüm yazılmaz",
      (await codeOf(() => changeFinishingRate({ ...base, code: legacyCode, pricePerM: "20" }))).startsWith("400") &&
        (await prisma.finishingRate.count({ where: { code: legacyCode } })) === 1);
    // v1'i geçmişe çek: as-of kolu tarihli geçmiş ister.
    await prisma.finishingRate.updateMany({ where: { code: f.rateCode }, data: { createdAt: new Date(Date.now() - 10 * DAY) } });
    await prisma.finishingRate.deleteMany({ where: { code: f.rateCode, revokedAt: { not: null } } });

    // ── Fikstür: İE + fason adımı + iki sevk + tek makbuz ─────────────────────
    woId = (await prisma.workOrder.create({ data: { workOrderNumber: `${f.tag}-WO`, status: "IN_PROGRESS", targetItemId: f.fabricId }, select: { id: true } })).id;
    batchId = (await prisma.batch.create({ data: { batchNumber: `${f.tag}-P`, workOrderId: woId }, select: { id: true } })).id;
    stationId = (await prisma.station.create({ data: { code: `${f.tag}-STN`, name: `${f.tag} boyahane`, type: "EXTERNAL" }, select: { id: true } })).id;
    stepId = (await prisma.workOrderStep.create({ data: { workOrderId: woId, stationId, stepSequence: 1 }, select: { id: true } })).id;
    const roll = async (n: string, qty: number, extra: Partial<Prisma.RollUncheckedCreateInput> = {}) => {
      const r = await prisma.roll.create({
        data: { itemId: f.fabricId, initialQty: D(qty), currentQty: D(qty), status: "AT_SUBCONTRACTOR", entrySource: "SUPPLIER_RECEIPT", barcode: `${f.tag}-R${n}`, ...extra },
        select: { id: true },
      });
      ids.rolls.push(r.id);
      return r.id;
    };
    const r1 = await roll("1", 100);
    const r2 = await roll("2", 60); // kısmi: 40 m alındı, 60 m kaldı
    const r3 = await roll("3", 100);
    const mkDispatch = async (n: string, at: Date) => {
      const d = await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${f.tag}-SD${n}`, workOrderId: woId!, batchId, stepId, subcontractorId: dye.id, dispatchedAt: at }, select: { id: true } });
      ids.dispatches.push(d.id);
      return d.id;
    };
    const d1 = await mkDispatch("1", new Date(Date.now() - 3 * DAY));
    const d2 = await mkDispatch("2", new Date());
    const di1 = (await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d1, rollId: r1, dispatchedQty: D(100), dispatchedWeight: D(12) }, select: { id: true } })).id;
    const di2 = (await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d1, rollId: r2, dispatchedQty: D(100), dispatchedWeight: D(8) }, select: { id: true } })).id;
    const di3 = (await prisma.subcontractorDispatchItem.create({ data: { dispatchId: d2, rollId: r3, dispatchedQty: D(100) }, select: { id: true } })).id;
    const rec = (await prisma.subcontractorReceipt.create({ data: { receiptNo: `${f.tag}-SR`, subcontractorId: dye.id, workOrderId: woId, stepId }, select: { id: true } })).id;
    ids.receipts.push(rec);
    await prisma.subcontractorReceiptItem.createMany({
      data: [
        { receiptId: rec, newRollId: r1, sourceDispatchItemId: di1, receivedQty: D(100) },
        { receiptId: rec, newRollId: r2, sourceDispatchItemId: di2, receivedQty: D(40), isPartial: true },
        { receiptId: rec, newRollId: r3, sourceDispatchItemId: di3, receivedQty: D(100) },
      ],
    });
    // Doğan toplar (çekmeli): 95 + 38 + 97 = 230 m (düşülen 240 m).
    await roll("B1", 95, { parentReceiptId: rec, status: "IN_PRODUCTION" });
    await roll("B2", 38, { parentReceiptId: rec, status: "IN_PRODUCTION" });
    await roll("B3", 97, { parentReceiptId: rec, status: "TAMBUR_CONSUMED", currentQty: D(0) }); // sonraki adımda tüketildi: yine sayılır
    await roll("B4", 50, { parentReceiptId: rec, status: "CANCELLED" }); // iptal doğan top: sayılmaz

    // ── §2 RAW_M (tek sürüm) ──────────────────────────────────────────────────
    const p2 = await previewSubcontractorPurchaseDraft(rec);
    const l2 = p2.lines[0];
    check("§2a ⭐ RAW_M miktar = düşülen metre 100 + 40 + 100 = 240", p2.lines.length === 1 && l2?.qty === "240.000" && l2.unit === "METER", JSON.stringify(p2.lines));
    check("§2b kalem = tarifenin hizmet kartı, fiyat 18, ara toplam 4320,00 TRY", l2?.serviceItemId === svc && l2.unitPrice === "18.0000" && p2.subtotal === "4320.00" && p2.currency === "TRY");
    check("§2c taraf = fason profilinin bağlı kartı, aktif fatura yok, uyarı yok", p2.supplierCustomerId === cardId && p2.existingInvoice === null && p2.warnings.length === 0, JSON.stringify(p2.warnings));

    // ── §3 as-of: dün zam (25) → d1 (3 gün önce) 18'de, d2 (bugün) 25'te ─────
    const yesterday = new Date(Date.now() - DAY);
    await prisma.finishingRate.updateMany({ where: { code: f.rateCode, revokedAt: null }, data: { revokedAt: yesterday } });
    await prisma.finishingRate.create({ data: { code: f.rateCode, name: `${f.tag} apre`, basis: "RAW_M", currency: "TRY", pricePerM: D(25), serviceItemId: svc, createdAt: yesterday } });
    const p3 = await previewSubcontractorPurchaseDraft(rec);
    const at18 = p3.lines.find((l) => l.unitPrice === "18.0000");
    const at25 = p3.lines.find((l) => l.unitPrice === "25.0000");
    check("§3a ⭐ sevk gününün fiyatı: d1 140 m × 18, d2 100 m × 25", p3.lines.length === 2 && at18?.qty === "140.000" && at25?.qty === "100.000", JSON.stringify(p3.lines));
    check("§3b ara toplam 140×18 + 100×25 = 5020,00", p3.subtotal === "5020.00", p3.subtotal);

    // ── §4 FINISHED_M / KG / köprüsüz ─────────────────────────────────────────
    const fin = `${f.tag}-FN`.slice(0, 32);
    const kg = `${f.tag}-KG`.slice(0, 32);
    ids.codes.push(fin, kg);
    const old = new Date(Date.now() - 10 * DAY);
    await prisma.finishingRate.create({ data: { code: fin, name: `${f.tag} mamul`, basis: "FINISHED_M", currency: "TRY", pricePerM: D(10), serviceItemId: svc, createdAt: old } });
    await prisma.finishingRate.create({ data: { code: kg, name: `${f.tag} kilo`, basis: "KG", currency: "USD", pricePerM: D(2), createdAt: old } });
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: fin } });
    const p4 = await previewSubcontractorPurchaseDraft(rec);
    check("§4a ⭐ FINISHED_M miktar = doğan topların metresi 230 (tüketilen initialQty ile, iptal B4 hariç)", p4.lines.length === 1 && p4.lines[0]?.qty === "230.000" && p4.subtotal === "2300.00", JSON.stringify(p4.lines));
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: kg } });
    const p5 = await previewSubcontractorPurchaseDraft(rec);
    const kl = p5.lines[0];
    check("§4b KG = 12 × 100/100 + 8 × 40/100 = 15,2 kg (tartısız kalem katılmaz)", p5.lines.length === 1 && kl?.qty === "15.200" && kl.unit === "KG" && p5.currency === "USD", JSON.stringify(p5.lines));
    check("§4c köprüsüz tarife → serviceItemId null + uyarı; tartısız kalem uyarısı", kl?.serviceItemId === null && p5.warnings.some((w) => w.includes("hizmet kartı bağlanmamış")) && p5.warnings.some((w) => w.includes("sevk tartısı yok")), JSON.stringify(p5.warnings));

    // ── §5 fiyatsız durumlar uyarılı ─────────────────────────────────────────
    await prisma.finishingRate.updateMany({ where: { code: kg }, data: { subcontractorId: sander.id } });
    const p6 = await previewSubcontractorPurchaseDraft(rec);
    check("§5a başka firmanın tarifesi → fiyat 0 + uyarı", p6.lines.every((l) => l.unitPrice === "0.0000" && l.finishingRateId === null) && p6.warnings.some((w) => w.includes("başka bir fason firmaya")), JSON.stringify(p6));
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: null } });
    const p7 = await previewSubcontractorPurchaseDraft(rec);
    check("§5b tarife kodu yok → fiyat 0 + uyarı (sessiz değil)", p7.lines.length === 1 && p7.lines[0]?.unitPrice === "0.0000" && p7.warnings.some((w) => w.includes("tarifesi tanımlı değil")), JSON.stringify(p7.warnings));
    await prisma.costStructure.update({ where: { itemId: f.fabricId }, data: { finishingRateCode: f.rateCode } });

    // ── §7 vergi bağlamı (yaratımdan önce: önizleme satırlarında) ─────────────
    const upsert = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await upsert(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_ENABLED, true);
    await upsert(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_NUMERATOR, 5);
    await upsert(SETTING_KEYS.FINANCE_PURCHASE_WITHHOLDING_DENOMINATOR, 10);
    const plain = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId: cardId });
    const p8 = await previewSubcontractorPurchaseDraft(rec);
    check("§7a ⭐ fason kabul bağlamı: rolsüz kartta serbest alış 0, kabul taslağında %50 tevkifat", plain.withholdingRate === 0 && p8.lines.every((l) => l.withholdingRate === 50), `${plain.withholdingRate} / ${JSON.stringify(p8.lines.map((l) => l.withholdingRate))}`);
    check("§7b bilinmeyen İE → 404 WORK_ORDER_NOT_FOUND", (await codeOf(() => resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, workOrderId: randomUUID() }))) === "404:WORK_ORDER_NOT_FOUND");
    check("§7c İE'siz çağrı bugünkü gibi (yanıt döner)", (await codeOf(() => resolveInvoiceTaxDefaults({ type: InvoiceType.SALES }))) === "OK");

    // ── §6 yaratım ────────────────────────────────────────────────────────────
    const token = randomUUID();
    const c1 = await createSubcontractorPurchaseDraft(rec, { clientToken: token });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: c1.data!.id }, select: { subcontractorReceiptId: true, type: true, status: true, lines: { select: { lineType: true, serviceItemId: true, qty: true, unit: true, withholdingRate: true } } } });
    check("§6a taslak: PURCHASE, kabul bağlı, SERVICE satırları hizmet kartıyla, birim m", inv.type === "PURCHASE" && inv.status === "DRAFT" && inv.subcontractorReceiptId === rec && inv.lines.length === 2 && inv.lines.every((l) => l.lineType === "SERVICE" && l.serviceItemId === svc && l.unit === "m"), JSON.stringify(inv.lines));
    check("§6b ⭐ ikinci taslak → 409 SUBCONTRACTOR_RECEIPT_ALREADY_INVOICED", (await codeOf(() => createSubcontractorPurchaseDraft(rec, {}))) === "409:SUBCONTRACTOR_RECEIPT_ALREADY_INVOICED");
    check("§6b2 yeni token'la da 409 aynı kod (createDraft boğazı)", (await codeOf(() => createSubcontractorPurchaseDraft(rec, { clientToken: randomUUID() }))) === "409:SUBCONTRACTOR_RECEIPT_ALREADY_INVOICED");
    const replay = await createSubcontractorPurchaseDraft(rec, { clientToken: token });
    check("§6c aynı token replay → aynı fatura", replay.data?.id === c1.data!.id);
    const pv = await previewSubcontractorPurchaseDraft(rec);
    check("§6d önizleme mevcut faturayı gösterir", pv.existingInvoice?.id === c1.data!.id);
    await prisma.invoice.update({ where: { id: c1.data!.id }, data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() } });
    const c2 = await createSubcontractorPurchaseDraft(rec, {});
    check("§6e iptal faturadan sonra yeni taslak açılır", !!c2.data?.id && c2.data.id !== c1.data!.id);

    // ── §8 kabul iptali ↔ fatura (patron kararı 2026-11-08) ──────────────────
    const svcSub = new SubcontractorService();
    const cp = (await svcSub.getCancelPreview(rec)).data;
    check("§8a önizleme: aktif taslak fatura → invoiced.blocked + allSafe false", cp?.invoiced.blocked === true && cp.invoiced.docNo !== null && cp.allSafe === false, JSON.stringify(cp?.invoiced));
    check("§8b ⭐ aktif faturalı kabul iptali → 409 SUBCONTRACTOR_RECEIPT_INVOICED",
      (await codeOf(() => svcSub.cancelReceipt(rec, "TEST iptal", undefined, []))) === "409:SUBCONTRACTOR_RECEIPT_INVOICED");
    await prisma.invoice.update({ where: { id: c2.data!.id }, data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() } });
    // Yarış: kabul iptalinin claim'i satırı tutarken taslak açılır; taslak kilitte bekler, commit sonrası iptali görür.
    let racer: Promise<string> | null = null;
    let pendingDuringLock = false;
    await prisma.$transaction(async (tx) => {
      await tx.subcontractorReceipt.updateMany({ where: { id: rec, cancelledAt: null }, data: { cancelledAt: new Date() } });
      let settled = false;
      racer = codeOf(() => createSubcontractorPurchaseDraft(rec, {})).finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 800));
      pendingDuringLock = !settled;
    }, { timeout: 15000 });
    const raceCode = await racer!;
    check("§8c ⭐ eşzamanlı iptal: taslak kilitte bekler, commit sonrası 409 SUBCONTRACTOR_RECEIPT_CANCELLED", pendingDuringLock && raceCode === "409:SUBCONTRACTOR_RECEIPT_CANCELLED", `${pendingDuringLock} ${raceCode}`);
    await prisma.subcontractorReceipt.update({ where: { id: rec }, data: { cancelledAt: null } });
    const c3 = await createSubcontractorPurchaseDraft(rec, {});
    check("§8d iptal geri alınınca taslak yine açılır (kilit kalıcı engel değil)", !!c3.data?.id);
    await prisma.invoice.update({ where: { id: c3.data!.id }, data: { status: InvoiceStatus.CANCELLED, cancelledAt: new Date() } });

    await prisma.subcontractor.update({ where: { id: dye.id }, data: { customerId: null } });
    check("§6f bağsız fason profili → 409 SUBCONTRACTOR_NOT_LINKED_TO_CARD", (await codeOf(() => createSubcontractorPurchaseDraft(rec, {}))) === "409:SUBCONTRACTOR_NOT_LINKED_TO_CARD");
    const pu = await previewSubcontractorPurchaseDraft(rec);
    check("§6f2 önizleme bağsızlığı söyler (supplierCustomerId null + uyarı)", pu.supplierCustomerId === null && pu.warnings.some((w) => w.includes("cari karta bağlı değil")));
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { customerId: cardId } });

    weavingId = (await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${f.tag}-DO`, itemId: f.fabricId, executionKind: "SUBCONTRACTED", subcontractorId: dye.id }, select: { id: true } })).id;
    const recW = (await prisma.subcontractorReceipt.create({ data: { receiptNo: `${f.tag}-SRW`, subcontractorId: dye.id, weavingOrderId: weavingId }, select: { id: true } })).id;
    ids.receipts.push(recW);
    check("§6g İE'siz (dokuma) kabul → 409 SUBCONTRACTOR_RECEIPT_NOT_WORK_ORDER_BOUND", (await codeOf(() => previewSubcontractorPurchaseDraft(recW))) === "409:SUBCONTRACTOR_RECEIPT_NOT_WORK_ORDER_BOUND");
    await prisma.subcontractorReceipt.update({ where: { id: recW }, data: { cancelledAt: new Date() } });
    check("§6h iptal kabul → 409 SUBCONTRACTOR_RECEIPT_CANCELLED", (await codeOf(() => createSubcontractorPurchaseDraft(recW, {}))) === "409:SUBCONTRACTOR_RECEIPT_CANCELLED");
    await prisma.subcontractorReceipt.update({ where: { id: rec }, data: { cancelledAt: new Date() } });
    check("§6h2 iptal İE kabulü → 409 SUBCONTRACTOR_RECEIPT_CANCELLED", (await codeOf(() => previewSubcontractorPurchaseDraft(rec))) === "409:SUBCONTRACTOR_RECEIPT_CANCELLED");
    check("§6i bilinmeyen kabul → 404", (await codeOf(() => previewSubcontractorPurchaseDraft(randomUUID()))).startsWith("404"));
  } finally {
    const invs = await prisma.invoice.findMany({ where: { subcontractorReceiptId: { in: ids.receipts } }, select: { id: true } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invs.map((i) => i.id) } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invs.map((i) => i.id) } } });
    if (cardId) await prisma.cariAccount.deleteMany({ where: { customerId: cardId } });
    await prisma.subcontractor.update({ where: { id: dye.id }, data: { customerId: dyeSnap.customerId } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: ids.receipts } } });
    await prisma.roll.deleteMany({ where: { parentReceiptId: { in: ids.receipts } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: ids.dispatches } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (stepId) await prisma.workOrderStep.delete({ where: { id: stepId } });
    if (stationId) await prisma.station.delete({ where: { id: stationId } });
    if (batchId) await prisma.batch.delete({ where: { id: batchId } });
    if (woId) await prisma.workOrder.delete({ where: { id: woId } });
    if (weavingId) await prisma.weavingOrder.delete({ where: { id: weavingId } });
    await prisma.costStructure.updateMany({ where: { itemId: f.fabricId }, data: { finishingRateCode: f.rateCode } });
    await prisma.finishingRate.deleteMany({ where: { code: { in: [...ids.codes, f.rateCode] } } });
    await prisma.serviceItem.deleteMany({ where: { id: { in: ids.services } } });
    if (cardId) await prisma.customer.delete({ where: { id: cardId } });
    await fiksturSil(f);
    for (const key of SETTING_KEYS_TOUCHED) {
      const snap = settingSnap.find((s) => s.key === key);
      if (snap) await prisma.systemSetting.update({ where: { key }, data: { value: snap.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
