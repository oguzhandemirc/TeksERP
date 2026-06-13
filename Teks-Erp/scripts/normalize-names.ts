// =============================================================================
// One-off: Saha #13 — mevcut ürün/renk adlarını standarda taşı
// Çalıştır: npx tsx scripts/normalize-names.ts          (dry-run, sadece rapor)
//           npx tsx scripts/normalize-names.ts --apply  (gerçekten yazar)
// Ürün: HEPSİ BÜYÜK (tr). Renk: BÜYÜK + tire + sayı blokları başta.
// İdempotent — ikinci koşuda "0 değişiklik" üretir. Audit'e SYSTEM olarak düşer.
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  normalizeItemName,
  normalizeColorName,
} from "../src/services/helpers/name-normalize.helper";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "== UYGULAMA MODU ==" : "== DRY-RUN (yazmaz; --apply ile uygula) ==");

  const items = await prisma.item.findMany({ select: { id: true, name: true } });
  const itemChanges = items
    .map((i) => ({ ...i, next: normalizeItemName(i.name) }))
    .filter((i) => i.next !== i.name);

  const colors = await prisma.color.findMany({ select: { id: true, name: true } });
  const colorChanges = colors
    .map((c) => ({ ...c, next: normalizeColorName(c.name) }))
    .filter((c) => c.next !== c.name);

  console.log(`\nÜrün: ${items.length} kayıt, ${itemChanges.length} değişecek`);
  for (const i of itemChanges) console.log(`  "${i.name}" → "${i.next}"`);
  console.log(`\nRenk: ${colors.length} kayıt, ${colorChanges.length} değişecek`);
  for (const c of colorChanges) console.log(`  "${c.name}" → "${c.next}"`);

  if (APPLY) {
    for (const i of itemChanges) {
      await prisma.item.update({ where: { id: i.id }, data: { name: i.next } });
    }
    for (const c of colorChanges) {
      await prisma.color.update({ where: { id: c.id }, data: { name: c.next } });
    }
    console.log(`\n✅ Uygulandı: ${itemChanges.length} ürün + ${colorChanges.length} renk güncellendi`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
