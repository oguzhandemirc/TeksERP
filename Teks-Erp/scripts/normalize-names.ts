// =============================================================================
// One-off: Saha #13 — mevcut ürün/renk adlarını standarda taşı
// Çalıştır: npx tsx scripts/normalize-names.ts          (dry-run, sadece rapor)
//           npx tsx scripts/normalize-names.ts --apply  (gerçekten yazar)
// Ürün: HEPSİ BÜYÜK (tr). Renk: BÜYÜK + sayı blokları başta + BOŞLUK KORUNUR
// (2026-07-27: tire standardı kalktı; legacy tireli ada DOKUNULMAZ — yalnız
// case/sayı-sırası/çoklu-boşluk düzelir). İdempotent — ikinci koşuda "0
// değişiklik" üretir.
//
// ⚠️ 2026-09-12: başlıkta "Audit'e SYSTEM olarak düşer" yazıyordu ama HİÇBİR
// audit çağrısı yoktu — karşılıksız beyan. İz artık gerçekten yazılıyor
// (`onarimIziYaz`). Ad TİCARİ OLARAK GÖRÜNÜRDÜR (belge · etiket · fatura) ve
// "müşteride ad donar" kuralı bunun üstüne kuruludur: izsiz bir toplu ad
// değişimi, sonradan "bu ürünün adı neden böyle" sorusunu cevapsız bırakır.
// =============================================================================
import prisma from "../src/lib/prisma";
import {
  normalizeItemName,
  normalizeColorName,
} from "../src/services/helpers/name-normalize.helper";
import { izDustuUyarisi, onarimIziYaz } from "./lib/onarim-izi";

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

    const SCRIPT = "scripts/normalize-names.ts";
    const izYazildi = await onarimIziYaz({
      script: SCRIPT,
      action: "MASTER_DATA_NAME_NORMALIZE",
      olcum: {
        urunGuncellenen: itemChanges.length,
        urunToplam: items.length,
        renkGuncellenen: colorChanges.length,
        renkToplam: colors.length,
        // Adın ESKİ hâli yalnız burada kalır — kolon üzerine yazıldı.
        urunDegisimleri: itemChanges.map((i) => ({ id: i.id, eski: i.name, yeni: i.next })),
        renkDegisimleri: colorChanges.map((c) => ({ id: c.id, eski: c.name, yeni: c.next })),
      },
    });
    if (!izYazildi) {
      console.error(izDustuUyarisi(SCRIPT, false));
      process.exitCode = 1;
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
