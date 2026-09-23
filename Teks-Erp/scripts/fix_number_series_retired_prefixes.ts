// =============================================================================
// EMEKLİ ÖN EK ONARIMI — kirli `retiredPrefixes` satırlarını temizler (K7)
// =============================================================================
// KURU KOŞUM VARSAYILAN. Yazmak için: --apply
//   npx tsx scripts/fix_number_series_retired_prefixes.ts
//   npx tsx scripts/fix_number_series_retired_prefixes.ts --apply
//
// NEDEN VAR (ölçüldü 2026-09-23, d3'ün gerçek panel turu · `tekserp_d3e2e_test`):
// panelde ön ek deneyip GERİ ALMAK iki tür çöp bırakıyordu —
//   ① yürürlükteki ön ek emekli listede kalıyor (`prefix=PRT`, `retired={PRT,ZQ}`)
//   ② hiç kod üretmemiş DENEME ön eki (`ZQ`) kalıcı olarak emekliye ayrılıyor.
// İkisi de sessiz: emekli liste "eskiden bu ön ek kullanılıyordu" diye okunur ve
// tarama uzayındaki çakışma kapısını gereksiz yere daraltır.
//
// ⚠️ ÜÇ SONUÇ, İKİ KORUMA — bir ön eki emekli listeden düşürmek, o ön ekle
// basılmış etiketleri OKUTULAMAZ kılar. Bu yüzden düşürme YALNIZ şu hâlde olur:
//   · kullanım ÖLÇÜLDÜ ve SIFIR  → düşürülür
//   · kullanım > 0               → korunur
//   · ÖLÇÜLEMEDİ (sayım kaynağı yok) → korunur ("bilmiyorum" ≠ "yok")
// Ek koruma: katalogda TOHUM olarak beyan edilen emekli ön ekler (bugün
// `workOrder` → `RK`) hiç düşürülmez. Onlar bir GEÇMİŞ BEYANIDIR: sahadaki
// basılı `RK` refakat kartları veritabanında karşılığı olmasa da okutuluyor
// (ölçüldü: fabrika kopyasında 0 `RK` kaydı var, kartlar yine de sahada).
//
// DAMGASIZ ve İDEMPOTENT: ikinci koşumda yapacak iş bulmaz; "yapıldı" işareti
// tutmaz — tutsaydı, sonradan kirlenen bir satırı bir daha hiç temizlemezdi.
// =============================================================================
import prisma from "../src/lib/prisma";
import { planRetiredPrefixCleanup } from "../src/services/helpers/series-retired.helper";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log("=== Emekli ön ek onarımı (K7) ===\n");
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}\n`);
  const planlar = await planRetiredPrefixCleanup();

  if (planlar.length === 0) {
    console.log("✅ Temiz: düşürülecek emekli ön ek yok.\n");
    return;
  }

  // ⚠️ ETKİLENEN HER KAYIT LİSTELENİR (yıkıcı işlem kuralı): soyut bir sayı
  // ("3 seri düzeltilecek") operatöre neyin değiştiğini söylemez.
  for (const p of planlar) {
    console.log(`• ${p.key} (${p.label})`);
    console.log(`    önce : {${p.onceki.join(", ")}}`);
    console.log(`    sonra: {${p.sonraki.join(", ")}}`);
    for (const g of p.gerekceler) console.log(`      - ${g}`);
  }
  console.log("");

  if (!APPLY) {
    console.log(`KURU KOŞUM — hiçbir şey yazılmadı (${planlar.length} seri aday). Yazmak için: --apply\n`);
    return;
  }
  for (const p of planlar) {
    await prisma.numberSeries.update({ where: { key: p.key }, data: { retiredPrefixes: p.sonraki } });
    console.log(`✔ ${p.key} güncellendi`);
  }
  console.log(`\n✅ ${planlar.length} seri onarıldı.\n`);
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
