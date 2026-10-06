#!/usr/bin/env node
// =============================================================================
// GRUP YAYIN KAPISI — `deploy/electron-grup-yayinla.sh` için CLI (yüklem: scripts/lib/grup-yayin.mjs)
// =============================================================================
// Çıkış: 0 geçti · 1 KIRMIZI · 2 ÖLÇÜLEMEDİ — sıfır-dışı her çıkış yayını DURDURUR.
//
//   node scripts/grup-yayin-kapisi.mjs grup <grup>                          # kayıtlı grup mu, eski kanal kodu DEĞİL mi
//   node scripts/grup-yayin-kapisi.mjs hedef <grup> <panel|tablet|backend>  # hedef KAYITTAN → KEY=VALUE; ortam ezmesi = DUR
//   node scripts/grup-yayin-kapisi.mjs terfi <grup> <ürün> <sürüm> [--dizin=<ortak paket>] [--kuru] [--terfi-atla=<cümle>]
//   node scripts/grup-yayin-kapisi.mjs derleme-bagi <ortak paket dizini> <sürüm>   # künye ↔ exe ↔ asar ↔ HEAD (grup-nötr)
//   node scripts/grup-yayin-kapisi.mjs hazirla <grup> <ortak paket dizini> <sürüm> # grup künye dizini → stdout
//   node scripts/grup-yayin-kapisi.mjs capa <ortak paket dizini>            # panel imza çapası dolu + pakete gömülü
//   node scripts/grup-yayin-kapisi.mjs imza <grup> <grup dizini>            # künye (kanal = GRUP) panelin kabul edeceği künye mi (3 = imzasız)
//   node scripts/grup-yayin-kapisi.mjs rotasyon <grup> <grup dizini> <yayındaki latest.yml>
//   node scripts/grup-yayin-kapisi.mjs imza-uzak <grup> <latest.yml>        # kenardan okunan künye (3 = imzasız)
//   node scripts/grup-yayin-kapisi.mjs surum-etiketi <ürün> <sürüm> [<grup> <kaçış cümlesi>]  # yayın sonrası, best-effort
//   node scripts/grup-yayin-kapisi.mjs terfi-atla-kaydi <grup> <ürün> <sürüm> <cümle>
//
// ⚠️ KOŞULSUZ `main()`: "doğrudan mı çalıştırıldım" tespiti macOS sembolik bağında susup 0 döndürürdü (fail-open).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { Olculemedi as DagitimOlculemedi, terfiKaynagi } from './lib/dagitim.mjs';
import { PANEL_KUNYE_ADI, derlemeBagiDenetimi, derlemeKunyesiOku, dosyaOzeti } from './lib/derleme-bagi.mjs';
import { GrupIhlali, grupCoz, grupDizini, grupHedefi, grupTerfiKapisi } from './lib/grup-yayin.mjs';
import { Olculemedi, panelArtefaktKimligi } from './lib/kanallar.mjs';
import { etiketAt } from './lib/surum.mjs';
import { cumleDenetle, terfiAtlaKaydi, terfiAtlaMesaji, terfiRaporu } from './lib/terfi.mjs';
import { ezmeSatirlari, yayinEzmeleri } from './lib/yayin-hedefi.mjs';

// Panel künye kapısı panelin doğrulayıcı modüllerine bağlıdır; yalnız künye komutlarında yüklenir.
const panelImzaKapisi = () => import('./lib/panel-imza-kapisi.mjs');

function dur(baslik, satirlar, kod) {
  console.error(`\n  ✖ ${baslik}`);
  for (const s of satirlar ?? []) console.error(`    ${s}`);
  console.error('');
  process.exit(kod);
}

function hataDur(e) {
  if (e instanceof Olculemedi || e instanceof DagitimOlculemedi) dur(`ÖLÇÜLEMEDİ — ${e.message}`, ['Ölçülemeyen kapı geçmiş kapı değildir: DUR.'], 2);
  if (e?.satirlar) dur(e.message, e.satirlar, 1);
  dur(`beklenmeyen hata: ${e?.stack ?? e}`, [], 2);
}

/** Gömülecek çapa dolu mu; paket dizini verilmişse ana sürece gerçekten gömülmüş mü (boş çapalı panel yayınlanmaz). */
async function capaDenetle(dizin) {
  const { panelCapaFarki, panelCapaPaketFarki, panelCapasi } = await panelImzaKapisi();
  const liste = panelCapasi();
  const f = panelCapaFarki(liste);
  if (!f.length && dizin) f.push(...panelCapaPaketFarki(panelArtefaktKimligi(dizin).anaSurec, liste));
  if (f.length) dur('PANEL İMZA ÇAPASI KULLANILAMAZ — paket hiçbir güncellemeyi doğrulayamaz (çıkışsız kapı)', f, 1);
  return liste;
}

const secenek = (ek, ad) => {
  const a = ek.find((x) => x === `--${ad}` || x.startsWith(`--${ad}=`));
  return a === undefined ? undefined : a.includes('=') ? a.slice(a.indexOf('=') + 1) : '';
};

async function main(argv) {
  const [komut, ...r] = argv;
  try {
    if (komut === 'grup') {
      grupCoz(r[0]);
      return void console.log(`  ✓ grup "${r[0]}" kayıtlı (deploy/dagitim.json) ve eski kanal kodu değil`);
    }
    if (komut === 'hedef') {
      // Kabuk yükleyici hedefi buradan alır; ortamı bu süreç miras aldığı için ezme burada görülür.
      const ezmeler = yayinEzmeleri({ env: process.env });
      if (ezmeler.length) dur('YAYIN HEDEFİ EZİLEMEZ — hiçbir şey yüklenmedi', ezmeSatirlari(ezmeler).map((s) => s.replace('deploy/kanallar.json kaydından', 'deploy/dagitim.json kaydından')), 1);
      const h = grupHedefi(r[0], r[1]);
      const kaynak = terfiKaynagi(grupCoz(r[0]).kayit, r[0]) ?? '-';
      for (const [k, v] of [['SSH_HEDEF', h.ssh], ['UZAK_DIZIN', h.vds], ['YAYIN_URL', h.feed], ['DEFTER', h.defter], ['TERFI_KAYNAGI', kaynak]]) console.log(`${k}=${v}`);
      return;
    }
    if (komut === 'terfi') {
      const [grup, urun, surum, ...ek] = r;
      const bilinmeyen = ek.filter((a) => a !== '--kuru' && !a.startsWith('--dizin=') && a !== '--terfi-atla' && !a.startsWith('--terfi-atla='));
      if (bilinmeyen.length) dur(`terfi: tanınmayan argüman: ${bilinmeyen.join(' ')}`, [], 2);
      const h = grupTerfiKapisi({ grup, urun, surum, atla: secenek(ek, 'terfi-atla'), kuru: ek.includes('--kuru'), dizin: secenek(ek, 'dizin') });
      const satirlar = terfiRaporu(h, { kod: grup, urun, surum });
      if (h.sonuc === 'uyumlu') {
        for (const s of satirlar) console.log(`  ${s}`);
        return;
      }
      dur(satirlar[0].replace(/^✖ /, ''), [
        ...satirlar.slice(1).map((s) => s.trim()),
        h.sonuc === 'ihlal' ? 'Akış: kaynak grup → test → kullanıcının onayı (terfi/<grup>/<ürün>-vX etiketi) → git checkout --detach <ürün>-vX → bu komut.' : null,
        h.sonuc === 'ihlal' ? 'Acil kaçış yalnız kullanıcının cümlesiyle: --terfi-atla="<cümle>" (yayın defterine + etiket mesajına yazılır).' : null,
      ].filter(Boolean), h.sonuc === 'olculemedi' ? 2 : 1);
    }
    if (komut === 'derleme-bagi') {
      const [dizin, surum] = r;
      if (!dizin || !surum) dur('derleme-bagi: <ortak paket dizini> <sürüm> gerekli', [], 2);
      const kunyeYolu = path.join(dizin, PANEL_KUNYE_ADI);
      const h = derlemeBagiDenetimi({
        kunye: derlemeKunyesiOku(kunyeYolu), kunyeYolu,
        beklenen: { urun: 'panel', kanal: null, surum },
        ozet: dosyaOzeti(path.join(dizin, `TeksERP-${surum}-Setup.exe`)),
        gomuluCommit: panelArtefaktKimligi(dizin).paket.gitCommit,
        terfiUrunu: null,
      });
      if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
      dur(h.sonuc === 'olculemedi' ? 'ÖLÇÜLEMEDİ — derleme bağı' : 'DERLEME BAĞI KOPUK — yüklenen bayt HEAD\'e bağlanmıyor', h.satirlar, h.sonuc === 'olculemedi' ? 2 : 1);
    }
    if (komut === 'hazirla') {
      const [grup, dizin, surum] = r;
      grupCoz(grup);
      if (!dizin || !surum) dur('hazirla: <grup> <ortak paket dizini> <sürüm> gerekli', [], 2);
      return void console.log(grupDizini(dizin, grup, { surum }));
    }
    if (komut === 'capa') {
      const liste = await capaDenetle(r[0]);
      return void console.log(`  ✓ panel imza çapası: ${liste.map((k) => k.kid).join(', ')}${r[0] ? ' · pakete gömülü' : ''}`);
    }
    if (komut === 'imza' || komut === 'rotasyon' || komut === 'imza-uzak') {
      const [grup, dizin, ek] = r;
      grupCoz(grup);
      if (!dizin) dur(`${komut}: dizin/dosya verilmedi`, [], 2);
      const { panelCapasi, panelKunyeDenetimi, panelRotasyonDenetimi, panelUzakKunyeDenetimi } = await panelImzaKapisi();
      if (komut === 'imza') {
        const h = await panelKunyeDenetimi({ kod: grup, dizin, liste: await capaDenetle(null) });
        if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
        dur(h.sonuc === 'imzasiz' ? 'PANEL KÜNYESİ İMZASIZ — yüklenmez' : 'PANEL KÜNYESİ GEÇERSİZ — yüklenmez', [
          ...h.satirlar,
          `İmza denetleyen panel künyenin kanalını KENDİ grubuyla ("${grup}") eşler ve bu latest.yml'i REDDEDER.`,
        ], h.sonuc === 'imzasiz' ? 3 : 1);
      }
      if (komut === 'rotasyon') {
        if (!ek) dur('rotasyon: <grup> <grup dizini> <yayındaki latest.yml> gerekli', [], 2);
        const yerel = await panelKunyeDenetimi({ kod: grup, dizin, liste: await capaDenetle(null) });
        if (yerel.sonuc !== 'uyumlu') dur('rotasyon: paketin künyesi geçerli değil', yerel.satirlar, 1);
        const h = panelRotasyonDenetimi({ yayindaki: fs.readFileSync(ek, 'utf8'), yeniKid: yerel.kid });
        if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
        dur('ROTASYON KİLİDİ — sahadaki paneller bu imzayı tanımaz, yüklenmez', h.satirlar, 1);
      }
      const h = panelUzakKunyeDenetimi({ kod: grup, metin: fs.readFileSync(dizin, 'utf8'), liste: panelCapasi() });
      if (h.sonuc === 'uyumlu') return void console.log(`  ✓ ${h.satirlar[0]}`);
      dur(h.sonuc === 'imzasiz' ? 'YAYINDAKİ KÜNYE İMZASIZ' : 'YAYINDAKİ KÜNYE GEÇERSİZ', h.satirlar, h.sonuc === 'imzasiz' ? 3 : 1);
    }
    if (komut === 'surum-etiketi') {
      const [urun, surum, grup, cumle] = r;
      const c = cumle ? cumleDenetle(cumle).cumle : '';
      const s = etiketAt(urun, surum, c ? { mesaj: terfiAtlaMesaji({ kod: grup, urun, surum, cumle: c }) } : {});
      const m = {
        atildi: `  ✓ sürüm etiketi atıldı: ${s.ad}`,
        'zaten-var': `  · sürüm etiketi zaten var: ${s.ad} (aynı tur)`,
        basarisiz: `  ⚠️ sürüm etiketi atılamadı: ${s.ad} (yayın etkilenmedi)`,
      }[s.durum];
      return void console.log(m + (s.not ? ` — ${s.not}` : ''));
    }
    if (komut === 'terfi-atla-kaydi') {
      const [grup, urun, surum, cumle] = r;
      grupCoz(grup);
      const c = cumleDenetle(cumle);
      if (!c.gecerli) dur(`terfi-atla-kaydi: ${c.sebep}`, [], 1);
      const t = terfiAtlaKaydi({ kod: grup, urun, surum, cumle: c.cumle });
      const m = {
        atildi: `  ✓ terfi atlama kaydı (etiket) atıldı: ${t.ad}`,
        'zaten-var': `  · terfi etiketi zaten var: ${t.ad} (dokunulmadı)`,
        basarisiz: `  ⚠️ terfi atlama etiketi atılamadı: ${t.ad} (yayın etkilenmedi; kayıt yayın defterinde)`,
      }[t.durum];
      return void console.log(m + (t.not ? ` — ${t.not}` : ''));
    }
    dur(`bilinmeyen komut: ${komut ?? '(yok)'}`, ['grup · hedef · terfi · derleme-bagi · hazirla · capa · imza · rotasyon · imza-uzak · surum-etiketi · terfi-atla-kaydi'], 2);
  } catch (e) {
    if (e instanceof GrupIhlali) dur(e.message, e.satirlar, 1);
    hataDur(e);
  }
}

main(process.argv.slice(2));
