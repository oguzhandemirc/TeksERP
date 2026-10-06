// =============================================================================
// DERLEME BAĞI — yayınlanan bayt ↔ onaylanan commit (G22 / DAGY-5)
// =============================================================================
// Terfi kapısı "HEAD == <ürün>-vX" ölçer; ama yüklenen artefakt önceden derlenmiştir ve hangi commit'ten
// derlendiğini taşımıyorsa onay ile sahaya giden bayt arasında bağ yoktur. Üç halka:
//   ① PAKETLEME temiz ağaç ister (commit'lenmemiş/izlenmeyen kaynak = DUR). Tek istisna paketlemenin
//      kendi yazdığı sürüm alanlarıdır (numara koda aittir, yayından sonra commit'lenir) — `SURUM_ALANLARI`.
//   ② Derleme, artefaktın yanına DERLEME KÜNYESİ yazar: commit + dosya özeti (+ sürüm).
//   ③ YAYIN künyeyi artefakta (özet), HEAD'e ve — üretim kanalında — terfi etiketinin commit'ine bağlar.
// Üç sonuç: uyumlu · ihlal · ÖLÇÜLEMEDİ (okunamayan git/dosya geçmiş kapı değildir).
// =============================================================================

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { KOK, Olculemedi } from './dagitim.mjs';
import { terfiEtiketAdi } from './surum.mjs';

export const DERLEME_KUNYESI_SURUMU = 1;
/** Panel paket dizinindeki künye adı; APK'da `<apk>.derleme.json`, OTA'da `yayin.json` alanları. */
export const PANEL_KUNYE_ADI = 'derleme.json';
export const apkKunyeYolu = (apkYol) => `${apkYol}.derleme.json`;

/** Paketlemenin KENDİ yazdığı sürüm alanları: bu dosyalarda yalnız bu alanların farkı kirlilik sayılmaz. */
export const SURUM_ALANLARI = {
  'Electron/package.json': [['version']],
  'mobil/app.json': [['expo', 'version'], ['expo', 'android', 'versionCode']],
};

const COMMIT = /^[0-9a-f]{40,64}$/;

function git(kok, args) {
  try {
    return { kod: 0, cikti: execFileSync('git', args, { cwd: kok, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }) };
  } catch (e) {
    return { kod: typeof e.status === 'number' ? e.status : -1, cikti: String(e.stdout ?? ''), hata: String(e.stderr ?? e.message ?? '').trim() };
  }
}

/** HEAD commit'i; okunamazsa ÖLÇÜLEMEDİ. */
export function basCommit(kok = KOK) {
  const r = git(kok, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const c = r.cikti.trim();
  if (r.kod !== 0 || !COMMIT.test(c)) throw new Olculemedi(`git HEAD okunamadı (${kok}): ${r.hata || c || 'çıktı yok'}`);
  return c;
}

const al = (o, yol) => yol.reduce((x, k) => (x == null ? undefined : x[k]), o);
function koy(o, yol, v) {
  let x = o;
  for (const k of yol.slice(0, -1)) {
    if (x[k] == null || typeof x[k] !== 'object') return;
    x = x[k];
  }
  if (v === undefined) delete x[yol[yol.length - 1]];
  else x[yol[yol.length - 1]] = v;
}

/** Dosyanın HEAD hâli ile çalışma hâli yalnız izinli sürüm alanlarında mı ayrışıyor? Ayrışan alanları döndürür; başka fark varsa null. */
function yalnizSurumFarki(kok, rel) {
  const head = git(kok, ['show', `HEAD:${rel}`]);
  if (head.kod !== 0) return null;
  let h;
  let w;
  try {
    h = JSON.parse(head.cikti);
    w = JSON.parse(fs.readFileSync(path.join(kok, rel), 'utf8'));
  } catch {
    return null;
  }
  const alanlar = [];
  for (const yol of SURUM_ALANLARI[rel]) {
    if (JSON.stringify(al(h, yol)) !== JSON.stringify(al(w, yol))) alanlar.push(`${yol.join('.')} ${al(h, yol)} → ${al(w, yol)}`);
    koy(w, yol, al(h, yol));
  }
  return JSON.stringify(w) === JSON.stringify(h) ? alanlar : null;
}

/**
 * Paketleme öncesi çalışma ağacı: commit'lenmemiş ya da izlenmeyen (yoksayılmayan) her dosya KİRLİLİKTİR.
 * @returns {{ sonuc: 'temiz'|'kirli'|'olculemedi', commit: string|null, kirli: string[], izinli: string[], satirlar: string[] }}
 */
export function temizAgacDenetimi({ kok = KOK } = {}) {
  let commit;
  try {
    commit = basCommit(kok);
  } catch (e) {
    return { sonuc: 'olculemedi', commit: null, kirli: [], izinli: [], satirlar: [e.message] };
  }
  const r = git(kok, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (r.kod !== 0) return { sonuc: 'olculemedi', commit, kirli: [], izinli: [], satirlar: [`git status okunamadı: ${r.hata}`] };
  const kirli = [];
  const izinli = [];
  const girdiler = r.cikti.split('\0').filter(Boolean);
  for (let i = 0; i < girdiler.length; i += 1) {
    const xy = girdiler[i].slice(0, 2);
    const rel = girdiler[i].slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i += 1; // -z'de yeniden adlandırmanın kaynak yolu ayrı girdidir
    const yalnizDegisti = /^[ M][ M]$/.test(xy);
    const fark = yalnizDegisti && SURUM_ALANLARI[rel] ? yalnizSurumFarki(kok, rel) : null;
    if (fark) {
      if (fark.length) izinli.push(`${rel}: ${fark.join(' · ')}`);
      continue;
    }
    kirli.push(`${xy.replace(/ /g, '·')} ${rel}`);
  }
  if (kirli.length) {
    return { sonuc: 'kirli', commit, kirli, izinli, satirlar: [
      `çalışma ağacı TEMİZ DEĞİL (${kirli.length} dosya) — paket commit'lenmemiş içerik taşırdı:`,
      ...kirli.slice(0, 20).map((x) => `  ${x}`),
      ...(kirli.length > 20 ? [`  … +${kirli.length - 20}`] : []),
      "Commit'le (ya da kenara al) ve yeniden paketle; yayın bu commit'e bağlanır.",
    ] };
  }
  return { sonuc: 'temiz', commit, kirli, izinli, satirlar: [`çalışma ağacı temiz · commit ${commit.slice(0, 12)}${izinli.length ? ` · yalnız sürüm alanı: ${izinli.join(' ; ')}` : ''}`] };
}

/** Dosya özeti (akışla): boyut + sha256 (hex) + sha512 (base64 — electron-builder `latest.yml` biçimi). */
export function dosyaOzeti(yol) {
  let fd;
  try {
    fd = fs.openSync(yol, 'r');
  } catch (e) {
    throw new Olculemedi(`artefakt okunamadı: ${yol} (${e.code ?? e.message})`);
  }
  const h256 = crypto.createHash('sha256');
  const h512 = crypto.createHash('sha512');
  const tampon = Buffer.alloc(1024 * 1024);
  let boyut = 0;
  try {
    for (;;) {
      const n = fs.readSync(fd, tampon, 0, tampon.length, null);
      if (n <= 0) break;
      h256.update(tampon.subarray(0, n));
      h512.update(tampon.subarray(0, n));
      boyut += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { boyut, sha256: h256.digest('hex'), sha512: h512.digest('base64') };
}

/** Derleme künyesi: `{v, urun, kanal, surum, commit, dosya, boyut, sha256, sha512, ...ek}` (artefaktın yanına). */
export function derlemeKunyesiYaz(hedef, { urun, kanal, surum, commit, dosyaYolu, ek = {} }) {
  if (!COMMIT.test(String(commit ?? ''))) throw new Olculemedi(`derleme künyesi: commit biçimsiz "${commit}"`);
  const oz = dosyaOzeti(dosyaYolu);
  const k = { v: DERLEME_KUNYESI_SURUMU, urun, kanal, surum, commit, dosya: path.basename(dosyaYolu), ...oz, ...ek };
  fs.writeFileSync(hedef, `${JSON.stringify(k, null, 2)}\n`);
  return k;
}

/** Künyeyi okur; yoksa null, bozuksa ÖLÇÜLEMEDİ. */
export function derlemeKunyesiOku(yol) {
  if (!fs.existsSync(yol)) return null;
  try {
    return JSON.parse(fs.readFileSync(yol, 'utf8'));
  } catch (e) {
    throw new Olculemedi(`derleme künyesi okunamadı: ${yol} (${e.message})`);
  }
}

/** `refs/tags/terfi/<kanal>/<ürün>-v<sürüm>` etiketinin commit'i; yoksa null. */
export function terfiEtiketiCommit({ kok = KOK, kanal, urun, surum }) {
  const r = git(kok, ['rev-parse', '-q', '--verify', `refs/tags/${terfiEtiketAdi(kanal, urun, surum)}^{commit}`]);
  const c = r.cikti.trim();
  if (r.kod === 0 && COMMIT.test(c)) return c;
  if (r.kod === 1 && !c) return null;
  throw new Olculemedi(`git terfi etiketi çözülemedi: ${r.hata || c}`);
}

/**
 * Yayın anı: künye ↔ artefakt ↔ HEAD ↔ (üretim kanalında) terfi etiketi.
 * @param {object} o
 * @param {object|null} o.kunye derlemeKunyesiOku() · @param {{urun,kanal,surum}} o.beklenen
 * @param {{boyut:number, sha256:string, sha512:string}} o.ozet artefaktın ölçülen özeti
 * @param {string|null|undefined} o.gomuluCommit artefaktın İÇİNE gömülen commit (panelde asar package.json) — verilmezse ölçülmez
 * @param {string|null} o.terfiUrunu terfi etiketinin ürünü (panel|tablet); null = kanal terfi istemiyor ya da kaçış verildi
 * @returns {{ sonuc: 'uyumlu'|'ihlal'|'olculemedi', satirlar: string[] }}
 */
export function derlemeBagiDenetimi({ kok = KOK, kunye, kunyeYolu, beklenen, ozet, gomuluCommit, terfiUrunu = null }) {
  const ihlal = [];
  if (!kunye) {
    return { sonuc: 'ihlal', satirlar: [
      `DERLEME KÜNYESİ YOK: ${kunyeYolu} — paket hangi commit'ten derlendiğini taşımıyor (eski paketleme betiği ya da elle taşınmış artefakt).`,
      'Bu commit\'te temiz ağaçtan yeniden paketle/derle; künye artefaktın yanında taşınır.',
    ] };
  }
  if (kunye.v !== DERLEME_KUNYESI_SURUMU) ihlal.push(`künye sürümü ${kunye.v} tanınmıyor (${DERLEME_KUNYESI_SURUMU} bekleniyor)`);
  for (const a of ['urun', 'kanal', 'surum']) {
    if (kunye[a] !== beklenen[a]) ihlal.push(`künye ${a} "${kunye[a]}" — yayın "${beklenen[a]}" bekliyor`);
  }
  if (!COMMIT.test(String(kunye.commit ?? ''))) ihlal.push(`künyede commit yok/biçimsiz ("${kunye.commit}")`);
  if (kunye.boyut !== ozet.boyut || kunye.sha256 !== ozet.sha256 || kunye.sha512 !== ozet.sha512) {
    ihlal.push(`artefakt künyedeki özetle TUTMUYOR (künye ${String(kunye.sha256).slice(0, 16)}… ${kunye.boyut} B · dosya ${ozet.sha256.slice(0, 16)}… ${ozet.boyut} B) — derlemeden sonra değişmiş ya da başka derlemenin dosyası`);
  }
  if (gomuluCommit !== undefined && gomuluCommit !== kunye.commit) {
    ihlal.push(`artefaktın İÇİNDEKİ commit (${String(gomuluCommit).slice(0, 12)}) künyeninkiyle (${String(kunye.commit).slice(0, 12)}) aynı değil`);
  }
  let bas;
  try {
    bas = basCommit(kok);
  } catch (e) {
    return { sonuc: 'olculemedi', satirlar: [e.message] };
  }
  if (COMMIT.test(String(kunye.commit ?? '')) && bas !== kunye.commit) {
    ihlal.push(`paket ${kunye.commit.slice(0, 12)} commit'inden derlenmiş, HEAD ${bas.slice(0, 12)} — yayın (ve atılacak sürüm etiketi) derlenen commit'te yapılır: git checkout --detach ${kunye.commit.slice(0, 12)}`);
  }
  if (terfiUrunu) {
    let tc;
    try {
      tc = terfiEtiketiCommit({ kok, kanal: beklenen.kanal, urun: terfiUrunu, surum: beklenen.surum });
    } catch (e) {
      return { sonuc: 'olculemedi', satirlar: [e.message] };
    }
    const ad = terfiEtiketAdi(beklenen.kanal, terfiUrunu, beklenen.surum);
    if (!tc) ihlal.push(`${ad} etiketi YOK — onaylanan commit ölçülemez`);
    else if (tc !== kunye.commit) ihlal.push(`${ad} ${tc.slice(0, 12)} commit'ini onaylıyor, paket ${String(kunye.commit).slice(0, 12)} commit'inden derlenmiş — onaylanan kod bu bayt DEĞİL`);
  }
  if (ihlal.length) return { sonuc: 'ihlal', satirlar: ihlal };
  return { sonuc: 'uyumlu', satirlar: [`derleme bağı: ${beklenen.urun} ${beklenen.surum} · commit ${kunye.commit.slice(0, 12)} = HEAD${terfiUrunu ? ' = terfi etiketi' : ''} · özet tutuyor`] };
}
