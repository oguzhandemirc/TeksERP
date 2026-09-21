// =============================================================================
// SEVK PARTİSİ MODUNA GEÇİŞ — mevcut paketleme gruplarını parti kalıbına hizala
// =============================================================================
// Koşum:  npx tsx scripts/migrate_packing_groups_to_lots.ts            (KURU — varsayılan)
//         npx tsx scripts/migrate_packing_groups_to_lots.ts --apply --canli-onay
//
// NE YAPAR (docs/design/SEVK-PARTISI-TASARIM.md §7):
//   (a) Grup modunda "ölü" (havuzda çuvalı kalmamış) grupları CLOSED'a çeker — parti
//       modunda canlılık `status`tan okunur; bu satırlar aksi hâlde AÇIK parti
//       olarak listeye dolar ve sayaç onları sayar (numara zaten sayılıyordu).
//   (b) Canlı gruplar OPEN kalır (şema varsayılanı) — DOKUNULMAZ.
//   (c) Çuvallara ambalaj numarası VERMEZ (sessiz backfill yok): grup modunda
//       çuval numarasızdı; operatör partiyi açıp "Partiye Al" ile numaralar.
//   (d) Etkilenen HER grubu adıyla raporlar — kuru koşumda da, `--apply` sonrasında da.
//
// ⚠️ Tek yönlü değildir: parti modundan grup moduna dönülürse `status` okunmaz,
//    canlılık yine çocuk satırdan türer — CLOSED damgası zararsız kalır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { LIVE_GROUP_WHERE } from "../src/services/helpers/packing-group.helper";
import { YAZILMASI_YASAK_DB, fixtureHedefEngeli, hedefDbAdi } from "./lib/hedef-db-kapisi";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");

console.log(`\n🎯 Hedef veritabanı: ${hedefDbAdi()}`);
if (YAZILMASI_YASAK_DB.has(hedefDbAdi())) {
  console.error(`\n⛔ DURDURULDU — '${hedefDbAdi()}' üretim/kopya adı; bu betik oraya YAZMAZ.\n`);
  process.exit(1);
}
const fixtureDisi = fixtureHedefEngeli();
if (APPLY && fixtureDisi && !CANLI_ONAY) {
  console.error(`\n⛔ --apply DURDURULDU — hedef fixture kalıbında değil.`);
  console.error(`   ${fixtureDisi}`);
  console.error(`   Fabrikada bilerek koşuyorsan: --apply --canli-onay\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Ölü grup = OPEN ama havuzda çuvalı yok (türetilmiş canlılığın tersi).
  const olu = await prisma.packingGroup.findMany({
    where: { status: "OPEN", NOT: LIVE_GROUP_WHERE },
    select: { id: true, name: true, customer: { select: { name: true } }, _count: { select: { sacks: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n${APPLY ? "UYGULANIYOR" : "KURU KOŞUM"} — CLOSED'a çekilecek ölü grup: ${olu.length}`);
  for (const g of olu) {
    console.log(`  · ${g.customer.name} / ${g.name} (${g._count.sacks} çuval, hepsi sevk edilmiş ya da boş)`);
  }
  if (!APPLY) {
    console.log(`\nDeğişiklik YAZILMADI. Uygulamak için: --apply${fixtureDisi ? " --canli-onay" : ""}`);
    return;
  }
  const res = await prisma.packingGroup.updateMany({
    where: { id: { in: olu.map((g) => g.id) }, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  console.log(`\n✅ ${res.count} grup CLOSED'a çekildi (rapor yukarıda).`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
