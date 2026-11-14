// =============================================================================
// BEKÇİ — BİLDİRİM S3: depo · sevkiyat · fason · gelen belge · mal kabul · satınalma olayları + özetleri + K7
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_depo
// =============================================================================
// NEDEN: S3 türleri (geniş katalog 2026-11-14) gerçek yazma yollarına bağlı olmalı; bağ kopunca bildirim sessizce
// kesilir ve başka hiçbir bekçi görmez. Ölçülenler:
//   §0 AST — her S3 OLAY türünün `src/`de TEK `emitNotification` literali `notification-sources/depo.ts`te (mal kabul /
//      satınalma → `ticaret.ts`) ve her yayma
//      fonksiyonu beklenen yazma yolu dosyasından çağrılıyor; özet türlerinin literali yok (zamanlayıcı yazar).
//   §1 DB (geri sarılan tx) — tür başına olay → outbox satırı, yük alanları + `{kullanici}` aktörden; sayım farkı
//      yokken / gelen belge claim'inde eş ve fark yokken bildirim YOK.
//   §2 gerçek yol: `adjustRollQty` (kendi tx'i) → `stok.elle-duzeltme` satırı; ret yolu (aynı metraj) satır doğurmaz.
//   §3 özet kaynakları kayıtlı; gün sonu sevkiyat özeti brüt tanımdan sayar (global ayar → `finally`de birebir geri).
//   §4 K7: modül kapalıyken tür görünmez (`canSeeNotificationType`).
// NEGATİF SONDA (2026-11-14): `stock-count.service.ts`ten `emitStockCountDifferenceTx(...)` satırı silindi ⇒ §0b ❌;
//   `depo.ts`te `sevkiyat.iade` emit'i hiç doğru olmayan koşula sarıldı ⇒ §1 sevkiyat.iade ❌ (31/2; md5 ile geri alındı).
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { Prisma, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS, type NotificationKind } from "../src/constants/notification-catalog";
import { canSeeNotificationType } from "../src/services/helpers/notification-visibility.helper";
import {
  emitIncomingDocApprovedTx, emitIncomingDocCancelledTx, emitIncomingDocClaimedTx,
  emitIncomingDocCreatedTx, emitReturnReceivedTx, emitRollQtyAdjustedTx,
  emitShipmentDispatchedTx, emitShipmentInvoicedTx, emitShipmentUndoneTx, emitStockCountDifferenceTx,
  emitSubcontractDispatchedTx, emitSubcontractReceivedTx, emitWarehouseTransferTx,
} from "../src/services/notification-sources/depo";
import { emitGoodsReceiptCreatedTx, emitPurchaseOrderCreatedTx } from "../src/services/notification-sources/ticaret";
import { registerDepotDigestSources } from "../src/services/notification-sources/depo-ozet";
import { digestStampKey, lastClosedWindow, registeredDigestKinds, runDigestOnce } from "../src/jobs/notification-digest.job";
import { adjustRollQty } from "../src/services/inventory/qty-adjust";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const S3_OLAY = [
  "sevkiyat.yola-cikti", "sevkiyat.geri-alindi", "sevkiyat.faturalandi", "sevkiyat.iade",
  "stok.elle-duzeltme", "stok.sayim-farki", "stok.transfer",
  "fason.cikis", "fason.donus",
  "gelenbelge.geldi", "gelenbelge.onaylandi", "gelenbelge.iptal", "gelenbelge.mukerrer", "gelenbelge.metre-farki",
  "malkabul.yapildi", "satinalma.siparis",
] as const satisfies readonly NotificationKind[];
const S3_OZET = ["sevkiyat.gunluk-ozet", "stok.gunluk-ozet", "fason.gunluk-ozet"] as const satisfies readonly NotificationKind[];

/** Yayma fonksiyonu → onu çağırması gereken yazma yolu dosyaları (src/ göreli). */
const CAGRI_YERLERI: Record<string, string[]> = {
  emitShipmentDispatchedTx: ["services/shipping/dispatch.ts"],
  emitShipmentUndoneTx: ["services/shipping/undo-dispatch.ts"],
  emitShipmentInvoicedTx: ["services/shipping/fields.ts"],
  emitReturnReceivedTx: ["services/return.service.ts"],
  emitRollQtyAdjustedTx: ["services/inventory/qty-adjust.ts"],
  emitStockCountDifferenceTx: ["services/stock-count.service.ts"],
  emitWarehouseTransferTx: ["services/warehouse-transfer.service.ts"],
  emitSubcontractDispatchedTx: ["services/subcontractor/dispatch.ts"],
  emitSubcontractReceivedTx: ["services/subcontractor/receive.ts"],
  emitIncomingDocCreatedTx: ["services/gelen-belge-note.service.ts", "services/gelen-belge-okuma.service.ts"],
  emitIncomingDocApprovedTx: ["services/gelen-belge-onay.service.ts"],
  emitIncomingDocCancelledTx: ["services/gelen-belge-iptal.service.ts"],
  emitIncomingDocClaimedTx: ["services/gelen-belge-onay-claim.service.ts"],
  emitGoodsReceiptCreatedTx: ["services/goods-receipt.service.ts"],
  emitPurchaseOrderCreatedTx: ["services/purchase-order.service.ts"],
};

// ── §0 AST ──────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 AST — tek yayma noktası + çağrı yerleri");
  const SRC = join(__dirname, "..", "src");
  const literaller = new Map<string, string[]>();
  const cagrilar = new Map<string, Set<string>>();
  for (const f of walkTs(SRC)) {
    const rel = relative(SRC, f).split(sep).join("/");
    const sf = ts.createSourceFile(rel, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const ad = n.expression.text;
        if (ad === "emitNotification") {
          const a = n.arguments[1];
          if (a && ts.isStringLiteral(a)) literaller.set(a.text, [...(literaller.get(a.text) ?? []), rel]);
        }
        if (ad in CAGRI_YERLERI) cagrilar.set(ad, (cagrilar.get(ad) ?? new Set()).add(rel));
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  // Mal kabul / satınalma ayrı dosyada (ticaret modelleri sevk/fason router zincirine girmesin — rejim kapısı).
  const kaynak = (k: string) => `services/notification-sources/${/^(malkabul|satinalma)\./.test(k) ? "ticaret" : "depo"}.ts`;
  const ihlal = S3_OLAY.filter((k) => JSON.stringify(literaller.get(k)) !== JSON.stringify([kaynak(k)])).map((k) => `${k}: ${JSON.stringify(literaller.get(k) ?? [])}`);
  check("§0a ⭐ her S3 OLAY türünün TEK emit literali notification-sources/depo.ts (malkabul/satinalma → ticaret.ts)", ihlal.length === 0, ihlal.join(" · ") || `${S3_OLAY.length} tür`);
  const eksik = Object.entries(CAGRI_YERLERI).flatMap(([fn, dosyalar]) => dosyalar.filter((d) => !cagrilar.get(fn)?.has(d)).map((d) => `${fn} ← ${d}`));
  check("§0b ⭐ her yayma fonksiyonu yazma yolundan çağrılıyor", eksik.length === 0, eksik.join(" · ") || `${Object.keys(CAGRI_YERLERI).length} fonksiyon`);
  check("§0c özet türleri `ozet` beyanlı ve emit literali yok (zamanlayıcı yazar)", S3_OZET.every((k) => "ozet" in NOTIFICATION_CATALOG[k] && !literaller.has(k)));
  check("§0d S3 türlerinin hepsi katalogda", [...S3_OLAY, ...S3_OZET].every((k) => NOTIFICATION_KINDS.includes(k)));
  check("§0e S3 yüklerinde tutar alanı yok", [...S3_OLAY, ...S3_OZET].every((k) => !NOTIFICATION_CATALOG[k].payloadAlanlari.some((a) => /tutar|fiyat|bedel/i.test(a))));
}

// ── §1 DB (geri sarılan tx) ─────────────────────────────────────────────────
class GeriSar extends Error {}
const ek = Date.now().toString(36);

async function bolum1(): Promise<void> {
  console.log("\n§1 olay → outbox (tek tx, sonda geri sarılır)");
  const firma = await ensureTestDyeHouse();
  const sonuc: Array<[string, boolean, string]> = [];
  try {
    await prisma.$transaction(async (tx) => {
      const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
      const t0 = new Date(Date.now() - 1000);
      const AD = `TEST-BD Ayşe ${ek}`;
      const u = await tx.user.create({ data: { username: `tbd_${ek}`, fullName: AD, passwordHash: "x" }, select: { id: true } });
      const cust = await tx.customer.create({ data: { code: `TEST-BD-${ek}`, name: `TEST-BD Müşteri ${ek}` }, select: { id: true } });
      const item = await tx.item.create({ data: { code: `TEST-BD-${ek}`, name: `TEST-BD Kumaş ${ek}`, itemType: "FABRIC" }, select: { id: true } });
      const wh = await tx.warehouse.create({ data: { code: `TBD${ek}`.slice(0, 16), name: `TEST-BD Depo ${ek}` }, select: { id: true } });
      const satir = (kind: string, subjectId: string) => tx.notificationOutbox.findMany({ where: { kind, subjectId, createdAt: { gte: t0 } }, select: { payload: true, dedupeKey: true } });
      const olc = async (kind: string, subjectId: string, ek2?: (p: Record<string, unknown>) => boolean, adet = 1): Promise<void> => {
        const rows = await satir(kind, subjectId);
        const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
        sonuc.push([kind, rows.length === adet && (adet === 0 || (ek2 ? ek2(p) : p.kullanici === AD)), `${rows.length} satır ${JSON.stringify(p).slice(0, 140)}`]);
      };

      // Sevkiyat: 2 top × 50,25 m sevkiyatta → brüt 100,5 m.
      const sh = await tx.shipment.create({ data: { shipmentNo: `TEST-BD-${ek}`, customerId: cust.id, status: ShipmentStatus.DISPATCHED }, select: { id: true } });
      const r1 = await tx.roll.create({ data: { itemId: item.id, initialQty: new Prisma.Decimal(50.25), currentQty: new Prisma.Decimal(50.25), barcode: `TBD1${ek}`, shipmentId: sh.id, status: RollStatus.SHIPPED }, select: { id: true } });
      await tx.roll.create({ data: { itemId: item.id, initialQty: new Prisma.Decimal(50.25), currentQty: new Prisma.Decimal(50.25), barcode: `TBD2${ek}`, shipmentId: sh.id, status: RollStatus.SHIPPED } });
      await emitShipmentDispatchedTx(tx, sh.id, u.id);
      await olc("sevkiyat.yola-cikti", sh.id, (p) => p.kullanici === AD && p.topSayisi === 2 && p.metre === 100.5 && p.musteriAd === `TEST-BD Müşteri ${ek}`);
      await emitShipmentUndoneTx(tx, sh.id, "yanlış araç", u.id);
      await olc("sevkiyat.geri-alindi", sh.id, (p) => p.sebep === "yanlış araç" && p.kullanici === AD);
      await emitShipmentInvoicedTx(tx, sh.id, "FTR-42", u.id);
      await olc("sevkiyat.faturalandi", sh.id, (p) => p.faturaNo === "FTR-42");

      const rr = await tx.rollReturn.create({ data: { rollId: r1.id, customerId: cust.id, itemId: item.id, qty: new Prisma.Decimal(50.25), receivedById: u.id, fromShipmentId: sh.id, returnNo: `TEST-IA-${ek}` }, select: { id: true } });
      await emitReturnReceivedTx(tx, rr.id, u.id);
      await olc("sevkiyat.iade", rr.id, (p) => p.topSayisi === 1 && p.metre === 50.25 && p.sevkiyatNo === `TEST-BD-${ek}`);

      await emitRollQtyAdjustedTx(tx, r1.id, { from: new Prisma.Decimal(50.25), to: new Prisma.Decimal(48), reason: "sayım" }, u.id);
      await olc("stok.elle-duzeltme", r1.id, (p) => p.eskiMetre === 50.25 && p.yeniMetre === 48 && p.barkod === `TBD1${ek}`);

      const sc = await tx.stockCount.create({ data: { countNo: `TEST-BD-${ek}`, warehouseId: wh.id }, select: { id: true } });
      await emitStockCountDifferenceTx(tx, sc.id, { countNo: `TEST-BD-${ek}`, rolls: 0, meters: 0, yarn: 0 }, u.id);
      await olc("stok.sayim-farki", sc.id, undefined, 0);
      sonuc[sonuc.length - 1]![0] = "stok.sayim-farki fark yokken yazılmaz";
      await emitStockCountDifferenceTx(tx, sc.id, { countNo: `TEST-BD-${ek}`, rolls: 3, meters: 120.5, yarn: 1 }, u.id);
      await olc("stok.sayim-farki", sc.id, (p) => p.dusulenTop === 3 && p.dusulenMetre === 120.5);

      const wh2 = await tx.warehouse.create({ data: { code: `TBE${ek}`.slice(0, 16), name: `TEST-BD Depo2 ${ek}` }, select: { id: true } });
      const tr = await tx.warehouseTransfer.create({ data: { transferNo: `TEST-BD-${ek}`, fromWarehouseId: wh.id, toWarehouseId: wh2.id }, select: { id: true } });
      await emitWarehouseTransferTx(tx, tr.id, { transferNo: `TEST-BD-${ek}`, from: "A", to: "B", count: 4 }, u.id);
      await olc("stok.transfer", tr.id, (p) => p.topSayisi === 4 && p.kaynakDepo === "A");

      // Başlık CHECK'i iş emri ya da dokuma emri bağı ister; en hafif bağ fason dokuma emri.
      const wv = await tx.weavingOrder.create({ data: { weavingOrderNumber: `TEST-BD-${ek}`, itemId: item.id, executionKind: "SUBCONTRACTED", subcontractorId: firma.id }, select: { id: true } });
      const sd = await tx.subcontractorDispatch.create({ data: { dispatchNo: `TEST-BD-${ek}`, subcontractorId: firma.id, weavingOrderId: wv.id, totalQty: new Prisma.Decimal(300) }, select: { id: true } });
      await emitSubcontractDispatchedTx(tx, sd.id, u.id);
      await olc("fason.cikis", sd.id, (p) => p.metre === 300 && p.firmaAd === firma.name);
      const srec = await tx.subcontractorReceipt.create({ data: { receiptNo: `TEST-BD-${ek}`, subcontractorId: firma.id, weavingOrderId: wv.id }, select: { id: true } });
      await emitSubcontractReceivedTx(tx, srec.id, 5, u.id);
      await olc("fason.donus", srec.id, (p) => p.topSayisi === 5);

      const note = await tx.customerDeliveryNote.create({ data: { noteNo: `TEST-BD-${ek}`, sourceKind: "MANUAL", ownerCustomerId: cust.id }, select: { id: true } });
      await emitIncomingDocCreatedTx(tx, note.id, u.id);
      await olc("gelenbelge.geldi", note.id, (p) => p.gonderen === `TEST-BD Müşteri ${ek}` && p.kullanici === AD);
      await emitIncomingDocClaimedTx(tx, note.id, { peers: [] }, u.id);
      sonuc.push(["gelenbelge claim: eş ve fark yokken bildirim yok", (await satir("gelenbelge.mukerrer", note.id)).length + (await satir("gelenbelge.metre-farki", note.id)).length === 0, "0"]);
      await emitIncomingDocClaimedTx(tx, note.id, { varianceReason: "kâğıt yanlış toplanmış", peers: ["GB-1", "GB-1"] }, u.id);
      await olc("gelenbelge.mukerrer", note.id, (p) => p.esler === "GB-1");
      await olc("gelenbelge.metre-farki", note.id, (p) => p.sebep === "kâğıt yanlış toplanmış");
      await emitIncomingDocApprovedTx(tx, note.id, u.id);
      await olc("gelenbelge.onaylandi", note.id, (p) => p.topSayisi === 0);
      await emitIncomingDocCancelledTx(tx, note.id, "mükerrer okutma", u.id);
      await olc("gelenbelge.iptal", note.id, (p) => p.sebep === "mükerrer okutma");

      const gr = await tx.goodsReceipt.create({ data: { receiptNo: `TEST-BD-${ek}`, warehouseId: wh.id, supplierId: cust.id }, select: { id: true } });
      await emitGoodsReceiptCreatedTx(tx, gr.id, u.id);
      await olc("malkabul.yapildi", gr.id, (p) => p.tedarikci === `TEST-BD Müşteri ${ek}`);
      const po = await tx.purchaseOrder.create({ data: { orderNo: `TEST-BD-${ek}`, orderDate: new Date(), supplierId: cust.id }, select: { id: true } });
      await emitPurchaseOrderCreatedTx(tx, po.id, null);
      await olc("satinalma.siparis", po.id, (p) => p.kullanici === "Sistem" && p.kalemSayisi === 0);

      // Birleştirme (K3): aynı tür + aynı kayıt → aynı dedupeKey.
      await emitShipmentUndoneTx(tx, sh.id, "ikinci", u.id);
      const iki = await satir("sevkiyat.geri-alindi", sh.id);
      sonuc.push(["§1z aynı tür + aynı kayıt iki olay → aynı dedupeKey", iki.length === 2 && iki[0]!.dedupeKey === iki[1]!.dedupeKey, iki.map((r) => r.dedupeKey).join(" | ")]);
      throw new GeriSar();
    });
  } catch (e) {
    if (!(e instanceof GeriSar)) throw e;
  }
  for (const [l, ok, d] of sonuc) check(l.startsWith("§") ? l : `§1 ${l}`, ok, d);
  const kalinti = await prisma.shipment.count({ where: { shipmentNo: `TEST-BD-${ek}` } });
  check("§1y geri sarma: test sevkiyatı kalıcı değil", kalinti === 0, `${kalinti}`);
}

// ── §2 gerçek yol: adjustRollQty ────────────────────────────────────────────
async function bolum2(): Promise<void> {
  console.log("\n§2 gerçek yol — adjustRollQty → stok.elle-duzeltme");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key } });
  const item = await prisma.item.create({ data: { code: `TEST-BD2-${ek}`, name: `TEST-BD2 ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const roll = await prisma.roll.create({ data: { itemId: item.id, initialQty: new Prisma.Decimal(40), currentQty: new Prisma.Decimal(40), barcode: `TBD3${ek}`, status: RollStatus.STOCK }, select: { id: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    await adjustRollQty(roll.id, { newQty: 37.5, reason: "TEST elle sayım" }, undefined);
    let red = false;
    try { await adjustRollQty(roll.id, { newQty: 37.5, reason: "TEST aynı" }, undefined); } catch { red = true; }
    const rows = await prisma.notificationOutbox.findMany({ where: { kind: "stok.elle-duzeltme", subjectId: roll.id }, select: { id: true, payload: true } });
    const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    check("§2a ⭐ gerçek düzeltme tx'i tek outbox satırı yazar (40 → 37,5)", rows.length === 1 && p.eskiMetre === 40 && p.yeniMetre === 37.5, `${rows.length} satır ${JSON.stringify(p)}`);
    check("§2b ret yolu (aynı metraj 400) satır doğurmaz", red && rows.length === 1);
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: roll.id } });
    await prisma.rollVariance.deleteMany({ where: { rollId: roll.id } });
    await prisma.roll.delete({ where: { id: roll.id } });
    await prisma.item.delete({ where: { id: item.id } });
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: (ilk.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

// ── §3 özet kaynakları ──────────────────────────────────────────────────────
async function bolum3(): Promise<void> {
  console.log("\n§3 özet kaynakları");
  registerDepotDigestSources();
  check("§3a üç S3 özet kaynağı kayıtlı", S3_OZET.every((k) => registeredDigestKinds().includes(k)));
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU — ${engel}`);
  const KIND = "sevkiyat.gunluk-ozet";
  const keys = [SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED, digestStampKey(KIND)];
  const ilk = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const NOW1 = new Date("2001-04-15T12:00:00Z");
  const NOW2 = new Date("2001-04-16T12:00:00Z");
  const gun = await lastClosedWindow(prisma, "GUN_SONU", NOW2);
  const cust = await prisma.customer.create({ data: { code: `TEST-BDO-${ek}`, name: `TEST-BDO ${ek}` }, select: { id: true } });
  const item = await prisma.item.create({ data: { code: `TEST-BDO-${ek}`, name: `TEST-BDO ${ek}`, itemType: "FABRIC" }, select: { id: true } });
  const at = new Date(gun!.from.getTime() + 3_600_000);
  const sh = await prisma.shipment.create({ data: { shipmentNo: `TEST-BDO-${ek}`, customerId: cust.id, status: ShipmentStatus.DISPATCHED, dispatchedAt: at }, select: { id: true } });
  const roll = await prisma.roll.create({ data: { itemId: item.id, initialQty: new Prisma.Decimal(70), currentQty: new Prisma.Decimal(70), barcode: `TBD4${ek}`, shipmentId: sh.id, status: RollStatus.SHIPPED }, select: { id: true } });
  try {
    await prisma.systemSetting.upsert({ where: { key: keys[0]! }, create: { key: keys[0]!, value: true }, update: { value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: keys[1]! } });
    const r1 = await runDigestOnce(KIND, NOW1);
    const r2 = await runDigestOnce(KIND, NOW2);
    const r2b = await runDigestOnce(KIND, NOW2);
    const rows = await prisma.notificationOutbox.findMany({ where: { kind: KIND, subjectKey: gun!.key }, select: { id: true, payload: true } });
    const p = (rows[0]?.payload ?? {}) as Record<string, unknown>;
    check("§3b ⭐ ilk tur taban, yeni pencere bir kez yazılır", r1 === "baseline" && r2 === "emitted" && r2b === "already" && rows.length === 1, `${r1}/${r2}/${r2b} · ${rows.length}`);
    check("§3c sevkiyat özeti brüt tanımdan sayar (≥ 1 sevkiyat, ≥ 70 m)", Number(p.sevkiyat) >= 1 && Number(p.metre) >= 70 && Number(p.top) >= 1, JSON.stringify(p));
    await prisma.notificationOutbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  } finally {
    await prisma.roll.delete({ where: { id: roll.id } });
    await prisma.shipment.delete({ where: { id: sh.id } });
    await prisma.item.delete({ where: { id: item.id } });
    await prisma.customer.delete({ where: { id: cust.id } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of ilk) await prisma.systemSetting.create({ data: { ...row, value: (row.value ?? Prisma.JsonNull) as Prisma.InputJsonValue } });
  }
}

// ── §4 K7 ───────────────────────────────────────────────────────────────────
function bolum4(): void {
  console.log("\n§4 K7 modül kapısı");
  const viewer = { permissions: ["*"] };
  const kapali = (kind: NotificationKind, modul: string) => !canSeeNotificationType(viewer, kind, { modules: { [modul]: false }, gates: {} })
    && canSeeNotificationType(viewer, kind, { modules: { [modul]: true }, gates: {} });
  check("§4a ⭐ gelen belge modülü kapalıyken gelenbelge.* görünmez", kapali("gelenbelge.iptal", "gelenBelgeEnabled"));
  check("§4b ticaret kapalıyken mal kabul / satınalma / sayım görünmez", kapali("malkabul.yapildi", "ticaretEnabled") && kapali("satinalma.siparis", "ticaretEnabled") && kapali("stok.sayim-farki", "ticaretEnabled"));
  check("§4c çoklu depo kapalıyken stok.transfer görünmez", kapali("stok.transfer", "depoMultiEnabled"));
}

async function main(): Promise<void> {
  console.log("=== Bildirim S3 — depo · sevkiyat · fason · gelen belge · satınalma ===");
  bolum0();
  bolum4();
  await bolum1();
  await bolum2();
  await bolum3();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
