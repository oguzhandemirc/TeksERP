// =============================================================================
// TEST: KARTELA — ANA VERİ ARŞİV KAPISI (S4, MV-06; K3)
// Çalıştır: npx tsx scripts/test_kartela_arsiv_kapisi.ts
// =============================================================================
// Kullanıcı kararı S4 (2026-09-26): stoktaki/çuvaldaki/sevkiyattaki kartela ürün ve renk
// kartı için CANLI referanstır.
//   §1 canlı kartelalı ürün Pasif'e alınamaz: 409 ITEM_HAS_LIVE_REFERENCES, kartelalar
//      kart no ile listelenir
//   §2 canlı kartelalı renk arşivlenemez: önizleme "Canlı kartela" satırını tek tek listeler,
//      kapı 409
//   §3 kartelalar düşülünce (canlı değil) ürün Pasif'e alınabilir
//   §4 Pasif kartın düşümü geri alınamaz (dirilme 409, çıkış yolu mesajda)
//   §5a/§5b canlı küme IN_STOCK'la sınırlı değil: çuvaldaki (IN_SACK) ve sevkiyattaki (IN_SHIPMENT) kartela
//      da ürünü Pasif'ten korur — 409 ITEM_HAS_LIVE_REFERENCES
//   §5 sevk stornosu da dirilmedir (SHIPPED → IN_SHIPMENT): Pasif kartın sevk edilmiş kartelası
//      geri alınamaz — 409 + çıkış yolu, kartela SHIPPED ve sevkiyat DISPATCHED kalır
// NEGATİF SONDA (06 denetimi, md5 ile geri alındı): `LIVE_SWATCH` yalnız IN_STOCK'a indirildi → §5a/§5b ❌ (eski
//   paket 5/0 yeşildi — canlı kümenin çuval/sevkiyat ayağını ölçen yoktu).
// =============================================================================

import prisma from "../src/lib/prisma";
import { ItemLifecycleStatus, ShipmentStatus, SwatchStatus } from "@prisma/client";
import { createSwatchesTx } from "../src/services/helpers/swatch-event.helper";
import { transitionItemLifecycle } from "../src/services/helpers/item-lifecycle.helper";
import { assertArchivableTx, listArchiveBlockers } from "../src/services/helpers/master-data-archive.helper";
import { COLOR_ARCHIVE } from "../src/services/helpers/archive-gate/color-archive.helper";
import { kartelaService } from "../src/services/kartela.service";
import { shippingService } from "../src/services/shipping.service";
import { SWATCH_ON_ARCHIVED_ITEM_MESSAGE } from "../src/constants/item-archive-messages";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestKartela } from "./fixture-subcontractor";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
const hata = async (fn: () => Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return e as { statusCode?: number; message?: string; details?: { code?: string; references?: Array<{ kind: string; count: number; records: Array<{ title: string }> }> } }; }
};

const TS = Date.now().toString().slice(-7);
let ITEM = "", COLOR = "", RECEIPT = "", ITEM2 = "", CUSTOMER = "";
const swatchIds: string[] = [];
const sackIds: string[] = [];
const shipmentIds: string[] = [];
const CONF_KEY = "shipping.confirmationEnabled";
let oncekiOnay: { value: unknown } | null | undefined;

async function main(): Promise<void> {
  console.log("=== Kartela — ana veri arşiv kapısı (S4) ===");
  try {
    const admin = await ensureTestAdmin();
    const firm = await ensureTestKartela();
    ITEM = (await prisma.item.create({ data: { code: `TEST-KAK-${TS}`, name: `Kartela Arşiv ${TS}`, itemType: "FABRIC" } })).id;
    COLOR = (await prisma.color.create({ data: { code: `TEST-KAK-${TS}`, name: `KARTELA ARŞİV RENK ${TS}` } })).id;
    RECEIPT = (await prisma.kartelaReceipt.create({ data: { receiptNo: `TST-KAK-KR-${TS}`, subcontractorId: firm.id } })).id;
    await prisma.$transaction(async (tx) => {
      const sw = await createSwatchesTx(tx, [0, 1].map((i) => ({
        cardNumber: `TST-KAK-${TS}-${i}`, barcode: `TST-KAKB-${TS}-${i}`, itemId: ITEM, colorId: COLOR, parentReceiptId: RECEIPT,
      })), { trigger: "KARTELA_RECEIVE", userId: admin.id });
      swatchIds.push(...sw.map((s) => s.id));
    });

    // §1
    const e1 = await hata(() => transitionItemLifecycle({ itemId: ITEM, to: ItemLifecycleStatus.ARCHIVED, userId: admin.id }));
    const kref = e1?.details?.references?.find((r) => r.kind === "SWATCH");
    check("§1 canlı kartelalı ürün Pasif'e alınamaz: 409 ITEM_HAS_LIVE_REFERENCES + kart no listesi",
      e1?.statusCode === 409 && e1.details?.code === "ITEM_HAS_LIVE_REFERENCES" && kref?.count === 2
        && kref.records.map((r) => r.title).sort().join() === [`TST-KAK-${TS}-0`, `TST-KAK-${TS}-1`].join(),
      `${e1?.statusCode} · ${kref?.count}`);

    // §2
    const blok = (await listArchiveBlockers(prisma, COLOR_ARCHIVE, COLOR)).find((b) => b.kind === "SWATCH");
    const e2 = await hata(() => prisma.$transaction((tx) => assertArchivableTx(tx, COLOR_ARCHIVE, COLOR)));
    check("§2 canlı kartelalı renk arşivlenemez: önizlemede \"Canlı kartela\" 2 kayıt, kapı 409",
      blok?.label === "Canlı kartela" && blok.count === 2 && blok.records.length === 2 && e2?.statusCode === 409, `${blok?.count} · ${e2?.statusCode}`);

    // §3
    const red = await kartelaService.reduceStock({ itemId: ITEM, colorId: COLOR, count: 2, reason: "bekçi: arşiv" }, admin.id);
    const e3 = await hata(() => transitionItemLifecycle({ itemId: ITEM, to: ItemLifecycleStatus.ARCHIVED, userId: admin.id }));
    const durum = (await prisma.item.findUniqueOrThrow({ where: { id: ITEM }, select: { lifecycleStatus: true } })).lifecycleStatus;
    check("§3 kartelalar düşülünce (canlı değil) ürün Pasif'e alınır", red.data.reduced === 2 && e3 === null && durum === ItemLifecycleStatus.ARCHIVED, `${e3?.message ?? "ok"}`);

    // §4
    const reduction = await prisma.swatchStockReduction.findFirstOrThrow({ where: { itemId: ITEM }, select: { id: true } });
    const e4 = await hata(() => kartelaService.reverseStockReduction(reduction.id, "bekçi: diriltme", admin.id));
    const hala = await prisma.swatch.count({ where: { id: { in: swatchIds }, status: "REDUCED" } });
    check("§4 Pasif kartın düşümü geri alınamaz: 409 + çıkış yolu, kartelalar düşülmüş kalır",
      e4?.statusCode === 409 && e4.message === SWATCH_ON_ARCHIVED_ITEM_MESSAGE && hala === 2, `${e4?.statusCode} · ${e4?.message}`);

    // §5 — kartela çuval → onaylı sevkiyat → sevk; kart Pasif; sevk stornosu kartelayı diriltemez
    oncekiOnay = await prisma.systemSetting.findUnique({ where: { key: CONF_KEY }, select: { value: true } });
    await prisma.systemSetting.upsert({ where: { key: CONF_KEY }, create: { key: CONF_KEY, value: true }, update: { value: true } });
    CUSTOMER = (await prisma.customer.create({ data: { code: `TEST-KAK-${TS}`, name: `Kartela Arşiv Müşteri ${TS}` } })).id;
    ITEM2 = (await prisma.item.create({ data: { code: `TEST-KAK2-${TS}`, name: `Kartela Arşiv Sevk ${TS}`, itemType: "FABRIC" } })).id;
    const [sv] = await prisma.$transaction((tx) => createSwatchesTx(tx, [{
      cardNumber: `TST-KAK2-${TS}`, barcode: `TST-KAK2B-${TS}`, itemId: ITEM2, colorId: COLOR, parentReceiptId: RECEIPT,
    }], { trigger: "KARTELA_RECEIVE", userId: admin.id }));
    swatchIds.push(sv!.id);
    const sack = (await shippingService.openSack({ customerId: CUSTOMER }, admin.id)).data as { id: string };
    sackIds.push(sack.id);
    await shippingService.scanIntoSack({ sackId: sack.id, barcode: `TST-KAK2B-${TS}` }, admin.id);
    const arsivle = () => hata(() => transitionItemLifecycle({ itemId: ITEM2, to: ItemLifecycleStatus.ARCHIVED, userId: admin.id }));
    const e5s = await arsivle();
    check("§5a çuvaldaki (IN_SACK) kartela canlıdır: ürün Pasif'e alınamaz",
      e5s?.statusCode === 409 && e5s.details?.code === "ITEM_HAS_LIVE_REFERENCES", `${e5s?.statusCode ?? "GEÇTİ"} · ${e5s?.details?.code}`);
    const shp = (await shippingService.createShipment({ sackIds: [sack.id], customerId: CUSTOMER }, admin.id)).data as { id: string };
    shipmentIds.push(shp.id);
    const e5p = await arsivle();
    check("§5b sevkiyattaki (IN_SHIPMENT, PLANNED) kartela canlıdır: ürün Pasif'e alınamaz",
      e5p?.statusCode === 409 && e5p.details?.code === "ITEM_HAS_LIVE_REFERENCES", `${e5p?.statusCode ?? "GEÇTİ"} · ${e5p?.details?.code}`);
    await shippingService.dispatchShipment(shp.id, {}, admin.id);
    const e5a = await hata(() => transitionItemLifecycle({ itemId: ITEM2, to: ItemLifecycleStatus.ARCHIVED, userId: admin.id }));
    const e5 = await hata(() => shippingService.undoDispatch(shp.id, "bekçi: storno", admin.id));
    const sv5 = await prisma.swatch.findUniqueOrThrow({ where: { id: sv!.id }, select: { status: true } });
    const shp5 = await prisma.shipment.findUniqueOrThrow({ where: { id: shp.id }, select: { status: true } });
    check("§5 ⭐ sevk stornosu Pasif kartın kartelasını diriltemez: 409 + çıkış yolu, kartela SHIPPED, sevkiyat DISPATCHED",
      e5a === null && e5?.statusCode === 409 && e5.message === SWATCH_ON_ARCHIVED_ITEM_MESSAGE
        && sv5.status === SwatchStatus.SHIPPED && shp5.status === ShipmentStatus.DISPATCHED,
      `arşiv ${e5a?.message ?? "ok"} · storno ${e5?.statusCode ?? "GEÇTİ"} · kartela ${sv5.status} · sevkiyat ${shp5.status}`);
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  if (oncekiOnay !== undefined) {
    if (oncekiOnay === null) await prisma.systemSetting.deleteMany({ where: { key: CONF_KEY } });
    else await prisma.systemSetting.update({ where: { key: CONF_KEY }, data: { value: oncekiOnay.value as never } });
  }
  if (ITEM) await prisma.swatchStockReductionItem.deleteMany({ where: { reduction: { itemId: ITEM } } });
  await prisma.swatch.deleteMany({ where: { id: { in: swatchIds } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: shipmentIds } } });
  await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
  await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
  await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
  await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  if (ITEM2) await prisma.item.deleteMany({ where: { id: ITEM2 } });
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
  if (ITEM) await prisma.swatchStockReduction.deleteMany({ where: { itemId: ITEM } });
  if (RECEIPT) await prisma.kartelaReceipt.deleteMany({ where: { id: RECEIPT } });
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
  if (COLOR) await prisma.color.deleteMany({ where: { id: COLOR } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
