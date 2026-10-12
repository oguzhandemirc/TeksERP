#!/usr/bin/env node
// =============================================================================
// KURULUM ARŞİVİ — müşteriye portalda TEK bağlantıyla giden TEK dosya (setup + yanındaki paketler)
// =============================================================================
// Portal bağlantısı = BİR derleme dosyası (`satici/sunucu/src/distribution/links.service.ts`); setup.exe ise
// yanında backend zip + PG zip + pg.json (+ etkili.tkpub) ister. Bu betik onları DÜZ bir zip'e koyar ve
// koymadan ÖNCE setup'ın vereceği kararları burada verir (fail-closed; DUR = arşiv bırakılmaz):
//   girdiler   her biri TEK ve VAR · adları kurulum.ps1 `GirdiCoz` desenlerine (kaynak metinden okunur) uyar ·
//              arşivdeki her desen TAM BİR dosyayla eşleşir (SHA256SUMS / BENIOKU.txt çakışmaz) · setup adı
//              sihirbazın sürüm adı (iss `OutputBaseFilename`; `-boru-sinamasi` CI sınaması RED) · PE
//   backend    ORTAK paket (O11a): PAKET.json backendKanal null · KORUMALI win-x64 (kurulum.ps1 OnKosul) · hizmet adı =
//              dağıtım kaydı (`deploy/dagitim.json`, soneksiz taban) · hizmet ikilileri zip'te · dist/server-kunye.json
//              ÜRETİM çapalı, müşteri/kurulum filigransız · PROVA değil ·
//              İMZALI: `backend-bildirim.ts ortak-dogrula` üretim çapasıyla TAM bütünlük, künye müşterisiz
//   PG         `pg-paketle.mjs --dogrula` (paket kayıtla eşit) · pg.json yükü kayıt + PG zip'in ad/boyut/sha256'sı ·
//              imzası aynı çapayla (dogrula --pg-kunye)
//   tkpub      yalnız `tkpub1:` açık anahtar, sağlaması tutar; özel anahtar (`tksec1:`) RED
//   panel      ORTAK panel kurulumu (`TeksERP-<sürüm>-Setup.exe`, Electron `artifactName`den) + grubun `latest.yml`i:
//              ad/boy/sha512 künyeyle eşit · künye kanalı bir DAĞITIM GRUBU (eski kanal kodu = kanal kimlikli panel → RED) ·
//              imza `panel-imza.ts dogrula` (gerçek çapa); `latest.yml` arşive GİRMEZ (grup adı taşır)
//   künye      arşive `ICERIK.json` (rol · ad · sürüm · boy · sha256; yalnız izinli anahtarlar — kanal/grup/müşteri YOK)
// Arşiv: kök düz (alt dizin yok), zip/exe "store", içinde SHA256SUMS (sha256sum biçimi) + BENIOKU.txt; yeniden
// açılıp her girdi SHA256SUMS'a ve kaynağa karşı ölçülür + `unzip -t`; yanında `<arşiv>.sha256`.
// `--prova`: imza kapıları UYARIYA düşer, ad `-PROVA-IMZASIZ` taşır (yapı denemesi; müşteriye verilmez).
// Test çapaları (TEKSERP_TEST_PAKET_CAPASI · TEKSERP_TEST_KOK_CAPASI) doğrulayıcıya GEÇİRİLMEZ: arşiv yalnız üretim çapasına güvenir.
// Zincir (3.9 D5): `pg-zincir.json` ya da yeniden imzalı `pg-zincir-<kid>.json` (D8) arşive setup'ın aradığı adla (pg.json)
//   girer; ad kid'i = imzalayan denetimi TS doğrulayıcısının seçim kuralındadır (tek kaynak); zincir-yalnız pakette güncelleyici
//   `paketZinciri` bilen derleme olmalı ve setup sürümü paketinkiyle aynı olmalı (setup içi Mac'ten okunamaz).
// Arşiv sürüm başına TEKTİR (müşteri/kanal/grup argümanı YOK): firma adı lisanstan, grup kiradan gelir.
//
//   node deploy/kurulum/kurulum-arsivi.mjs --setup <TeksERP-Kurulum-<sürüm>.exe> --backend <tekserp-backend-*.zip> \
//     --pg <postgresql-*.zip> --pg-kunye <pg.json> --panel <TeksERP-<v>-Setup.exe> --panel-kunye <latest.yml> \
//     [--tkpub <etkili.tkpub>] --cikti <dizin> [--prova]
//
// ÇIKIŞ: 0 arşiv hazır · 1 kapı DUR (arşiv bırakılmaz) · 2 ÖLÇÜLEMEDİ / kullanım.
// Belge: docs/ops/SATICI-KURULUM.md §14 · bekçi: node scripts/test_kurulum_arsivi.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Olculemedi as PgOlculemedi, SURUM_REL, jsonOku, sha256, surumKaydiHatalari } from '../pg/lib/pg-ornegi.mjs';
import { peImzasi, zipAc } from '../pg/lib/zip-okuyucu.mjs';
import { isaretciYuku } from '../../scripts/lib/backend-yayin.mjs';
import { Olculemedi as DepoOlculemedi, derlemeAdiHatasi, derlemeAdiKurali, kurulumArsiviAdi } from '../../scripts/lib/derleme-deposu.mjs';
import { KANAL_ADLARI_REL, KAYIT_REL as DAGITIM_REL, Olculemedi as DagitimOlculemedi, VENDOR_URL_REL, backendPaketKimligi, kayitAyristir } from '../../scripts/lib/dagitim.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEKS = path.join(KOK, 'Teks-Erp');
const PG_PAKETLE = path.join(KOK, 'deploy', 'pg', 'pg-paketle.mjs');
const KURULUM_PS1 = 'deploy/kurulum/kurulum.ps1';
const ON_OLCUM_PS1 = 'deploy/kurulum/on-olcum.ps1';
const ISS = 'deploy/kurulum/tekserp-kurulum.iss';
const OZETLER = 'SHA256SUMS';
const BENIOKU = 'BENIOKU.txt';
const ICERIK = 'ICERIK.json';
const ELECTRON_PKG = 'Electron/package.json';
const PANEL_IMZA = 'scripts/panel-imza.ts';
// kurulum.ps1 AsamaPaket'in sürüm dizini kuralı: arşiv adı ve SHA256SUMS bu sürümle doğar.
const SURUM_DESENI = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.]{1,40})?$/;
const GUVENLI_AD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const DEGERLI = ['--setup', '--backend', '--pg', '--pg-kunye', '--panel', '--panel-kunye', '--tkpub', '--cikti'];
const ZORUNLU = ['--setup', '--backend', '--pg', '--pg-kunye', '--panel', '--panel-kunye', '--cikti'];
const KULLANIM = 'Kullanım: --setup <exe> --backend <zip> --pg <zip> --pg-kunye <pg.json> --panel <TeksERP-<v>-Setup.exe> --panel-kunye <latest.yml> [--tkpub <etkili.tkpub>] --cikti <dizin> [--prova]';
/** Ortak paket ÜRETİM çapasıyla doğar (build-korumali: müşterisiz → üretim); başka kip arşive girmez. */
const ORTAK_CAPA = 'uretim';
const ZINCIR_IMZA = 'butunluk-zincir.jws';
const ZINCIR_PG_KUNYE = 'pg-zincir.json';
/** Zincirli PG künyesi adı: kid'siz ya da kid'li; tam dilbilgisi + ad kid'i = imzalayan TS seçim kuralında (`pgKunyesiDogrula`). */
const zincirPgKunyesi = (ad) => ad === ZINCIR_PG_KUNYE || (ad.startsWith(ZINCIR_PG_KUNYE.replace(/\.json$/, '-')) && ad.endsWith('.json'));
/** Güncelleyicinin künyesindeki anahtar (native/tekserp-guncelleyici `identity()`): zincirli paketi bilen derleme. */
const ZINCIR_ISARETI = 'paketZinciri';

class Dur extends Error {
  constructor(kod, mesaj, satirlar = []) {
    super(mesaj);
    this.kod = kod;
    this.satirlar = satirlar;
  }
}
const olculemedi = (m, s = []) => new Dur(2, `ÖLÇÜLEMEDİ — ${m}`, s);

// ---------------------------------------------------------------- desenler (tek kaynak: setup'ın kendi betikleri)
const metinOku = (rel) => {
  try {
    return fs.readFileSync(path.join(KOK, rel), 'utf8');
  } catch (e) {
    throw olculemedi(`${rel} okunamadı: ${e.message}`);
  }
};

/** Windows `-Filter` jokerini (büyük/küçük harf duyarsız) düzenli ifadeye çevirir. */
export function jokerDeseni(joker) {
  const govde = [...joker].map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(`^${govde}$`, 'i');
}

/**
 * Setup'ın klasörde aradığı dosya desenleri: kurulum.ps1 `GirdiCoz` üç çağrısı + on-olcum.ps1'in tkpub adı +
 * iss'in çıktı adı. Biri bulunamazsa ÖLÇÜLEMEDİ (desen buraya kopyalanmaz; setup değişirse arşiv onu izler).
 */
export function girdiDesenleri({ kurulum, onOlcum, iss }) {
  const d = {};
  for (const m of kurulum.matchAll(/GirdiCoz \$C\["paket\.(backend|pg|pgKunye)"\] "([^"]+)" "/g)) {
    if (d[m[1]] !== undefined && d[m[1]] !== m[2]) throw olculemedi(`${KURULUM_PS1}: paket.${m[1]} iki farklı desenle çözülüyor (${d[m[1]]} · ${m[2]})`);
    d[m[1]] = m[2];
  }
  for (const k of ['backend', 'pg', 'pgKunye']) if (!d[k]) throw olculemedi(`${KURULUM_PS1}: GirdiCoz paket.${k} deseni bulunamadı (yeri/biçimi değişti — kurulum-arsivi.mjs'i güncelle)`);
  const tk = [...new Set([...onOlcum.matchAll(/Join-Path \$Kaynak "([A-Za-z0-9._-]+\.tkpub)"/g)].map((m) => m[1]))];
  if (tk.length !== 1) throw olculemedi(`${ON_OLCUM_PS1}: setup'ın aradığı .tkpub adı tek değil (${tk.join(', ') || 'yok'})`);
  const cikti = [...iss.matchAll(/^OutputBaseFilename=(\S+)$/gm)].map((m) => m[1]);
  const asil = cikti.filter((c) => c.endsWith('{#KurulumSurumu}'));
  const sinama = cikti.filter((c) => !c.endsWith('{#KurulumSurumu}'));
  if (asil.length !== 1 || sinama.length !== 1 || !sinama[0].startsWith(asil[0])) throw olculemedi(`${ISS}: OutputBaseFilename iki satırı (asıl + sınama) beklenen biçimde değil: ${cikti.join(' · ') || 'yok'}`);
  const onek = asil[0].slice(0, -'{#KurulumSurumu}'.length);
  const sonek = sinama[0].slice(asil[0].length);
  return {
    backend: { joker: d.backend, desen: jokerDeseni(d.backend) },
    pg: { joker: d.pg, desen: jokerDeseni(d.pg) },
    pgKunye: { joker: d.pgKunye, desen: jokerDeseni(d.pgKunye) },
    tkpub: { joker: tk[0], desen: jokerDeseni(tk[0]) },
    setup: { onek, sonek, desen: new RegExp(`^${onek.replace(/[.+^${}()|[\]\\-]/g, '\\$&')}[0-9A-Za-z][0-9A-Za-z.+-]*\\.exe$`) },
  };
}

/** İmzalı işaretçi metninin (`{bildirim}` JSON) JWS başlığındaki kid; çözülemezse null. */
export function jwsBaslikKid(metin) {
  try {
    const b = JSON.parse(String(metin).replace(/^\uFEFF/, '')).bildirim;
    return JSON.parse(Buffer.from(String(b).split('.')[0], 'base64url').toString('utf8')).kid ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- argümanlar
export function argAyristir(argv) {
  const deger = {};
  const hatalar = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const esit = a.indexOf('=');
    const ad = esit > 0 ? a.slice(0, esit) : a;
    if (ad === '--prova' && esit < 0) {
      if (deger.prova) hatalar.push('--prova iki kez');
      deger.prova = true;
      continue;
    }
    if (ad === '--musteri') {
      hatalar.push('--musteri kalktı: kurulum arşivi ORTAKTIR (sürüm başına tek; firma adı lisanstan, grup kiradan)');
      if (esit < 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i += 1;
      continue;
    }
    if (!DEGERLI.includes(ad)) {
      hatalar.push(`bilinmeyen argüman: ${a}`);
      continue;
    }
    const v = esit > 0 ? a.slice(esit + 1) : argv[(i += 1)];
    if (v === undefined || v === '' || v.startsWith('--')) hatalar.push(`${ad} bir değer ister`);
    else if (Object.hasOwn(deger, ad)) hatalar.push(`${ad} TEK verilir (iki kez verildi)`);
    else deger[ad] = v;
  }
  for (const z of ZORUNLU) if (!deger[z] && !hatalar.some((h) => h.startsWith(z))) hatalar.push(`${z} gerekli`);
  return { deger, hatalar };
}

// ---------------------------------------------------------------- yardımcılar
/** Büyük dosyayı belleğe almadan SHA-256'lar. */
function akisOzeti(yol) {
  return new Promise((coz, red) => {
    const h = createHash('sha256');
    let boyut = 0;
    fs.createReadStream(yol)
      .on('data', (p) => {
        boyut += p.length;
        h.update(p);
      })
      .on('error', red)
      .on('end', () => coz({ sha256: h.digest('hex'), boyut }));
  });
}

const jsonBomsuz = (buf, ad) => {
  try {
    return JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Dur(1, `${ad} JSON değil: ${e.message}`);
  }
};

/** TS doğrulayıcısı (Teks-Erp/scripts/backend-bildirim.ts) — üretim çapası, test çapası ortamdan SİLİNİR. */
function tsDogrulayici(komut, argumanlar) {
  const cikti = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-arsiv-dogrula-'));
  try {
    const env = { ...process.env };
    delete env.TEKSERP_TEST_PAKET_CAPASI;
    delete env.TEKSERP_TEST_KOK_CAPASI;
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', komut, ...argumanlar, `--cikti=${cikti}`], { cwd: TEKS, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    const metin = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    if (r.error) throw olculemedi(`backend-bildirim.ts ${komut} çalıştırılamadı: ${r.error.message}`);
    if (r.status !== 0 && /ERR_MODULE_NOT_FOUND[\s\S]*['"]tsx['"]|Cannot find package 'tsx'/.test(metin)) throw olculemedi(`tsx bulunamadı (${TEKS}/node_modules) — doğrulayıcı koşamadı`);
    if (r.status !== 0) return { ok: false, neden: metin.split('\n').filter((s) => /✖|⚠|Error|hata|doğrulan|TUTMUYOR|bütünlüğü/i.test(s)).slice(-4).join(' · ') || `çıkış ${r.status}` };
    let sonuc;
    try {
      sonuc = JSON.parse(fs.readFileSync(path.join(cikti, 'sonuc.json'), 'utf8'));
    } catch (e) {
      throw olculemedi(`backend-bildirim.ts ${komut} sonucu okunamadı: ${e.message}`);
    }
    return { ok: true, sonuc, metin };
  } finally {
    fs.rmSync(cikti, { recursive: true, force: true });
  }
}

/** tkpub: ilk anlamlı satır `tkpub1:<base64url(32 bayt ‖ 4 bayt SHA-256 sağlaması)>` (backup-crypto/keys.ts). */
export function tkpubHatasi(metin) {
  if (/tksec1:/.test(metin)) return 'dosya ÖZEL anahtar (tksec1:) taşıyor — müşteri arşivine GİREMEZ';
  const satir = metin.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#'));
  if (!satir || !satir.startsWith('tkpub1:')) return 'ilk anlamlı satır "tkpub1:" ile başlamıyor';
  const govde = satir.slice('tkpub1:'.length);
  if (!/^[A-Za-z0-9_-]+$/.test(govde)) return 'base64url dışı karakter';
  const b = Buffer.from(govde, 'base64url');
  if (b.length !== 36) return `anahtar uzunluğu ${b.length} bayt (36 beklenir)`;
  if (!b.subarray(32).equals(Buffer.from(sha256(b.subarray(0, 32)), 'hex').subarray(0, 4))) return 'sağlama tutmuyor (bozuk/yanlış kopya)';
  return null;
}

// ---------------------------------------------------------------- panel
/** Panel kurulum adının deseni Electron paketinin `artifactName`inden (kopyalanmaz); sürüm yakalanır. */
export function panelAdDeseni(pkgMetni) {
  let p;
  try {
    p = JSON.parse(pkgMetni);
  } catch (e) {
    throw olculemedi(`${ELECTRON_PKG} JSON değil: ${e.message}`);
  }
  const ad = p?.build?.nsis?.artifactName ?? p?.build?.win?.artifactName;
  if (typeof ad !== 'string' || !ad.includes('${version}') || !ad.endsWith('.${ext}')) throw olculemedi(`${ELECTRON_PKG}: build.win/nsis artifactName "\${version}…\${ext}" biçiminde değil (${ad})`);
  const [on, son] = ad.slice(0, -'.${ext}'.length).split('${version}');
  const kac = (x) => x.replace(/[.+^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`^${kac(on)}([0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,6}(?:-[0-9A-Za-z.]{1,40})?)${kac(son)}\\.exe$`);
}

/** electron-builder `latest.yml`inin arşiv kararına giren alanları (tam ayrıştırıcı panelin doğrulayıcısındadır). */
export function latestYmlCoz(metin) {
  const al = (re) => re.exec(metin)?.[1]?.trim().replace(/^'(.*)'$/, '$1') ?? null;
  const yol = al(/^path: (.+)$/m);
  const sha512 = al(/^sha512: (.+)$/m);
  const boyut = Number(al(/^ {4}size: (\d+)$/m));
  const surum = al(/^version: (.+)$/m);
  const bildirim = al(/^ {2}bildirim: (\S+)$/m);
  let yuk = null;
  try {
    yuk = bildirim ? JSON.parse(Buffer.from(bildirim.split('.')[1], 'base64url').toString('utf8')) : null;
  } catch {
    yuk = null;
  }
  return { yol, sha512, boyut, surum, yuk };
}

/** Panel künyesini panelin KENDİ doğrulayıcısıyla (gerçek çapa) ölçer; test çapası geçirilmez. */
function panelDogrula({ exe, kunye, kanal }) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-arsiv-panel-'));
  try {
    fs.symlinkSync(exe.yol, path.join(dizin, exe.ad));
    fs.symlinkSync(kunye.yol, path.join(dizin, 'latest.yml'));
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('TEKSERP_TEST_')) delete env[k];
    const r = spawnSync(process.execPath, ['--import', 'tsx', PANEL_IMZA, 'dogrula', `--musteri=${kanal}`, `--dizin-paket=${dizin}`], { cwd: TEKS, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 });
    const metin = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    if (r.error) throw olculemedi(`${PANEL_IMZA} dogrula çalıştırılamadı: ${r.error.message}`);
    if (r.status !== 0 && /ERR_MODULE_NOT_FOUND[\s\S]*['"]tsx['"]|Cannot find package 'tsx'/.test(metin)) throw olculemedi(`tsx bulunamadı (${TEKS}/node_modules) — panel doğrulayıcısı koşamadı`);
    return r.status === 0 ? { ok: true, metin } : { ok: false, neden: metin.split('\n').slice(-2).join(' · ') || `çıkış ${r.status}` };
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- içerik künyesi
/** Arşivin içerik künyesinde izinli anahtarlar (OPT-IN): kanal/grup/müşteri kimliği yeni bir anahtarla SIZAMAZ. */
export const ICERIK_ANAHTARLARI = Object.freeze({ kok: Object.freeze(['v', 'tur', 'surum', 'zaman', 'dosyalar']), dosya: Object.freeze(['rol', 'ad', 'surum', 'boyut', 'sha256']) });
export const ICERIK_ROLLERI = Object.freeze(['setup', 'backend', 'pg', 'pgKunye', 'panel', 'tkpub']);

/** İçerik künyesi kapısı: yalnız izinli anahtarlar, bilinen roller, sürüm/ad/özet biçimli; ihlal listesi döner. */
export function icerikKunyesiHatalari(k) {
  const h = [];
  if (!k || typeof k !== 'object' || Array.isArray(k)) return ['künye nesne değil'];
  for (const a of Object.keys(k)) if (!ICERIK_ANAHTARLARI.kok.includes(a)) h.push(`izinsiz kök anahtarı: ${a}`);
  if (k.v !== 1 || k.tur !== 'tekserp-ilk-kurulum') h.push('v/tur beklenen değil');
  if (typeof k.surum !== 'string' || !SURUM_DESENI.test(k.surum)) h.push(`sürüm biçimsiz: ${k.surum}`);
  if (!Array.isArray(k.dosyalar) || !k.dosyalar.length) return [...h, 'dosyalar boş'];
  for (const d of k.dosyalar) {
    for (const a of Object.keys(d ?? {})) if (!ICERIK_ANAHTARLARI.dosya.includes(a)) h.push(`izinsiz dosya anahtarı: ${a}`);
    if (!ICERIK_ROLLERI.includes(d?.rol)) h.push(`bilinmeyen rol: ${d?.rol}`);
    if (typeof d?.ad !== 'string' || !GUVENLI_AD.test(d.ad)) h.push(`ad biçimsiz: ${d?.ad}`);
    if (d?.surum !== null && !(typeof d?.surum === 'string' && SURUM_DESENI.test(d.surum))) h.push(`${d?.ad}: sürüm biçimsiz`);
    if (!Number.isInteger(d?.boyut) || !/^[0-9a-f]{64}$/.test(String(d?.sha256))) h.push(`${d?.ad}: boy/özet biçimsiz`);
  }
  for (const r of ['setup', 'backend', 'pg', 'pgKunye', 'panel']) if (k.dosyalar.filter((d) => d?.rol === r).length !== 1) h.push(`rol ${r} TEK olmalı`);
  return h;
}

/** Müşterinin göreceği kısa yönerge (UTF-8 BOM + CRLF: eski Not Defteri de Türkçe harfleri doğru gösterir). */
function beniOku({ surum, setupAd, setupImzali, prova, panelAd }) {
  const s = [
    `TeksERP sunucu kurulumu — backend ${surum}${prova ? ' — PROVA (müşteriye verilmez)' : ''}`,
    '',
    '1. Önce arşivi açın: arşive sağ tıklayın → "Tümünü ayıkla..." → bir klasör seçin.',
    '   Arşivin içinden çift tıklanan kurulum programı yanındaki dosyaları göremez ve',
    '   "Kurulum klasöründe TEK tekserp-backend-*.zip olmalı (bulunan: 0)" diyerek durur.',
    `2. Çıkan klasörde ${setupAd} dosyasını çalıştırın (yönetici izni ister).`,
  ];
  if (!setupImzali) s.push('   Windows "Bilgisayarınız korundu" derse: "Ek bilgi" → "Yine de çalıştır".');
  s.push(
    '3. Klasördeki diğer dosyaları silmeyin, adlarını değiştirmeyin; hepsi aynı klasörde kalmalı.',
    `4. Yönetim paneli: ${panelAd} dosyasını paneli kullanacak her Windows bilgisayarında çalıştırın`,
    '   (sunucu kurulumu bittikten sonra; panel sunucuyu ağda kendisi bulur).',
    `5. Bütünlük (isteğe bağlı): ${OZETLER} dosyasındaki SHA-256 özetleri; içerik listesi ${ICERIK}.`,
    '',
  );
  return s.join('\r\n');
}

// ---------------------------------------------------------------- kapılar
async function denetle(arg) {
  const prova = arg.prova === true;
  const hatalar = [];
  const uyarilar = [];
  const imzaKapisi = (m) => (prova ? uyarilar : hatalar).push(prova ? `[PROVA] ${m}` : m);

  // Ortak paketin kimliği paketleyiciyle AYNI yüklemden (dağıtım kaydı); kanal kaydı okunmaz.
  let hizmetAdi;
  let gruplar = [];
  try {
    const dagitim = kayitAyristir(metinOku(DAGITIM_REL));
    gruplar = (dagitim.gruplar ?? []).map((g) => g.kod);
    hizmetAdi = backendPaketKimligi(dagitim, metinOku(VENDOR_URL_REL), metinOku(KANAL_ADLARI_REL)).TEKSERP_HIZMET_ADI;
  } catch (e) {
    if (e instanceof Dur) throw e;
    if (e instanceof DagitimOlculemedi) throw olculemedi(e.message);
    throw new Dur(1, `dağıtım kaydı: ${e.message}`);
  }
  const capa = ORTAK_CAPA;

  const desen = girdiDesenleri({ kurulum: metinOku(KURULUM_PS1), onOlcum: metinOku(ON_OLCUM_PS1), iss: metinOku(ISS) });
  let adKurali;
  try {
    adKurali = derlemeAdiKurali();
  } catch (e) {
    if (e instanceof DepoOlculemedi) throw olculemedi(e.message);
    throw e;
  }
  let kayit;
  try {
    kayit = jsonOku(SURUM_REL);
  } catch (e) {
    throw olculemedi(e instanceof PgOlculemedi ? e.message : String(e.message ?? e));
  }
  const kh = surumKaydiHatalari(kayit);
  if (kh.length) throw olculemedi(`PG sürüm kaydı kırmızı (${SURUM_REL})`, kh);

  // 1) Girdiler: TEK, VAR, düzenli dosya, boş değil, adları setup desenlerine uyar.
  const girdi = {};
  const gercek = new Map();
  for (const [anahtar, ad] of [['--setup', 'setup'], ['--backend', 'backend'], ['--pg', 'pg'], ['--pg-kunye', 'pgKunye'], ['--panel', 'panel'], ['--panel-kunye', 'panelKunye'], ['--tkpub', 'tkpub']]) {
    if (!arg[anahtar]) continue;
    const yol = path.resolve(arg[anahtar]);
    const st = fs.statSync(yol, { throwIfNoEntry: false });
    if (!st) { hatalar.push(`${anahtar} yok: ${yol}`); continue; }
    if (!st.isFile()) { hatalar.push(`${anahtar} düzenli dosya değil: ${yol}`); continue; }
    if (st.size === 0) { hatalar.push(`${anahtar} boş dosya: ${yol}`); continue; }
    const rp = fs.realpathSync(yol);
    if (gercek.has(rp)) { hatalar.push(`${anahtar} ve ${gercek.get(rp)} AYNI dosya: ${rp}`); continue; }
    gercek.set(rp, anahtar);
    const taban = path.basename(yol);
    if (!GUVENLI_AD.test(taban)) hatalar.push(`${anahtar} adı güvenli ASCII değil (boşluk/Türkçe harf/yol): "${taban}"`);
    girdi[ad] = { yol, ad: taban, boyut: st.size };
  }
  if (girdi.backend && !desen.backend.desen.test(girdi.backend.ad)) hatalar.push(`backend adı "${girdi.backend.ad}" setup deseni ${desen.backend.joker} ile eşleşmez (kurulum.ps1 GirdiCoz)`);
  if (girdi.pg && !desen.pg.desen.test(girdi.pg.ad)) hatalar.push(`PG adı "${girdi.pg.ad}" setup deseni ${desen.pg.joker} ile eşleşmez`);
  if (girdi.pgKunye && zincirPgKunyesi(girdi.pgKunye.ad)) girdi.pgKunye = { ...girdi.pgKunye, kaynakAd: girdi.pgKunye.ad, ad: desen.pgKunye.joker };
  if (girdi.pgKunye && !desen.pgKunye.desen.test(girdi.pgKunye.ad)) hatalar.push(`PG künyesinin adı "${girdi.pgKunye.ad}" — setup yalnız "${desen.pgKunye.joker}" arar`);
  if (girdi.tkpub && !desen.tkpub.desen.test(girdi.tkpub.ad)) hatalar.push(`tkpub adı "${girdi.tkpub.ad}" — setup yalnız "${desen.tkpub.joker}" arar (on-olcum.ps1)`);
  if (girdi.setup) {
    if (girdi.setup.ad.endsWith(`${desen.setup.sonek}.exe`)) hatalar.push(`"${girdi.setup.ad}" CI boru öz-sınaması (${desen.setup.sonek}) — müşteriye VERİLMEZ, asıl TeksERP-Kurulum-<sürüm>.exe gerekir`);
    else if (!desen.setup.desen.test(girdi.setup.ad)) hatalar.push(`setup adı "${girdi.setup.ad}" sihirbazın çıktı adına (${desen.setup.onek}<sürüm>.exe) uymuyor`);
  }
  const panelDeseni = panelAdDeseni(metinOku(ELECTRON_PKG));
  if (girdi.panel && !panelDeseni.test(girdi.panel.ad)) hatalar.push(`panel adı "${girdi.panel.ad}" Electron artifactName desenine (${panelDeseni.source}) uymuyor`);
  if (girdi.panel && desen.setup.desen.test(girdi.panel.ad)) hatalar.push(`panel adı "${girdi.panel.ad}" sunucu setup deseniyle çakışıyor`);
  if (hatalar.length) throw new Dur(1, `GİRDİLER (${hatalar.length})`, hatalar);

  // 2) setup.exe: Windows PE mi, Authenticode var mı (geçerliliğini Windows ölçer).
  const pe = peImzasi(fs.readFileSync(girdi.setup.yol));
  if (!pe.pe) hatalar.push(`setup bir Windows programı (PE) değil: ${girdi.setup.ad}`);
  else if (!pe.imzali) uyarilar.push('setup Authenticode imzasız — müşteride SmartScreen "Ek bilgi → Yine de çalıştır" ister (ve Akıllı Uygulama Denetimi açıksa engellenir)');

  // 3) Backend zip: PAKET.json + server-kunye.json + imzalı liste + hizmet ikilileri.
  let paket = null;
  let sKunye = null;
  let zincirYalniz = false;
  let guncelleyiciZincir = false;
  let zb;
  try {
    zb = zipAc(girdi.backend.yol);
  } catch (e) {
    if (e instanceof PgOlculemedi) throw olculemedi(`backend zip okunamadı: ${e.message}`);
    throw e;
  }
  try {
    const girdiler = new Map(zb.girdiler.map((g) => [g.ad, g]));
    const oku = (ad) => (girdiler.has(ad) ? zb.oku(girdiler.get(ad)) : null);
    const pj = oku('PAKET.json');
    if (!pj) hatalar.push('backend zip kökünde PAKET.json yok (setup "paket PAKET.json tasimiyor" der)');
    else paket = jsonBomsuz(pj, 'PAKET.json');
    const sk = oku('dist/server-kunye.json');
    if (!sk) hatalar.push('backend zip dist/server-kunye.json taşımıyor (korumalı derleme künyesi)');
    else sKunye = jsonBomsuz(sk, 'dist/server-kunye.json');
    if (paket) {
      if (paket.backendKanal !== null) hatalar.push(`ORTAK PAKET DEĞİL: paket "${paket.backendKanal}" kanalı için üretilmiş (eski kanal yolu) — ortak arşive yalnız paketle.ps1 argümansız paketi girer`);
      if (paket.korumali !== true || paket.korumaHedef !== 'win-x64') hatalar.push(`paket KORUMALI win-x64 değil (korumali=${paket.korumali}, hedef=${paket.korumaHedef}) — setup hizmet düzenine kuramaz (kurulum.ps1 OnKosul)`);
      if (!paket.backendHizmetAdi) hatalar.push(`PAKET.json backendHizmetAdi yok — Dağıtım v2 öncesi (pm2) paketi setup'la kurulmaz`);
      else if (paket.backendHizmetAdi !== hizmetAdi) hatalar.push(`hizmet adı "${paket.backendHizmetAdi}" — dağıtım kaydı "${hizmetAdi}" bekliyor`);
      const ikili = paket.hizmetIkilileri && typeof paket.hizmetIkilileri === 'object' ? Object.entries(paket.hizmetIkilileri) : [];
      if (!ikili.length) hatalar.push('PAKET.json hizmetIkilileri boş — hizmet konağı/güncelleyici taşımayan paket setup\'la kurulmaz');
      for (const [ad, o] of ikili) {
        const g = girdiler.get(`runtime/${ad}`);
        if (!g) hatalar.push(`hizmet ikilisi zip'te yok: runtime/${ad}`);
        else if (o && Number.isInteger(o.boyut) && g.acik !== o.boyut) hatalar.push(`runtime/${ad} boyutu ${g.acik} — PAKET.json ${o.boyut}`);
      }
      if (typeof paket.uygulamaSurumu !== 'string' || !SURUM_DESENI.test(paket.uygulamaSurumu)) hatalar.push(`paket sürümü biçimsiz: "${paket.uygulamaSurumu}" (setup'ın sürüm dizini kuralı)`);
      if (paket.prova === true) imzaKapisi('PROVA paketi (PAKET.json prova=true) — fabrikaya kurulmaz (kurulum.ps1 provaKabul ister)');
      const eskiImza = girdiler.has('butunluk.jws');
      const zincirImza = girdiler.has(ZINCIR_IMZA);
      zincirYalniz = zincirImza && !eskiImza;
      guncelleyiciZincir = oku('runtime/tekserp-guncelleyici.exe')?.toString('latin1').includes(ZINCIR_ISARETI) === true;
      const imzaliListe = (eskiImza || zincirImza) && girdiler.has('butunluk-liste.txt');
      if (!imzaliListe || typeof paket.butunlukKid !== 'string' || !paket.butunlukKid) {
        imzaKapisi(`backend paketi İMZASIZ (butunluk.jws ${eskiImza ? 'var' : 'YOK'} · ${ZINCIR_IMZA} ${zincirImza ? 'var' : 'YOK'} · butunluk-liste.txt ${girdiler.has('butunluk-liste.txt') ? 'var' : 'YOK'} · butunlukKid ${paket.butunlukKid ?? 'null'}) — imza: Teks-Erp/scripts/build-korumali-imza.ts zip`);
        paket.imzasiz = true;
      }
    }
    if (sKunye) {
      if (sKunye.guvenCapasi !== capa) hatalar.push(`derlemenin çapa kipi "${sKunye.guvenCapasi ?? '(yok — G3 öncesi)'}" — ortak paket "${capa}" çapalı doğar`);
      if (sKunye.musteri != null || sKunye.kurulumId != null) hatalar.push(`derleme künyesi filigranda müşteri/kurulum taşıyor (${sKunye.musteri ?? '-'} / ${sKunye.kurulumId ?? '-'}) — ortak paket filigransız doğar, filigran kurulumda`);
    }
  } finally {
    zb.kapat();
  }

  // 4) PG: paket kayıtla eşit (pg-paketle --dogrula) + pg.json yükü bu zip'i ve kaydı gösteriyor.
  const pgOzet = await akisOzeti(girdi.pg.yol);
  const pr = spawnSync(process.execPath, [PG_PAKETLE, '--dogrula', girdi.pg.yol], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (pr.error || pr.status === 2) throw olculemedi(`pg-paketle --dogrula: ${(pr.error?.message ?? `${pr.stdout}${pr.stderr}`).trim().split('\n').slice(-2).join(' · ')}`);
  if (pr.status !== 0) hatalar.push(`PG zip kayıtla eşit değil (pg-paketle --dogrula çıkış ${pr.status}): ${`${pr.stdout}${pr.stderr}`.trim().split('\n').filter((s) => /✖/.test(s)).slice(0, 3).join(' · ')}`);
  const pgYuk = isaretciYuku(fs.readFileSync(girdi.pgKunye.yol, 'utf8'));
  // Zincir gereği: zincir-yalnız paket ya da zincir imzalı (pkt-*) PG künyesi → güncelleyici zinciri bilmeli, setup aynı sürüm.
  const pgZincir = /^pkt-/.test(String(jwsBaslikKid(fs.readFileSync(girdi.pgKunye.yol, 'utf8')) ?? ''));
  if (zincirYalniz || pgZincir) {
    const neden = zincirYalniz ? 'ZİNCİR-YALNIZ paket' : `zincir imzalı PG künyesi (${girdi.pgKunye.kaynakAd ?? girdi.pgKunye.ad})`;
    if (!guncelleyiciZincir) hatalar.push(`${neden}, ama runtime/tekserp-guncelleyici.exe "${ZINCIR_ISARETI}" bilmeyen eski derleme — kurulan sistem zinciri doğrulayamaz`);
    const setupSurum = girdi.setup.ad.slice(desen.setup.onek.length, -'.exe'.length);
    if (paket && setupSurum !== paket.uygulamaSurumu) hatalar.push(`${neden}: setup sürümü ${setupSurum} — paket ${paket.uygulamaSurumu} (setup kendi güncelleyicisini taşır; aynı derlemeden olmalı)`);
  }
  if (!pgYuk || typeof pgYuk.paket !== 'object') hatalar.push(`pg.json çözülemedi (imzalı işaretçi biçiminde değil): ${girdi.pgKunye.yol}`);
  else {
    const p = pgYuk.paket;
    if (p.ad !== girdi.pg.ad || Number(p.boyut) !== pgOzet.boyut || p.sha256 !== pgOzet.sha256) {
      hatalar.push(`pg.json özeti PG zip'ine UYMUYOR: künye ${p.ad} ${p.boyut} B ${String(p.sha256).slice(0, 16)}… · zip ${girdi.pg.ad} ${pgOzet.boyut} B ${pgOzet.sha256.slice(0, 16)}… (setup "PG zip'i künyeyle TUTMUYOR" der)`);
    }
    const fark = [];
    if (String(pgYuk.cizgi) !== String(kayit.cizgi)) fark.push(`çizgi ${pgYuk.cizgi}≠${kayit.cizgi}`);
    if (pgYuk.surum !== kayit.surum) fark.push(`sürüm ${pgYuk.surum}≠${kayit.surum}`);
    if (String(pgYuk.derleme) !== String(kayit.derleme)) fark.push(`derleme ${pgYuk.derleme}≠${kayit.derleme}`);
    if (pgYuk.icuSurum !== kayit.yayin['win-x64'].icuSurum) fark.push(`ICU ${pgYuk.icuSurum}≠${kayit.yayin['win-x64'].icuSurum}`);
    if (fark.length) hatalar.push(`pg.json kaydın sabitlediği PostgreSQL değil (${fark.join(', ')}) — ${SURUM_REL}`);
  }

  // 5) tkpub (isteğe bağlı): yalnız açık anahtar.
  if (girdi.tkpub) {
    if (girdi.tkpub.boyut > 4096) hatalar.push(`tkpub ${girdi.tkpub.boyut} B — açık anahtar dosyası birkaç satırdır`);
    else {
      const t = tkpubHatasi(fs.readFileSync(girdi.tkpub.yol, 'utf8'));
      if (t) hatalar.push(`etkili.tkpub: ${t}`);
    }
  } else uyarilar.push(`${desen.tkpub.joker} yok — setup sonunda "Etkili Yazılım yedek alıcısı yok" YAPILACAK maddesi çıkar`);

  // 5b) Panel: PE · künye (latest.yml) ↔ exe (ad/boy/sha512) · künye kanalı bir dağıtım GRUBU (ortak panel).
  const panelSurum = panelDeseni.exec(girdi.panel.ad)[1];
  const panelBayt = fs.readFileSync(girdi.panel.yol);
  if (!peImzasi(panelBayt).pe) hatalar.push(`panel kurulumu bir Windows programı (PE) değil: ${girdi.panel.ad}`);
  const pk = latestYmlCoz(fs.readFileSync(girdi.panelKunye.yol, 'utf8'));
  const sha512 = createHash('sha512').update(panelBayt).digest();
  const panelOzet = { sha256: sha256(panelBayt), boyut: panelBayt.length };
  if (pk.yol !== girdi.panel.ad || pk.surum !== panelSurum) hatalar.push(`panel künyesi (latest.yml) ${pk.yol ?? '?'} / ${pk.surum ?? '?'} gösteriyor — verilen ${girdi.panel.ad}`);
  if (pk.boyut !== panelBayt.length || pk.sha512 !== sha512.toString('base64')) hatalar.push(`panel künyesinin boy/sha512'si exe'yle TUTMUYOR (${pk.boyut} B · exe ${panelBayt.length} B)`);
  if (!pk.yuk) hatalar.push('panel künyesi imzalı bildirim (tekserp.bildirim) taşımıyor — imzasız latest.yml arşive girmez');
  else {
    if (pk.yuk.urun !== 'panel' || pk.yuk.surum !== panelSurum || pk.yuk.paket?.ad !== girdi.panel.ad || pk.yuk.paket?.sha512 !== sha512.toString('hex') || pk.yuk.paket?.boyut !== panelBayt.length) hatalar.push('panel bildirimi bu exe\'yi göstermiyor (ürün/sürüm/ad/boy/sha512)');
    if (!gruplar.includes(pk.yuk.kanal)) hatalar.push(`panel künyesinin kanalı "${pk.yuk.kanal}" bir dağıtım grubu (${gruplar.join('/')}) değil — KANAL KİMLİKLİ panel ortak arşive girmez`);
  }
  if (hatalar.length) throw new Dur(1, `KAPI (${hatalar.length})`, hatalar);
  console.log(`  panel imzası   : panel-imza.ts dogrula (grup ${pk.yuk.kanal}, gerçek çapa) …`);
  const pd = panelDogrula({ exe: girdi.panel, kunye: girdi.panelKunye, kanal: pk.yuk.kanal });
  if (!pd.ok) imzaKapisi(`PANEL KÜNYESİ DOĞRULANAMADI (panel-imza.ts dogrula): ${pd.neden}`);

  // 6) İmza: üretim çapasıyla TAM doğrulama (ortak paketin bütünlüğü + müşterisiz künye + pg.json imzası).
  let imzaKid = null;
  if (!paket.imzasiz) {
    console.log(`  imza           : backend-bildirim.ts ortak-dogrula (çapa ${capa}) …`);
    const d = tsDogrulayici('ortak-dogrula', [`--zip=${girdi.backend.yol}`, `--guven-capasi=${capa}`,
      `--pg-cizgi=${kayit.cizgi}`, `--pg-en-az=${kayit.backendEnAz}`, `--pg-kunye=${girdi.pgKunye.yol}`]);
    if (!d.ok) imzaKapisi(`İMZA DOĞRULANAMADI (backend-bildirim.ts ortak-dogrula): ${d.neden}`);
    else {
      const b = d.sonuc;
      const h = b?.pg?.hedef?.paket;
      if (b?.kip !== 'ortak-dogrula' || b?.surum !== paket.uygulamaSurumu) imzaKapisi(`imzalı künye ${b?.surum} (${b?.kip}) — PAKET.json ${paket.uygulamaSurumu}`);
      else if (!h || h.ad !== girdi.pg.ad || Number(h.boyut) !== pgOzet.boyut || h.sha256 !== pgOzet.sha256) imzaKapisi('imzalı pg.json başka bir PG zip\'ini gösteriyor');
      else imzaKid = b.paketImzaKid;
      for (const u of b?.uyarilar ?? []) uyarilar.push(u);
    }
  } else {
    console.log(`  imza           : backend imzasız — yalnız pg.json doğrulanıyor (pg-dogrula, çapa ${capa}) …`);
    const d = tsDogrulayici('pg-dogrula', [`--kunye=${girdi.pgKunye.yol}`, `--zip=${girdi.pg.yol}`, `--guven-capasi=${capa}`]);
    if (!d.ok) imzaKapisi(`pg.json İMZASI DOĞRULANAMADI: ${d.neden}`);
  }
  if (hatalar.length) throw new Dur(1, `İMZA (${hatalar.length})`, hatalar);

  // 7) Arşiv adı + içerik listesi; her desen TAM BİR üyeyle eşleşmeli (fazla dosya setup'ı şaşırtmaz).
  const surum = paket.uygulamaSurumu;
  // Ad grubu taşır (panelin grubu): portal "test = yalnız deneme kurulumu"nu ve onaylı paketi addan ayırır.
  let arsivAd;
  try {
    arsivAd = kurulumArsiviAdi(pk.yuk.kanal, surum, prova ? '-PROVA-IMZASIZ' : '', adKurali);
  } catch (e) {
    if (e instanceof DepoOlculemedi) throw olculemedi(e.message);
    throw e;
  }
  const adHata = derlemeAdiHatasi(arsivAd, adKurali);
  if (adHata) throw new Dur(1, `arşiv adı satıcının derleme deposuna uymuyor: ${adHata}`);
  const uyeler = [girdi.setup.ad, girdi.backend.ad, girdi.pg.ad, girdi.pgKunye.ad, girdi.panel.ad, ...(girdi.tkpub ? [girdi.tkpub.ad] : []), ICERIK, OZETLER, BENIOKU];
  if (uyeler.filter((u) => desen.setup.desen.test(u)).length !== 1) throw new Dur(1, `desen çakışması: sunucu setup deseni için TEK dosya beklenir (${uyeler.join(', ')})`);
  const kucuk = uyeler.map((u) => u.toLowerCase());
  if (new Set(kucuk).size !== kucuk.length) throw new Dur(1, `arşivde büyük/küçük harf farkıyla aynı ad (Windows'ta çakışır): ${uyeler.join(', ')}`);
  for (const [ad, beklenen, zorunlu] of [['backend', girdi.backend.ad, true], ['pg', girdi.pg.ad, true], ['pgKunye', girdi.pgKunye.ad, true], ['tkpub', girdi.tkpub?.ad, false]]) {
    const es = uyeler.filter((u) => desen[ad].desen.test(u));
    if ((zorunlu || beklenen) && (es.length !== 1 || es[0] !== beklenen)) throw new Dur(1, `desen çakışması: setup ${desen[ad].joker} için ${es.length} dosya görür (${es.join(', ') || 'hiç'})`);
    if (!zorunlu && !beklenen && es.length) throw new Dur(1, `desen çakışması: ${desen[ad].joker} beklenmeyen dosyayla eşleşiyor (${es.join(', ')})`);
  }
  return { girdi, paket, sKunye, hizmetAdi, capa, prova, surum, arsivAd, uyarilar, imzaKid, setupImzali: Boolean(pe.imzali), pgOzet, panelSurum, panelOzet, panelGrup: pk.yuk.kanal };
}

// ---------------------------------------------------------------- üretim + yeniden ölçüm
function zipAraci() {
  const r = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  if (r.error) throw olculemedi(`Info-ZIP \`zip\` bulunamadı: ${r.error.message}`);
  const satir = r.stdout.split('\n').find((l) => /^This is Zip \d/.test(l));
  if (!satir) throw olculemedi('`zip -v` Info-ZIP sürüm satırı vermedi (başka bir zip aracı?)');
  const u = spawnSync('unzip', ['-v'], { encoding: 'utf8' });
  if (u.error) throw olculemedi(`\`unzip\` bulunamadı (arşiv bağımsız araçla sınanır): ${u.error.message}`);
  return satir.trim();
}

const baytSirasi = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** İçerik künyesi: yalnız sürüm + dosya listesi (ad · rol · sürüm · boy · sha256); kimlik taşımaz. */
function icerikKunyesi(d, ozet) {
  const boy = (g) => fs.statSync(g.yol).size;
  const satir = (rol, g, surum) => ({ rol, ad: g.ad, surum, boyut: boy(g), sha256: ozet.get(g.ad) });
  const z = new Date(d.sKunye?.zaman ?? '');
  return {
    v: 1,
    tur: 'tekserp-ilk-kurulum',
    surum: d.surum,
    zaman: Number.isNaN(z.getTime()) ? null : z.toISOString(),
    dosyalar: [
      satir('setup', d.girdi.setup, d.girdi.setup.ad.slice('TeksERP-Kurulum-'.length, -'.exe'.length)),
      satir('backend', d.girdi.backend, d.surum),
      satir('pg', d.girdi.pg, null),
      satir('pgKunye', d.girdi.pgKunye, null),
      satir('panel', d.girdi.panel, d.panelSurum),
      ...(d.girdi.tkpub ? [satir('tkpub', d.girdi.tkpub, null)] : []),
    ],
  };
}

async function uret(d, cikti) {
  const arac = zipAraci();
  const hedef = path.join(cikti, d.arsivAd);
  const sahne = fs.mkdtempSync(path.join(cikti, '.kurulum-arsivi-'));
  const yarim = path.join(cikti, `.${d.arsivAd}.yarim`);
  const temizle = () => {
    fs.rmSync(sahne, { recursive: true, force: true });
    fs.rmSync(yarim, { force: true });
  };
  try {
    const kaynak = [d.girdi.setup, d.girdi.backend, d.girdi.pg, d.girdi.pgKunye, d.girdi.panel, ...(d.girdi.tkpub ? [d.girdi.tkpub] : [])];
    const ozet = new Map();
    for (const g of kaynak) {
      const s = path.join(sahne, g.ad);
      fs.copyFileSync(g.yol, s, fs.constants.COPYFILE_FICLONE);
      const o = await akisOzeti(s);
      const k = await akisOzeti(g.yol);
      if (o.sha256 !== k.sha256) throw new Dur(1, `kopya kaynakla aynı değil (${g.ad}) — girdi koşum sırasında değişti`);
      ozet.set(g.ad, o.sha256);
    }
    fs.writeFileSync(path.join(sahne, BENIOKU), `﻿${beniOku({ surum: d.surum, setupAd: d.girdi.setup.ad, setupImzali: d.setupImzali, prova: d.prova, panelAd: d.girdi.panel.ad })}`);
    ozet.set(BENIOKU, sha256(fs.readFileSync(path.join(sahne, BENIOKU))));
    const icerik = icerikKunyesi(d, ozet);
    const ih = icerikKunyesiHatalari(icerik);
    if (ih.length) throw new Dur(1, 'İÇERİK KÜNYESİ KAPISI', ih);
    fs.writeFileSync(path.join(sahne, ICERIK), `${JSON.stringify(icerik, null, 2)}\n`);
    ozet.set(ICERIK, sha256(fs.readFileSync(path.join(sahne, ICERIK))));
    const ozetMetni = `${[...ozet.keys()].sort(baytSirasi).map((a) => `${ozet.get(a)}  ${a}`).join('\n')}\n`;
    fs.writeFileSync(path.join(sahne, OZETLER), ozetMetni);
    ozet.set(OZETLER, sha256(Buffer.from(ozetMetni)));

    // Damga = derlemenin künye zamanı (UTC): aynı girdiler aynı araçla aynı bayt.
    const z = new Date(d.sKunye?.zaman ?? '');
    const damga = Number.isNaN(z.getTime()) ? new Date() : z;
    const adlar = [...ozet.keys()].sort(baytSirasi);
    for (const a of adlar) {
      fs.chmodSync(path.join(sahne, a), 0o644);
      fs.utimesSync(path.join(sahne, a), damga, damga);
    }
    const env = { ...process.env, TZ: 'UTC' };
    delete env.ZIPOPT;
    delete env.ZIP;
    const r = spawnSync('zip', ['-q', '-X', '-D', '-6', '-n', '.zip:.exe', yarim, '-@'], { cwd: sahne, input: `${adlar.join('\n')}\n`, env, encoding: 'utf8' });
    if (r.error || r.status !== 0) throw olculemedi(`zip çıkış ${r.status ?? r.error?.message}: ${(r.stderr || '').trim()}`);

    // Yeniden aç: düz kök, tam küme, girdi başına özet = kaynak = SHA256SUMS; zip/exe sıkıştırılmadan.
    const hatalar = [];
    const za = zipAc(yarim);
    try {
      const gorulen = za.girdiler.map((g) => g.ad);
      if (gorulen.some((a) => a.includes('/') || a.includes('\\'))) hatalar.push(`arşivde alt dizin/yol var: ${gorulen.filter((a) => /[\\/]/.test(a)).join(', ')}`);
      const fazla = gorulen.filter((a) => !ozet.has(a));
      const eksik = adlar.filter((a) => !gorulen.includes(a));
      if (fazla.length || eksik.length || gorulen.length !== adlar.length) hatalar.push(`arşiv kümesi farklı (fazla: ${fazla.join(', ') || '-'} · eksik: ${eksik.join(', ') || '-'})`);
      const sums = new Map();
      for (const g of za.girdiler) {
        const veri = za.oku(g);
        if (g.ad === OZETLER) {
          for (const s of veri.toString('utf8').split('\n').filter(Boolean)) {
            const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(s);
            if (!m) hatalar.push(`${OZETLER} satırı biçimsiz: ${s.slice(0, 80)}`);
            else sums.set(m[2], m[1]);
          }
        }
        if (sha256(veri) !== ozet.get(g.ad)) hatalar.push(`${g.ad}: arşivdeki bayt kaynakla aynı değil`);
        if (/\.(zip|exe)$/i.test(g.ad) && g.yontem !== 0) hatalar.push(`${g.ad}: sıkıştırılmış saklanmış (store bekleniyordu)`);
      }
      for (const a of adlar.filter((x) => x !== OZETLER)) if (sums.get(a) !== ozet.get(a)) hatalar.push(`${OZETLER}: ${a} satırı tutmuyor`);
      if (sums.size !== adlar.length - 1) hatalar.push(`${OZETLER} ${sums.size} satır — ${adlar.length - 1} dosya`);
    } finally {
      za.kapat();
    }
    const t = spawnSync('unzip', ['-tq', yarim], { encoding: 'utf8' });
    if (t.status !== 0) hatalar.push(`unzip -t: ${(t.stdout || t.stderr || '').trim().slice(0, 200)}`);
    if (hatalar.length) throw new Dur(1, `ARŞİV DOĞRULAMASI BAŞARISIZ (${hatalar.length}) — arşiv bırakılmadı`, hatalar);

    if (fs.existsSync(hedef)) throw new Dur(2, `hedef bu arada doğdu, ezilmez: ${hedef}`);
    fs.renameSync(yarim, hedef);
    const son = await akisOzeti(hedef);
    fs.writeFileSync(`${hedef}.sha256`, `${son.sha256}  ${d.arsivAd}\n`);
    return { hedef, son, adlar, ozet, arac, damga };
  } catch (e) {
    temizle();
    throw e;
  } finally {
    fs.rmSync(sahne, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- ana akış
async function main() {
  const { deger: arg, hatalar } = argAyristir(process.argv.slice(2));
  if (hatalar.length) throw new Dur(2, KULLANIM, hatalar);
  const cikti = path.resolve(arg['--cikti']);
  const rel = path.relative(KOK, cikti);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Dur(2, `çıktı dizini depo içinde olamaz (yapıt commit'lenmesin): ${cikti}`);
  console.log(`== Kurulum arşivi (ortak)${arg.prova ? ' — PROVA (imza kapıları uyarı)' : ''} ==`);
  const d = await denetle(arg);
  const hedef = path.join(cikti, d.arsivAd);
  if (fs.existsSync(hedef) || fs.existsSync(`${hedef}.sha256`)) throw new Dur(2, `arşiv zaten var, ezilmez: ${hedef} — eskisini kenara al`);
  fs.mkdirSync(cikti, { recursive: true });
  const u = await uret(d, cikti);
  console.log('== Arşiv hazır ve yeniden açılıp doğrulandı ==');
  console.log(`  arşiv          : ${u.hedef}`);
  console.log(`  boyut / sha256 : ${u.son.boyut} B · ${u.son.sha256}  (yanında ${d.arsivAd}.sha256)`);
  console.log(`  içerik (düz)   : ${u.adlar.map((a) => `${a}`).join(' · ')}`);
  console.log(`  backend        : ${d.girdi.backend.ad} · ${d.surum} · ortak · hizmet ${d.hizmetAdi} · çapa ${d.capa}${d.imzaKid ? ` · imza ${d.imzaKid} GEÇERLİ` : ' · İMZA DOĞRULANMADI'}`);
  console.log(`  panel          : ${d.girdi.panel.ad} · ${d.panelSurum} · sha256 ${d.panelOzet.sha256.slice(0, 16)}… (künye grubu ${d.panelGrup}; grup adı arşive GİRMEZ)`);
  console.log(`  PG             : ${d.girdi.pg.ad} · ${d.pgOzet.sha256.slice(0, 16)}… = pg.json`);
  console.log(`  damga / araç   : ${u.damga.toISOString()} · ${u.arac}`);
  for (const w of d.uyarilar) console.log(`  ⚠ ${w}`);
  console.log(`  sonraki adım   : node deploy/satici/derleme-koy.mjs --ortam <uretim|hazirlik> --dosya ${u.hedef}   (KURU; yazım --uygula)`);
  console.log(d.prova ? 'SONUC: PROVA-ARSIVI (müşteriye verilmez)' : 'SONUC: ARSIV-HAZIR');
}

const anaModul = (() => {
  try {
    return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (anaModul) {
  main().catch((e) => {
    if (e instanceof Dur) {
      console.error(`\n  ✖ ${e.message}`);
      for (const s of e.satirlar) console.error(`    - ${s}`);
      console.error(`\nSONUC: ${e.kod === 2 ? 'OLCULEMEDI' : 'DUR'} — arşiv bırakılmadı\n`);
      process.exit(e.kod);
    }
    console.error(`\n  ✖ BEKLENMEYEN HATA: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  });
}
