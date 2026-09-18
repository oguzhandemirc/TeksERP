// =============================================================================
// MAL KABUL ÖN-UÇUŞ (C8, 2026-09-17) — doğrulama sınıfı satır hatası FİŞ BAŞLIĞI AÇILMADAN 400; içi boş fiş DOĞMAZ
// =============================================================================
// Bulgu: `devere.lotRequired` açıkken lotsuz iplik satırı `failed[]`e düşüyor, fiş başlığı doğuyor, panel kapanıyordu.
// §1 lot zorunlu + lotsuz iplik → 400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo, code: YARN_LOT_REQUIRED}]`, `goods_receipts`
//   sayısı DEĞİŞMEZ · §2 lot dolu → fiş + satır doğar · §3 sarf kalemi → ITEM_TYPE_NOT_ALLOWED · §4 pasif kalem → ITEM_INACTIVE ·
//   §5 ikinci satır hatalıysa İLK satır da yazılmaz (hepsi ya da hiçbiri; lineNo 2) · §6 bayrak kapalı → lotsuz iplik geçer
//   (bayt bayt eski) · §7 `POST /:id/lines` yolu da ön-uçuştan geçer (`assertReceiptLinesValid`).
//   GENİŞLEME (2026-09-18, 9b): §8 pasif renk → COLOR_NOT_FOUND · §9 izinli listede olmayan renk → COLOR_NOT_ALLOWED ·
//   §10 pasif özellik → PROPERTY_INVALID · §11 fiyat zorunlu bayrağı + fiyatsız satır (kartta fiyat yok) → PRICE_REQUIRED ·
//   §12 siparişe bağlı fiş + engel bayrağı: iki satır TOPLAMI ısmarlananı aşar → OVER_RECEIPT lineNo 2, fiş YOK ·
//   §13 iki bayrak kapalı → aynı satırlar geçer (failed boş). Hepsinde fiş başlığı doğmaz (hepsi ya da hiçbiri).
//   NEGATİF SONDA (2026-09-18): `fabricLineIssue` renk kolu düşer → §8/§9 ❌; `running` toplamı düşer → §12 ❌.
// NEGATİF SONDALAR (ölçüldü): `create`teki `assertReceiptLinesValid` çağrısı düşer → §1a/§1b/§2a/§3a/§4a/§5a ❌ (6; başlık
//   doğar, failed[]) · ön-uçuşta `lotRequired` hep false → aynı 6 ❌ (lotsuz satır satır düzeyinde düşer, fiş yine doğar).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar fotoğrafına döner. Fikstür `TEST-GRP-<pid>`.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { assertReceiptLinesValid } from "../src/services/helpers/goods-receipt-preflight.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-GRP-${process.pid}`;
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED, SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED];
const setFlag = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: String(v) }, update: { value: String(v) } });
type Issue = { lineNo: number; code: string };
async function hata(fn: () => Promise<unknown>): Promise<{ status: number; code?: string; lines?: Issue[] } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (!(e instanceof AppError)) return { status: -1 };
    const d = e.details as { code?: string; lines?: Issue[] } | undefined;
    return { status: e.statusCode, code: d?.code, lines: d?.lines };
  }
}
const fisSayisi = () => prisma.goodsReceipt.count({ where: { deliveryNoteNo: { startsWith: TAG } } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== MAL KABUL ÖN-UÇUŞ BEKÇİSİ (C8) ===\n");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: FLAGS } }, select: { key: true, value: true } });
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const sarf = await prisma.item.create({ data: { code: `${TAG}-SF`, name: `${TAG} sarf`, itemType: "CONSUMABLE", unit: "ADET" }, select: { id: true } });
  const pasif = await prisma.item.create({ data: { code: `${TAG}-PS`, name: `${TAG} pasif`, itemType: "FABRIC", unit: "MT", isActive: false }, select: { id: true } });
  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} depo` }, select: { id: true } });
  // §8–§12 fikstürleri: izinli renk listesi olan kumaş, pasif renk, izinli olmayan renk, pasif özellik, 100 m'lik sipariş.
  const fabricAllowed = await prisma.item.create({ data: { code: `${TAG}-KA`, name: `${TAG} kumaş izinli`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const colorOk = await prisma.color.create({ data: { code: `${TAG}-C1`, name: `${TAG} krem` }, select: { id: true } });
  const colorOther = await prisma.color.create({ data: { code: `${TAG}-C2`, name: `${TAG} mavi` }, select: { id: true } });
  const colorPasif = await prisma.color.create({ data: { code: `${TAG}-C3`, name: `${TAG} pasif`, isActive: false }, select: { id: true } });
  await prisma.itemAllowedColor.create({ data: { itemId: fabricAllowed.id, colorId: colorOk.id } });
  const propPasif = await prisma.fabricProperty.create({ data: { code: `${TAG}-P1`, name: `${TAG} özellik pasif`, isActive: false }, select: { id: true } });
  const po = await prisma.purchaseOrder.create({ data: { orderNo: `${TAG}-PO`, orderDate: new Date(), lines: { create: [{ lineNo: 1, itemId: fabric.id, qty: 100 }] } }, select: { id: true } });
  const items = [yarn.id, fabric.id, sarf.id, pasif.id, fabricAllowed.id];
  const receiptIds: string[] = [];
  const rollIds: string[] = [];
  try {
    for (const key of FLAGS.slice(0, 3)) await setFlag(key, true);
    await setFlag(SETTING_KEYS.DEVERE_LOT_REQUIRED, true);
    const n0 = await fisSayisi();

    console.log("── §1 lot zorunlu + lotsuz iplik → 400, fiş YOK ──");
    const e1 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-1`, lines: [{ itemId: yarn.id, initialQty: 5 }] }));
    check("§1a ⭐ 400 RECEIPT_LINES_INVALID, details.lines[0] = {lineNo 1, YARN_LOT_REQUIRED}", e1?.status === 400 && e1.code === "RECEIPT_LINES_INVALID" && e1.lines?.[0]?.lineNo === 1 && e1.lines?.[0]?.code === "YARN_LOT_REQUIRED", JSON.stringify(e1));
    check("§1b ⭐ fiş BAŞLIĞI doğmadı (goods_receipts sayısı aynı)", (await fisSayisi()) === n0);

    console.log("── §2 lot dolu → fiş + iplik satırı ──");
    const r2 = (await goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-2`, lines: [{ itemId: yarn.id, initialQty: 5, lotNo: `${TAG}-LOT` }] })) as { data: { id: string; failed: unknown[]; yarnMovements?: unknown[] } };
    receiptIds.push(r2.data.id);
    check("§2a lotlu iplik satırı: fiş doğdu, failed boş", r2.data.failed.length === 0 && (await fisSayisi()) === n0 + 1);

    console.log("── §3/§4 ürün türü ve pasif kalem ──");
    const e3 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-3`, lines: [{ itemId: sarf.id, initialQty: 1 }] }));
    check("§3a sarf kalemi → ITEM_TYPE_NOT_ALLOWED, fiş yok", e3?.code === "RECEIPT_LINES_INVALID" && e3.lines?.[0]?.code === "ITEM_TYPE_NOT_ALLOWED" && (await fisSayisi()) === n0 + 1);
    const e4 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-4`, lines: [{ itemId: pasif.id, initialQty: 1 }] }));
    check("§4a pasif kalem → ITEM_INACTIVE, fiş yok", e4?.lines?.[0]?.code === "ITEM_INACTIVE" && (await fisSayisi()) === n0 + 1);

    console.log("── §5 hepsi ya da hiçbiri ──");
    const e5 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-5`, lines: [{ itemId: fabric.id, initialQty: 10, width: 150 }, { itemId: yarn.id, initialQty: 5 }] }));
    check("§5a ⭐ 1. satır (kumaş) geçerli, 2. satır lotsuz → 400 lineNo 2; kumaş TOPU da doğmadı, fiş yok", e5?.lines?.length === 1 && e5.lines[0]!.lineNo === 2 && (await fisSayisi()) === n0 + 1 && (await prisma.roll.count({ where: { itemId: fabric.id } })) === 0, JSON.stringify(e5?.lines));

    console.log("── §6 bayrak kapalı → bayt bayt eski ──");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_LOT_REQUIRED } });
    const r6 = (await goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-6`, lines: [{ itemId: yarn.id, initialQty: 5 }] })) as { data: { id: string; failed: unknown[] } };
    receiptIds.push(r6.data.id);
    check("§6a lotRequired kapalı: lotsuz iplik satırı geçer (failed boş)", r6.data.failed.length === 0);
    await setFlag(SETTING_KEYS.DEVERE_LOT_REQUIRED, true);

    console.log("── §7 POST /:id/lines yolu ──");
    const e7 = await hata(() => assertReceiptLinesValid([{ itemId: fabric.id, initialQty: 3 }, { itemId: yarn.id, initialQty: 2, bobbinCount: 0 }]));
    check("§7a satır ekleme ön-uçuşu: bobin 0 → BOBBIN_INVALID lineNo 2 (lot dolu olsa da sırayla: lotsuz önce)", e7?.code === "RECEIPT_LINES_INVALID" && e7.lines?.[0]?.lineNo === 2 && (e7.lines[0]!.code === "YARN_LOT_REQUIRED" || e7.lines[0]!.code === "BOBBIN_INVALID"), JSON.stringify(e7?.lines));
    check("§7b geçerli satırlar → sessiz geçer", (await hata(() => assertReceiptLinesValid([{ itemId: fabric.id, initialQty: 3 }, { itemId: yarn.id, initialQty: 2, lotNo: "L1", bobbinCount: 4 }]))) === null);

    console.log("── §8/§9/§10 kumaş satırı: renk pasif · renk izinli değil · özellik pasif ──");
    const e8 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-8`, lines: [{ itemId: fabric.id, initialQty: 10, colorId: colorPasif.id }] }));
    check("§8a ⭐ pasif renk → COLOR_NOT_FOUND lineNo 1, fiş yok", e8?.code === "RECEIPT_LINES_INVALID" && e8.lines?.[0]?.code === "COLOR_NOT_FOUND" && (await fisSayisi()) === n0 + 2);
    const e9 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-9`, lines: [{ itemId: fabricAllowed.id, initialQty: 10, colorId: colorOther.id }] }));
    check("§9a ⭐ izinli listede olmayan renk → COLOR_NOT_ALLOWED, fiş yok", e9?.lines?.[0]?.code === "COLOR_NOT_ALLOWED" && (await fisSayisi()) === n0 + 2);
    check("§9b izinli renk geçer (ön-uçuş sessiz)", (await hata(() => assertReceiptLinesValid([{ itemId: fabricAllowed.id, initialQty: 10, colorId: colorOk.id }]))) === null);
    check("§9c izinli listesi BOŞ kumaşta her aktif renk serbest", (await hata(() => assertReceiptLinesValid([{ itemId: fabric.id, initialQty: 10, colorId: colorOther.id }]))) === null);
    const e10 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-10`, lines: [{ itemId: fabric.id, initialQty: 10, propertyIds: [propPasif.id] }] }));
    check("§10a ⭐ pasif özellik → PROPERTY_INVALID, fiş yok", e10?.lines?.[0]?.code === "PROPERTY_INVALID" && (await fisSayisi()) === n0 + 2);

    console.log("── §11 fiyat zorunlu bayrağı + çözülemeyen fiyat ──");
    await setFlag(SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED, true);
    const e11 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-11`, lines: [{ itemId: fabric.id, initialQty: 10 }] }));
    check("§11a ⭐ fiyatsız satır, kartta fiyat yok → PRICE_REQUIRED, fiş yok", e11?.lines?.[0]?.code === "PRICE_REQUIRED" && (await fisSayisi()) === n0 + 2);
    check("§11b satır fiyatı verilince geçer (0 dahil — bedava numune meşru)", (await hata(() => assertReceiptLinesValid([{ itemId: fabric.id, initialQty: 10, unitPrice: 0 }], { requirePrice: true, priceFor: (l) => l.unitPrice ?? null, currency: "TRY" }))) === null);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.GOODS_RECEIPT_REQUIRE_PRICE_ENABLED } });

    console.log("── §12 siparişten fazla: satırlar arası TOPLAM ──");
    await setFlag(SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED, true);
    const e12 = await hata(() => goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-12`, purchaseOrderId: po.id, lines: [{ itemId: fabric.id, initialQty: 60 }, { itemId: fabric.id, initialQty: 50 }] }));
    check("§12a ⭐ 60 + 50 > 100 → OVER_RECEIPT lineNo 2 (ilk satır tek başına geçerdi), fiş YOK", e12?.code === "RECEIPT_LINES_INVALID" && e12.lines?.length === 1 && e12.lines[0]!.lineNo === 2 && e12.lines[0]!.code === "OVER_RECEIPT" && (await fisSayisi()) === n0 + 2);
    check("§12b mesaj ısmarlanan/gelmiş/fazla söyler", /100 m ısmarlandı, 60 m gelmiş; bu satırla 110 m olur \(10 m fazla\)/.test(String((e12 as { lines?: { message?: string }[] } | null)?.lines?.[0]?.message ?? "")));
    check("§12c tam 100 (60 + 40) geçer", (await hata(() => assertReceiptLinesValid([{ itemId: fabric.id, initialQty: 60 }, { itemId: fabric.id, initialQty: 40 }], { overReceipt: { orderNo: "PO", ordered: new Map([[fabric.id, new Prisma.Decimal(100)]]), received: new Map() } }))) === null);

    console.log("── §13 iki bayrak kapalı → bayt bayt eski (satırlar geçer) ──");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.PURCHASE_BLOCK_OVER_RECEIPT_ENABLED } });
    const r13 = (await goodsReceiptService.create({ warehouseId: wh.id, deliveryNoteNo: `${TAG}-13`, purchaseOrderId: po.id, lines: [{ itemId: fabric.id, initialQty: 60 }, { itemId: fabric.id, initialQty: 50 }] })) as { data: { id: string; failed: unknown[] } };
    receiptIds.push(r13.data.id);
    check("§13a engel kapalı: 110 m siparişe karşı fiş doğar, failed boş (uyarı başka kanal)", r13.data.failed.length === 0 && (await fisSayisi()) === n0 + 3);
  } finally {
    const rolls = await prisma.roll.findMany({ where: { itemId: { in: items } }, select: { id: true } });
    rollIds.push(...rolls.map((r) => r.id));
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.yarnMovement.deleteMany({ where: { itemId: yarn.id } });
    await prisma.yarnStock.deleteMany({ where: { itemId: yarn.id } });
    await prisma.yarnLot.deleteMany({ where: { itemId: yarn.id } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...receiptIds, ...rollIds] } } });
    await prisma.goodsReceipt.deleteMany({ where: { deliveryNoteNo: { startsWith: TAG } } }).catch(() => undefined);
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: po.id } }).catch(() => undefined);
    await prisma.purchaseOrder.deleteMany({ where: { id: po.id } }).catch(() => undefined);
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: items } } }).catch(() => undefined);
    await prisma.color.deleteMany({ where: { id: { in: [colorOk.id, colorOther.id, colorPasif.id] } } }).catch(() => undefined);
    await prisma.fabricProperty.deleteMany({ where: { id: propPasif.id } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: { in: items } } });
    await prisma.warehouse.delete({ where: { id: wh.id } }).catch(() => undefined);
    for (const key of FLAGS) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as never }, update: { value: eski.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
