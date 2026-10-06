#!/usr/bin/env node
// =============================================================================
// TeksERP — PROFİL MATRİSİ YAYIN KAPISI (CLI) — yüklem `scripts/lib/profil-raporu.mjs`
// =============================================================================
// Kullanım (yayın betiği, hedef grup belli olduktan sonra, ilk yüklemeden ÖNCE çağırır):
//   node scripts/profil-matrisi-kapisi.mjs --grup=<grup> [--commit=<sha>] [--profil-matrisi-atla="<kullanıcının cümlesi>"]
//   --commit verilmezse HEAD alınır ve ağaç TEMİZ olmalıdır (kirli ağaçta HEAD yayınlanan şey değildir).
// Çıkış: 0 geçti/muaf/atlandı · 1 ihlal · 2 ölçülemedi (= DUR). Son satır makine okur:
//   PROFIL_MATRISI_KAPISI\t<sonuc>\t<grup>\t<commit>\t<cümle|->
// =============================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { KAYIT_REL, KOK, kayitAyristir } from './lib/dagitim.mjs';
import { KACIS_BAYRAGI, PROFIL_DIZINI_REL, profilMatrisiKapisi, raporYolu } from './lib/profil-raporu.mjs';

const argv = process.argv.slice(2);
const arg = (ad) => {
  const a = argv.find((x) => x === `--${ad}` || x.startsWith(`--${ad}=`));
  if (a === undefined) return undefined;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : '';
};
const bilinen = new Set(['grup', 'commit', KACIS_BAYRAGI.slice(2)]);
const yabanci = argv.filter((x) => !bilinen.has(x.replace(/^--/, '').split('=')[0]));
const cik = (sonuc, grup, commit, sebep, cumle) => {
  const isaret = { gecti: '✅', muaf: '⏭', atlandi: '⚠️', ihlal: '❌', olculemedi: '❌' }[sonuc] ?? '❌';
  console.log(`${isaret} profil matrisi kapısı: ${sonuc.toUpperCase()} — ${sebep}`);
  if (sonuc === 'olculemedi') console.log('   Ölçülemeyen şart geçmiş şart değildir: PM_PG_URL=… node scripts/agir-is.mjs -- npx tsx Teks-Erp/scripts/profil-matrisi.ts');
  if (sonuc === 'ihlal' && cumle === undefined) console.log(`   Acil kaçış yalnız kullanıcının cümlesiyle: ${KACIS_BAYRAGI}="<cümle>"`);
  console.log(['PROFIL_MATRISI_KAPISI', sonuc, grup ?? '-', commit ?? '-', cumle ?? '-'].join('\t'));
  process.exit({ gecti: 0, muaf: 0, atlandi: 0, ihlal: 1 }[sonuc] ?? 2);
};

if (yabanci.length) cik('olculemedi', undefined, undefined, `tanınmayan argüman: ${yabanci.join(' ')}`);
const grup = arg('grup');
if (!grup) cik('olculemedi', undefined, undefined, '--grup=<grup> zorunlu');
let kayit;
try {
  kayit = kayitAyristir(readFileSync(path.join(KOK, KAYIT_REL), 'utf8'));
} catch (e) {
  cik('olculemedi', grup, undefined, e.message);
}
let commit = arg('commit');
let kirli = false;
if (commit === undefined) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: KOK, encoding: 'utf8' }).trim();
    kirli = execFileSync('git', ['status', '--porcelain'], { cwd: KOK, encoding: 'utf8' }).trim() !== '';
  } catch (e) {
    cik('olculemedi', grup, undefined, `git okunamadı: ${e.message}`);
  }
}
const atla = arg(KACIS_BAYRAGI.slice(2));
const r = profilMatrisiKapisi({ grup, commit, kayit, profilDizini: path.join(KOK, PROFIL_DIZINI_REL), atla });
// Kök grup muaftır; diğerinde kirli ağaçtaki HEAD yayınlanan commit sayılamaz (kaçış bunu da örtmez).
if (r.sonuc !== 'muaf' && kirli) cik('olculemedi', grup, commit, 'ağaç kirli — --commit verilmeden HEAD yayınlanan commit sayılamaz');
if (r.sonuc !== 'muaf') console.log(`   rapor: ${raporYolu(commit)}`);
cik(r.sonuc, grup, commit, r.sebep, r.cumle);
