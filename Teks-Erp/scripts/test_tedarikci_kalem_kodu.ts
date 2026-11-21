// =============================================================================
// BEKÇİ — TEDARİKÇİ KALEM KODU ↔ İPLİK KARTI (Seyitoğlu d5, 2026-11-22)
// =============================================================================
//   §0 statik — katlama tek kaynak; öğrenme mal kabulde tx DIŞI (satır döngüsünden sonra)
//   §1 kodlu kabul → hareket izi + eşleme doğar; ikinci kabulde öneri aynı kart; farklı kartla kabul → son kazanır
//   §2 katlama "ab-12 " = "AB-12"; başka tedarikçinin aynı kodu karışmaz; fason/tedarikçisiz fişte öğrenme yok
//   §3 kumaş satırında kod → 400 (ön-uçuş); PATCH iplik olmayan karta 400; pasif kart önerilmez; düzelt/kaldır + 404
//   §4 öğrenme hatası kabulü düşürmez (best-effort); ⭐ yarış: açık tx'te aynı anahtar varken öğrenme tek satır (ON CONFLICT)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-11-22): `learnSupplierItemCode`taki `INSERT … ON CONFLICT` findUnique→create/update'e
//    çevrilince §4b ❌ (açık tx commit'leyince create P2002 ile düşer). Bkz. arşiv notu.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar (iplik · ticaret) FOTOĞRAFINA döner.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import {
  learnSupplierItemCode,
  learnSupplierItemCodesSafely,
  listSupplierItemCodes,
  removeSupplierItemCode,
  suggestSupplierItemCode,
  supplierItemCodeKey,
  updateSupplierItemCode,
} from "../src/services/supplier-item-code.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    if (e instanceof AppError) return String((e.details as { code?: string } | undefined)?.code ?? e.statusCode);
    if (e instanceof Prisma.PrismaClientKnownRequestError) return `prisma ${e.code}`;
    return e instanceof Error ? e.message : String(e);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TAG = `TEST-TKK-${process.pid}`;
const ROOT = path.resolve(__dirname, "..");
const FLAGS = [SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED];
const receiptIds: string[] = [];
type Fis = { data: { id: string; failed: Array<{ reason: string }> } };

function statik(): void {
  console.log("── §0 Statik ──");
  check("§0a katlama: boşluk silinir + büyük harf", supplierItemCodeKey(" ab-12 ") === "AB-12" && supplierItemCodeKey("153.01 0652") === "153.010652" && supplierItemCodeKey("   ") === "");
  const svc = readFileSync(path.join(ROOT, "src/services/goods-receipt.service.ts"), "utf8");
  const sync = svc.indexOf("const purchaseOrder = await syncPurchaseOrderSafely(receipt.purchaseOrderId);");
  const learn = svc.indexOf("await learnSupplierItemCodesSafely(receipt.supplierId, learnPairs, userId);");
  check("§0b öğrenme satır döngüsünden SONRA, tx DIŞINDA (sipariş senkronunun ardında)", sync > 0 && learn > sync && learn - sync < 400);
  const own = readFileSync(path.join(ROOT, "src/services/supplier-item-code.service.ts"), "utf8");
  check("§0c öğrenme tek ifade `ON CONFLICT (\"supplierId\", \"codeKey\")`", /ON CONFLICT \("supplierId", "codeKey"\) DO UPDATE/.test(own));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== TEDARİKÇİ KALEM KODU BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const yarnA = await prisma.item.create({ data: { code: `${TAG}-A`, name: `${TAG} iplik A`, itemType: "YARN", unit: "KG" }, select: { id: true } });
  const yarnB = await prisma.item.create({ data: { code: `${TAG}-B`, name: `${TAG} iplik B`, itemType: "YARN", unit: "KG" }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  const sup1 = await prisma.customer.create({ data: { code: `${TAG}-T1`, name: `${TAG} tedarikçi 1`, type: "SUPPLIER" }, select: { id: true } });
  const sup2 = await prisma.customer.create({ data: { code: `${TAG}-T2`, name: `${TAG} tedarikçi 2`, type: "SUPPLIER" }, select: { id: true } });
  const items = [yarnA.id, yarnB.id, fabric.id];
  const kabul = async (supplierId: string | null, lines: Array<{ itemId: string; initialQty: number; supplierItemCode?: string | null }>) => {
    const r = (await goodsReceiptService.create({ warehouseId: wh.id, supplierId, deliveryNoteNo: `${TAG}-${receiptIds.length}`, lines })) as Fis;
    receiptIds.push(r.data.id);
    return r.data;
  };
  const row = (supplierId: string, code: string) =>
    prisma.supplierItemCode.findUnique({ where: { supplierId_codeKey: { supplierId, codeKey: supplierItemCodeKey(code) } }, select: { id: true, itemId: true, hitCount: true, rawCode: true } });
  try {
    for (const key of FLAGS) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });

    console.log("\n── §1 Öğrenme ve öneri ──");
    const r1 = await kabul(sup1.id, [{ itemId: yarnA.id, initialQty: 20.73, supplierItemCode: " 153.01.0652 " }]);
    const m1 = await prisma.yarnMovement.findFirst({ where: { goodsReceiptId: r1.id }, select: { supplierItemCode: true } });
    check("§1a hareket ham kodu iz olarak taşıyor (TRIM)", m1?.supplierItemCode === "153.01.0652", JSON.stringify(m1));
    const e1 = await row(sup1.id, "153.01.0652");
    check("§1b ⭐ eşleme doğdu (tedarikçi, kod) → iplik A, hitCount 1", e1?.itemId === yarnA.id && e1.hitCount === 1, JSON.stringify(e1));
    const s1 = await suggestSupplierItemCode(sup1.id, "153.01.0652");
    check("§1c öneri aynı kartı getiriyor", s1.match?.itemId === yarnA.id && s1.match.itemName.includes("iplik A"));
    await kabul(sup1.id, [{ itemId: yarnB.id, initialQty: 5, supplierItemCode: "153.01.0652" }]);
    const e1b = await row(sup1.id, "153.01.0652");
    check("§1d farklı kartla kabul → SON KAZANAN (B), aynı satır, hitCount 2", e1b?.id === e1?.id && e1b?.itemId === yarnB.id && e1b?.hitCount === 2, JSON.stringify(e1b));
    const kodsuz = await kabul(sup1.id, [{ itemId: yarnA.id, initialQty: 3 }]);
    check("§1e kodsuz satır = bugünkü davranış (iz NULL, eşleme yazılmaz)", (await prisma.yarnMovement.findFirst({ where: { goodsReceiptId: kodsuz.id }, select: { supplierItemCode: true } }))?.supplierItemCode === null && (await prisma.supplierItemCode.count({ where: { supplierId: sup1.id } })) === 1);

    console.log("\n── §2 Katlama ve kapsam ──");
    await kabul(sup1.id, [{ itemId: yarnA.id, initialQty: 1, supplierItemCode: "ab-12 " }]);
    const s2 = await suggestSupplierItemCode(sup1.id, "AB-12");
    check("§2a \"ab-12 \" ile öğrenilen \"AB-12\" ile önerilir", s2.match?.itemId === yarnA.id);
    check("§2b başka tedarikçide aynı kod önerilmez", (await suggestSupplierItemCode(sup2.id, "AB-12")).match === null);
    await kabul(sup2.id, [{ itemId: yarnB.id, initialQty: 1, supplierItemCode: "AB-12" }]);
    check("§2c ikinci tedarikçinin eşlemesi birincininkini ezmez", (await row(sup1.id, "AB-12"))?.itemId === yarnA.id && (await row(sup2.id, "AB-12"))?.itemId === yarnB.id);
    const once = await prisma.supplierItemCode.count({ where: { codeKey: "TEDARIKCISIZ-1" } });
    const t0 = await kabul(null, [{ itemId: yarnA.id, initialQty: 1, supplierItemCode: "TEDARIKCISIZ-1" }]);
    check("§2d tedarikçisiz fiş: iz yazılır, eşleme öğrenilmez", (await prisma.yarnMovement.findFirst({ where: { goodsReceiptId: t0.id }, select: { supplierItemCode: true } }))?.supplierItemCode === "TEDARIKCISIZ-1" && (await prisma.supplierItemCode.count({ where: { codeKey: "TEDARIKCISIZ-1" } })) === once);

    console.log("\n── §3 Kapılar, düzelt, kaldır ──");
    let satirKod = "";
    try {
      await kabul(sup1.id, [{ itemId: fabric.id, initialQty: 10, supplierItemCode: "X1" }]);
    } catch (e) {
      satirKod = e instanceof AppError ? String((e.details as { lines?: Array<{ code: string }> } | undefined)?.lines?.[0]?.code) : String(e);
    }
    check("§3a kumaş satırında kod → 400 SUPPLIER_ITEM_CODE_YARN_ONLY (fiş açılmaz)", satirKod === "SUPPLIER_ITEM_CODE_YARN_ONLY" && (await prisma.goodsReceipt.count({ where: { deliveryNoteNo: `${TAG}-${receiptIds.length}` } })) === 0, satirKod);
    const e3 = (await row(sup1.id, "AB-12"))!;
    check("§3b PATCH iplik olmayan karta → 400 SUPPLIER_ITEM_CODE_NOT_YARN", (await hataKodu(() => updateSupplierItemCode(e3.id, { itemId: fabric.id }))) === "SUPPLIER_ITEM_CODE_NOT_YARN");
    const upd = await updateSupplierItemCode(e3.id, { itemId: yarnB.id });
    check("§3c PATCH iplik karta → güncellendi, liste tedarikçi süzgeciyle döner", upd.itemId === yarnB.id && (await listSupplierItemCodes({ supplierId: sup1.id })).some((r) => r.id === e3.id && r.item.id === yarnB.id));
    await prisma.item.update({ where: { id: yarnB.id }, data: { lifecycleStatus: "PHASE_OUT" } });
    check("§3d pasife alınan (PHASE_OUT) kart önerilmez", (await suggestSupplierItemCode(sup1.id, "AB-12")).match === null);
    await prisma.item.update({ where: { id: yarnB.id }, data: { lifecycleStatus: "ACTIVE" } });
    await removeSupplierItemCode(e3.id);
    check("§3e kaldır → satır yok; ikinci kaldır 404", (await row(sup1.id, "AB-12")) === null && (await hataKodu(() => removeSupplierItemCode(e3.id))) === "SUPPLIER_ITEM_CODE_NOT_FOUND");

    console.log("\n── §4 Best-effort ve yarış ──");
    let dustu = false;
    await learnSupplierItemCodesSafely(crypto.randomUUID(), [{ rawCode: "FK-YOK", itemId: yarnA.id }]).catch(() => { dustu = true; });
    check("§4a öğrenme hatası (olmayan tedarikçi FK) fırlatmaz", !dustu);
    let ins!: () => void;
    const inserted = new Promise<void>((r) => { ins = r; });
    const tutan = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "supplier_item_codes" ("id","supplierId","codeKey","rawCode","itemId","hitCount","createdAt","updatedAt") VALUES (gen_random_uuid(), ${sup2.id}::uuid, 'YARIS-1', 'YARIS-1', ${yarnA.id}::uuid, 1, now(), now())`; // tz-ok: kolonlar timestamptz
      ins();
      await sleep(600);
    }, { timeout: 10_000 });
    await inserted;
    const ogren = hataKodu(() => learnSupplierItemCode({ supplierId: sup2.id, rawCode: "yaris-1", itemId: yarnB.id }));
    await tutan;
    const sonuc = await ogren;
    const yr = await prisma.supplierItemCode.findMany({ where: { supplierId: sup2.id, codeKey: "YARIS-1" }, select: { itemId: true, hitCount: true } });
    check("§4b ⭐ açık tx'teki aynı anahtarla eşzamanlı öğrenme: hata yok, TEK satır, hitCount 2, son kazanan", sonuc === "geçti" && yr.length === 1 && yr[0].hitCount === 2 && yr[0].itemId === yarnB.id, `${sonuc} ${JSON.stringify(yr)}`);
  } finally {
    await prisma.supplierItemCode.deleteMany({ where: { supplierId: { in: [sup1.id, sup2.id] } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: { in: items } } });
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: items } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: items } } }).catch(() => undefined);
    await prisma.warehouse.delete({ where: { id: wh.id } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: { in: [sup1.id, sup2.id] } } }).catch(() => undefined);
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
