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
// =============================================================================

import prisma from "../src/lib/prisma";
import { ItemLifecycleStatus } from "@prisma/client";
import { createSwatchesTx } from "../src/services/helpers/swatch-event.helper";
import { transitionItemLifecycle } from "../src/services/helpers/item-lifecycle.helper";
import { assertArchivableTx, listArchiveBlockers } from "../src/services/helpers/master-data-archive.helper";
import { COLOR_ARCHIVE } from "../src/services/helpers/archive-gate/color-archive.helper";
import { kartelaService } from "../src/services/kartela.service";
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
let ITEM = "", COLOR = "", RECEIPT = "";
const swatchIds: string[] = [];

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
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  if (ITEM) await prisma.swatchStockReductionItem.deleteMany({ where: { reduction: { itemId: ITEM } } });
  await prisma.swatch.deleteMany({ where: { id: { in: swatchIds } } });
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
