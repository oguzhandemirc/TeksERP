// =============================================================================
// BEKÇİ — ARŞİV SEDDİ: kartela × ürün · top × renk · kartela × renk (MV-06; top × ürün seddinin ikizleri)
// Çalıştır: npx tsx scripts/test_arsiv_seddi_kartela_renk.ts
// =============================================================================
// Uygulama kapısı `assertRollsRevivable` / `assertSwatchesRevivable` (renk ayağıyla); DB seddi
// `rolls_color_not_archived` · `swatches_master_not_archived` (migration 20260926190000). Bu bekçi kapıyı
// ATLAYAN ham yazımın DB'de durduğunu ve geri alma yollarının DB'ye gitmeden 409 verdiğini ölçer:
//   §1 tetikleyici kümeleri TS ikizleriyle aynı (top ölü kümesi `DEAD_ROLL_STATUSES` · kartela canlı `LIVE_SWATCH`)
//   §2 kartela × Pasif ürün: canlı INSERT ✖ · ölü INSERT ✔ · ⭐ dirilme (REDUCED → IN_STOCK) ✖ · canlıyı Pasif karta taşımak ✖
//   §3 kartela × pasif renk: aynı dört durum + renksiz kartela ✔
//   §4 top × pasif renk: canlı INSERT ✖ · ölü INSERT ✔ · ⭐ dirilme ✖ · canlı topu pasif renge boyamak ✖ · aktif renkte ✔
//   §5 uygulama: iki geri alma yolu (top iptal geri alma · kartela düşüm stornosu) pasif renkte 409 COLOR_INACTIVE
//   §6 error.middleware: üç kısıt adı çıkış yolunu söyleyen Türkçe mesaja eşlenir
//
// NEGATİF SONDA (2026-09-26, geri alındı): tetikleyiciler DISABLE → §2–§4 sed satırları ❌ · uygulama renk
//   ayağı kaldırıldı → §5 ❌ (DB seddi 23514'e düştü, 409 COLOR_INACTIVE değil).
// =============================================================================
import { ItemLifecycleStatus, RollStatus, SwatchStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestKartela } from "./fixture-subcontractor";
import { transitionItemLifecycle } from "../src/services/helpers/item-lifecycle.helper";
import { DEAD_ROLL_STATUSES, LIVE_SWATCH } from "../src/services/helpers/live-ref-where.helper";
import { checkConstraintMessage, extractCheckConstraint } from "../src/middlewares/error.middleware";
import {
  ROLL_ON_ARCHIVED_COLOR_MESSAGE,
  SWATCH_ON_ARCHIVED_COLOR_MESSAGE,
  SWATCH_ON_ARCHIVED_ITEM_MESSAGE,
} from "../src/constants/item-archive-messages";
import { InventoryService } from "../src/services/inventory.service";
import { kartelaService } from "../src/services/kartela.service";
import { createSwatchesTx } from "../src/services/helpers/swatch-event.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
/** "OK" ya da yakalanan CHECK kısıt adı (23514), başka hata ise "ERR:…". */
async function sedOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    const c = extractCheckConstraint(e);
    return c !== null ? c : `ERR:${(e as Error).message.slice(0, 80)}`;
  }
}
async function hataOf(fn: () => Promise<unknown>): Promise<{ code: string; msg: string }> {
  try {
    await fn();
    return { code: "", msg: "GEÇTİ" };
  } catch (e) {
    return { code: String((e as { details?: { code?: string } }).details?.code ?? ""), msg: (e as Error).message };
  }
}

const T = `TST-ASR-${Date.now().toString().slice(-7)}`;
const itemIds: string[] = [];
const colorIds: string[] = [];
const rollIds: string[] = [];
let RECEIPT = "";
let seq = 0;

const kume = async (fn: string, desen: RegExp): Promise<Set<string>> => {
  const def = await prisma.$queryRawUnsafe<Array<{ d: string }>>(`SELECT pg_get_functiondef('${fn}'::regproc) AS d`);
  const m = desen.exec(def[0]?.d ?? "");
  return new Set((m?.[1] ?? "").split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean));
};
const ayni = (a: Set<string>, b: readonly string[]) => a.size === b.length && b.every((x) => a.has(x));

async function mkItem(tag: string, arsiv: boolean, adminId: string): Promise<string> {
  const id = (await prisma.item.create({ data: { code: `${T}-${tag}`, name: `${T} ${tag}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  itemIds.push(id);
  if (arsiv) await transitionItemLifecycle({ itemId: id, to: ItemLifecycleStatus.ARCHIVED, userId: adminId });
  return id;
}
async function mkColor(tag: string, aktif: boolean): Promise<string> {
  const id = (await prisma.color.create({ data: { code: `${T}-${tag}`, name: `${T} RENK ${tag}`, isActive: aktif }, select: { id: true } })).id;
  colorIds.push(id);
  return id;
}
const swatchData = (itemId: string, colorId: string | null, status: SwatchStatus) => ({
  cardNumber: `${T}-K${++seq}`, barcode: `${T}-KB${seq}`, itemId, colorId, parentReceiptId: RECEIPT, status,
  ...(status === SwatchStatus.REDUCED ? { cancelledAt: new Date() } : {}),
});
const rollData = (itemId: string, colorId: string | null, status: RollStatus) => ({
  barcode: `${T}R${++seq}`.slice(0, 30), itemId, colorId, initialQty: 40, currentQty: 40, status,
});
const topYarat = async (itemId: string, colorId: string | null, status: RollStatus, ek: object = {}) => {
  const r = await prisma.roll.create({ data: { ...rollData(itemId, colorId, status), ...ek }, select: { id: true } });
  rollIds.push(r.id);
  return r.id;
};

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  RECEIPT = (await prisma.kartelaReceipt.create({ data: { receiptNo: `${T}-KR`, subcontractorId: (await ensureTestKartela()).id }, select: { id: true } })).id;

  console.log("=== 1) Tetikleyici kümeleri ↔ TS ikizleri ===");
  const topOlu = await kume("rolls_archived_color_guard", /NEW\.status IN \(([^)]+)\)/);
  check("top × renk tetikleyicisinin ölü kümesi `DEAD_ROLL_STATUSES` ile aynı", ayni(topOlu, DEAD_ROLL_STATUSES as string[]), [...topOlu].join(","));
  const kartelaCanli = await kume("swatches_archived_master_guard", /NEW\.status NOT IN \(([^)]+)\)/);
  const tsCanli = (LIVE_SWATCH.status as { in: string[] }).in;
  check("kartela tetikleyicisinin canlı kümesi `LIVE_SWATCH` ile aynı", ayni(kartelaCanli, tsCanli), [...kartelaCanli].join(","));

  console.log("\n=== 2) Kartela × Pasif ürün (ham yazım) ===");
  const pasifUrun = await mkItem("PASIF", true, admin.id);
  const aktifUrun = await mkItem("AKTIF", false, admin.id);
  check("Pasif karta CANLI kartela INSERT → sed", (await sedOf(() => prisma.swatch.create({ data: swatchData(pasifUrun, null, SwatchStatus.IN_STOCK) }))) === "swatches_item_not_archived");
  const oluK = await prisma.swatch.create({ data: swatchData(pasifUrun, null, SwatchStatus.REDUCED), select: { id: true } });
  check("Pasif karta ÖLÜ kartela INSERT → geçer (tarihçe)", true);
  check("⭐ Pasif karttaki kartelanın DİRİLMESİ (REDUCED → IN_STOCK) → sed",
    (await sedOf(() => prisma.swatch.update({ where: { id: oluK.id }, data: { status: SwatchStatus.IN_STOCK, cancelledAt: null } }))) === "swatches_item_not_archived");
  const canliK = await prisma.swatch.create({ data: swatchData(aktifUrun, null, SwatchStatus.IN_STOCK), select: { id: true } });
  check("canlı kartelayı Pasif karta taşımak (itemId) → sed", (await sedOf(() => prisma.swatch.update({ where: { id: canliK.id }, data: { itemId: pasifUrun } }))) === "swatches_item_not_archived");

  console.log("\n=== 3) Kartela × pasif renk (ham yazım) ===");
  const pasifRenk = await mkColor("PASIF", false);
  const aktifRenk = await mkColor("AKTIF", true);
  check("pasif renge CANLI kartela INSERT → sed", (await sedOf(() => prisma.swatch.create({ data: swatchData(aktifUrun, pasifRenk, SwatchStatus.IN_STOCK) }))) === "swatches_color_not_archived");
  const oluR = await prisma.swatch.create({ data: swatchData(aktifUrun, pasifRenk, SwatchStatus.REDUCED), select: { id: true } });
  check("pasif renge ÖLÜ kartela INSERT → geçer (tarihçe)", true);
  check("⭐ pasif renkteki kartelanın DİRİLMESİ (REDUCED → IN_STOCK) → sed",
    (await sedOf(() => prisma.swatch.update({ where: { id: oluR.id }, data: { status: SwatchStatus.IN_STOCK, cancelledAt: null } }))) === "swatches_color_not_archived");
  check("canlı kartelayı pasif renge boyamak (colorId) → sed", (await sedOf(() => prisma.swatch.update({ where: { id: canliK.id }, data: { colorId: pasifRenk } }))) === "swatches_color_not_archived");
  check("aktif renkte / renksiz canlı kartela → geçer (körlük zemini)",
    (await sedOf(() => prisma.swatch.update({ where: { id: canliK.id }, data: { colorId: aktifRenk } }))) === "OK"
      && (await sedOf(() => prisma.swatch.create({ data: swatchData(aktifUrun, null, SwatchStatus.IN_STOCK) }))) === "OK");

  console.log("\n=== 4) Top × pasif renk (ham yazım) ===");
  check("pasif renge CANLI top INSERT → sed", (await sedOf(() => prisma.roll.create({ data: rollData(aktifUrun, pasifRenk, RollStatus.WAREHOUSE) }))) === "rolls_color_not_archived");
  const oluTop = await topYarat(aktifUrun, pasifRenk, RollStatus.CANCELLED);
  check("pasif renge ÖLÜ top INSERT → geçer (tarihçe)", true);
  check("⭐ pasif renkteki topun DİRİLMESİ (CANCELLED → WAREHOUSE) → sed",
    (await sedOf(() => prisma.roll.update({ where: { id: oluTop }, data: { status: RollStatus.WAREHOUSE } }))) === "rolls_color_not_archived");
  const canliTop = await topYarat(aktifUrun, aktifRenk, RollStatus.WAREHOUSE);
  check("canlı topu pasif renge boyamak (colorId) → sed", (await sedOf(() => prisma.roll.update({ where: { id: canliTop }, data: { colorId: pasifRenk } }))) === "rolls_color_not_archived");
  check("aktif renkte canlı top durum değişimi → geçer (körlük zemini)", (await sedOf(() => prisma.roll.update({ where: { id: canliTop }, data: { status: RollStatus.STOCK } }))) === "OK");

  console.log("\n=== 5) Uygulama katmanı — geri alma yolları pasif renkte DB'ye gitmeden 409 ===");
  const iptalTop = await topYarat(aktifUrun, pasifRenk, RollStatus.CANCELLED, { preCancelStatus: RollStatus.WAREHOUSE });
  const r1 = await hataOf(() => new InventoryService().restoreCancelledRoll(iptalTop, admin.id));
  check("⭐ top iptal geri alma, rengi pasif → 409 COLOR_INACTIVE + çıkış yolu", r1.code === "COLOR_INACTIVE" && r1.msg === ROLL_ON_ARCHIVED_COLOR_MESSAGE, `${r1.code} · ${r1.msg}`);
  const dusumRenk = await mkColor("DUSUM", true);
  await prisma.$transaction((tx) => createSwatchesTx(tx, [0, 1].map((i) => ({
    cardNumber: `${T}-D${i}`, barcode: `${T}-DB${i}`, itemId: aktifUrun, colorId: dusumRenk, parentReceiptId: RECEIPT,
  })), { trigger: "KARTELA_RECEIVE", userId: admin.id }));
  await kartelaService.reduceStock({ itemId: aktifUrun, colorId: dusumRenk, count: 2, reason: "bekçi: renk arşivi" }, admin.id);
  await prisma.color.update({ where: { id: dusumRenk }, data: { isActive: false } });
  const reduction = await prisma.swatchStockReduction.findFirstOrThrow({ where: { itemId: aktifUrun, colorId: dusumRenk }, select: { id: true } });
  const r2 = await hataOf(() => kartelaService.reverseStockReduction(reduction.id, "bekçi: diriltme", admin.id));
  const hala = await prisma.swatch.count({ where: { colorId: dusumRenk, status: SwatchStatus.REDUCED } });
  check("⭐ kartela düşüm stornosu, rengi pasif → 409 COLOR_INACTIVE + çıkış yolu, kartelalar düşülmüş kalır",
    r2.code === "COLOR_INACTIVE" && r2.msg === SWATCH_ON_ARCHIVED_COLOR_MESSAGE && hala === 2, `${r2.code} · ${r2.msg} · ${hala}`);

  console.log("\n=== 6) Hata eşlemesi ===");
  check("üç kısıt adı çıkış yolunu söyleyen Türkçe mesaja eşlenir",
    checkConstraintMessage("swatches_item_not_archived") === SWATCH_ON_ARCHIVED_ITEM_MESSAGE
      && checkConstraintMessage("swatches_color_not_archived") === SWATCH_ON_ARCHIVED_COLOR_MESSAGE
      && checkConstraintMessage("rolls_color_not_archived") === ROLL_ON_ARCHIVED_COLOR_MESSAGE);
}

async function temizle(): Promise<void> {
  const del = async (fn: () => Promise<unknown>) => fn().catch((e) => console.error("temizlik:", (e as Error).message.slice(0, 120)));
  await del(() => prisma.swatchStockReductionItem.deleteMany({ where: { reduction: { itemId: { in: itemIds } } } }));
  await del(() => prisma.swatch.deleteMany({ where: { itemId: { in: itemIds } } }));
  await del(() => prisma.swatchStockReduction.deleteMany({ where: { itemId: { in: itemIds } } }));
  if (RECEIPT) await del(() => prisma.kartelaReceipt.deleteMany({ where: { id: RECEIPT } }));
  await del(() => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }));
  await del(() => prisma.roll.deleteMany({ where: { id: { in: rollIds } } }));
  await del(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...itemIds, ...rollIds] } } }));
  await del(() => prisma.item.deleteMany({ where: { id: { in: itemIds } } }));
  await del(() => prisma.color.deleteMany({ where: { id: { in: colorIds } } }));
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
