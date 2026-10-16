#!/usr/bin/env node
// =============================================================================
// PLAY MAĞAZA GİRİŞİ (deploy/play-magaza.mjs + */magaza/) — ağsız, DB'siz.
//   §1 kaynak: iki uygulamanın metinleri Play sınırlarında (başlık ≤30, kısa ≤80, tam ≤4000), varsayılan dil var
//   §2 görsel: simge 512×512 RGBA · öne çıkan 1024×500 alfasız · ekran görüntüsü alfasız, kenar oranı ≤ 2, en çok 8
//   §3 red: sınır aşan metin, eksik varsayılan dil, tablet için üretim ataması, yüzdesiz üretim
//   §4 sır: magaza/ altında inceleme hesabının e-postası/parolası/TOTP izi yok; ham (maskesiz) görüntü yok
// Koşum: node scripts/test_play_magaza.mjs
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { argumanlar, kaynakOku, UYGULAMALAR } from '../deploy/play-magaza.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let gecti = 0;
let kaldi = 0;
const ol = (ad, kosul, ayrinti = '') => { kosul ? gecti++ : kaldi++; console.log(`  ${kosul ? '✅' : '❌'} ${ad}${!kosul && ayrinti ? ` — ${ayrinti}` : ''}`); };
const atar = (f) => { try { f(); return null; } catch (e) { return e.message; } };

/** PNG IHDR: genişlik, yükseklik, renk tipi (2 = RGB, 6 = RGBA). */
function png(yol) {
  const b = fs.readFileSync(yol);
  if (b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`PNG değil: ${yol}`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), derinlik: b[24], tip: b[25] };
}

console.log('§1–§2 kaynak ve görseller');
for (const [ad, u] of Object.entries(UYGULAMALAR)) {
  const dizin = path.join(KOK, u.dizin);
  let k = null;
  const hata = atar(() => { k = kaynakOku(dizin); });
  ol(`${ad}: metinler.json Play sınırlarında`, !hata, hata);
  if (!k) continue;
  ol(`${ad}: tr-TR + en-US var, varsayılan tr-TR`, k.metin.listings['tr-TR'] && k.metin.listings['en-US'] && k.metin.details.defaultLanguage === 'tr-TR');
  ol(`${ad}: iletişim e-postası`, k.metin.details.contactEmail === 'info@etkiliyazilim.com');
  const i = k.gorsel.icon && png(k.gorsel.icon[0]);
  ol(`${ad}: simge 512×512 RGBA 8 bit`, i && i.w === 512 && i.h === 512 && i.tip === 6 && i.derinlik === 8, JSON.stringify(i));
  const f = k.gorsel.featureGraphic && png(k.gorsel.featureGraphic[0]);
  ol(`${ad}: öne çıkan 1024×500 alfasız`, f && f.w === 1024 && f.h === 500 && f.tip === 2, JSON.stringify(f));
  for (const t of ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots']) {
    for (const y of k.gorsel[t] ?? []) {
      const p = png(y);
      const oran = Math.max(p.w, p.h) / Math.min(p.w, p.h);
      ol(`${ad}: ${t}/${path.basename(y)} alfasız, oran ≤ 2, kenar 320..3840`, p.tip === 2 && oran <= 2 && Math.min(p.w, p.h) >= 320 && Math.max(p.w, p.h) <= 3840, JSON.stringify(p));
    }
  }
}

console.log('§3 red');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'play-magaza-'));
try {
  const yaz = (m) => fs.writeFileSync(path.join(tmp, 'metinler.json'), JSON.stringify(m));
  const l = { title: 'T', shortDescription: 'k', fullDescription: 't' };
  yaz({ details: { defaultLanguage: 'tr-TR' }, listings: { 'tr-TR': { ...l, shortDescription: 'x'.repeat(81) } } });
  ol('81 karakter kısa açıklama RED', /shortDescription/.test(atar(() => kaynakOku(tmp)) ?? ''));
  yaz({ details: { defaultLanguage: 'tr-TR' }, listings: { 'tr-TR': { ...l, title: 'ş'.repeat(30) } } });
  ol('30 karakter (çok baytlı) başlık geçer', atar(() => kaynakOku(tmp)) === null);
  yaz({ details: { defaultLanguage: 'tr-TR' }, listings: { 'tr-TR': { ...l, fullDescription: '' } } });
  ol('boş tam açıklama RED', /fullDescription/.test(atar(() => kaynakOku(tmp)) ?? ''));
  yaz({ details: { defaultLanguage: 'en-US' }, listings: { 'tr-TR': l } });
  ol('listings içinde olmayan varsayılan dil RED', /defaultLanguage/.test(atar(() => kaynakOku(tmp)) ?? ''));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
ol('tablet için üretim ataması RED', /YAPILMAZ/.test(atar(() => argumanlar(['--app=tablet', '--uretim=62', '--yuzde=20'])) ?? ''));
ol('yüzdesiz üretim RED', /yuzde/.test(atar(() => argumanlar(['--app=yonetim', '--uretim=1'])) ?? ''));
ol('bilinmeyen uygulama RED', /--app/.test(atar(() => argumanlar(['--app=patron'])) ?? ''));
ol('yonetim %20 kabul', atar(() => argumanlar(['--app=yonetim', '--uretim=1', '--yuzde=20', '--uygula'])) === null);

console.log('§4 sır ve ham görüntü');
for (const u of Object.values(UYGULAMALAR)) {
  const dizin = path.join(KOK, u.dizin);
  const dosyalar = fs.readdirSync(dizin, { recursive: true }).map(String);
  ol(`${u.dizin}: ham/maskesiz görüntü dosyası yok`, !dosyalar.some((d) => /ham|raw|maskesiz/i.test(d)), dosyalar.join(','));
  const metin = dosyalar.filter((d) => /\.(json|txt|md)$/.test(d)).map((d) => fs.readFileSync(path.join(dizin, d), 'utf8')).join('\n');
  ol(`${u.dizin}: inceleme hesabı izi yok`, !/play-inceleme|otpauth:|totp.*[A-Z2-7]{16,}/i.test(metin));
}

console.log(`\n${gecti} geçti · ${kaldi} kaldı`);
process.exit(kaldi ? 1 : 0);
