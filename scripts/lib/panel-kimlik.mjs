// =============================================================================
// PANEL ORTAK KİMLİĞİ — dinlenme tabanı · derleme argümanları · paketten geri okuma (tek ortak paket O5)
// =============================================================================
// Kimliğin tek kaynağı `deploy/dagitim.json` (`panelKimligi`, scripts/lib/dagitim.mjs). Ağaçtaki
// `Electron/package.json` o kimliğin dinlenme tabanıdır; paketleme aynı değerleri electron-builder'a
// `-c.*` ile yeniden verir ve derlenen paketin İÇİNİ okuyup kimliği doğrular.
// Paket okuyucu (`panelArtefaktKimligi`) ve literal yüklemi eski kanal kitaplığından alınır — O15'te
// bu dosyaya taşınır. Eski kanal kaydı yalnız OKUNUR: ortak paket hiçbir eski kanalın kimliğini taşımaz.
// Bekçi: scripts/test_panel_kimlik.mjs · CLI: scripts/panel-kimlik-kapisi.mjs
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { KAYIT_REL, ESKI_KAYIT_REL, Olculemedi, kayitHatalari, panelKimligi, KOK } from './dagitim.mjs';
import { tirnakliGecer } from './kanallar.mjs';

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
  return f;
}

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
