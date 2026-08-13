// =============================================================================
// BEKÇİ — MAL KABUL: satın alınan malın depo girişi
// =============================================================================
// Çalıştırma: npx tsx scripts/test_goods_receipt.ts
//
// NEDEN: Mal Kabul, alım-satım kurulumunun TEK giriş kapısıdır — buradan doğan
// top yanlış damgalanırsa (yanlış depo, yanlış kaynak, fişsiz) envanterin
// tamamı yanlış başlar ve hata hiçbir yerde görünmez.
//
// ÖLÇÜLENLER:
//   A) Fiş + satırlar: top WAREHOUSE + PURCHASE_RECEIPT + FİŞİN deposu + fiş bağı
//   B) Defterde ENTRY satırı (mal dışarıdan geldi) — fiş bağıyla
//   C) İdempotency: aynı clientToken ile ikinci çağrı YENİ fiş açmaz
//   D) Parçalı sonuç: hatalı satır `failed[]`e düşer, SAĞLAM satır KALIR
//      (10 top girildi deyip 2'sini yutmak en kötü davranış)
//   E) Pasif depoya mal kabul REDDEDİLİR
//   F) İptal: toplar CANCELLED + fiş CANCELLED
//   G) ⭐ İŞLEM GÖRMÜŞ top varsa fiş iptal EDİLEMEZ — "mal hiç girmedi" storno
//      semantiği defteri yalanlayamaz
// =============================================================================
import { GoodsReceiptStatus, RollEntrySource, RollStatus, WarehouseEventType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-GR-${Date.now()}`;
const receiptIds: string[] = [];
const warehouseIds: string[] = [];

async function main(): Promise<void> {
  console.log("=== Mal kabul bekçisi ===\n");

  const def = await ensureDefaultWarehouse();
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} Depo` }, select: { id: true } });
  warehouseIds.push(wh.id);

  // ── A + B) Fiş + satır + defter ─────────────────────────────────────────
  const res = await goodsReceiptService.create({
    warehouseId: wh.id,
    deliveryNoteNo: "IRS-12345",
    lines: [
      { itemId: item.id, initialQty: 100 },
      { itemId: item.id, initialQty: 60 },
    ],
  });
  const detail = res.data as { id: string; receiptNo: string; rolls: Array<{ id: string; status: string }>; totals: { rollCount: number; totalQty: number } };
  receiptIds.push(detail.id);

  check("A1) Fiş MK ön ekiyle doğdu", detail.receiptNo.startsWith("MK"), detail.receiptNo);
  check("A2) İki top girildi", detail.rolls.length === 2, `top=${detail.rolls.length}`);
  check("A3) Toplam metraj 160", detail.totals.totalQty === 160, `toplam=${detail.totals.totalQty}`);

  const rollRows = await prisma.roll.findMany({
    where: { goodsReceiptId: detail.id },
    select: { id: true, status: true, entrySource: true, warehouseId: true, barcode: true, entryStationId: true },
  });
  check("A4) Toplar WAREHOUSE statüsünde", rollRows.every((r) => r.status === RollStatus.WAREHOUSE));
  check("A5) entrySource = PURCHASE_RECEIPT", rollRows.every((r) => r.entrySource === RollEntrySource.PURCHASE_RECEIPT));
  check("A6) ⭐ Toplar FİŞİN deposunda (varsayılana sapmadı)", rollRows.every((r) => r.warehouseId === wh.id), `varsayılan=${def.id}`);
  check("A7) Barkod üretildi", rollRows.every((r) => Boolean(r.barcode)));
  check("A8) Giriş istasyonu NULL (mal kabul üretim noktası değil)", rollRows.every((r) => r.entryStationId === null));

  const ledger = await prisma.warehouseMovement.findMany({
    where: { rollId: { in: rollRows.map((r) => r.id) } },
    select: { eventType: true, toWarehouseId: true, goodsReceiptId: true },
  });
  check("B1) Her top için ENTRY satırı", ledger.length === 2 && ledger.every((l) => l.eventType === WarehouseEventType.ENTRY));
  check("B2) Defter satırı fişin deposunu ve fişi taşıyor", ledger.every((l) => l.toWarehouseId === wh.id && l.goodsReceiptId === detail.id));

  // ── B3-B5) Fiş belgesi: LAZY-INIT (açılışta DEĞİL, ilk baskıda donar) ────
  const beforePrint = await prisma.printedDocument.count({ where: { docType: "GOODS_RECEIPT", sourceId: detail.id } });
  check(
    "B3) ⭐ Fiş açılışında belge DONMADI (fiş bir KAPTIR — satır sonradan eklenir)",
    beforePrint === 0,
    `belge=${beforePrint}`,
  );
  const grHtml = (await printedDocumentService.getHtml("GOODS_RECEIPT" as never, detail.id)).data?.html ?? "";
  check("B4) İlk baskıda belge üretildi ve tedarikçi irsaliyesini yazıyor", grHtml.includes("MAL KABUL") && grHtml.includes("IRS-12345"), `uzunluk=${grHtml.length}`);
  const afterPrint = await prisma.printedDocument.count({ where: { docType: "GOODS_RECEIPT", sourceId: detail.id } });
  check("B5) Baskı belgeyi dondurdu (lazy-init)", afterPrint === 1, `belge=${afterPrint}`);

  // ── C) İdempotency ──────────────────────────────────────────────────────
  const token = randomUUID();
  const first = await goodsReceiptService.create({ warehouseId: wh.id, clientToken: token, lines: [{ itemId: item.id, initialQty: 5 }] });
  const firstId = (first.data as { id: string }).id;
  receiptIds.push(firstId);
  const second = await goodsReceiptService.create({ warehouseId: wh.id, clientToken: token, lines: [{ itemId: item.id, initialQty: 5 }] });
  const secondId = (second.data as { id: string }).id;
  const receiptCount = await prisma.goodsReceipt.count({ where: { clientToken: token } });
  check("C1) Aynı clientToken ikinci fiş AÇMADI", receiptCount === 1 && secondId === firstId, `fiş=${receiptCount}`);
  const tokenRolls = await prisma.roll.count({ where: { goodsReceiptId: firstId } });
  check("C2) Satırlar da tekrarlanmadı", tokenRolls === 1, `top=${tokenRolls}`);

  // ── D) Parçalı sonuç ────────────────────────────────────────────────────
  const partial = await goodsReceiptService.create({
    warehouseId: wh.id,
    lines: [
      { itemId: item.id, initialQty: 30 },
      { itemId: "00000000-0000-4000-8000-000000000000", initialQty: 20 }, // var olmayan ürün
    ],
  });
  const partialData = partial.data as { id: string; rolls: unknown[]; failed: Array<{ index: number; reason: string }> };
  receiptIds.push(partialData.id);
  check("D1) Sağlam satır KALDI", partialData.rolls.length === 1, `top=${partialData.rolls.length}`);
  check("D2) ⭐ Hatalı satır SEBEBİYLE döndü (yutulmadı)", partialData.failed?.length === 1 && Boolean(partialData.failed[0]?.reason), partialData.failed?.[0]?.reason?.slice(0, 60));

  // ── E) Pasif depo reddedilir ────────────────────────────────────────────
  const passive = await prisma.warehouse.create({ data: { code: `${TAG}-P`, name: `${TAG} Pasif`, isActive: false }, select: { id: true } });
  warehouseIds.push(passive.id);
  let passiveMsg = "";
  try {
    const bad = await goodsReceiptService.create({ warehouseId: passive.id });
    receiptIds.push((bad.data as { id: string }).id);
  } catch (e) {
    passiveMsg = (e as Error).message;
  }
  check("E) Pasif depoya mal kabul reddedildi", passiveMsg.includes("pasif"), passiveMsg.slice(0, 60));

  // ── F) İptal ────────────────────────────────────────────────────────────
  const cancelRes = await goodsReceiptService.cancel(detail.id, "TEST — bekçi iptali");
  const afterCancel = await prisma.goodsReceipt.findUnique({ where: { id: detail.id }, select: { status: true } });
  const cancelledRolls = await prisma.roll.count({ where: { goodsReceiptId: detail.id, status: RollStatus.CANCELLED } });
  check("F1) Fiş CANCELLED", afterCancel?.status === GoodsReceiptStatus.CANCELLED);
  check("F2) Fişin topları da iptal edildi", cancelledRolls === 2, `iptal=${cancelledRolls}`);
  check("F3) İptal sonucu sayı döndürüyor", (cancelRes.data as { cancelledRolls: number }).cancelledRolls === 2);

  // ── G) ⭐ İşlem görmüş top varsa iptal engellenir ────────────────────────
  const guarded = await goodsReceiptService.create({ warehouseId: wh.id, lines: [{ itemId: item.id, initialQty: 44 }] });
  const guardedData = guarded.data as { id: string; rolls: Array<{ id: string }> };
  receiptIds.push(guardedData.id);
  // Topu "işlem görmüş" say: üretime çek.
  await prisma.roll.update({ where: { id: guardedData.rolls[0]!.id }, data: { status: RollStatus.IN_PRODUCTION } });
  let guardMsg = "";
  try {
    await goodsReceiptService.cancel(guardedData.id, "olmamalı");
  } catch (e) {
    guardMsg = (e as Error).message;
  }
  check("G1) ⭐ İşlem görmüş toplu fiş iptal EDİLEMEDİ", guardMsg.includes("işlem görmüş"), guardMsg.slice(0, 80));
  const stillActive = await prisma.goodsReceipt.findUnique({ where: { id: guardedData.id }, select: { status: true } });
  check("G2) Guard yan etki bırakmadı (fiş hâlâ ACTIVE)", stillActive?.status === GoodsReceiptStatus.ACTIVE);

  check("Körlük zemini: en az 4 fiş üretildi", receiptIds.length >= 4, `${receiptIds.length} fiş`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      const rolls = await prisma.roll.findMany({ where: { goodsReceiptId: { in: receiptIds } }, select: { id: true } });
      const ids = rolls.map((r) => r.id);
      if (ids.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
        await prisma.roll.deleteMany({ where: { id: { in: ids } } });
      }
      if (receiptIds.length) await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 200));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
