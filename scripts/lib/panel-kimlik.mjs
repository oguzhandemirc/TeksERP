// =============================================================================
// PANEL ORTAK KİMLİĞİ — dinlenme tabanı · derleme argümanları · paketten geri okuma (tek ortak paket O5)
// =============================================================================
// Kimliğin tek kaynağı `deploy/dagitim.json` (`panelKimligi`, scripts/lib/dagitim.mjs). Ağaçtaki
// `Electron/package.json` o kimliğin dinlenme tabanıdır; paketleme aynı değerleri electron-builder'a
// `-c.*` ile yeniden verir ve derlenen paketin İÇİNİ okuyup kimliği doğrular.
// Paket okuyucu (`panelArtefaktKimligi`) ve literal yüklemi (`tirnakliGecer`) bu dosyadadır.
// Eski kanal kaydı yalnız OKUNUR: ortak paket hiçbir eski kanalın kimliğini taşımaz.
// Bekçi: scripts/test_panel_kimlik.mjs · CLI: scripts/panel-kimlik-kapisi.mjs
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { KAYIT_REL, ESKI_KAYIT_REL, Olculemedi, kayitHatalari, panelKimligi, KOK } from './dagitim.mjs';

export const PANEL_PAKET_REL = 'Electron/package.json';
export const PANEL_ISARETCI_REL = 'Electron/shared/musteri.json';
export const PANEL_MAIN_REL = 'Electron/electron/main.ts';
export const PANEL_KIMLIK_COZUCU_REL = 'Electron/build-identity.ts';

/** Dinlenme ölçümünün okuduğu dosyalar (olmayan dosya `undefined` kalır — işaretçi için beklenen budur). */
export const PANEL_DINLENME_DOSYALARI = Object.freeze([
  KAYIT_REL, ESKI_KAYIT_REL, PANEL_PAKET_REL, PANEL_ISARETCI_REL, PANEL_MAIN_REL, PANEL_KIMLIK_COZUCU_REL,
]);

/** Bekçinin ve CLI'nin dosyaları — commit tetiği bunları + okunan dosyaları kapsar. */
export const PANEL_KIMLIK_BEKCI_DOSYALARI = Object.freeze([
  ...PANEL_DINLENME_DOSYALARI, 'scripts/lib/panel-kimlik.mjs', 'scripts/lib/dagitim.mjs', 'scripts/panel-kimlik-kapisi.mjs',
  'scripts/test_panel_kimlik.mjs', 'deploy/electron-paketle.sh', 'scripts/hooks/pre-commit.mjs',
]);
export const panelKimlikTetigi = (rel) => PANEL_KIMLIK_BEKCI_DOSYALARI.includes(rel);

function jsonOku(dosyalar, rel) {
  if (typeof dosyalar[rel] !== 'string') throw new Olculemedi(`${rel} okunamadı`);
  try {
    return JSON.parse(dosyalar[rel]);
  } catch (e) {
    throw new Olculemedi(`${rel} ayrıştırılamadı: ${e.message}`);
  }
}

/** Dağıtım kaydından panel kimliği; kayıt geçersizse Olculemedi (kimliksiz paket doğmaz). */
export function ortakKimlik(dosyalar) {
  const kayit = jsonOku(dosyalar, KAYIT_REL);
  const h = kayitHatalari(kayit);
  if (h.length) throw new Olculemedi(`${KAYIT_REL} geçersiz: ${h[0]}`);
  return panelKimligi(kayit);
}

const fark = (f, neresi, gercek, beklenen) => {
  if (gercek !== beklenen) f.push(`${neresi} = ${JSON.stringify(gercek)} — ortak kimlik ${JSON.stringify(beklenen)} bekliyor`);
};

/**
 * Ağaç dinlenmede mi: package.json tabanı = ortak kimlik, müşteri işaretçisi yok, ana süreç kimliği
 * literal taşımaz (kimlik `@shared/channel`dan), kimlik çözücü dağıtım kaydını okur.
 */
export function panelDinlenmeFarki(dosyalar) {
  const k = ortakKimlik(dosyalar);
  const p = jsonOku(dosyalar, PANEL_PAKET_REL);
  const f = [];
  fark(f, `${PANEL_PAKET_REL} name`, p.name, k.paketAdi);
  fark(f, `${PANEL_PAKET_REL} productName`, p.productName, k.urunAdi);
  fark(f, `${PANEL_PAKET_REL} description`, p.description, k.aciklama);
  fark(f, `${PANEL_PAKET_REL} build.appId`, p.build?.appId, k.appId);
  fark(f, `${PANEL_PAKET_REL} build.productName`, p.build?.productName, k.urunAdi);
  fark(f, `${PANEL_PAKET_REL} build.nsis.shortcutName`, p.build?.nsis?.shortcutName, k.urunAdi);
  fark(f, `${PANEL_PAKET_REL} build.nsis.uninstallDisplayName`, p.build?.nsis?.uninstallDisplayName, k.urunAdi);
  fark(f, `${PANEL_PAKET_REL} build.publish[0].url`, p.build?.publish?.[0]?.url, k.feed);
  fark(f, `${PANEL_PAKET_REL} build.directories.output`, p.build?.directories?.output, k.cikti);
  if (dosyalar[PANEL_ISARETCI_REL] !== undefined) {
    f.push(`${PANEL_ISARETCI_REL} VAR — ortak paket müşteri işaretçisi taşımaz (kimlik dağıtım kaydından, firma adı lisanstan)`);
  }
  const main = dosyalar[PANEL_MAIN_REL];
  if (typeof main !== 'string') throw new Olculemedi(`${PANEL_MAIN_REL} okunamadı`);
  const yorumsuz = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [alan, v] of [['appId', k.appId], ['ürün adı', k.urunAdi]]) {
    if (tirnakliGecer(yorumsuz, v)) f.push(`${PANEL_MAIN_REL} ortak kimliğin ${alan} literalini taşıyor ("${v}") — kimlik @shared/channel'dan gelir`);
  }
  const cozucu = dosyalar[PANEL_KIMLIK_COZUCU_REL];
  if (typeof cozucu !== 'string') throw new Olculemedi(`${PANEL_KIMLIK_COZUCU_REL} okunamadı`);
  for (const iz of [`../${KAYIT_REL}`, 'panelKimligi']) {
    if (!cozucu.includes(iz)) f.push(`${PANEL_KIMLIK_COZUCU_REL} dağıtım kaydı izini (${iz}) taşımıyor — ortak kimlik kayıttan çözülmüyor`);
  }
  // Eski kanal yolu emekli: çözücü donuk kaydı ya da kanal ortamını yeniden okursa paket bir fabrikanın kimliğini taşıyabilir.
  for (const iz of ESKI_YOL_IZLERI) {
    if (cozucu.includes(iz)) f.push(`${PANEL_KIMLIK_COZUCU_REL} emekli eski kanal yolunun izini (${iz}) taşıyor — kimlik yalnız dağıtım kaydından`);
  }
  return f;
}

/** Emekli eski kanal yolunun derleme izleri — çözücüde GEÇMEMELİ. */
export const ESKI_YOL_IZLERI = Object.freeze([ESKI_KAYIT_REL, 'TEKSERP_KANAL']);

/** electron-builder'a derleme ANINDA verilen ortak kimlik (`-c.<anahtar>=<değer>`). */
export function panelOrtakDerlemeAyarlari(k) {
  return {
    appId: k.appId,
    productName: k.urunAdi,
    'extraMetadata.name': k.paketAdi,
    'extraMetadata.productName': k.urunAdi,
    'extraMetadata.description': k.aciklama,
    'nsis.shortcutName': k.urunAdi,
    'nsis.uninstallDisplayName': k.urunAdi,
    'publish.url': k.feed,
    'directories.output': k.cikti,
  };
}
export const panelOrtakDerlemeArgumanlari = (k) => Object.entries(panelOrtakDerlemeAyarlari(k)).map(([a, v]) => `-c.${a}=${v}`);

/**
 * Derlenen paket (`panelArtefaktKimligi` çıktısı) ↔ ortak kimlik. Boş dizi = paket ortak kimliktedir
 * ve hiçbir eski kanalın kimliğini (appId · adres · ürün adı · varsayılan sunucu · etiket) taşımaz.
 */
export function panelOrtakArtefaktFarki(k, eskiKayit, a) {
  const f = [];
  fark(f, 'paketin güncelleme adresi (app-update.yml url)', a.url, k.feed);
  fark(f, 'paketin updaterCacheDirName', a.updaterCacheDirName, `${k.paketAdi}-updater`);
  if (!a.exeler.includes(`${k.urunAdi}.exe`)) f.push(`win-unpacked içinde "${k.urunAdi}.exe" yok (bulunan: ${a.exeler.join(', ') || '-'})`);
  fark(f, 'paketin package.json name (updater önbelleği)', a.paket.name, k.paketAdi);
  fark(f, 'paketin package.json productName (çalışma anı adı · userData)', a.paket.productName, k.urunAdi);
  for (const [ne, v] of [['appId (AUMID)', k.appId], ['güncelleme adresi', k.feed]]) {
    if (!tirnakliGecer(a.anaSurec, v)) f.push(`ana süreçte (out/main/main.js) ortak kimliğin ${ne} "${v}" yok — kimlik derlemeye enjekte edilmemiş`);
  }
  const baslik = a.arayuzBasligi ?? '';
  if (baslik !== k.urunAdi) f.push(`arayüz <title> "${baslik}" — ortak kimlik "${k.urunAdi}" bekliyor`);
  const kanallar = eskiKayit && typeof eskiKayit === 'object' ? eskiKayit.kanallar : null;
  if (!kanallar || typeof kanallar !== 'object') throw new Olculemedi(`${ESKI_KAYIT_REL}: "kanallar" nesnesi yok — yabancı kimlik ölçülemedi`);
  for (const [kod, d] of Object.entries(kanallar)) {
    const yabanci = [
      ['ana süreç', a.anaSurec, 'appId', d?.panel?.appId], ['ana süreç', a.anaSurec, 'güncelleme adresi', d?.yayin?.panelFeed],
      ['ana süreç', a.anaSurec, 'ürün adı', d?.panel?.urunAdi],
      ['arayüz', a.arayuz, 'appId', d?.panel?.appId], ['arayüz', a.arayuz, 'ürün adı', d?.panel?.urunAdi],
      ['arayüz', a.arayuz, 'varsayılan sunucu', d?.panel?.erpAdresi], ['arayüz', a.arayuz, 'görünür etiket', d?.gorunurEtiket],
    ];
    for (const [yer, metin, ne, v] of yabanci) {
      if (typeof v === 'string' && v && tirnakliGecer(metin, v)) f.push(`${yer} eski "${kod}" kanalının ${ne} "${v}" değerini taşıyor — ortak paket karışık kimlikli`);
    }
    if (d?.panel?.urunAdi && baslik.includes(d.panel.urunAdi)) f.push(`arayüz <title> eski "${kod}" kanalının ürün adını taşıyor`);
  }
  return f;
}

/** Dinlenme tabanını kayıttan yazar (kimlik kayıtta değişince TEK komut): yalnız kimlik alanları. */
export function panelTabaniniYaz(kok = KOK) {
  const yol = path.join(kok, PANEL_PAKET_REL);
  const k = ortakKimlik({ [KAYIT_REL]: fs.readFileSync(path.join(kok, KAYIT_REL), 'utf8') });
  const p = JSON.parse(fs.readFileSync(yol, 'utf8'));
  p.name = k.paketAdi;
  p.productName = k.urunAdi;
  p.description = k.aciklama;
  p.build.appId = k.appId;
  p.build.productName = k.urunAdi;
  p.build.nsis.shortcutName = k.urunAdi;
  p.build.nsis.uninstallDisplayName = k.urunAdi;
  p.build.publish[0].url = k.feed;
  p.build.directories.output = k.cikti;
  fs.writeFileSync(yol, `${JSON.stringify(p, null, 2)}\n`);
  // Kilit dosyasının kök adı package.json `name`ini izler (npm ci adı kıyaslamaz; ayrışık ad yalnız kafa karıştırır).
  const kilit = path.join(path.dirname(yol), 'package-lock.json');
  if (fs.existsSync(kilit)) {
    const l = JSON.parse(fs.readFileSync(kilit, 'utf8'));
    l.name = k.paketAdi;
    if (l.packages?.['']) l.packages[''].name = k.paketAdi;
    fs.writeFileSync(kilit, `${JSON.stringify(l, null, 2)}\n`);
  }
  return k;
}

/* ------------------------------------------------------------------ *
 * Kaynak literal yüklemi ve kaynak bağ noktaları
 * ------------------------------------------------------------------ */

function yakala(dosyalar, rel, desen, neyi) {
  const m = dosyalar[rel];
  if (typeof m !== 'string') throw new Olculemedi(`${rel} okunamadı`);
  const r = desen.exec(m);
  if (!r) throw new Olculemedi(`${rel}: ${neyi} bulunamadı (yeri/biçimi değişti — bekçiyi güncelle)`);
  return r[1];
}

/** index.html `<title>` yer tutucusu — `Electron/build-identity.ts` derlemede pencere başlığıyla değiştirir. */
export const PANEL_BASLIK_YER_TUTUCU = '%TEKSERP_WINDOW_TITLE%';
const yorumsuz = (m) => m.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Metinde `değer` TIRNAKLI bir dize olarak geçiyor mu (önek/alt dize eşleşmesi değil). */
export const tirnakliGecer = (metin, deger) => new RegExp(`(["'\`])${esc(deger)}\\1`).test(metin);

/**
 * Kaynak dosyalar kimliği KANALDAN alıyor mu — hiçbir kanalın literal kimliği yok, bağ noktaları yerinde.
 * Bağ noktası bulunamazsa ÖLÇÜLEMEDİ (yer/biçim değişti); literal ya da yanlış bağ KIRMIZI.
 */
export function panelKaynakFarki(kayit, dosyalar) {
  const f = [];
  const kanallar = Object.entries(kayit?.kanallar ?? {});
  const oku = (rel) => {
    if (typeof dosyalar[rel] !== 'string') throw new Olculemedi(`${rel} okunamadı`);
    return dosyalar[rel];
  };
  const main = yorumsuz(oku('Electron/electron/main.ts'));
  if (!/setAppUserModelId\(/.test(main)) throw new Olculemedi('Electron/electron/main.ts: setAppUserModelId çağrısı bulunamadı (yeri değişti — bekçiyi güncelle)');
  if (!/\bnew BrowserWindow\(\{[\s\S]*?\btitle:/.test(main)) throw new Olculemedi('Electron/electron/main.ts: BrowserWindow `title:` bulunamadı');
  if (!/from\s+["']@shared\/channel["']/.test(main)) f.push('Electron/electron/main.ts kimliği @shared/channel\'dan almıyor');
  if (!/setAppUserModelId\(\s*APP_ID\s*\)/.test(main)) f.push('Electron/electron/main.ts setAppUserModelId kanaldan değil (`APP_ID` bekleniyor)');
  if (!/\btitle:\s*WINDOW_TITLE\s*,/.test(main)) f.push('Electron/electron/main.ts pencere başlığı kanaldan değil (`title: WINDOW_TITLE` bekleniyor)');
  if (!/"page-title-updated"[\s\S]{0,120}?preventDefault\(\)/.test(main)) {
    f.push('Electron/electron/main.ts sayfa <title>\'ının pencere başlığını ezmesini engellemiyor (`page-title-updated` → preventDefault)');
  }
  for (const [kod, k] of kanallar) {
    for (const [alan, v] of [['appId', k?.panel?.appId], ['urunAdi', k?.panel?.urunAdi]]) {
      if (typeof v === 'string' && v && tirnakliGecer(main, v)) f.push(`Electron/electron/main.ts "${kod}" kanalının ${alan} literalini taşıyor ("${v}") — kimlik kanaldan gelir`);
    }
  }
  const baslik = yakala(dosyalar, 'Electron/index.html', /<title>([^<]*)<\/title>/, '<title>');
  if (baslik !== PANEL_BASLIK_YER_TUTUCU) f.push(`Electron/index.html <title> = "${baslik}" — yer tutucu ${PANEL_BASLIK_YER_TUTUCU} bekleniyor (başlık derlemede kanaldan)`);
  const splash = yakala(dosyalar, 'Electron/resources/splash.html', /<title>([^<]*)<\/title>/, '<title>');
  for (const [kod, k] of kanallar) {
    if (k?.panel?.urunAdi && splash.includes(k.panel.urunAdi)) f.push(`Electron/resources/splash.html <title> "${kod}" kanalının ürün adını taşıyor — kanaldan bağımsız olmalı`);
  }
  if (!/from\s+["']virtual:tekserp-channel["']/.test(oku('Electron/shared/channel.ts'))) {
    f.push('Electron/shared/channel.ts kimliği derleme sanal modülünden (virtual:tekserp-channel) almıyor');
  }
  const derleme = oku('Electron/build-identity.ts');
  if (!derleme.includes(PANEL_BASLIK_YER_TUTUCU)) f.push(`Electron/build-identity.ts başlık yer tutucusu izini (${PANEL_BASLIK_YER_TUTUCU}) taşımıyor`);
  for (const iz of ESKI_YOL_IZLERI) {
    if (derleme.includes(iz)) f.push(`Electron/build-identity.ts emekli eski kanal yolunun izini (${iz}) taşıyor`);
  }
  return f;
}

/* ------------------------------------------------------------------ *
 * PANEL ARTEFAKTININ kimliği — yayıncı çalışma ağacına değil pakete bakar
 * ------------------------------------------------------------------ */

/**
 * Asar arşivinden seçilen dosyaları okur (zero-dep). Biçim: [u32 4][u32 başlık turşusu boyu]
 * [u32 yük boyu][u32 JSON boyu][JSON başlık]…; veri 8 + turşu boyundan başlar, girdi
 * `{size, offset}` (offset dize). `unpacked` girdi arşivde değildir, okunmaz.
 */
export function asarOku(yol, sec) {
  let fd;
  try {
    fd = fs.openSync(yol, 'r');
  } catch {
    throw new Olculemedi(`paket arşivi okunamadı: ${yol}`);
  }
  try {
    const bas = Buffer.alloc(16);
    if (fs.readSync(fd, bas, 0, 16, 0) !== 16 || bas.readUInt32LE(0) !== 4) throw new Error('asar başlığı değil');
    const tursu = bas.readUInt32LE(4);
    const uzunluk = bas.readUInt32LE(12);
    if (uzunluk <= 0 || uzunluk > tursu) throw new Error('başlık boyu tutarsız');
    const hb = Buffer.alloc(uzunluk);
    fs.readSync(fd, hb, 0, uzunluk, 16);
    const baslik = JSON.parse(hb.toString('utf8'));
    const taban = 8 + tursu;
    const cikti = {};
    const gez = (n, on) => {
      for (const [ad, alt] of Object.entries(n.files ?? {})) {
        const p = `${on}${ad}`;
        if (alt.files) gez(alt, `${p}/`);
        else if (sec(p) && !alt.unpacked && typeof alt.size === 'number') {
          const b = Buffer.alloc(alt.size);
          fs.readSync(fd, b, 0, alt.size, taban + Number(alt.offset));
          cikti[p] = b;
        }
      }
    };
    gez(baslik, '');
    return cikti;
  } catch (e) {
    throw new Olculemedi(`paket arşivi (${yol}) çözülemedi: ${e.message}`);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * `release/<kod>/<sürüm>` dizinindeki derlemenin kendi kimliği.
 *   · `win-unpacked/resources/app-update.yml` — güncelleme adresi + updater önbellek adı;
 *   · `win-unpacked/<ürün adı>.exe` — kurulum dizini, kısayol, görev çubuğu adı;
 *   · `resources/app.asar` → paketin package.json'ı (`name`, `productName` → userData) ile
 *     derlenmiş ana süreç/arayüz: çalışma anında KULLANILAN adres/AUMID oradadır
 *     (updater `setFeedURL`le app-update.yml'i ezer — yalnız yml'e bakan kapı kör kalırdı).
 * Aynı dizindeki Setup.exe aynı derlemenin çıktısıdır (paketleme dizini derlemeden önce siler).
 */
export function panelArtefaktKimligi(dizin) {
  const yml = path.join(dizin, 'win-unpacked', 'resources', 'app-update.yml');
  let metin;
  try {
    metin = fs.readFileSync(yml, 'utf8');
  } catch {
    throw new Olculemedi(`paketin gömülü güncelleme yapılandırması okunamadı: ${yml}`);
  }
  const satir = (ad) => {
    const r = new RegExp(`^${ad}:[ \\t]*(.+?)[ \\t\\r]*$`, 'm').exec(metin);
    return r ? r[1].replace(/^['"]|['"]$/g, '') : null;
  };
  const url = satir('url');
  const updaterCacheDirName = satir('updaterCacheDirName');
  if (!url || !updaterCacheDirName) {
    throw new Olculemedi(`${yml}: url / updaterCacheDirName satırı yok — paket kimliği çözülemedi`);
  }
  let exeler;
  try {
    exeler = fs.readdirSync(path.join(dizin, 'win-unpacked')).filter((f) => f.toLowerCase().endsWith('.exe'));
  } catch {
    throw new Olculemedi(`${path.join(dizin, 'win-unpacked')} okunamadı`);
  }
  const asarYol = path.join(dizin, 'win-unpacked', 'resources', 'app.asar');
  const icerik = asarOku(asarYol, (p) => p === 'package.json' || p === 'out/main/main.js' ||
    (p.startsWith('out/renderer/') && /\.(js|html)$/.test(p)));
  if (!icerik['package.json'] || !icerik['out/main/main.js'] || !icerik['out/renderer/index.html']) {
    throw new Olculemedi(`${asarYol}: package.json / out/main/main.js / out/renderer/index.html yok — paket kimliği çözülemedi`);
  }
  let paket;
  try {
    paket = JSON.parse(icerik['package.json'].toString('utf8'));
  } catch (e) {
    throw new Olculemedi(`${asarYol} package.json ayrıştırılamadı: ${e.message}`);
  }
  const arayuzJs = Object.keys(icerik).filter((p) => p.startsWith('out/renderer/') && p.endsWith('.js')).sort();
  return {
    url,
    updaterCacheDirName,
    exeler,
    // gitCommit: paketlemenin `-c.extraMetadata.gitCommit` ile gömdüğü derleme commit'i (G22 derleme bağı).
    paket: { name: paket.name, productName: paket.productName, gitCommit: typeof paket.gitCommit === 'string' ? paket.gitCommit : null },
    anaSurec: icerik['out/main/main.js'].toString('utf8'),
    arayuz: arayuzJs.map((p) => icerik[p].toString('utf8')).join('\n'),
    arayuzBasligi: /<title>([^<]*)<\/title>/.exec(icerik['out/renderer/index.html'].toString('utf8'))?.[1] ?? null,
  };
}
