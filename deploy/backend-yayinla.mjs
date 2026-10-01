#!/usr/bin/env node
/**
 * TeksERP Backend — KANAL YAYINCISI (Dağıtım v2 · docs/design/GUNCELLEYICI.md §1).
 *
 * `deploy/electron-yayinla.sh` ve `deploy/mobil-yayinla.mjs`in ikizi: imzalı backend paketini kanalın güncelleme
 * dizinine yükler, PAKET anahtarıyla imzalı SÜRÜM BİLDİRİMİNİ (`tekserp-surum`) üretir ve `son.json`u EN SON yazar.
 *
 * ⚠️ HEDEF KANAL KAYDINDAN, KİMLİK PAKETTEN: `--musteri` `deploy/kanallar.json`da kayıtlı olmalı; VDS yolları, feed,
 *    defter ve ssh takma adı YALNIZ kayıttan (`kanal.yayin.backend*`, `scripts/lib/yayin-hedefi.mjs`) okunur; `--ssh`
 *    ya da SSH_HEDEF/UZAK_DIZIN/YAYIN_URL… ezmesi görülürse DURULUR. Paketin `PAKET.json` `backendKanal`ı ve imzalı künyesi
 *    o kanalın olmalı — `Teks-Erp/scripts/backend-bildirim.ts` paketi açıp TAM bütünlük denetimiyle ölçer.
 * ⚠️ SIRA (pazarlık dışı): sürüm dizini GEÇİCİ adla yüklenir → uzakta boy + sha256 ölçülür → dizin yeniden adlanır
 *    → `son.json` geçici adla yüklenip EN SON yerine taşınır. Yarım yayında `son.json` eski sürümü gösterir.
 * ⚠️ DEĞİŞMEZ SÜRÜM: var olan `<sürüm>/` EZİLMEZ; yeni sürüm kanalda yayındaki sürümden BÜYÜK olmalı (geri inme yok).
 * ⚠️ TERFİ (K5): `terfiKaynagi` olan kanala yalnız terfi etiketli commit ve hazırlık kanalında yayınlanmış sürüm.
 * ⚠️ SÜRÜM NOTU: prova olmayan pakette `docs/surumler/backend-<sürüm>.md` ZORUNLU; bildirimin özeti onun "Özet"i.
 * ⚠️ CI KAÇIŞI (G22): paketin imzalı künyesinde `ciKokeni.kip = "atlandi"` (üretim imzası CI koşusu OLMADAN,
 *    kullanıcının cümlesiyle — `build-korumali-imza.ts --ci-atla`) görülürse yayın DURMAZ: uyarı basılır, cümle ·
 *    saat · makine · HEAD yayın defterine `ci-atlandi:` kolonu olarak yazılır.
 * ⚠️ KENAR DOĞRULAMASI: yayın belirteci (Worker) yoksa HİÇBİR ŞEY yüklenmeden DUR; yayından sonra `son.json`
 *    kenardan belirteçle okunur ve yüklenenle bayt bayt kıyaslanır.
 *
 * ⚠️ PG TEK KAYNAK: bildirimin `pg.cizgi` + `pg.enAz`ı ve hedef PG paketinin kimliği (sürüm · derleme · ICU)
 *    YALNIZ `deploy/pg/pg-surumu.json`dan (`cizgi` · `backendEnAz` · `surum` · `derleme` · `icuSurum`) gelir.
 *    `--pg-cizgi`/`--pg-en-az` geriye uyum için kabul edilir ama kayıttan FARKLIYSA DUR; `--pg-kunye`nin ve
 *    `--pg-yayinla` paketinin künyesi kaydın sürüm/derleme/ICU'su değilse DUR (sessiz sapma yok).
 *
 * Kullanım:
 *   node deploy/backend-yayinla.mjs --musteri=<kod> --paket=<imzalı zip> --anahtar=<PAKET anahtar dosyası>
 *        [--pg-kunye=<pg.json>] [--min-kaynak=<sürüm>] [--zorunlu] [--kuru] [--terfi-atla="<cümle>"]
 *   node deploy/backend-yayinla.mjs --musteri=<kod> --pg-yayinla --pg-paket=<PG sahne zip> --pg-kunye=<pg.json> [--kuru]
 *        # PG paketi (sözleşme sürümü 2): `<kanal>/backend/pg/<sürüm>-<derleme>/` DEĞİŞMEZ dizinine; son.json'a dokunmaz
 *   node deploy/backend-yayinla.mjs --musteri=<kod> --dogrula        # yükleme YOK: kenardaki son.json'u oku
 * `--kuru`: künye + sürüm notu + terfi (ağsız) + paket bütünlüğü ölçülür, bildirim İMZASIZ kurulur; ağa ÇIKILMAZ.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KAYIT_REL, Olculemedi, kanalCoz } from '../scripts/lib/kanallar.mjs';
import { cumleDenetle, istanbulSaati, terfiAtlaKaydi, terfiKapisi, terfiRaporu } from '../scripts/lib/terfi.mjs';
import { BelirtecYok, belirtecOku, belirtecliFetch, yayinOku } from '../scripts/lib/yayin-okuma.mjs';
import { ezmeSatirlari, yayinEzmeleri, yayinHedefi } from '../scripts/lib/yayin-hedefi.mjs';
import { yayinSonrasiBildir } from '../scripts/lib/yayin-bildirim.mjs';
import { Olculemedi as PgOlculemedi, SURUM_REL as PG_KAYIT_REL, jsonOku as pgJsonOku, surumKaydiHatalari } from './pg/lib/pg-ornegi.mjs';
import {
  SURUM_DESENI,
  cekirdekSurum,
  ciAtlaMetni,
  ciKokeniOku,
  defterKomutu,
  defterSatiri,
  isaretciSurumu,
  isaretciYuku,
  ozetCikar,
  pgYayinPlani,
  surumKiyasla,
  yayinPlani,
} from '../scripts/lib/backend-yayin.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEKS = path.join(KOK, 'Teks-Erp');
const BAR = '='.repeat(72);
const bilgi = (m) => console.log(`  ${m}`);
function dur(baslik, ...satirlar) {
  console.error(`\n${BAR}\n  ✖ HATA — ${baslik}\n${BAR}`);
  for (const s of satirlar) console.error(`  ${s}`);
  console.error(`${BAR}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (ad) => {
  const e = argv.find((a) => a === `--${ad}` || a.startsWith(`--${ad}=`));
  if (!e) return undefined;
  const [, d] = e.split(/=(.*)/s);
  return d ?? '';
};
const KURU = argv.includes('--kuru');
const TERFI_ATLA = argv.some((a) => a === '--terfi-atla' || a.startsWith('--terfi-atla=')) ? (arg('terfi-atla') ?? '') : undefined;
{
  const ezmeler = yayinEzmeleri({ argv });
  if (ezmeler.length) dur('YAYIN HEDEFİ EZİLEMEZ — hiçbir şey yüklenmedi', ...ezmeSatirlari(ezmeler));
}
if (argv.some((a) => /^--(parola|password|sifre)/.test(a))) dur('Parola argümandan ALINMAZ', 'PAKET anahtarının parolası TTY\'de sorulur ya da stdin\'den okunur.');

const MUSTERI = arg('musteri');
if (!MUSTERI) dur('HANGİ KANALA YAYINLANIYOR?', '`--musteri=<kod>` zorunludur — hedef dizin, feed ve defter kanal kaydından çözülür.');
let KANAL;
let KAYIT;
try {
  ({ kanal: KANAL, kayit: KAYIT } = kanalCoz(MUSTERI));
} catch (e) {
  if (e instanceof Olculemedi) dur(`KANAL KAYIT DEFTERİ ÖLÇÜLEMEDİ (${KAYIT_REL})`, e.message);
  dur(e.message, ...(e.satirlar ?? []));
}
let SSH_HEDEF;
try {
  SSH_HEDEF = yayinHedefi(MUSTERI, 'backend', { kayit: KAYIT }).ssh;
} catch (e) {
  dur(`YAYIN HEDEFİ ÇÖZÜLEMEDİ (${KAYIT_REL})`, e.message, ...(e.satirlar ?? []));
}

/* ------------------------------------------------------------------ *
 * Uzak komutlar — `--kuru`da yalnız yazılır
 * ------------------------------------------------------------------ */

function uzak(komut, aciklama, { sessiz = false } = {}) {
  if (!sessiz) bilgi(aciklama);
  if (KURU) {
    bilgi(`    [kuru] ssh ${SSH_HEDEF} ${komut}`);
    return { status: 0, stdout: '' };
  }
  return spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SSH_HEDEF, komut], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function uzakZorunlu(komut, aciklama) {
  const r = uzak(komut, aciklama);
  if (r.error) dur(`${aciklama} — ssh çalıştırılamadı`, String(r.error.message));
  if (r.status !== 0) dur(`${aciklama} — başarısız (çıkış ${r.status})`, String(r.stderr ?? '').trim().slice(0, 300));
  return r;
}

function gonder(yerel, uzakYol, aciklama) {
  bilgi(aciklama);
  if (KURU) {
    bilgi(`    [kuru] scp ${yerel} ${SSH_HEDEF}:${uzakYol}`);
    return;
  }
  const r = spawnSync('scp', ['-s', '-q', '-o', 'BatchMode=yes', yerel, `${SSH_HEDEF}:${uzakYol}`], { stdio: 'inherit' });
  if (r.error || r.status !== 0) dur(`${aciklama} — scp başarısız (çıkış ${r.status ?? r.error?.message})`);
}

/* ------------------------------------------------------------------ *
 * --dogrula: kenardan yayındaki son.json
 * ------------------------------------------------------------------ */

async function kenardanOku(url) {
  const r = await belirtecliFetch(`${url}?onbellek-atla=${crypto.randomBytes(6).toString('hex')}`, { method: 'GET' });
  return { durum: r.status, govde: r.status === 200 ? await r.text() : '' };
}

if (argv.includes('--dogrula')) {
  console.log(`\n${BAR}\n  BACKEND YAYIN DENETİMİ — ${MUSTERI} (yükleme yok)\n${BAR}`);
  try {
    const k = await kenardanOku(KANAL.yayin.backendManifest);
    if (k.durum !== 200) dur(`son.json kenarda ${k.durum}`, KANAL.yayin.backendManifest);
    const s = isaretciSurumu(k.govde);
    if (!s) dur('son.json okunamadı (işaretçi biçimsiz)', KANAL.yayin.backendManifest);
    bilgi(`✔ kanalın yayındaki backend sürümü: ${s}`);
    process.exit(0);
  } catch (e) {
    if (e instanceof BelirtecYok) dur('YAYIN BELİRTECİ YOK — kenar okunamaz', e.message);
    throw e;
  }
}

/* ------------------------------------------------------------------ *
 * PG paketi (sözleşme sürümü 2) — ayrı, değişmez dizin; kanal kapısından sonra, son.json'a dokunmadan
 * ------------------------------------------------------------------ */

/** PG sürüm kaydı (tek kaynak) — kırmızıysa ya da okunamıyorsa DUR (fail-closed). */
let pgKayitOnbellek = null;
function pgKaydi() {
  if (pgKayitOnbellek) return pgKayitOnbellek;
  let k;
  try {
    k = pgJsonOku(PG_KAYIT_REL);
  } catch (e) {
    dur(`PG SÜRÜM KAYDI ÖLÇÜLEMEDİ (${PG_KAYIT_REL})`, e instanceof PgOlculemedi ? e.message : String(e?.message ?? e));
  }
  const h = surumKaydiHatalari(k);
  if (h.length) dur(`PG SÜRÜM KAYDI KIRMIZI (${PG_KAYIT_REL})`, ...h, 'Önce: node scripts/test_pg_ornegi.mjs');
  pgKayitOnbellek = k;
  return k;
}

const PG_KUNYE = arg('pg-kunye') ? path.resolve(arg('pg-kunye')) : null;
function pgKunyeYukuOku() {
  if (!PG_KUNYE || !fs.existsSync(PG_KUNYE)) dur('PG KÜNYESİ YOK', '`--pg-kunye=<pg.json>` (Teks-Erp/scripts/backend-bildirim.ts pg-imzala çıktısı)');
  const y = isaretciYuku(fs.readFileSync(PG_KUNYE, 'utf8'));
  if (!y || typeof y.surum !== 'string' || !Number.isInteger(y.derleme) || typeof y.paket?.ad !== 'string') dur('PG künyesi çözülemedi', PG_KUNYE);
  // Hedef PG paketi kaydın sabitlediği ikilidir: çizgi · sürüm · derleme · ICU birebir (imza TS aracında ölçülür).
  const k = pgKaydi();
  const fark = [];
  if (y.cizgi !== Number(k.cizgi)) fark.push(`çizgi ${y.cizgi} ≠ kayıt ${k.cizgi}`);
  if (y.surum !== k.surum) fark.push(`sürüm ${y.surum} ≠ kayıt ${k.surum}`);
  if (String(y.derleme) !== k.derleme) fark.push(`derleme ${y.derleme} ≠ kayıt ${k.derleme}`);
  if (y.icuSurum !== k.yayin['win-x64'].icuSurum) fark.push(`ICU ${y.icuSurum} ≠ kayıt ${k.yayin['win-x64'].icuSurum}`);
  if (fark.length) {
    dur('PG KÜNYESİ KAYITLA UYUŞMUYOR — yayınlanmadı', ...fark, `Tek kaynak ${PG_KAYIT_REL}: sürüm değişimi bir KARARDIR (docs/design/KENDI-POSTGRESQL.md §2), künye kayda uyar.`);
  }
  return y;
}

function tsArac(komut, argumanlar, cikti) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/backend-bildirim.ts', komut, ...argumanlar, `--cikti=${cikti}`], { cwd: TEKS, stdio: 'inherit' });
  if (r.status !== 0) dur(`backend-bildirim.ts ${komut} başarısız (çıkış ${r.status})`, 'Yukarıdaki satır nedeni söyler; hiçbir şey yüklenmedi.');
  return JSON.parse(fs.readFileSync(path.join(cikti, 'sonuc.json'), 'utf8'));
}

if (argv.includes('--pg-yayinla')) {
  const pgZip = arg('pg-paket') ? path.resolve(arg('pg-paket')) : null;
  if (!pgZip || !fs.existsSync(pgZip)) dur('PG PAKETİ YOK', '`--pg-paket=<PG sahne zip>`');
  const y = pgKunyeYukuOku();
  console.log(`\n${BAR}\n  PostgreSQL ${y.surum}-${y.derleme} → ${MUSTERI}${KURU ? ' — KURU' : ''}\n${BAR}`);
  const pgCikti = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-pg-yayin-'));
  const k = tsArac('pg-dogrula', [`--kunye=${PG_KUNYE}`, `--zip=${pgZip}`, `--guven-capasi=${KANAL.backend.guvenCapasi}`], pgCikti).kunye;
  const pgPlan = pgYayinPlani({ vdsBackend: KANAL.yayin.vdsBackend, surum: k.surum, derleme: k.derleme, paketAd: k.paket.ad, damga: crypto.randomBytes(6).toString('hex') });
  if (!KURU && uzak(pgPlan.komut.varMi, 'PG sürüm dizini var mı?', { sessiz: true }).status === 0) dur(`${pgPlan.dizin} ZATEN VAR — yayınlanmış PG paketi EZİLMEZ`);
  uzakZorunlu(pgPlan.komut.geciciAc, `geçici dizin: ${pgPlan.gecici}`);
  gonder(pgZip, `${pgPlan.gecici}/${k.paket.ad}`, 'PG paketi');
  gonder(PG_KUNYE, `${pgPlan.gecici}/pg.json`, 'PG künyesi (pg.json)');
  if (!KURU) {
    const [ozetU, boyU] = String(uzakZorunlu(pgPlan.komut.olc, 'uzakta boy + sha256 ölçülüyor').stdout).trim().split(/\s+/);
    if (ozetU !== k.paket.sha256 || Number(boyU) !== k.paket.boyut) {
      uzak(pgPlan.komut.geciciSil, 'yarım yükleme siliniyor');
      dur('Uzaktaki PG paketi künyeyle TUTMUYOR — yayın yapılmadı', `beklenen ${k.paket.sha256}/${k.paket.boyut} · uzak ${ozetU}/${boyU}`);
    }
  }
  uzakZorunlu(pgPlan.komut.yayinla, `PG dizini yayında: ${pgPlan.dizin}`);
  const pgSatir = defterSatiri({ zaman: istanbulSaati(), surum: `${k.surum}-${k.derleme}`, kim: `${os.userInfo().username}@${os.hostname().split('.')[0]}`, sha16: k.paket.sha256.slice(0, 16), boyut: k.paket.boyut, urun: 'pg' });
  uzak(defterKomutu(KANAL.yayin.backendDefter, pgSatir), 'yayın defteri');
  fs.rmSync(pgCikti, { recursive: true, force: true });
  console.log(`\n${BAR}\n  ${KURU ? 'KURU — hiçbir şey yüklenmedi' : `✔ PostgreSQL ${k.surum}-${k.derleme} "${MUSTERI}" kanalında (backend bildirimi --pg-kunye ile hedefler)`}\n${BAR}\n`);
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 1) Paket künyesi + sürüm notu
 * ------------------------------------------------------------------ */

const PAKET = arg('paket') ? path.resolve(arg('paket')) : null;
if (!PAKET || !fs.existsSync(PAKET)) dur('PAKET YOK', '`--paket=<imzalı zip>` (paketle.ps1 -Korumali + build-korumali-imza.ts zip çıktısı)');
const ANAHTAR = arg('anahtar');
if (!KURU && !ANAHTAR) dur('PAKET ANAHTARI YOK', '`--anahtar=<PAKET anahtar dosyası>` — bildirim paketi imzalayan anahtarla imzalanır (kuru kip anahtarsız çalışır).');
// Bildirimin `pg` bloğu kayıttan: argüman yalnız geriye uyum içindir ve kayıttan farklıysa DUR.
const PG_CIZGI = pgKaydi().cizgi;
const PG_EN_AZ = pgKaydi().backendEnAz;
for (const [ad, kayitta] of [['pg-cizgi', PG_CIZGI], ['pg-en-az', PG_EN_AZ]]) {
  const verilen = arg(ad);
  if (verilen !== undefined && verilen !== kayitta) {
    dur(`--${ad}=${verilen} kayıttaki değerden (${kayitta}) FARKLI — yayınlanmadı`,
      `PostgreSQL gereksinimi tek kaynaktan: ${PG_KAYIT_REL} (cizgi · backendEnAz). Argümanı kaldır ya da kaydı bir KARARLA değiştir.`);
  }
}
const PG_HEDEF = PG_KUNYE ? pgKunyeYukuOku() : null;

let kunye;
try {
  kunye = JSON.parse(execFileSync('unzip', ['-p', PAKET, 'PAKET.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).replace(/^﻿/, ''));
} catch (e) {
  dur('PAKET.json okunamadı', `${PAKET}: ${String(e.message ?? e).slice(0, 200)}`);
}
const SURUM = String(kunye.uygulamaSurumu ?? '');
if (!SURUM_DESENI.test(SURUM)) dur(`Paket sürümü yayınlanabilir biçimde değil: "${SURUM}"`, 'x.y.z ya da x.y.z-ön.sürüm (+yapı eki yok).');
const PROVA = kunye.prova === true;
if (PROVA && KANAL.tur !== 'hazirlik') dur(`PROVA paketi "${MUSTERI}" (${KANAL.tur}) kanalına yayınlanmaz`, 'Prova yalnız hazırlık kanalında denenir.');
if (kunye.backendKanal !== MUSTERI) dur(`Paket "${kunye.backendKanal}" kanalı için üretilmiş`, `Hedef "${MUSTERI}" — paketle.ps1 -Musteri ${MUSTERI} ile üret.`);

console.log(`\n${BAR}\n  BACKEND ${SURUM} → ${MUSTERI} (${KANAL.tur})${KURU ? ' — KURU' : ''}\n${BAR}`);
const belge = path.join(KOK, 'docs', 'surumler', `backend-${PROVA ? cekirdekSurum(SURUM) : SURUM}.md`);
let ozet = fs.existsSync(belge) ? ozetCikar(fs.readFileSync(belge, 'utf8')) : null;
if (!ozet) {
  if (!PROVA) {
    dur(`SÜRÜM NOTU YOK ya da "Özet" boş: ${path.relative(KOK, belge)}`,
      'Sürüm notu yazılmadan sürüm çıkmaz (şablon docs/surumler/SABLON.md); bildirimin özeti bu bölümden gelir.');
  }
  ozet = `Prova paketi ${SURUM} — hazırlık kanalı denemesi.`;
  bilgi(`⚠ prova: sürüm belgesi özeti yok, sabit özet kullanılacak`);
}
bilgi(`✓ sürüm notu: ${fs.existsSync(belge) ? path.relative(KOK, belge) : '(prova)'} · özet ${ozet.length} karakter`);

/* ------------------------------------------------------------------ *
 * 2) Terfi kapısı (K5) — yüklemeden ÖNCE
 * ------------------------------------------------------------------ */

const terfi = terfiKapisi({ kod: MUSTERI, urun: 'backend', surum: SURUM, atla: TERFI_ATLA, kuru: KURU });
const terfiSatirlari = terfiRaporu(terfi, { kod: MUSTERI, urun: 'backend', surum: SURUM });
if (terfi.sonuc !== 'uyumlu') {
  dur(terfiSatirlari[0].replace(/^✖ /, ''), ...terfiSatirlari.slice(1).map((s) => s.trim()),
    terfi.sonuc === 'ihlal' ? 'Acil kaçış yalnız kullanıcının cümlesiyle: --terfi-atla="<cümle>"' : 'Ölçülemeyen şart geçmiş şart değildir.');
}
for (const s of terfiSatirlari) bilgi(s);

/* ------------------------------------------------------------------ *
 * 3) Bildirim — paket TAM denetlenir; kuru kipte imzasız
 * ------------------------------------------------------------------ */

const CIKTI = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-backend-yayin-'));
const ozetDosyasi = path.join(CIKTI, 'ozet.txt');
fs.writeFileSync(ozetDosyasi, ozet);
const aracArg = [
  '--import', 'tsx', 'scripts/backend-bildirim.ts', KURU ? 'dogrula' : 'imzala',
  `--zip=${PAKET}`, `--kanal=${MUSTERI}`, `--kanal-turu=${KANAL.tur}`, `--guven-capasi=${KANAL.backend.guvenCapasi}`, `--pg-cizgi=${PG_CIZGI}`, `--pg-en-az=${PG_EN_AZ}`,
  `--ozet-dosyasi=${ozetDosyasi}`, `--cikti=${CIKTI}`,
  ...(PG_KUNYE ? [`--pg-kunye=${PG_KUNYE}`] : []),
  ...(arg('min-kaynak') ? [`--min-kaynak=${arg('min-kaynak')}`] : []),
  ...(argv.includes('--zorunlu') ? ['--zorunlu'] : []),
  ...(KURU ? [] : [`--anahtar=${ANAHTAR}`]),
];
const arac = spawnSync(process.execPath, aracArg, { cwd: TEKS, stdio: 'inherit' });
if (arac.status !== 0) dur(`Bildirim üretilemedi (backend-bildirim.ts çıkış ${arac.status})`, 'Yukarıdaki satır nedeni söyler; hiçbir şey yüklenmedi.');
const sonuc = JSON.parse(fs.readFileSync(path.join(CIKTI, 'sonuc.json'), 'utf8'));
const B = sonuc.bildirim;
if (B.surum !== SURUM || B.kanal !== MUSTERI) dur('Bildirim künyeyle bağlanmıyor', `${B.surum}/${B.kanal} ≠ ${SURUM}/${MUSTERI}`);
const sha16 = B.paket.sha256.slice(0, 16);
bilgi(`✓ paket ${B.paket.ad} · ${B.paket.boyut} B · sha256 ${sha16}… · kid ${B.paketImzaKid} · PG ${B.pg.cizgi} ≥ ${B.pg.enAz}${B.pg.hedef ? ` · hedef ${B.pg.hedef.surum}-${B.pg.hedef.derleme}` : ''}`);
// CI kökeni imzalı künyeden (bütünlük yukarıda TAM denetlendi); kaçış DURDURMAZ, uyarır ve deftere girer.
let ciKokeni = null;
try {
  ciKokeni = ciKokeniOku(execFileSync('unzip', ['-p', PAKET, 'butunluk.jws'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
} catch {
  ciKokeni = null;
}
const CI_ATLA = ciAtlaMetni(ciKokeni);
if (CI_ATLA) bilgi(`⚠ CI KAÇIŞI: bu paketin üretim imzası CI koşusu OLMADAN atıldı — kullanıcının cümlesi ${CI_ATLA}`);
else if (ciKokeni?.kip === 'kosu') bilgi(`✓ CI kökeni: koşu ${ciKokeni.kosu} · ${ciKokeni.dal} · ${String(ciKokeni.commit).slice(0, 12)}`);
else bilgi('ℹ CI kökeni künyede yok (hazırlık imzası ya da G22 öncesi paket)');

const plan = yayinPlani({
  vdsBackend: KANAL.yayin.vdsBackend,
  backendDefter: KANAL.yayin.backendDefter,
  surum: SURUM,
  paketAd: B.paket.ad,
  damga: crypto.randomBytes(6).toString('hex'),
});

/* ------------------------------------------------------------------ *
 * 4) Uzak kapılar — belirteç · monotonluk · değişmezlik (yüklemeden ÖNCE)
 * ------------------------------------------------------------------ */

if (KURU) {
  bilgi('[kuru] kenar belirteci, yayındaki sürüm ve sürüm dizininin varlığı ÖLÇÜLMEDİ (ağ yok)');
} else {
  try {
    belirtecOku(KANAL.yayin.backendManifest);
  } catch (e) {
    if (e instanceof BelirtecYok) dur('YAYIN BELİRTECİ YOK — yayından sonra kenar doğrulanamaz; hiçbir şey yüklenmedi', e.message);
    throw e;
  }
  const mevcut = yayinOku(KANAL.yayin.backendManifest, { kayit: KAYIT, hedef: SSH_HEDEF });
  if (mevcut.durum === 'olculemedi') dur('Kanalın yayındaki son.json ÖLÇÜLEMEDİ', mevcut.neden);
  if (mevcut.durum === 'var') {
    const once = isaretciSurumu(mevcut.govde);
    if (!once) dur('Yayındaki son.json çözülemedi (işaretçi biçimsiz) — elle incele', KANAL.yayin.backendManifest);
    if ((surumKiyasla(SURUM, once) ?? 0) <= 0) {
      dur(`${SURUM} kanalda yayındaki ${once}'dan YENİ değil`, 'Yayında geri inme yok; yeni paket yeni sürüm numarası alır (prova sürümlerinde sha sırası tanımsızdır).');
    }
    bilgi(`✓ monotonluk: ${once} → ${SURUM}`);
  } else bilgi('✓ kanalın İLK backend yayını (son.json yok)');
  const var_ = uzak(plan.komut.varMi, 'sürüm dizini var mı?', { sessiz: true });
  if (var_.status === 0) dur(`${plan.surumDizini} ZATEN VAR — yayınlanmış sürüm EZİLMEZ`);
  if (PG_HEDEF) {
    const pgPlan = pgYayinPlani({ vdsBackend: KANAL.yayin.vdsBackend, surum: PG_HEDEF.surum, derleme: PG_HEDEF.derleme, paketAd: PG_HEDEF.paket.ad, damga: 'denetim' });
    if (uzak(pgPlan.komut.hazirMi, 'hedeflenen PG paketi kanalda mı?', { sessiz: true }).status !== 0) {
      dur(`PG ${PG_HEDEF.surum}-${PG_HEDEF.derleme} bu kanalda YOK — önce: --pg-yayinla --pg-paket=<zip> --pg-kunye=<pg.json>`, 'Bildirim yayınlanmadı: hedef paket olmadan kurulumlar PG adımında düşerdi.');
    }
    bilgi(`✓ hedeflenen PG paketi kanalda: ${pgPlan.dizin}`);
  }
}

/* ------------------------------------------------------------------ *
 * 5) Yükleme — geçici dizin → ölç → yeniden adla → son.json EN SON
 * ------------------------------------------------------------------ */

uzakZorunlu(plan.komut.geciciAc, `geçici dizin: ${plan.gecici}`);
gonder(PAKET, `${plan.gecici}/${B.paket.ad}`, `paket → ${plan.gecici}/`);
const isaretci = path.join(CIKTI, 'surum.json');
gonder(isaretci, `${plan.gecici}/surum.json`, 'sürüm işaretçisi (surum.json)');
if (!KURU) {
  const olcum = uzakZorunlu(plan.komut.olc, 'uzakta boy + sha256 ölçülüyor');
  const [ozetU, boyU] = String(olcum.stdout).trim().split(/\s+/);
  const tutar = ozetU === B.paket.sha256 && Number(boyU) === B.paket.boyut;
  if (!tutar) {
    uzak(plan.komut.geciciSil, 'yarım yükleme siliniyor');
    dur('Uzaktaki dosya bildirimle TUTMUYOR — yayın yapılmadı', `beklenen ${B.paket.sha256}/${B.paket.boyut} · uzak ${ozetU}/${boyU}`);
  }
  bilgi('✓ uzak ölçüm bildirimle birebir');
}
uzakZorunlu(plan.komut.yayinla, `sürüm dizini yayında: ${plan.surumDizini}`);
gonder(isaretci, plan.sonJsonGecici, 'son.json (geçici ad)');
uzakZorunlu(plan.komut.sonJsonYaz, 'son.json EN SON yerine taşındı');

const satir = defterSatiri({
  zaman: istanbulSaati(),
  surum: SURUM,
  kim: `${os.userInfo().username}@${os.hostname().split('.')[0]}`,
  sha16,
  boyut: B.paket.boyut,
  terfiAtla: TERFI_ATLA !== undefined ? cumleDenetle(TERFI_ATLA).cumle : null,
  ciAtla: CI_ATLA,
});
const defter = uzak(defterKomutu(plan.defter, satir), 'yayın defteri');
if (!KURU && defter.status !== 0) bilgi('⚠ yayın defteri yazılamadı (yayın etkilenmedi)');

if (KURU) {
  console.log(`\n${BAR}\n  KURU — hiçbir şey yüklenmedi; imzasız bildirim: ${path.join(CIKTI, 'sonuc.json')}\n${BAR}\n`);
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * 6) Kenar doğrulaması + bildirim + terfi kaçış kaydı
 * ------------------------------------------------------------------ */

const yerel = fs.readFileSync(isaretci, 'utf8');
const kenar = await kenardanOku(KANAL.yayin.backendManifest);
if (kenar.durum !== 200 || kenar.govde !== yerel) {
  dur(`KENAR son.json yüklenenle AYNI DEĞİL (HTTP ${kenar.durum})`, 'Önbellek ya da Worker yapılandırmasını incele; kurulumlar bu sürümü GÖRMEYEBİLİR.');
}
bilgi('✓ kenarda son.json yüklenenle bayt bayt aynı');
await yayinSonrasiBildir({ urun: 'backend', kanal: MUSTERI, surum: SURUM, ayrinti: { sha16, boyut: String(B.paket.boyut) }, terfiAtla: TERFI_ATLA });
if (terfi.atlandi) {
  const k = terfiAtlaKaydi({ kod: MUSTERI, urun: 'backend', surum: SURUM, cumle: terfi.atlandi.cumle });
  bilgi(k.durum === 'basarisiz' ? `⚠ terfi atlama etiketi atılamadı: ${k.not}` : `✓ terfi atlama etiketi: ${k.ad}`);
}
fs.rmSync(CIKTI, { recursive: true, force: true });
console.log(`\n${BAR}\n  ✔ backend ${SURUM} "${MUSTERI}" kanalında yayında — kurulumlar politikalarına göre alır${CI_ATLA ? `\n  ⚠ CI KAÇIŞLI imza: ${CI_ATLA}` : ''}\n${BAR}\n`);
