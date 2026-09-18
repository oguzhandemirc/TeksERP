// =============================================================================
// BEKÇİ — n İRSALİYE → 1 FATURA (2026-09-18): pivot · REPLACE · kapılar · tolerans · eski tek-fiş yolu
// =============================================================================
// §0 BACKFILL: migration'daki INSERT gerçek satırlara koşulur — eski kolonla bağlı fatura pivota düşer, ikinci koşum 0
// §1 NULLABLE DOĞUŞ: fişsiz fatura `goodsReceipts: []`, `receiptMatch: null`; `goodsReceiptId` null
// §2 n FİŞ → TEK TASLAK (`createDraftFromGoodsReceipts`): kalemler birleşir (aynı kalem/fiyat toplanır), `goodsReceipts` 2,
//    `goodsReceiptId` NULL (n>1); liste `goodsReceiptId=` süzgeci; mal kabul listesi `filter[invoiced]=false` bağlıları düşer
// §3 REPLACE (`updateDraft.goodsReceiptIds`): küme değişir, tek fişte kolon dolar, `[]` temizler (kolon null)
// §4 KAPILAR: başka tedarikçi 400 PARTY_MISMATCH · başka para birimi 400 CURRENCY_MISMATCH · bağlı fiş 409 ALREADY_INVOICED ·
//    fatura iptali fişi serbest bırakır · iptal fiş 400 NOT_LINKABLE
// §5 TOLERANS: bayrak KAPALI (varsayılan) → onay geçer (fark ne olursa olsun; `receiptMatch.checked=false`) · AÇIK + %0 →
//    onay 400 INVOICE_RECEIPT_MISMATCH `details.differences` · AÇIK + %50 → geçer · bayrak açıkken taslak detayı exceeded taşır
// §6 ESKİ TEK-FİŞ YOLU (`createDraftFromGoodsReceipt`): `goodsReceiptId` dolu + pivot 1 satır (tek yazar); eski istemci
//    `createDraft({goodsReceiptId})` da pivota tek satır düşürür
// Negatif sonda (kırmızı görüldü): `writeInvoiceReceiptsTx` kolonu yazmayınca §3 ❌ (§6 createDraft'ın kendi kolon yazımıyla
// yeşil kalır — o yüzden §3 ölçer); `exceeded` hesabından `checked` düşünce §5 "bayrak KAPALI: exceeded yok" + "kapalıyken
// onay geçer" ❌ (kapı `checked` olmadan `exceeded` üretemez: sondanın kendisi bunu ölçtü).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik yalnız `temizle`de; bayraklar `finally`de geri yüklenir.
// Koşum: npx tsx scripts/test_invoice_receipts.ts
// =============================================================================
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemType, Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { invoiceService } from "../src/services/invoice.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const status = (e: unknown) => (e instanceof AppError ? e.statusCode : -1);
const code = (e: unknown) => (e instanceof AppError ? (e.details as { code?: string } | undefined)?.code : undefined);
async function hata(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const T = `TESTINVR${Date.now().toString(36).toUpperCase()}`;
const FLAGS = [SETTING_KEYS.FINANCE_INVOICE_MATCH_TOLERANCE, SETTING_KEYS.FINANCE_INVOICE_QTY_TOLERANCE_PCT, SETTING_KEYS.FINANCE_INVOICE_PRICE_TOLERANCE_PCT, SETTING_KEYS.FINANCE_ENABLED];
const ids = { item: "", wh: "", sup: "", sup2: "" };
const receiptIds: string[] = [];
const invoiceIds: string[] = [];
let foto: Array<{ key: string; value: Prisma.JsonValue }> = [];

async function bayrak(key: string, value: Prisma.InputJsonValue): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function fis(supplierId: string, currency: "TRY" | "USD", lines: Array<{ qty: number; price: number }>): Promise<string> {
  const r = await goodsReceiptService.create({ warehouseId: ids.wh, supplierId, currency, lines: lines.map((l) => ({ itemId: ids.item, initialQty: l.qty, unitPrice: l.price, clientToken: crypto.randomUUID() })) });
  const id = (r.data as { id: string }).id;
  receiptIds.push(id);
  return id;
}
async function detay(id: string) {
  const d = (await invoiceService.findById(id)).data as unknown as { goodsReceiptId?: string | null; goodsReceipts: Array<{ id: string }>; receiptMatch: { checked: boolean; differences: Array<{ kind: string; exceeded: boolean; diffPct: number }> } | null; lines: Array<{ id: string; qty: unknown; unitPrice: unknown }> };
  const row = await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { goodsReceiptId: true, _count: { select: { goodsReceiptLinks: true } } } });
  return { ...d, kolon: row.goodsReceiptId, pivot: row._count.goodsReceiptLinks };
}
const LINE = { description: "Kumaş", qty: 100, unit: "m", unitPrice: 5, vatRate: 20 };

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  try {
    await prisma.systemSetting.deleteMany({ where: { key: { in: FLAGS.slice(0, 3) } } });
    await bayrak(SETTING_KEYS.FINANCE_ENABLED, true);
    ids.item = (await prisma.item.create({ data: { code: `${T}-K`, name: `${T} kumaş`, itemType: ItemType.FABRIC }, select: { id: true } })).id;
    ids.wh = (await prisma.warehouse.create({ data: { code: `${T}-D`, name: `${T} depo` }, select: { id: true } })).id;
    ids.sup = (await prisma.customer.create({ data: { code: `${T}-T1`, name: `${T} Tedarikçi 1`, isCustomerRole: false, isSupplierRole: true }, select: { id: true } })).id;
    ids.sup2 = (await prisma.customer.create({ data: { code: `${T}-T2`, name: `${T} Tedarikçi 2`, isCustomerRole: false, isSupplierRole: true }, select: { id: true } })).id;
    const r1 = await fis(ids.sup, "TRY", [{ qty: 100, price: 5 }]);
    const r2 = await fis(ids.sup, "TRY", [{ qty: 50, price: 5 }, { qty: 20, price: 7 }]);
    const r3 = await fis(ids.sup, "TRY", [{ qty: 10, price: 5 }]);
    const rUsd = await fis(ids.sup, "USD", [{ qty: 10, price: 1 }]);
    const rOther = await fis(ids.sup2, "TRY", [{ qty: 10, price: 5 }]);

    console.log("\n§0 backfill (migration SQL'i gerçek satırlara)");
    const legacy = await invoiceService.createDraft({ type: "PURCHASE", customerId: ids.sup, currency: "TRY", goodsReceiptId: r3, lines: [{ ...LINE, qty: 10 }] });
    invoiceIds.push(legacy.data.id);
    await prisma.invoiceToGoodsReceipt.deleteMany({ where: { invoiceId: legacy.data.id } }); // göç öncesi durum: yalnız kolon
    const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20260918100000_invoice_to_goods_receipts", "migration.sql"), "utf8");
    const insert = sql.split(";").map((x) => x.trim()).filter((x) => /^INSERT INTO "invoice_to_goods_receipts"/.test(x.replace(/^--.*$/gm, "").trim()))[0]!;
    const n1 = await prisma.$executeRawUnsafe(insert.replace(/^--.*$/gm, ""));
    const n2 = await prisma.$executeRawUnsafe(insert.replace(/^--.*$/gm, ""));
    check("⭐ backfill: eski kolonla bağlı fatura pivota düştü (≥1), ikinci koşum 0 (idempotent)", n1 >= 1 && n2 === 0 && (await detay(legacy.data.id)).pivot === 1, `${n1}/${n2}`);

    console.log("\n§1 nullable doğuş");
    const bos = await invoiceService.createDraft({ type: "PURCHASE", customerId: ids.sup, currency: "TRY", lines: [LINE] });
    invoiceIds.push(bos.data.id);
    const dBos = await detay(bos.data.id);
    check("⭐ fişsiz fatura: goodsReceipts [], receiptMatch null, kolon null, pivot 0", dBos.goodsReceipts.length === 0 && dBos.receiptMatch === null && dBos.kolon === null && dBos.pivot === 0);

    console.log("\n§2 n fiş → tek taslak");
    const cok = await invoiceService.createDraftFromGoodsReceipts([r1, r2]);
    invoiceIds.push(cok.data.id);
    const dCok = await detay(cok.data.id);
    const qtys = dCok.lines.map((l) => `${Number(l.qty)}@${Number(l.unitPrice)}`).sort();
    check("⭐ iki fişin kalemleri birleşti (aynı kalem/fiyat toplandı: 150@5 + 20@7), goodsReceipts 2, kolon NULL, pivot 2", qtys.join(",") === "150@5,20@7" && dCok.goodsReceipts.length === 2 && dCok.kolon === null && dCok.pivot === 2, qtys.join(","));
    const liste = (await invoiceService.list({ goodsReceiptId: r2, pageSize: 50 })).data.map((r) => r.id);
    check("liste süzgeci goodsReceiptId → bağlı fatura var, fişsiz yok", liste.includes(cok.data.id) && !liste.includes(bos.data.id));
    const acik = (await goodsReceiptService.list({ page: 1, pageSize: 200, filters: { invoiced: "false", supplierId: ids.sup } })).rows.map((r) => (r as { id: string }).id);
    check("⭐ mal kabul `filter[invoiced]=false`: bağlı r1/r2/r3 YOK, serbest rUsd VAR", !acik.includes(r1) && !acik.includes(r2) && !acik.includes(r3) && acik.includes(rUsd));
    const eInv = await hata(() => goodsReceiptService.list({ page: 1, pageSize: 10, filters: { invoiced: "evet" } }));
    check("filter[invoiced] tanınmayan değer → 400", status(eInv) === 400);

    console.log("\n§3 REPLACE");
    await invoiceService.updateDraft(cok.data.id, { goodsReceiptIds: [r1] });
    const d3 = await detay(cok.data.id);
    check("⭐ küme [r1] → tek fiş: pivot 1, kolon = r1 (eski okuyucu)", d3.pivot === 1 && d3.kolon === r1 && d3.goodsReceipts[0]?.id === r1);
    await invoiceService.updateDraft(cok.data.id, { goodsReceiptIds: [] });
    const d3b = await detay(cok.data.id);
    check("`[]` temizler: pivot 0, kolon null", d3b.pivot === 0 && d3b.kolon === null);
    await invoiceService.updateDraft(cok.data.id, { notes: "x" });
    check("`goodsReceiptIds` yoksa dokunulmaz", (await detay(cok.data.id)).pivot === 0);
    await invoiceService.updateDraft(cok.data.id, { goodsReceiptIds: [r1, r2] });

    console.log("\n§4 kapılar");
    const e4a = await hata(() => invoiceService.createDraft({ type: "PURCHASE", customerId: ids.sup, currency: "TRY", goodsReceiptIds: [rOther], lines: [LINE] }));
    check("başka tedarikçinin fişi → 400 GOODS_RECEIPT_PARTY_MISMATCH", status(e4a) === 400 && code(e4a) === "GOODS_RECEIPT_PARTY_MISMATCH", msg(e4a));
    const e4b = await hata(() => invoiceService.createDraft({ type: "PURCHASE", customerId: ids.sup, currency: "TRY", goodsReceiptIds: [rUsd], lines: [LINE] }));
    check("para birimi farklı → 400 GOODS_RECEIPT_CURRENCY_MISMATCH", status(e4b) === 400 && code(e4b) === "GOODS_RECEIPT_CURRENCY_MISMATCH", msg(e4b));
    const e4c = await hata(() => invoiceService.createDraft({ type: "PURCHASE", customerId: ids.sup, currency: "TRY", goodsReceiptIds: [r1], lines: [LINE] }));
    check("⭐ zaten bağlı fiş → 409 GOODS_RECEIPT_ALREADY_INVOICED", status(e4c) === 409 && code(e4c) === "GOODS_RECEIPT_ALREADY_INVOICED", msg(e4c));
    const e4d = await hata(() => invoiceService.createDraftFromGoodsReceipts([r1, rOther]));
    check("n fiş taslağı: farklı tedarikçi → 400 PARTY_MISMATCH", status(e4d) === 400 && code(e4d) === "GOODS_RECEIPT_PARTY_MISMATCH", msg(e4d));
    const e4e = await hata(() => invoiceService.createDraft({ type: "SALES", customerId: ids.sup, currency: "TRY", goodsReceiptIds: [rUsd], lines: [LINE] }));
    check("satış faturasına fiş → 400 NOT_LINKABLE", status(e4e) === 400 && code(e4e) === "GOODS_RECEIPT_NOT_LINKABLE", msg(e4e));
    await invoiceService.cancel(cok.data.id, "bekçi");
    const yeniden = await invoiceService.createDraft({ type: "PURCHASE", customerId: ids.sup, currency: "TRY", goodsReceiptIds: [r1], lines: [LINE] });
    invoiceIds.push(yeniden.data.id);
    check("⭐ fatura iptali fişi serbest bırakır (aynı fiş yeni taslağa bağlanır)", (await detay(yeniden.data.id)).pivot === 1);

    console.log("\n§5 tolerans (onay kapısı)");
    // yeniden: r1 (100 m × 5 = 500) ↔ fatura 100 m × 5 → fark yok
    await invoiceService.updateDraft(yeniden.data.id, { lines: [{ ...LINE, qty: 130 }] }); // miktar %30 sapma, tutar %30
    const dOff = await detay(yeniden.data.id);
    check("bayrak KAPALI: receiptMatch.checked false, exceeded yok (fark hesaplanır: QTY %30)", dOff.receiptMatch?.checked === false && dOff.receiptMatch.differences.every((d) => !d.exceeded) && dOff.receiptMatch.differences.find((d) => d.kind === "QTY")?.diffPct === 30, JSON.stringify(dOff.receiptMatch));
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_MATCH_TOLERANCE, true);
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_QTY_TOLERANCE_PCT, 0);
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_PRICE_TOLERANCE_PCT, 0);
    const dOn = await detay(yeniden.data.id);
    check("⭐ bayrak AÇIK + %0: taslak detayı exceeded taşır (QTY ve AMOUNT)", dOn.receiptMatch?.checked === true && dOn.receiptMatch.differences.filter((d) => d.exceeded).length === 2);
    const e5 = await hata(() => invoiceService.confirm(yeniden.data.id));
    check("⭐ ONAY → 400 INVOICE_RECEIPT_MISMATCH, details.differences var", status(e5) === 400 && code(e5) === "INVOICE_RECEIPT_MISMATCH" && Array.isArray((e5 as AppError).details?.differences), msg(e5).slice(0, 140));
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_QTY_TOLERANCE_PCT, 50);
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_PRICE_TOLERANCE_PCT, 50);
    const dTol = await detay(yeniden.data.id);
    check("tolerans %50: exceeded yok", dTol.receiptMatch?.checked === true && dTol.receiptMatch.differences.every((d) => !d.exceeded));
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_MATCH_TOLERANCE, false);
    await bayrak(SETTING_KEYS.FINANCE_INVOICE_QTY_TOLERANCE_PCT, 0);
    const kapali = await invoiceService.confirm(yeniden.data.id);
    check("⭐ bayrak KAPALI → onay geçer (fark %30 olsa da) = bugünkü davranış", Boolean(kapali.data.id));

    console.log("\n§6 eski tek-fiş yolu");
    const rTek = await fis(ids.sup, "TRY", [{ qty: 5, price: 5 }]);
    const tek = await invoiceService.createDraftFromGoodsReceipt(rTek);
    invoiceIds.push(tek.data.id);
    const dTek = await detay(tek.data.id);
    check("⭐ `createDraftFromGoodsReceipt(id)`: goodsReceiptId dolu + pivot 1 (tek yazar)", dTek.kolon === rTek && dTek.pivot === 1 && dTek.goodsReceipts[0]?.id === rTek);
    check("eski istemci `createDraft({goodsReceiptId})` (§0 legacy) da pivota tek satır düşürmüştü", (await prisma.invoiceToGoodsReceipt.count({ where: { invoiceId: legacy.data.id, goodsReceiptId: r3 } })) === 1);
  } catch (e) {
    fail++;
    console.log(`  ✗ FAIL: beklenmeyen hata — ${msg(e).slice(0, 300)}`);
  } finally {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
}

async function temizle(): Promise<void> {
  if (invoiceIds.length > 0) {
    await prisma.invoiceToGoodsReceipt.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: invoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  const cariler = (await prisma.cariAccount.findMany({ where: { customer: { code: { startsWith: T } } }, select: { id: true } })).map((c) => c.id);
  if (cariler.length > 0) {
    await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariler } } });
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariler } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: cariler } } });
  }
  if (receiptIds.length > 0) {
    const rollIds = (await prisma.roll.findMany({ where: { goodsReceiptId: { in: receiptIds } }, select: { id: true } })).map((r) => r.id);
    if (rollIds.length > 0) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
    await prisma.yarnMovement.deleteMany({ where: { goodsReceiptId: { in: receiptIds } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  }
  if (ids.wh) await prisma.warehouse.deleteMany({ where: { id: ids.wh } });
  if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
  await prisma.customer.deleteMany({ where: { code: { startsWith: T } } });
  for (const key of FLAGS) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
