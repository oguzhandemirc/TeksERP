// =============================================================================
// GERİYE DOLDURMA — mevcut topların deposu (Roll.warehouseId)
// =============================================================================
//   npx tsx scripts/backfill_roll_warehouse.ts            → KURU ANLATIM (varsayılan)
//   npx tsx scripts/backfill_roll_warehouse.ts --apply     → gerçekten yazar
//
// NEDEN GÜVENLİ (bu bir TAHMİN DEĞİL): çoklu depodan önce sistemde depo kavramı
// tek bir yerdi — fabrikanın TEK deposu. Dolayısıyla "bu top hangi depoydu"
// sorusunun geriye dönük cevabı %100 kesindir: varsayılan depo. Yanlış atıf
// yapma ihtimali yok.
//
// ⚠️ HAM SQL ile yazar, Prisma `update` ile DEĞİL: Prisma her update'te
// `updatedAt`i tazeler ve envanter sekmelerinin "Son İşlem" sıralaması tam o
// kolondan çözülür (kök CLAUDE.md "Buraya geliş ≠ oluşturma") → script sahadaki
// HER listeyi yeniden sıralardı. Emsal: backfill_roll_production_timestamps.ts
//
// ⚠️ DEPO DEFTERİNE (warehouse_movements) SATIR YAZMAZ: defter "bu güncellemeden
// SONRAKİ olaylar"dır; açılış durumu topun kendi satırındaki `warehouseId`'dir.
// Yüz binlerce anlamsız "başlangıç" satırı üretmenin faydası yok.
//
// İdempotent: yalnız `warehouseId IS NULL` satırlara dokunur, tekrar koşulabilir.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";

const APPLY = process.argv.includes("--apply");
const BATCH = 500;
const SAMPLE = 20;

async function main(): Promise<void> {
  console.log(`=== Roll.warehouseId geriye doldurma — ${APPLY ? "UYGULAMA" : "KURU ANLATIM"} ===\n`);

  const target = await prisma.warehouse.findFirst({
    where: { isDefault: true },
    select: { id: true, code: true, name: true },
  });
  if (!target) {
    console.error(
      "❌ Varsayılan depo YOK. Önce backend'i bir kez ayağa kaldırın (boot uzlaştırması " +
        "`ensureDefaultWarehouse` onu yaratır) ya da Tanımlar → Depolar'dan açıp varsayılan yapın.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Hedef depo: ${target.name} (${target.code})\n`);

  const total = await prisma.roll.count({ where: { warehouseId: null } });
  const grand = await prisma.roll.count();
  console.log(`Deposuz top: ${total} / toplam ${grand}`);
  if (total === 0) {
    console.log("Yapacak iş yok.");
    return;
  }

  // Etkilenecek kayıtlar somut olarak listelenir (kök CLAUDE.md: "--apply öncesi
  // etkilenecek her kaydı somut listeler").
  const byStatus = await prisma.roll.groupBy({
    by: ["status"],
    where: { warehouseId: null },
    _count: { _all: true },
  });
  console.log("\nStatü kırılımı:");
  for (const r of [...byStatus].sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${r.status.padEnd(28)} ${r._count._all}`);
  }

  const sample = await prisma.roll.findMany({
    where: { warehouseId: null },
    select: { barcode: true, status: true, currentQty: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: SAMPLE,
  });
  console.log(`\nÖrnek ilk ${sample.length} kayıt (en yeni):`);
  for (const r of sample) {
    console.log(
      `  ${(r.barcode ?? "(barkodsuz)").padEnd(16)} ${r.status.padEnd(24)} ` +
        `${String(r.currentQty).padStart(9)} m  ${r.createdAt.toISOString().slice(0, 10)}`,
    );
  }
  if (total > SAMPLE) console.log(`  … ve ${total - SAMPLE} kayıt daha`);

  if (!APPLY) {
    console.log("\nKURU ANLATIM — hiçbir şey yazılmadı. Uygulamak için: --apply");
    return;
  }

  console.log("\nYazılıyor…");
  let written = 0;
  for (;;) {
    // Ham SQL + LIMIT'li alt sorgu: `updatedAt` TAZELENMEZ.
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      WITH batch AS (
        SELECT id FROM rolls WHERE "warehouseId" IS NULL LIMIT ${BATCH}
      )
      UPDATE rolls r SET "warehouseId" = ${target.id}::uuid
      FROM batch b WHERE r.id = b.id
      RETURNING 1 AS n
    `;
    if (rows.length === 0) break;
    written += rows.length;
    console.log(`  ${written}/${total}`);
  }

  const left = await prisma.roll.count({ where: { warehouseId: null } });
  console.log(`\n✅ ${written} kayıt güncellendi. Kalan deposuz top: ${left}`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
