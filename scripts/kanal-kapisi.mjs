#!/usr/bin/env node
// =============================================================================
// KANAL KAPISI — kabuk yayın betikleri için CLI (yüklemler scripts/lib/kanallar.mjs)
// =============================================================================
// Çıkış: 0 geçti · 1 KIRMIZI · 2 ÖLÇÜLEMEDİ — sıfır-dışı her çıkış DURDURUR.
//
//   node scripts/kanal-kapisi.mjs kanal <kod>                      # kayıtlı mı
//   node scripts/kanal-kapisi.mjs panel-paketle <kod>              # kayıtlı mı + ağaç dinlenmede + kimlik kaynağı kanal
//   node scripts/kanal-kapisi.mjs panel-derleme <kod>              # electron-builder `-c.*` kimlik argümanları (satır başına bir)
//   node scripts/kanal-kapisi.mjs backend-paketle <kod>          # kayıtlı mı + backend bloğu (pm2Ad/urunAdi/guvenCapasi) → KEY=VALUE
//   node scripts/kanal-kapisi.mjs panel-yayin <kod> <paket dizini> # paket (release/<kod>/<sürüm>) bu kanalın mı
//   node scripts/kanal-kapisi.mjs terfi <kod> <panel|tablet> <sürüm> [--kuru] [--terfi-atla=<cümle>]  # K5 (scripts/lib/terfi.mjs)
//   node scripts/kanal-kapisi.mjs terfi-atla-kaydi <kod> <panel|tablet> <sürüm> <cümle>             # kaçışın etiketi (best-effort)
//   node scripts/kanal-kapisi.mjs panel-capa [<kod> <paket dizini>]  # panel imza çapası dolu/üretim biçiminde (+ pakete gömülü)
//   node scripts/kanal-kapisi.mjs panel-imza <kod> <paket dizini>    # latest.yml künyesi panelin kabul edeceği künye mi
//   node scripts/kanal-kapisi.mjs panel-rotasyon <kod> <paket dizini> <yayındaki latest.yml dosyası>  # imzalayan, yayındakinin çapasında
//   node scripts/kanal-kapisi.mjs panel-imza-uzak <kod> <latest.yml dosyası>                          # kenardan okunan künye
//   panel-imza · panel-imza-uzak ek çıkış: 3 = İMZASIZ (imza aracıyla imzalanabilir; yüklenmez)
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
  VENDOR_URL_REL,
  backendPaketleAyarlari,
  dosyalariOku,
  kanalCoz,
  panelArtefaktFarki,
  panelArtefaktKimligi,
  panelDerlemeArgumanlari,
  panelIsaretciFarki,
  panelKaynakFarki,
  panelSabitKimlikFarki,
  varsayilanLisansSunucusu,
} from './lib/kanallar.mjs';
import { cumleDenetle, terfiAtlaKaydi, terfiKapisi, terfiRaporu } from './lib/terfi.mjs';
import fs from 'node:fs';

// Panel künye kapısı GECİKMELİ yüklenir: panel komutları dışındaki her komut (kanal · terfi · backend…) panelin
// doğrulayıcı modüllerine (Electron/electron/guncelleme/) bağlı kalmasın — o komutları kopyalayan bekçiler de.
const panelImzaKapisi = () => import('./lib/panel-imza-kapisi.mjs');
import { yayinBildirVeBas } from './lib/yayin-bildirim.mjs';

function dur(baslik, satirlar, kod) {
  console.error(`\n  ✖ ${baslik}`);
  for (const s of satirlar ?? []) console.error(`    ${s}`);
  console.error('');
  process.exit(kod);
}

/** Gömülecek çapa + (paket dizini verilmişse) pakete gerçekten gömülmüş mü — boş çapa paketlenmez/yayınlanmaz. */
async function panelCapaDenetle(kod, dizin) {
  const { panelCapaFarki, panelCapaPaketFarki, panelCapasi } = await panelImzaKapisi();
  const liste = panelCapasi();
  const f = panelCapaFarki(liste);
  if (!f.length && kod && dizin) f.push(...panelCapaPaketFarki(panelArtefaktKimligi(dizin).anaSurec, liste));
  if (f.length) {
    dur('PANEL İMZA ÇAPASI KULLANILAMAZ — paket hiçbir güncellemeyi doğrulayamaz (çıkışsız kapı)', [
      ...f,
      'Anahtar kararı + çapa: cd Teks-Erp && npx tsx scripts/guven-capasi-ekle.ts panel … (docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md §İmzalı künye).',
    ], 1);
  }
  return liste;
}

/** Async panel komutları (künye dosya özeti akışla ölçülür). */
async function panelKomutu(komut, [kod, dizin, ek]) {
  const { panelCapasi, panelKunyeDenetimi, panelRotasyonDenetimi, panelUzakKunyeDenetimi } = await panelImzaKapisi();
  if (komut === 'panel-capa') {
    if (kod) kanalCoz(kod);
    const liste = await panelCapaDenetle(kod, dizin);
    return void console.log(`  ✓ panel imza çapası: ${liste.map((k) => k.kid).join(', ')}${dizin ? ' · pakete gömülü' : ''}`);
  }
  kanalCoz(kod);
  if (komut === 'panel-imza') {
    if (!dizin) dur('panel-imza: paket dizini verilmedi', [], 2);
    const liste = await panelCapaDenetle(kod, dizin);
    const h = await panelKunyeDenetimi({ kod, dizin, liste });
    if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
    dur(h.sonuc === 'imzasiz' ? 'PANEL KÜNYESİ İMZASIZ — yüklenmez' : 'PANEL KÜNYESİ GEÇERSİZ — yüklenmez', [
      ...h.satirlar,
      'İmza denetleyen panel bu latest.yml\'i REDDEDER ve güncellemesiz kalır.',
    ], h.sonuc === 'imzasiz' ? 3 : 1);
  }
  if (komut === 'panel-rotasyon') {
    if (!dizin || !ek) dur('panel-rotasyon: <kod> <paket dizini> <yayındaki latest.yml> gerekli', [], 2);
    const liste = await panelCapaDenetle(kod, dizin);
    const yerel = await panelKunyeDenetimi({ kod, dizin, liste });
    if (yerel.sonuc !== 'uyumlu') dur('panel-rotasyon: paketin künyesi geçerli değil', yerel.satirlar, 1);
    const h = panelRotasyonDenetimi({ yayindaki: fs.readFileSync(ek, 'utf8'), yeniKid: yerel.kid });
    if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
    dur('ROTASYON KİLİDİ — sahadaki paneller bu imzayı tanımaz, yüklenmez', h.satirlar, 1);
  }
  if (komut === 'panel-imza-uzak') {
    if (!dizin) dur('panel-imza-uzak: latest.yml dosyası verilmedi', [], 2);
    const h = panelUzakKunyeDenetimi({ kod, metin: fs.readFileSync(dizin, 'utf8'), liste: panelCapasi() });
    if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
    dur(h.sonuc === 'imzasiz' ? 'YAYINDAKİ KÜNYE İMZASIZ' : 'YAYINDAKİ KÜNYE GEÇERSİZ', h.satirlar, h.sonuc === 'imzasiz' ? 3 : 1);
  }
}

const PANEL_KOMUTLARI = new Set(['panel-capa', 'panel-imza', 'panel-rotasyon', 'panel-imza-uzak']);

function hataDur(e) {
  if (e instanceof Olculemedi) dur(`ÖLÇÜLEMEDİ — ${e.message}`, ['Ölçülemeyen kapı geçmiş kapı değildir: DUR.'], 2);
  if (e?.satirlar) dur(e.message, e.satirlar, 1);
  dur(`beklenmeyen hata: ${e?.stack ?? e}`, [], 2);
}

function main(argv) {
  const [komut, kod, dizin] = argv;
  if (PANEL_KOMUTLARI.has(komut)) {
    panelKomutu(komut, argv.slice(1)).catch(hataDur);
    return;
  }
  try {
    if (komut === 'kanal') {
      const { kanal } = kanalCoz(kod);
      console.log(`  ✓ kanal "${kod}" (${kanal.tur}) kayıtlı`);
      return;
    }
    if (komut === 'panel-paketle') {
      // Kimlik derleme ANINDA enjekte edilir; ağaç yalnız ezilen TABANDIR ve dinlenmede olmalı.
      const { kayit, kanal } = kanalCoz(kod);
      const vk = kayit.varsayilan;
      const d = dosyalariOku(PANEL_SABIT_DOSYALAR);
      const f = [
        ...panelSabitKimlikFarki(kayit.kanallar[vk], d).map((x) => `dinlenme ("${vk}"): ${x}`),
        ...panelIsaretciFarki(vk, kayit.kanallar[vk], d).map((x) => `dinlenme ("${vk}"): ${x}`),
        ...panelKaynakFarki(kayit, d),
      ];
      if (f.length) {
        dur(`AĞAÇ "${kod}" KANALI İÇİN PAKETLENEMEZ — kimlik kaynağı kanal değil ya da ağaç dinlenmede değil`, [
          ...f,
          'Paketleme kimliği ağaca YAZMAZ, derleme anında enjekte eder; literal kimlik taşıyan kaynak o enjeksiyonu',
          'göremez ve paket başka kanalın kimliğiyle doğar (aynı makinede o kanalın kurulumu/verisi/güncelleyicisi).',
        ], 1);
      }
      console.log(`  ✓ kanal "${kod}" (${kanal.tur}) · ağaç dinlenmede ("${vk}") · kimlik derlemede kanaldan`);
      return;
    }
    if (komut === 'backend-paketle') {
      // Backend paketinin (paketle.ps1 -Musteri <kod>) kanal kimliği. kanalCoz →
      // kayitHatalari backend bloğunu (urunAdi/pm2Ad) da doğrular (eksikse KIRMIZI).
      // Backend'in HTTP yayın feed'i YOK (Faz 3'e kadar) → burada TERFİ yok, yalnız
      // kimlik. Çıktı KEY=VALUE (paketle.ps1 ecosystem env'ine + PAKET.json'a yazar).
      const { kanal } = kanalCoz(kod);
      // Backend'in varsayılan lisans satıcısı derlenen ağaçtan (vendor-url.ts, TEK kaynak); okunamazsa paket kimliksiz doğmaz.
      const lisansVarsayilan = varsayilanLisansSunucusu(dosyalariOku([VENDOR_URL_REL])[VENDOR_URL_REL]);
      if (!lisansVarsayilan) dur(`backend-paketle: ${VENDOR_URL_REL} DEFAULT_LICENSE_SERVER_URL okunamadı`, [], 2);
      const ayar = backendPaketleAyarlari(kod, kanal, lisansVarsayilan);
      for (const [k, v] of Object.entries(ayar)) console.log(`${k}=${v}`);
      return;
    }
    if (komut === 'panel-derleme') {
      const { kanal } = kanalCoz(kod);
      for (const a of panelDerlemeArgumanlari(kod, kanal)) console.log(a);
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
      console.log(`  ✓ paket "${kod}" kanalının (app-update.yml · updater önbelleği · exe adı · paketin package.json'ı · ana süreç/arayüz kimliği)`);
      return;
    }
    if (komut === 'terfi') {
      const [, , urun, surum, ...ek] = argv;
      const bilinmeyen = ek.filter((a) => a !== '--kuru' && a !== '--terfi-atla' && !a.startsWith('--terfi-atla='));
      if (bilinmeyen.length) dur(`terfi: tanınmayan argüman: ${bilinmeyen.join(' ')}`, [], 2);
      const atlaArg = ek.find((a) => a === '--terfi-atla' || a.startsWith('--terfi-atla='));
      const atla = atlaArg === undefined ? undefined : atlaArg.slice('--terfi-atla='.length);
      const h = terfiKapisi({ kod, urun, surum, atla, kuru: ek.includes('--kuru') });
      const satirlar = terfiRaporu(h, { kod, urun, surum });
      if (h.sonuc === 'uyumlu') {
        for (const s of satirlar) console.log(`  ${s}`);
        return;
      }
      dur(satirlar[0].replace(/^✖ /, ''), [
        ...satirlar.slice(1).map((s) => s.trim()),
        h.sonuc === 'ihlal' ? 'Akış: hazırlık kanalı → test → kullanıcının onayı (terfi etiketi) → git checkout --detach <ürün>-vX → bu komut.' : null,
        h.sonuc === 'ihlal' ? 'Acil kaçış yalnız kullanıcının cümlesiyle: --terfi-atla="<cümle>" (yayın defterine + etiket mesajına yazılır).' : null,
      ].filter(Boolean), h.sonuc === 'olculemedi' ? 2 : 1);
    }
    if (komut === 'terfi-atla-kaydi') {
      const [, , urun, surum, cumle] = argv;
      const c = cumleDenetle(cumle);
      if (!c.gecerli) dur(`terfi-atla-kaydi: ${c.sebep}`, [], 1);
      const t = terfiAtlaKaydi({ kod, urun, surum, cumle: c.cumle });
      const mesaj = {
        atildi: `  ✓ terfi atlama kaydı (etiket) atıldı: ${t.ad}`,
        'zaten-var': `  · terfi etiketi zaten var: ${t.ad} (dokunulmadı)`,
        basarisiz: `  ⚠️ terfi atlama etiketi atılamadı: ${t.ad} (yayın etkilenmedi; kayıt yayın defterinde)`,
      }[t.durum];
      console.log(mesaj + (t.not ? ` — ${t.not}` : ''));
      // Portala terfi atlama bildirimi (Faz 3d) — kayıttan SONRA, best-effort: yardımcı fırlatmaz, süreç sonucu değişmez.
      void yayinBildirVeBas({ olay: 'TERFI_ATLANDI', urun, kanal: kod, surum, ayrinti: { cumle: c.cumle, etiket: t.ad } });
      return;
    }
    dur(`bilinmeyen komut: ${komut ?? '(yok)'}`, ['kanal <kod> · panel-paketle <kod> · backend-paketle <kod> · panel-derleme <kod> · panel-yayin <kod> <dizin> · terfi <kod> <ürün> <sürüm> · terfi-atla-kaydi <kod> <ürün> <sürüm> <cümle> · panel-capa [<kod> <dizin>] · panel-imza <kod> <dizin> · panel-rotasyon <kod> <dizin> <dosya> · panel-imza-uzak <kod> <dosya>'], 2);
  } catch (e) {
    hataDur(e);
  }
}

main(process.argv.slice(2));
