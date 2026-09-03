// =============================================================================
// BEKÇİ — DEPO HAREKET DEFTERİ: doğru olayda doğru satır
// =============================================================================
// Çalıştırma: npx tsx scripts/test_warehouse_ledger.ts
//
// NEDEN: `Roll.warehouseId` malın NEREDE olduğunu söyler; defter NASIL geldiğini
// / gittiğini. Defter satırı eksik kalırsa hata çıkmaz — yalnız "bu depoya bu ay
// ne girdi/çıktı" sorusu sessizce eksik cevaplanır. Fazla satır daha da kötüdür:
// aynı mal iki kez girmiş görünür.
//
// ÖLÇÜLENLER:
//   A) GİRİŞ (createInitialEntry) → TEK `ENTRY` satırı, hedef depo dolu, çıkış boş
//   B) ⭐ KESİM ÇOCUĞU SATIR YAZMAZ — kesim bir DÖNÜŞÜMDÜR, hareket değil.
//      Yazsaydı depoya giren mal İKİ KEZ sayılırdı (100 m top 2×50 olunca
//      depoya 100 m daha girmiş görünürdü). Bu kontrol, "her doğuşa satır at"
//      şeklindeki en olası yanlış refleksi kilitler.
//   C) İPTAL → `CANCEL` satırı, ÇIKIŞ deposu dolu (mal o depodan düştü)
//   D) `qty` HER ZAMAN POZİTİF — yön `eventType`ten okunur (RollVariance emsali)
//   E) Anlamsız satır yazılmaz: deposuz (from+to boş) çağrı satır üretmez
// =============================================================================
import { WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { writeWarehouseMovement } from "../src/services/helpers/warehouse-ledger.helper";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

const inventory = new InventoryService();
const tambur = new TamburService();

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

const rollIds: string[] = [];

async function main(): Promise<void> {
  console.log("=== Depo hareket defteri bekçisi ===\n");

  const def = await ensureDefaultWarehouse();
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("Test verisi yetersiz — aktif Item yok.");

  // ── A) Giriş ────────────────────────────────────────────────────────────
  const entry = await inventory.createInitialEntry({ itemId: item.id, initialQty: 120 }, undefined, undefined, false, {
    forcedStatus: "WAREHOUSE",
  });
  const parentId = (entry.data as { id: string }).id;
  rollIds.push(parentId);

  const entryRows = await prisma.warehouseMovement.findMany({ where: { rollId: parentId } });
  check("A1) Girişte TEK defter satırı", entryRows.length === 1, `satır=${entryRows.length}`);
  check("A2) Satır ENTRY ve hedef depo dolu", entryRows[0]?.eventType === WarehouseEventType.ENTRY && entryRows[0]?.toWarehouseId === def.id);
  check("A3) ENTRY'de ÇIKIŞ deposu boş", entryRows[0]?.fromWarehouseId === null);
  check("A4) qty giriş metrajı", Number(entryRows[0]?.qty) === 120, `qty=${entryRows[0]?.qty}`);

  // ── B) ⭐ Kesim çocuğu satır YAZMAZ ──────────────────────────────────────
  // `qualityGrade` AÇIKÇA: giriş topu gradesiz doğuyor,
  // `quality.gradeRequiredEnabled` AÇIKKEN kesim 400 GRADE_REQUIRED'a düşerdi
  // ve defter bekçisi kendi konusunu hiç ölçemezdi.
  const cut = await tambur.cutWarehouseRoll(parentId, {
    cutLength: 40,
    rawDestination: "WAREHOUSE",
    qualityGrade: "1.KALITE",
  });
  const childId = (cut.data as { childRoll?: { id: string } }).childRoll?.id;
  if (childId) rollIds.push(childId);
  const childRows = childId ? await prisma.warehouseMovement.count({ where: { rollId: childId } }) : -1;
  check("B1) Kesim çocuğu doğdu", Boolean(childId));
  check(
    "B2) ⭐ Kesim çocuğuna defter satırı YAZILMADI (çift sayım yok)",
    childRows === 0,
    `çocuk satırı=${childRows}`,
  );
  const parentRowsAfterCut = await prisma.warehouseMovement.count({ where: { rollId: parentId } });
  check("B3) Kesim ebeveynin satır sayısını da değiştirmedi", parentRowsAfterCut === 1, `ebeveyn satırı=${parentRowsAfterCut}`);

  // ── C) İptal → CANCEL ───────────────────────────────────────────────────
  await inventory.softDelete(parentId, undefined, {
    confirmActive: true,
    confirmLabelPrinted: true,
    reason: "TEST — defter bekçisi",
  });
  const cancelRows = await prisma.warehouseMovement.findMany({
    where: { rollId: parentId, eventType: WarehouseEventType.CANCEL },
  });
  check("C1) İptalde CANCEL satırı yazıldı", cancelRows.length === 1, `satır=${cancelRows.length}`);
  check("C2) CANCEL'da ÇIKIŞ deposu dolu, hedef boş", cancelRows[0]?.fromWarehouseId === def.id && cancelRows[0]?.toWarehouseId === null);

  // ── D) qty pozitiflik sözleşmesi ────────────────────────────────────────
  const allRows = await prisma.warehouseMovement.findMany({ where: { rollId: { in: rollIds } }, select: { qty: true } });
  check("D) Tüm satırlarda qty >= 0 (yön eventType'ten okunur)", allRows.every((r) => Number(r.qty) >= 0), `satır=${allRows.length}`);

  // ── E) Anlamsız satır yazılmaz ──────────────────────────────────────────
  const before = await prisma.warehouseMovement.count({ where: { rollId: parentId } });
  await prisma.$transaction(async (tx) => {
    await writeWarehouseMovement(tx, {
      rollId: parentId,
      eventType: WarehouseEventType.ENTRY,
      qty: 10,
      // from + to İKİSİ de boş → satır yazılmamalı
    });
    await writeWarehouseMovement(tx, {
      rollId: parentId,
      eventType: WarehouseEventType.ENTRY,
      qty: -5, // negatif → yazılmamalı
      toWarehouseId: def.id,
    });
  });
  const after = await prisma.warehouseMovement.count({ where: { rollId: parentId } });
  check("E) Deposuz/negatif çağrı satır ÜRETMEDİ", after === before, `önce=${before} sonra=${after}`);

  // Körlük zemini — defter gerçekten yazıyor mu (hepsi 0 olsaydı A-E vakumen geçerdi)
  check("Körlük zemini: bu koşumda en az 2 defter satırı üretildi", allRows.length >= 2, `${allRows.length} satır`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds }, parentRollId: { not: null } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 160));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
