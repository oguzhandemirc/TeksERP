// =============================================================================
// DEMO SEED — TAM VİTRİN
// =============================================================================
// `seed.ts` (fabrika iskeleti) ve `seed-ticaret-demo.ts` (cari/fatura/çek/kasa)
// ÜSTÜNE koşar; onların ürettiği hiçbir kaydı silmez ve idempotenttir.
//
// AMAÇ: demoyu gezen kişi hiçbir ekranı BOŞ görmesin. Boş ekran, ürünün o
// özelliğe sahip olmadığı izlenimini verir — "bu özellik çalışmıyor" cümlesi
// çoğu zaman "veri yok" demektir.
//
// ⚠️ HİÇBİR ŞEY SİLİNMEZ. Tazeleme yolu `docs/ops/demo-reset.sh` (yedek alır,
// DB'yi sıfırdan kurar). 300 top + defter satırlarını FK-güvenli sırayla silmek,
// seed'in kendisinden büyük bir risk yüzeyi olurdu.
//
// ⚠️ İDEMPOTENTLİK ÜÇ KATMANLI: servis yolları `clientToken: demoToken(...)`,
// doğrudan yazımlar deterministik PK (`demoId`), doğal anahtarlı upsert'ler.
// İkinci koşum "0 yeni" vermelidir.
//
// Koşum:  npx tsx prisma/seed-demo-full.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { assertDemoDatabase, assertNotProductionCopy, dbAdi, sayaclar, notlarListesi } from "./demo/_kit";
import { katalogKur } from "./demo/catalog";
import { carilerKur, siparislerKur } from "./demo/sales";
import { envanterKur } from "./demo/inventory";
import { kartelaKur, transferKur, sayimKur, kurTarihcesiKur } from "./demo/extras";
import { sevkiyatKur } from "./demo/shipping";
import { finansKur } from "./demo/finance";
import { cuvalKur, iplikStokKur, fiyatKur, cihazKur } from "./demo/extras2";
import { demoKullanicisiYetkilendir, firmaKunyesiKur } from "./demo/users";
import { dogrula } from "./demo/verify";

async function main(): Promise<void> {
  const db = await dbAdi();
  assertDemoDatabase(db);
  await assertNotProductionCopy();

  console.log("🎬 TeksERP — TAM DEMO VİTRİNİ");
  console.log(`   Veritabanı: ${db}`);
  console.log("   Bu script HİÇBİR KAYDI SİLMEZ; idempotenttir.\n");

  const { itemIds, colorIds } = await katalogKur();
  const alicilar = await carilerKur();
  await siparislerKur(alicilar, itemIds, colorIds);
  await envanterKur(itemIds, colorIds);
  await kurTarihcesiKur();
  await kartelaKur();
  await transferKur();
  await sayimKur();
  await sevkiyatKur();
  await finansKur();
  await cuvalKur();
  await iplikStokKur();
  await fiyatKur();
  await cihazKur();
  await demoKullanicisiYetkilendir();
  await firmaKunyesiKur();

  const olcumHatasi = await dogrula();

  // ── ÖZET ────────────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────");
  for (const [ad, n] of sayaclar()) console.log(`${ad.padEnd(26)}: ${n}`);
  const uyarilar = notlarListesi();
  if (uyarilar.length > 0) {
    console.log(`\n⚠ ${uyarilar.length} uyarı — yukarıda listelendi.`);
  }
  console.log("─────────────────────────────────────────────\n");

  await prisma.$disconnect();
  // Kabul ölçütü tutmuyorsa ya da bir ekran boşsa KIRMIZI bit — sessiz "başarılı"
  // bir seed, tam da önlenmek istenen "boş ekran" sonucunu gizlerdi.
  process.exit(uyarilar.length > 0 || olcumHatasi > 0 ? 1 : 0);
}

void main();
