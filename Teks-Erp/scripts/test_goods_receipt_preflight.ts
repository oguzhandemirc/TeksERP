// =============================================================================
// MAL KABUL ÖN-UÇUŞ (C8, 2026-09-17) — doğrulama sınıfı satır hatası FİŞ BAŞLIĞI AÇILMADAN 400; içi boş fiş DOĞMAZ
// =============================================================================
// Bulgu: `devere.lotRequired` açıkken lotsuz iplik satırı `failed[]`e düşüyor, fiş başlığı doğuyor, panel kapanıyordu.
// §1 lot zorunlu + lotsuz iplik → 400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo, code: YARN_LOT_REQUIRED}]`, `goods_receipts`
//   sayısı DEĞİŞMEZ · §2 lot dolu → fiş + satır doğar · §3 sarf kalemi → ITEM_TYPE_NOT_ALLOWED · §4 pasif kalem → ITEM_INACTIVE ·
//   §5 ikinci satır hatalıysa İLK satır da yazılmaz (hepsi ya da hiçbiri; lineNo 2) · §6 bayrak kapalı → lotsuz iplik geçer
//   (bayt bayt eski) · §7 `POST /:id/lines` yolu da ön-uçuştan geçer (`assertReceiptLinesValid`).
// NEGATİF SONDALAR (ölçüldü): `create`teki `assertReceiptLinesValid` çağrısı düşer → §1a/§1b/§2a/§3a/§4a/§5a ❌ (6; başlık
//   doğar, failed[]) · ön-uçuşta `lotRequired` hep false → aynı 6 ❌ (lotsuz satır satır düzeyinde düşer, fiş yine doğar).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Bayraklar fotoğrafına döner. Fikstür `TEST-GRP-<pid>`.
// =============================================================================
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
const FLAGS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.TICARET_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED];
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
  const items = [yarn.id, fabric.id, sarf.id, pasif.id];
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
