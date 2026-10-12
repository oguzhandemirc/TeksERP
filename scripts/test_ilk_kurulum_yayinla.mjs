#!/usr/bin/env node
// =============================================================================
// BEKÇİ — İLK KURULUM DEPOSU YAYINI (`deploy/kurulum/ilk-kurulum-yayinla.mjs` + `scripts/lib/ilk-kurulum-baglanti.mjs`)
// =============================================================================
// Ağsız: PATH'in önüne sahte `ssh`/`scp` (çağrıyı günlüğe yazar, "yok" der). NE ÖLÇER:
//   §1 argüman + grup kapısı: zorunlu argümanlar · tanınmayan argüman · eski kanal kodu / kayıtsız grup → 2, ağa çıkılmaz
//   §2 paket + setup: PROVA paketi ve setup adı ≠ paket sürümü → DUR 1, ağa çıkılmaz
//   §3 terfi kapısı (saf + uçtan uca): kök grup (test) otomatik; oncu/genel AÇIKLAMALI `terfi/<grup>/backend-v<s>`
//      etiketini `backend-v<s>` commit'inde ister — etiketsiz / hafif etiket / başka commit → DUR (uçtan uca: ssh YOK);
//      test grubu terfiyi geçer ve yayındaki backend'i VDS'ten okumaya gider (sahte ssh "yok" → DUR 1)
//   §4 backend-yayinla bağlantısı: girdi yok/eksik/tam · pg künyesi yedeği · argv sırası ve --uygula · latest.yml'den
//      panel adı yalnız güvenli tek bileşen
// Koşum: node scripts/test_ilk_kurulum_yayinla.mjs   (çıkış 0 yeşil · 1 kırmızı)
// =============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Alt araçlar (kurulum-arsivi → imza doğrulayıcıları) parola kasasına gitmesin: bekçi gerçek Anahtar Zinciri'ne dokunmaz.
process.env.TEKSERP_PAROLA_KASASI = 'kapali';
const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BETIK = path.join(KOK, 'deploy', 'kurulum', 'ilk-kurulum-yayinla.mjs');
const y = await import(BETIK);
const b = await import(path.join(KOK, 'scripts', 'lib', 'ilk-kurulum-baglanti.mjs'));
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ilk-kurulum-yayinla-'));
let gecti = 0;
let kaldi = 0;
function check(ad, ok, ek = '') {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? '✅' : '❌'} ${ad}${!ok && ek ? ` — ${ek}` : ''}`);
}

const SAHTE = path.join(TEMP, 'bin');
const LOG = path.join(TEMP, 'ag.log');
fs.mkdirSync(SAHTE);
for (const arac of ['ssh', 'scp']) fs.writeFileSync(path.join(SAHTE, arac), `#!/bin/sh\necho "${arac} $*" >> "$AG_LOG"\ncat >/dev/null\nexit 44\n`, { mode: 0o755 });
function kos(args) {
  fs.writeFileSync(LOG, '');
  const r = spawnSync(process.execPath, [BETIK, ...args], { cwd: KOK, encoding: 'utf8', env: { ...process.env, PATH: `${SAHTE}:${process.env.PATH}`, AG_LOG: LOG, HOME: TEMP }, timeout: 120_000 });
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}`, ag: fs.readFileSync(LOG, 'utf8') };
}
const ozet = (r) => `kod ${r.kod} · ${r.cikti.trim().split('\n').slice(-3).join(' | ').slice(0, 260)}`;

function zipKur(ad, paket) {
  const d = path.join(TEMP, `z-${ad}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'PAKET.json'), JSON.stringify(paket));
  const zip = path.join(TEMP, `tekserp-backend-${ad}.zip`);
  spawnSync('zip', ['-q', '-X', zip, 'PAKET.json'], { cwd: d });
  return zip;
}
const dosya = (ad) => {
  const f = path.join(TEMP, ad);
  fs.writeFileSync(f, 'x');
  return f;
};
const ZIP = zipKur('9.9.9', { uygulamaSurumu: '9.9.9', prova: false });
const SETUP = dosya('TeksERP-Kurulum-9.9.9.exe');
const PG = dosya('postgresql-16.zip');
const PGK = dosya('pg.json');
const temel = (grup, ek = {}) => {
  const a = { '--grup': grup, '--backend': ZIP, '--setup': SETUP, '--pg': PG, '--pg-kunye': PGK, ...ek };
  return Object.entries(a).filter(([, v]) => v !== null).flat();
};

// §1
console.log('\n§1 argüman + grup kapısı');
{
  const r = kos([]);
  check('§1a argümansız → 2, zorunlular listelenir, ağa çıkılmaz', r.kod === 2 && /--grup gerekli/.test(r.cikti) && /--pg-kunye gerekli/.test(r.cikti) && r.ag === '', ozet(r));
  const t = kos([...temel('test'), '--bilinmeyen']);
  check('§1b tanınmayan argüman → 2', t.kod === 2 && /tanınmayan argüman: --bilinmeyen/.test(t.cikti) && t.ag === '', ozet(t));
  const e = kos(temel('testfabrika'));
  check('§1c ⭐ eski kanal kodu grup olarak → 2 (ESKİ KANAL), ağa çıkılmaz', e.kod === 2 && /ESKİ KANAL kodu/.test(e.cikti) && e.ag === '', ozet(e));
  const k = kos(temel('hazirlik'));
  check('§1d kayıtsız grup → 2', k.kod === 2 && /kayıtlı bir güncelleme grubu değil/.test(k.cikti) && k.ag === '', ozet(k));
  const yok = kos(temel('test', { '--pg': path.join(TEMP, 'olmayan.zip') }));
  check('§1e olmayan girdi dosyası → 2', yok.kod === 2 && /--pg dosyası yok/.test(yok.cikti) && yok.ag === '', ozet(yok));
}

// §2
console.log('\n§2 paket + setup');
{
  const pr = kos(temel('test', { '--backend': zipKur('prova', { uygulamaSurumu: '9.9.9-prova.abc', prova: true }) }));
  check('§2a PROVA paketi → DUR 1, ağa çıkılmaz', pr.kod === 1 && /yayın sürümü değil/.test(pr.cikti) && pr.ag === '', ozet(pr));
  const s = kos(temel('test', { '--setup': dosya('TeksERP-Kurulum-0.0.0-git.abc.exe') }));
  check('§2b ⭐ setup adı paket sürümünü taşımıyor (CI sınama setup\'ı) → DUR 1, ağa çıkılmaz', s.kod === 1 && /TeksERP-Kurulum-9\.9\.9\.exe beklenir/.test(s.cikti) && s.ag === '', ozet(s));
  check('§2c setupAdiHatasi: aynı sürüm null', y.setupAdiHatasi('TeksERP-Kurulum-2.15.6.exe', '2.15.6') === null && y.setupAdiHatasi('TeksERP-Kurulum-2.15.5.exe', '2.15.6') !== null);
}

// §3
console.log('\n§3 terfi kapısı');
{
  const C = 'a'.repeat(40);
  const D = 'b'.repeat(40);
  const kok = y.terfiKarari({ grup: 'test', kaynak: null, surum: '9.9.9', git: null });
  check('§3a kök grup (test) etiket istemez, "yalnız deneme/test kurulumları" der', kok.ok && /deneme\/test kurulumları/.test(kok.satir));
  const yok = y.terfiKarari({ grup: 'genel', kaynak: 'oncu', surum: '9.9.9', git: { surumEtiketi: C, terfiEtiketi: null } });
  check('§3b ⭐ genel, terfi etiketi YOK → RED (müşteri paketi yalnız terfiyle)', !yok.ok && /terfi\/genel\/backend-v9\.9\.9 etiketi YOK/.test(yok.neden), yok.neden);
  const hafif = y.terfiKarari({ grup: 'oncu', kaynak: 'test', surum: '9.9.9', git: { surumEtiketi: C, terfiEtiketi: { tur: 'commit', commit: C, mesaj: '' } } });
  check('§3c ⭐ hafif (açıklamasız) terfi etiketi → RED', !hafif.ok && /AÇIKLAMALI değil/.test(hafif.neden), hafif.neden);
  const baska = y.terfiKarari({ grup: 'oncu', kaynak: 'test', surum: '9.9.9', git: { surumEtiketi: C, terfiEtiketi: { tur: 'tag', commit: D, mesaj: 'onay' } } });
  check('§3d ⭐ terfi etiketi başka commit\'te → RED', !baska.ok && /commit'inde .* değil/.test(baska.neden), baska.neden);
  const surumsuz = y.terfiKarari({ grup: 'oncu', kaynak: 'test', surum: '9.9.9', git: { surumEtiketi: null, terfiEtiketi: { tur: 'tag', commit: D, mesaj: 'onay' } } });
  check('§3e sürüm etiketi yok → RED', !surumsuz.ok && /backend-v9\.9\.9 etiketi yok/.test(surumsuz.neden), surumsuz.neden);
  const ok = y.terfiKarari({ grup: 'genel', kaynak: 'oncu', surum: '9.9.9', git: { surumEtiketi: C, terfiEtiketi: { tur: 'tag', commit: C, mesaj: 'onay' } } });
  check('§3f açıklamalı terfi etiketi sürüm commit\'inde → onaylı', ok.ok && /onaylı/.test(ok.satir));

  const o = kos(temel('oncu'));
  check('§3g ⭐ uçtan uca: oncu (bu ağaçta terfi/oncu/backend-v9.9.9 yok) → DUR 1 TERFİ YOK, ağa çıkılmaz', o.kod === 1 && /TERFİ YOK/.test(o.cikti) && o.ag === '', ozet(o));
  const t = kos(temel('test'));
  check('§3h uçtan uca: test grubu terfiyi geçer ("kök grup") ve yayındaki backend\'i VDS\'ten okur (sahte ssh "yok" → DUR 1)',
    t.kod === 1 && /kök grup/.test(t.cikti) && /yayındaki Windows backend YOK/.test(t.cikti) && /^ssh /m.test(t.ag), ozet(t));
}

// §4
console.log('\n§4 backend-yayinla bağlantısı');
{
  const argOf = (o) => (ad) => o[ad];
  check('§4a girdi yok → "yok"', b.ilkKurulumGirdisi(argOf({})).durum === 'yok');
  const e = b.ilkKurulumGirdisi(argOf({ 'ilk-kurulum-setup': 's.exe' }));
  check('§4b ⭐ kısmi → "eksik" (pg + pg künyesi listelenir)', e.durum === 'eksik' && e.eksik.join(' ') === '--ilk-kurulum-pg --ilk-kurulum-pg-kunye', JSON.stringify(e));
  const t = b.ilkKurulumGirdisi(argOf({ 'ilk-kurulum-setup': 's.exe', 'ilk-kurulum-pg': 'p.zip' }), { pgKunyeYedek: '/k/pg.json' });
  check('§4c setup + pg + yayının --pg-kunye\'si → "tam"', t.durum === 'tam' && t.girdi.pgKunye === '/k/pg.json', JSON.stringify(t));
  const y2 = b.ilkKurulumGirdisi(argOf({}), { pgKunyeYedek: '/k/pg.json' });
  check('§4d yalnız yayının --pg-kunye\'si varken → "yok" (PG yayını ilk kurulum isteği sayılmaz)', y2.durum === 'yok');
  const argv = b.ilkKurulumArgv({ grup: 'test', paket: '/p.zip', girdi: { setup: '/s.exe', pg: '/p.zip', pgKunye: '/pg.json', tkpub: '/e.tkpub' }, uygula: true });
  check('§4e argv: betik · --grup · --backend · --setup · --pg · --pg-kunye · --tkpub · --uygula',
    JSON.stringify(argv) === JSON.stringify(['deploy/kurulum/ilk-kurulum-yayinla.mjs', '--grup', 'test', '--backend', '/p.zip', '--setup', '/s.exe', '--pg', '/p.zip', '--pg-kunye', '/pg.json', '--tkpub', '/e.tkpub', '--uygula']), JSON.stringify(argv));
  const yuk = argv.map((x) => (x.startsWith('--') ? x.slice(2) : null)).filter(Boolean);
  const kabul = y.argAyristir(argv.slice(1));
  check('§4f bağlantının ürettiği argv ilk-kurulum-yayinla\'nın ayrıştırıcısından hatasız geçer', kabul.hatalar.length === 0 && kabul.a.uygula === true && yuk.length === 7, JSON.stringify(kabul.hatalar));
  check('§4g latest.yml → panel adı; yol/garip ad null',
    y.latestYmlPaneli('version: 1.6.4\npath: TeksERP-1.6.4-Setup.exe\nsha512: x\n') === 'TeksERP-1.6.4-Setup.exe' &&
      y.latestYmlPaneli('path: ../TeksERP-1.6.4-Setup.exe\n') === null && y.latestYmlPaneli('path: kotu.exe\n') === null && y.latestYmlPaneli('') === null);
  check('§4h kabukKomutu boşluklu/açılı değeri tırnaklar', b.kabukKomutu(['a b', '<x>', 'düz']) === "node 'a b' '<x>' 'düz'", b.kabukKomutu(['a b', '<x>', 'düz']));
}

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi === 0 ? 0 : 1);
