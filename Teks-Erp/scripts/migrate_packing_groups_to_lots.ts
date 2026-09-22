// =============================================================================
// SEVK PARTİSİ MODUNA GEÇİŞ — mevcut paketleme gruplarını parti kalıbına hizala
// =============================================================================
// Koşum:  npx tsx scripts/migrate_packing_groups_to_lots.ts            (KURU — varsayılan)
//         npx tsx scripts/migrate_packing_groups_to_lots.ts --apply --canli-onay
//
// NE YAPAR (docs/design/SEVK-PARTISI-TASARIM.md §7):
//   (a) Grup modunda "ölü" (havuzda çuvalı kalmamış, en az bir çuvalı olmuş) grupları
//       CLOSED'a ("sevk edildi") çeker — parti modunda canlılık `status`tan okunur; bu
//       satırlar aksi hâlde AÇIK parti olarak listeye dolar. BOŞ (hiç çuvalsız) grup
//       dokunulmaz: o bir taslaktır, açık kalır ya da silinir.
//   (b) Canlı gruplar OPEN kalır (şema varsayılanı) — DOKUNULMAZ.
//   (b2) TERS TUTARSIZLIK: CLOSED ama havuzda çuvalı var (2026-09-22 öncesi elle kapatma
//       ucundan kalan satırlar) → OPEN. Parti modunda CLOSED = "sevk edildi"dir; sevk
//       edilmemiş çuvalı olan parti kapalı olamaz (bekçi: `test_sevk_partisi` §13).
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
  const sel = { id: true, name: true, customer: { select: { name: true } }, _count: { select: { sacks: true } } } as const;
  // Ölü grup = OPEN, havuzda çuvalı yok, ama en az bir çuvalı OLMUŞ (hepsi sevk edildi).
  const olu = await prisma.packingGroup.findMany({
    where: { status: "OPEN", NOT: LIVE_GROUP_WHERE, sacks: { some: {} } },
    select: sel,
    orderBy: { createdAt: "asc" },
  });
  // Ters tutarsızlık = CLOSED ama havuzda çuvalı var.
  const ters = await prisma.packingGroup.findMany({
    where: { status: "CLOSED", ...LIVE_GROUP_WHERE },
    select: sel,
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n${APPLY ? "UYGULANIYOR" : "KURU KOŞUM"} — CLOSED'a çekilecek (hepsi sevk edilmiş) grup: ${olu.length}`);
  for (const g of olu) console.log(`  · ${g.customer.name} / ${g.name} (${g._count.sacks} çuval, hepsi sevk edilmiş)`);
  console.log(`OPEN'a çekilecek (kapalı ama havuzda çuvalı var) parti: ${ters.length}`);
  for (const g of ters) console.log(`  · ${g.customer.name} / ${g.name} (${g._count.sacks} çuval)`);
  if (!APPLY) {
    console.log(`\nDeğişiklik YAZILMADI. Uygulamak için: --apply${fixtureDisi ? " --canli-onay" : ""}`);
    return;
  }
  const r1 = await prisma.packingGroup.updateMany({
    where: { id: { in: olu.map((g) => g.id) }, status: "OPEN" },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  const r2 = await prisma.packingGroup.updateMany({
    where: { id: { in: ters.map((g) => g.id) }, status: "CLOSED" },
    data: { status: "OPEN" },
  });
  console.log(`\n✅ ${r1.count} grup CLOSED'a, ${r2.count} parti OPEN'a çekildi (rapor yukarıda).`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
