#!/usr/bin/env node
// =============================================================================
// KANAL KAPISI — kabuk yayın betikleri için CLI (yüklemler scripts/lib/kanallar.mjs)
// =============================================================================
// Çıkış: 0 geçti · 1 KIRMIZI · 2 ÖLÇÜLEMEDİ — sıfır-dışı her çıkış DURDURUR.
//
//   node scripts/kanal-kapisi.mjs kanal <kod>                      # kayıtlı mı
//   node scripts/kanal-kapisi.mjs panel-paketle <kod>              # ağaç bu kanalın panel kimliğini taşıyor mu
//   node scripts/kanal-kapisi.mjs panel-yayin <kod> <paket dizini> # paket (release/<kod>/<sürüm>) bu kanalın mı
//
// ⚠️ AYRI DOSYA ve KOŞULSUZ `main()`: CLI eskiden kitaplığın içindeydi ve "doğrudan
// mı çalıştırıldım" diye `process.argv[1]`i `import.meta.url` ile kıyaslıyordu.
// macOS'ta /var → /private/var (ve /tmp → /private/tmp) sembolik bağı yüzünden kıyas
// tutmadı, gövde HİÇ koşmadı ve kapı 0 döndü — fail-OPEN, sessiz. Tespit gerektirmeyen
// bir giriş dosyası bu arızayı yapısal olarak imkânsız kılar.
// =============================================================================

import {
  Olculemedi,
  PANEL_SABIT_DOSYALAR,
  dosyalariOku,
  kanalCoz,
  panelArtefaktFarki,
  panelArtefaktKimligi,
  panelSabitKimlikFarki,
} from './lib/kanallar.mjs';

function dur(baslik, satirlar, kod) {
  console.error(`\n  ✖ ${baslik}`);
  for (const s of satirlar ?? []) console.error(`    ${s}`);
  console.error('');
  process.exit(kod);
}

function main(argv) {
  const [komut, kod, dizin] = argv;
  try {
    if (komut === 'kanal') {
      const { kanal } = kanalCoz(kod);
      console.log(`  ✓ kanal "${kod}" (${kanal.tur}) kayıtlı`);
      return;
    }
    if (komut === 'panel-paketle') {
      const { kanal } = kanalCoz(kod);
      const f = panelSabitKimlikFarki(kanal, dosyalariOku(PANEL_SABIT_DOSYALAR));
      if (f.length) {
        dur(`AĞAÇ "${kod}" KANALININ PANEL KİMLİĞİNİ TAŞIMIYOR — paketlenirse yanlış kimlikle doğar`, [
          ...f,
          'Paketleme bu alanları YAZMAZ (yalnız kod · yayın adresi · çıktı dizini); başka kanalın kimliğiyle',
          'derlenen panel aynı makinede o kanalın kurulumunun, verisinin ve güncelleyicisinin üstüne yazar.',
        ], 1);
      }
      console.log(`  ✓ kanal "${kod}" (${kanal.tur}) · panel kimliği ağaçla birebir`);
      return;
    }
    if (komut === 'panel-yayin') {
      const { kayit } = kanalCoz(kod);
      if (!dizin) dur('panel-yayin: paket dizini verilmedi', [], 2);
      const f = panelArtefaktFarki(kayit, kod, panelArtefaktKimligi(dizin));
      if (f.length) {
        dur(`PAKET "${kod}" KANALININ DEĞİL — yükleme yapılmadı`, [
          ...f,
          'Hedef klasör paketin KENDİ kimliğinden çözülür; çalışma ağacındaki musteri.json bir beyandır.',
        ], 1);
      }
      console.log(`  ✓ paket "${kod}" kanalının (app-update.yml · updater önbelleği · exe adı)`);
      return;
    }
    dur(`bilinmeyen komut: ${komut ?? '(yok)'}`, ['kanal <kod> · panel-paketle <kod> · panel-yayin <kod> <dizin>'], 2);
  } catch (e) {
    if (e instanceof Olculemedi) dur(`ÖLÇÜLEMEDİ — ${e.message}`, ['Ölçülemeyen kapı geçmiş kapı değildir: DUR.'], 2);
    if (e?.satirlar) dur(e.message, e.satirlar, 1);
    dur(`beklenmeyen hata: ${e?.stack ?? e}`, [], 2);
  }
}

main(process.argv.slice(2));
