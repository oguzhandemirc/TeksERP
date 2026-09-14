// =============================================================================
// BEKÇİ — KABUL-ANI OKUYUCULARI: alış faturası taslağı + sipariş karşılama
//          tambur aşımından ETKİLENMEZ, üç sonuç fail-closed (hüküm §10.6 → §11 B)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts receipt_qty_readers
//
// NEDEN: iki para yüzeyi "fatura MAL KABUL ANINI belgeler" diyerek `Roll.initialQty`
// okuyordu; oysa tambur geri alması aşımlı kesimde `initialQty`yi yukarı çeker
// (`restoreBumpTx`, `initialBump`). Kabul topu depoda kesilip geri alınınca fatura
// taslağı ve sipariş karşılaması bump kadar BÜYÜYORDU (1c ölçtü, hüküm §6/§10.6;
// bu bekçi doğduğu gün aynı kusuru §D/§G'de yakaladı — ② "gerekli mi" cevabı).
//
// YÖNTEM: GERÇEK mal kabul fişi (100 m, alış siparişine bağlı) → `cutWarehouseRoll`
// 40·40·40 (3. kesim ebeveyne TAMBUR_OVERCUT 20 keşfi yazar) → SINGLE geri almalar →
// bump'lı ebeveyn yeniden kesilir. Her durumda İKİ okuyucu 100 demek zorunda.
// Altı durum TEK fikstürle değil, aynı topun ALTI HÂLİYLE ölçülür — kusur yalnız
// bump'lı hâllerde (§D/§G) görünür; canlı-çocuklu hâller (§A/§B) ise
// "initialQty − Σ canlı OVERAGE" gibi bir okuyucunun düştüğü yerdir (F1 sondası,
// 2026-09-13: 6 durumun 4'ünde yanlış) — bu yüzden ALTISI da assert edilir.
// §E/§F ikinci fişle ÜÇ SONUCU ölçer: ufuk-öncesi satırsız top → `initialQty`
// yedeği + `warnings` cümlesi (iki yüzeyde) · ufuk-sonrası satırsız top → 409
// `RECEIPT_LEDGER_ROW_MISSING` (iki yüzeyde). 7. durum (giriş ölçümü düzeltmesi
// satırı, `RECEIPT_QTY_REASONS`e yeni üye) yazıcısıyla birlikte 6e diliminde eklenir.
//
// NEGATİF SONDALAR (2026-09-13/14, cp + sha256 ile geri alındı, `git checkout --` değil):
// helper `initialQty`ye döndürüldü → §D1/§D2/§G1/§G2 (4 ❌) · ③ dalı fail-open yapıldı
// (satırsız ufuk-sonrası top yedeğe düşürüldü) → §F1/§F2/§F3 (3 ❌) · fatura taslağı
// uyarıyı düşürdü → §E3 (1 ❌); diğerleri her sondada yeşil.
// POZİTİF KONTROL: §0 fikstür 100 = 100 hiçbir düzeltme olmadan yeşil.
// =============================================================================
import { randomUUID } from "node:crypto";

import { PurchaseOrderStatus, RollStatus } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { ledgerHorizonStart } from "../src/constants/ledger-horizon";
import goodsReceiptService from "../src/services/goods-receipt.service";
import { RECEIPT_LEDGER_ROW_MISSING } from "../src/services/helpers/receipt-qty.helper";
import { invoiceService } from "../src/services/invoice.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { TamburService } from "../src/services/tambur.service";
import { InventoryService } from "../src/services/inventory.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const TAG = `TST-KABUL-${Date.now().toString(36)}`;
const KABUL = 100;
const ids = {
  item: "",
  grade: "",
  supplier: "",
  pos: [] as string[],
  receipts: [] as string[],
  rolls: [] as string[],
};

interface PoDetail {
  status: PurchaseOrderStatus;
  lines: Array<{ receivedQty: { toString(): string } }>;
}

interface Fis {
  po: string;
  receipt: string;
  parent: string;
}

/** Alış siparişi (100 m) + ona bağlı mal kabul fişi (100 m) → fiş topu. */
async function fisKur(wh: string): Promise<Fis> {
  const po = (
    await purchaseOrderService.create({ supplierId: ids.supplier, lines: [{ itemId: ids.item, qty: KABUL, unitPrice: 10 }] })
  ).data as unknown as { id: string };
  ids.pos.push(po.id);
  const gr = await goodsReceiptService.create(
    {
      warehouseId: wh,
      supplierId: ids.supplier,
      purchaseOrderId: po.id,
      currency: "TRY",
      lines: [{ itemId: ids.item, initialQty: KABUL, unitPrice: 10, clientToken: randomUUID() }],
    },
    undefined,
  );
  const grData = gr.data as { id: string; failed?: unknown[] };
  ids.receipts.push(grData.id);
  const parent = await prisma.roll.findFirst({ where: { goodsReceiptId: grData.id }, select: { id: true, status: true } });
  if (parent?.status !== RollStatus.WAREHOUSE) throw new Error(`fiş topu depoda doğmadı: ${JSON.stringify(grData.failed ?? null)}`);
  ids.rolls.push(parent.id);
  return { po: po.id, receipt: grData.id, parent: parent.id };
}

/** İki okuyucu: fatura taslağı satır Σ'sı + uyarıları, sipariş karşılaması + uyarıları. */
async function okuyucular(f: Fis): Promise<{ taslak: number; taslakUyari: string[]; karsilama: number; poUyari: string[] }> {
  const d = await invoiceService.createDraftFromGoodsReceipt(f.receipt);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id: d.data.id },
    select: { lines: { select: { qty: true } } },
  });
  const taslak = inv.lines.reduce((a, l) => a + Number(l.qty), 0);
  // Taslak deftere yazmamıştır (④ sınıfı); bir sonraki durum için yol açılır.
  // @silme-baglami: SINANAN_SILME — ④ sınıfı taslak (deftere hiç yazmamış) siliniyor — bir sonraki durum için yol açılıyor
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: d.data.id } });
  await prisma.invoice.delete({ where: { id: d.data.id } });

  const res = await purchaseOrderService.resync(f.po);
  const po = res.data as unknown as PoDetail;
  const karsilama = po.lines.reduce((a, l) => a + Number(l.receivedQty.toString()), 0);
  return { taslak, taslakUyari: d.warnings ?? [], karsilama, poUyari: res.warnings ?? [] };
}

async function durum(f: Fis, kod: string, baslik: string): Promise<void> {
  const r = await prisma.roll.findUniqueOrThrow({ where: { id: f.parent }, select: { initialQty: true, currentQty: true } });
  const o = await okuyucular(f);
  const iz = `initialQty=${Number(r.initialQty)} current=${Number(r.currentQty)}`;
  check(`§${kod}1 ${baslik}: alış faturası taslağı ${KABUL} m`, o.taslak === KABUL, `taslak=${o.taslak} (${iz})`);
  check(`§${kod}2 ${baslik}: sipariş karşılaması ${KABUL} m`, o.karsilama === KABUL, `karşılama=${o.karsilama} (${iz})`);
  check(`§${kod}3 ${baslik}: uyarı YOK (defter satırı var)`, o.taslakUyari.length === 0 && o.poUyari.length === 0, JSON.stringify([o.taslakUyari, o.poUyari]));
}

async function kes(parent: string, len: number): Promise<string> {
  const tambur = new TamburService();
  const c = await tambur.cutWarehouseRoll(parent, { cutLength: len, rawDestination: "WAREHOUSE", qualityGrade: `${TAG}-W` });
  const cid = (c.data as { childRoll?: { id: string } }).childRoll?.id;
  if (!cid) throw new Error(`kesim ${len} m çocuğu doğmadı`);
  ids.rolls.push(cid);
  return cid;
}

async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}

async function main(): Promise<void> {
  console.log("\n=== Kabul-anı okuyucuları: tambur aşımı fatura/karşılamaya sızmaz ===\n");
  const wh = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!wh) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");

  ids.item = (
    await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })
  ).id;
  ids.grade = (
    await prisma.qualityGrade.create({
      data: { code: `${TAG}-W`, name: `${TAG} depo kalitesi`, targetStatus: RollStatus.WAREHOUSE },
      select: { id: true },
    })
  ).id;
  ids.supplier = (
    await prisma.customer.create({ data: { code: TAG, name: `${TAG} tedarikçi`, type: "SUPPLIER" }, select: { id: true } })
  ).id;

  // ── ALTI DURUM — tek fiş topunun altı hâli ────────────────────────────────
  const f = await fisKur(wh.id);
  check("§0z fikstür: fiş topu depoda doğdu, defterde ENTRY_RECEIPT satırı var", (await prisma.warehouseMovement.count({ where: { rollId: f.parent, reasonCode: "ENTRY_RECEIPT" } })) === 1);
  await durum(f, "0", "kabul anı");

  const cocuklar = [await kes(f.parent, 40), await kes(f.parent, 40), await kes(f.parent, 40)];
  const kesif = await prisma.rollVariance.findFirst({
    where: { rollId: f.parent, source: "TAMBUR_OVERCUT", reversedAt: null },
    select: { qty: true, sourceRollId: true },
  });
  check("§Az fikstür: 3. kesim ebeveyne TAMBUR_OVERCUT 20 keşfi yazdı", Number(kesif?.qty) === 20 && kesif?.sourceRollId === cocuklar[2], JSON.stringify(kesif));
  await durum(f, "A", "üç kesim, çocuklar canlı");

  const undo = new TamburUndoService();
  await undo.applyUndo(cocuklar[2]!, undefined, { mode: "SINGLE", reason: "bekçi §B" });
  await durum(f, "B", "3. çocuk geri, ikisi canlı");
  await undo.applyUndo(cocuklar[1]!, undefined, { mode: "SINGLE", reason: "bekçi §C" });
  await durum(f, "C", "2. çocuk geri, biri canlı");

  await undo.applyUndo(cocuklar[0]!, undefined, { mode: "SINGLE", reason: "bekçi §D" });
  const dSonra = await prisma.roll.findUniqueOrThrow({ where: { id: f.parent }, select: { initialQty: true } });
  check("§Dz fikstür: tümü geri alınınca initialQty 120'ye çekildi (bump yazıldı)", Number(dSonra.initialQty) === 120, `initialQty=${Number(dSonra.initialQty)}`);
  await durum(f, "D", "tümü geri, initialQty bump'lı");

  await kes(f.parent, 60);
  await kes(f.parent, 70);
  await durum(f, "G", "bump'lı ebeveyn yeniden kesildi");

  // ── 7. DURUM — GİRİŞ ÖLÇÜMÜ DÜZELTMESİ (6e, 2026-09-14): bütün topta Düzelt diyaloğu
  //    currentQty = initialQty = m yazar; defter ENTRY_CORRECTION satırı alır (yukarı → to
  //    +fark, aşağı → from −fark) ve okuyucular ENTRY + Σ düzeltme = DÜZELTİLMİŞ metrajı
  //    okur — initialQty'den değil defterden (satırı silince §H yedeğe DÜŞMEZ, 409 verir).
  const h = await fisKur(wh.id);
  const inventory = new InventoryService();
  await inventory.applyManualProperties(h.parent, { colorId: null, currentQty: 110, reason: "bekçi §H: giriş ölçümü +10" });
  const hUst = await prisma.warehouseMovement.findMany({ where: { rollId: h.parent, reasonCode: "ENTRY_CORRECTION" }, select: { qty: true, toWarehouseId: true, fromWarehouseId: true, rollVarianceId: true, goodsReceiptId: true } });
  check("§Hz fikstür: +10 düzeltmesi ENTRY_CORRECTION giriş ucu (+10) yazdı, sapma satırına ve fişe bağlı", hUst.length === 1 && Number(hUst[0]!.qty) === 10 && hUst[0]!.toWarehouseId !== null && hUst[0]!.fromWarehouseId === null && hUst[0]!.rollVarianceId !== null && hUst[0]!.goodsReceiptId === h.receipt, JSON.stringify(hUst));
  const h1 = await okuyucular(h);
  check("§H1 ⭐ +10 düzeltmesi sonrası alış faturası taslağı 110 m (defterden)", h1.taslak === 110, `taslak=${h1.taslak}`);
  check("§H2 ⭐ +10 düzeltmesi sonrası sipariş karşılaması 110 m", h1.karsilama === 110, `karşılama=${h1.karsilama}`);
  await inventory.applyManualProperties(h.parent, { colorId: null, currentQty: 90, reason: "bekçi §H: giriş ölçümü −20" });
  const hAlt = await prisma.warehouseMovement.findFirst({ where: { rollId: h.parent, reasonCode: "ENTRY_CORRECTION", fromWarehouseId: { not: null } }, select: { qty: true } });
  check("§Hz2 fikstür: −20 düzeltmesi çıkış ucu (−20) yazdı", Number(hAlt?.qty) === 20, `qty=${hAlt?.qty}`);
  const h2 = await okuyucular(h);
  check("§H3 ⭐ 110 → 90 düzeltmesi sonrası iki okuyucu 90 m (işaretli Σ: 100 + 10 − 20)", h2.taslak === 90 && h2.karsilama === 90, `taslak=${h2.taslak} karşılama=${h2.karsilama}`);
  const hRoll = await prisma.roll.findUniqueOrThrow({ where: { id: h.parent }, select: { initialQty: true, currentQty: true } });
  check("§H4 durum = defter: initialQty = currentQty = 90", Number(hRoll.initialQty) === 90 && Number(hRoll.currentQty) === 90, `initialQty=${Number(hRoll.initialQty)} current=${Number(hRoll.currentQty)}`);

  // ── ÜÇ SONUÇ — ikinci fiş, defter satırı BİLEREK silinir (sonda DB) ───────
  const g = await fisKur(wh.id);
  // Bilerek silinen satır KİMLİĞİYLE silinir: önce bul, sonra id ile sil (ad/kod yüklemi §10b'de sınırsız sayılır).
  const fisSatiri = await prisma.warehouseMovement.findFirst({ where: { rollId: g.parent, reasonCode: "ENTRY_RECEIPT" }, select: { id: true } });
  // @silme-baglami: SINANAN_SILME — ufuk öncesi satırsız fiş senaryosu kuruluyor: okuyucunun defter satırı YOKKEN davranışı sınanıyor
  if (fisSatiri) await prisma.warehouseMovement.delete({ where: { id: fisSatiri.id } });
  const ufukOncesi = new Date(ledgerHorizonStart().getTime() - 24 * 3600 * 1000);
  await prisma.roll.update({ where: { id: g.parent }, data: { createdAt: ufukOncesi } });
  const e = await okuyucular(g);
  check("§E1 ufuk-öncesi satırsız top: taslak initialQty yedeğinden (100)", e.taslak === KABUL, `taslak=${e.taslak}`);
  check("§E2 ufuk-öncesi satırsız top: karşılama initialQty yedeğinden (100)", e.karsilama === KABUL, `karşılama=${e.karsilama}`);
  check("§E3 ⭐ iki yüzey de warnings'e ufuk cümlesini koydu", e.taslakUyari.some((w) => w.includes("ufkundan")) && e.poUyari.some((w) => w.includes("ufkundan")), JSON.stringify([e.taslakUyari, e.poUyari]));

  await prisma.roll.update({ where: { id: g.parent }, data: { createdAt: new Date() } });
  const f1 = await beklenenHata(() => invoiceService.createDraftFromGoodsReceipt(g.receipt));
  check("§F1 ⭐ ufuk-sonrası satırsız top: fatura taslağı 409 RECEIPT_LEDGER_ROW_MISSING", f1?.statusCode === 409 && f1.details?.code === RECEIPT_LEDGER_ROW_MISSING, f1 ? `${f1.statusCode} ${String(f1.details?.code)}` : "hata yok");
  const f2 = await beklenenHata(() => purchaseOrderService.resync(g.po));
  check("§F2 ⭐ ufuk-sonrası satırsız top: sipariş karşılaması 409 RECEIPT_LEDGER_ROW_MISSING", f2?.statusCode === 409 && f2.details?.code === RECEIPT_LEDGER_ROW_MISSING, f2 ? `${f2.statusCode} ${String(f2.details?.code)}` : "hata yok");
  check("§F3 409 sessiz geçmedi: taslak açılmadı", (await prisma.invoice.count({ where: { goodsReceiptId: g.receipt } })) === 0);
}

async function cleanup(): Promise<void> {
  try {
    await prisma.invoiceLine.deleteMany({ where: { invoice: { goodsReceiptId: { in: ids.receipts } } } }).catch(() => undefined);
    await prisma.invoice.deleteMany({ where: { goodsReceiptId: { in: ids.receipts } } }).catch(() => undefined);
    const rolls = await prisma.roll.findMany({
      where: { OR: [{ id: { in: ids.rolls } }, { parentRollId: { in: ids.rolls } }] },
      select: { id: true },
    });
    const rid = rolls.map((r) => r.id);
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rid } } });
    await prisma.rollVariance.deleteMany({ where: { OR: [{ rollId: { in: rid } }, { sourceRollId: { in: rid } }] } });
    await prisma.roll.deleteMany({ where: { id: { in: rid }, parentRollId: { not: null } } });
    await prisma.roll.deleteMany({ where: { id: { in: rid } } });
    await prisma.goodsReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: ids.pos } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ids.pos } } });
    if (ids.supplier) {
      await prisma.cariAccount.deleteMany({ where: { customerId: ids.supplier } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: ids.supplier } });
    }
    if (ids.grade) await prisma.qualityGrade.deleteMany({ where: { id: ids.grade } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
  } catch (e) {
    console.log(`⚠️ temizlik hatası: ${(e as Error).message}`);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Bekçi hata ile durdu:", e);
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
