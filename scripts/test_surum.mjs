#!/usr/bin/env node
// =============================================================================
// BEKÇİ — sürüm numarası kuralı (scripts/lib/surum.mjs)
// =============================================================================
// Neden bekçi: bu kural sessiz bozulur. Yanlış tarafa kayarsa ya numaralar
// atlanır (operatör 1.1.1 için not yazarken sistem 1.1.3'e geçmiştir), ya hiç
// artmaz, ya da YAYINDAKİ bir numaranın üstüne yazılır — üçü de ancak yayın
// çıktıktan sonra, sahada fark edilir.
//
// §1-§2 saf aritmetik ve kıyas (ağ/git İSTEMEZ).
// §3 gerçek git etiketleri üzerinde koşar — GEÇİCİ bir depoda, bu deponun
//    etiketlerine DOKUNMADAN.
// §5 TERFİ KAPISI (K5, scripts/lib/terfi.mjs): saf hüküm + geçici depoda uçtan uca
//    (CLI çıkış kodları, kaçış kaydı). Ağ ve push SAHTE: PATH'in önüne sahte `ssh`
//    (yalnız VDS yayın ağacında `test -f … ; cat …` okuması, geçici dizinden cevaplar;
//    başka komut KIRMIZI), sahte `curl` (HER çağrı KIRMIZI — güncelleme sunucusu anonim
//    okumaya kapalı, 3c') ve sahte `git` (`push` ENGELLENİR) konur. Kalıcı sonda: yüklemden bir şart sökülünce
//    ilgili kontrolün kırmızıya döndüğü ölçülür.
//
//   node scripts/test_surum.mjs
// =============================================================================

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ayristir,
  etiketDefteriKiyasla,
  karsilastir,
  manifestGovdesindenSurum,
  sonrakiSurumEtiketten,
  terfiEtiketAdi,
  yamaArtir,
} from './lib/surum.mjs';
import { cumleDenetle, istanbulSaati, terfiHukmu } from './lib/terfi.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let gecti = 0;
const kaldi = [];
function ol(ad, fn) {
  try {
    fn();
    gecti += 1;
    console.log(`✅ ${ad}`);
  } catch (e) {
    kaldi.push(ad);
    console.log(`❌ ${ad}\n   ${e.message}`);
  }
}

console.log('\n§1 — Aritmetik');
ol('yama hanesi artar', () => assert.equal(yamaArtir('1.0.0'), '1.0.1'));
ol('9 → 10 (sözlüksel değil SAYISAL)', () => assert.equal(yamaArtir('1.2.9'), '1.2.10'));
ol('biçim tutmazsa null', () => assert.equal(yamaArtir('1.0'), null));
ol('ön-sürüm eki kabul edilmez', () => assert.equal(ayristir('1.0.0-rc1'), null));
ol('kıyas sayısal', () => assert.equal(karsilastir('1.0.10', '1.0.9'), 1));

console.log('\n§2 — Etiket defteri ↔ yayın kıyası');
// ⚠️ Bu kapı, etiketin bayatlamasına karşı. Gerçek yolu var: yayın başka bir
// makineden yapıldı ve etiket itilmedi. O durumda taban geride kalır ve
// YAYINDAKİ BİR NUMARANIN ÜSTÜNE yazılır — latest.yml sahadakinden ESKİ bir
// paketi gösterir, filo takılır.
ol('yayının önündeyse temiz', () =>
  assert.equal(etiketDefteriKiyasla('1.1.1', '1.1.0').durum, 'temiz'));
// ⚠️ Eşitlik 'bayat' DEĞİL ayrı bir durum: sebebi "yeni iş yok" ya da "yarım
// kalan yayın", ikisi de meşru. Davranış aynı (DUR) ama teşhis farklı — yanlış
// teşhis operatörü var olmayan bir etiket sorununu kovalamaya iter.
ol('yayınla eşitse ZATEN-YAYINDA (bayat DEĞİL)', () =>
  assert.equal(etiketDefteriKiyasla('1.1.0', '1.1.0').durum, 'zaten-yayinda'));
ol('yayının gerisindeyse BAYAT', () =>
  assert.equal(etiketDefteriKiyasla('1.0.9', '1.1.0').durum, 'bayat'));
// ⚠️ İnternetsiz ortamda paketleme mümkün kalmalı: bu bir DOĞRULAMA, kapı değil.
ol('yayın okunamazsa ölçülemedi (kapı DEĞİL)', () =>
  assert.equal(etiketDefteriKiyasla('1.1.1', null).durum, 'olculemedi'));

console.log('\n§3 — Git etiketinden sıradaki sürüm (geçici depo)');
const depo = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-surum-'));
const g = (...a) => execFileSync('git', a, { cwd: depo, encoding: 'utf8' }).trim();
try {
  g('init', '-q');
  g('config', 'user.email', 'bekci@test');
  g('config', 'user.name', 'bekci');
  g('commit', '-q', '--allow-empty', '-m', 'ilk');

  // Süreç çapında cwd değiştirmek zorundayız: sonrakiSurumEtiketten `git`i
  // bulunduğu dizinde koşturur.
  const eskiCwd = process.cwd();
  process.chdir(depo);
  try {
    ol('hiç etiket yoksa numara ÜRETİLMEZ (fail-closed)', () => {
      const k = sonrakiSurumEtiketten('panel');
      assert.equal(k.surum, null);
    });

    g('tag', '-a', 'panel-v1.1.0', '-m', 'panel 1.1.0');

    // ⚠️ ASIL KONTROL ①: HEAD etiketin üstündeyken numara KORUNUR. İki işi
    // birden görür — komutun tekrar koşumu (not kapısı kırmızı, derleme düştü)
    // ve aynı turda İKİNCİ MÜŞTERİ için ayrı derleme.
    ol('HEAD etiketteyse KORUNUR (aynı tur / ikinci müşteri)', () => {
      const k = sonrakiSurumEtiketten('panel');
      assert.equal(k.surum, '1.1.0');
      assert.equal(k.artti, false);
    });

    g('commit', '-q', '--allow-empty', '-m', 'yeni is');

    // ⚠️ ASIL KONTROL ②: kod ilerleyince artar.
    ol('HEAD ilerleyince ARTAR', () => {
      const k = sonrakiSurumEtiketten('panel');
      assert.equal(k.surum, '1.1.1');
      assert.equal(k.artti, true);
    });

    // ⚠️ Sözlüksel sıralama burada ısırır: v1.1.9 > v1.1.10 der ve numara
    // GERİ giderdi.
    g('tag', '-a', 'panel-v1.1.9', '-m', 'p');
    g('commit', '-q', '--allow-empty', '-m', 'x');
    g('tag', '-a', 'panel-v1.1.10', '-m', 'p');
    g('commit', '-q', '--allow-empty', '-m', 'y');
    ol('en yüksek etiket SAYISAL seçilir (1.1.10 > 1.1.9)', () =>
      assert.equal(sonrakiSurumEtiketten('panel').surum, '1.1.11'));

    // ⚠️ Çizgiler AYRI: panel etiketi tablet numarasını etkilemez.
    ol('çizgiler karışmaz (tablet ≠ panel)', () =>
      assert.equal(sonrakiSurumEtiketten('tablet').surum, null));

    // ⚠️ AYNI UZUNLUKTA YABANCI ÖN EK. `git tag --list <onEk>-v*` süzgeci
    // kaldırılırsa bu satır sızar: 'demop-v9.9.9'.slice('panel-v'.length)
    // → '9.9.9' — ayrıştırma BAŞARILI olur ve yabancı bir çizgi paneli
    // 9.9.10'a fırlatır. Yalnız parse'a güvenmek yetmez; sondanın kendisi de
    // ilk yazımda bunu ıskaladı (git tag --list süzgecini kaldırdım, bekçi
    // yeşil kaldı).
    g('tag', '-a', 'demop-v9.9.9', '-m', 'yabanci');
    ol('aynı uzunlukta yabancı ön ek SIZMAZ', () =>
      assert.equal(sonrakiSurumEtiketten('panel').surum, '1.1.11'));

    // ⚠️ Terfi (onay) etiketi sürüm çizgisini SAYMAZ: `terfi/<kanal>/panel-v*` `panel-v*`
    // süzgecine girerse onay etiketi numarayı fırlatırdı.
    g('tag', '-a', terfiEtiketAdi('adnansahin', 'panel', '9.9.9'), '-m', 'onay cümlesi burada duruyor, bekçi');
    ol('terfi etiketi (terfi/adnansahin/panel-v9.9.9) sürüm çizgisine SIZMAZ', () =>
      assert.equal(sonrakiSurumEtiketten('panel').surum, '1.1.11'));
  } finally {
    process.chdir(eskiCwd);
  }
} finally {
  fs.rmSync(depo, { recursive: true, force: true });
}

console.log('\n§4 — Expo manifest gövdesinden sürüm');
// ⚠️ Gövde İKİ parça taşır; "ilk { ile son } arası" kestirmesi ayrıştırma
// hatası verir (ölçüldü).
const govde = [
  '--sinir',
  'content-disposition: form-data; name="manifest"',
  'content-type: application/json',
  '',
  JSON.stringify({ id: 'x', extra: { expoClient: { version: '1.0.3', sdkVersion: '54.0.0' } } }),
  '--sinir',
  'content-disposition: form-data; name="extensions"',
  'content-type: application/json',
  '',
  '{"assetRequestHeaders":{}}',
  '--sinir--',
  '',
].join('\r\n');
ol('iki parçalı gövdeden doğru sürüm', () =>
  assert.equal(manifestGovdesindenSurum(govde), '1.0.3'));
ol('sdkVersion ile karışmaz', () =>
  assert.notEqual(manifestGovdesindenSurum(govde), '54.0.0'));
ol('bozuk gövde null', () => assert.equal(manifestGovdesindenSurum('merhaba'), null));

console.log('\n§5 — Terfi kapısı (K5): üç şart, üç sonuç, kaçış yalnız kullanıcının cümlesiyle');

// §5a — kullanıcı cümlesi
ol('cümle: boş → RED', () => assert.equal(cumleDenetle('   ').gecerli, false));
ol('cümle: kısa ("acil yayınla") → RED', () => assert.match(cumleDenetle('acil yayınla').sebep, /KISA/));
ol('cümle: noktalama kelime sayılmaz ("acil — — — — — — —") → RED', () => assert.equal(cumleDenetle('acil — — — — — — — —').gecerli, false));
ol('cümle: geçerli, boşluk/sekme/satır tekilleşir (defter TSV\'sine sızmaz)', () => {
  const c = cumleDenetle('fabrika\tpaneli\naçılmıyor,   acil düzeltme');
  assert.equal(c.gecerli, true);
  assert.equal(c.cumle, 'fabrika paneli açılmıyor, acil düzeltme');
});
ol('saat Europe/Istanbul, ofsetli ISO', () => assert.match(istanbulSaati(new Date('2026-09-28T09:05:07Z')), /^2026-09-28T12:05:07\+03:00$/));

// §5b — saf hüküm
const BAS = 'a'.repeat(40);
const ESKI = 'b'.repeat(40);
const ONAY = 'testfabrikada denendi, fabrikaya çıkabilir (bekçi)';
const gitTam = { bas: BAS, surumEtiketi: BAS, terfiEtiketi: { tur: 'tag', commit: BAS, mesaj: ONAY } };
const panelVar = (surum) => [{ ne: 'panel latest.yml', url: 'https://x/latest.yml', durum: 'var', surum }];
const h = (o) => terfiHukmu({ kod: 'adnansahin', urun: 'panel', surum: '1.3.4', kaynak: 'testfabrika', git: gitTam, kaynaklar: panelVar('1.3.4'), ...o });
ol('POZİTİF: HEAD == panel-vX · terfi etiketi HEAD\'de · kaynak = X → uyumlu', () => assert.equal(h({}).sonuc, 'uyumlu'));
ol('POZİTİF: kaynak X\'in ÖNÜNDE (1.3.5 ≥ 1.3.4) → uyumlu', () => assert.equal(h({ kaynaklar: panelVar('1.3.5') }).sonuc, 'uyumlu'));
ol('HEAD ≠ panel-vX → ihlal', () => assert.equal(h({ git: { ...gitTam, surumEtiketi: ESKI } }).sonuc, 'ihlal'));
ol('panel-vX etiketi yok → ihlal', () => assert.equal(h({ git: { ...gitTam, surumEtiketi: null } }).sonuc, 'ihlal'));
ol('terfi etiketi yok → ihlal', () => assert.equal(h({ git: { ...gitTam, terfiEtiketi: null } }).sonuc, 'ihlal'));
ol('terfi etiketi hafif (tur commit) → ihlal', () => assert.equal(h({ git: { ...gitTam, terfiEtiketi: { tur: 'commit', commit: BAS, mesaj: '' } } }).sonuc, 'ihlal'));
ol('terfi etiketi başka commit\'te → ihlal', () => assert.equal(h({ git: { ...gitTam, terfiEtiketi: { ...gitTam.terfiEtiketi, commit: ESKI } } }).sonuc, 'ihlal'));
ol('terfi etiketi mesajı onay cümlesi değil ("ok") → ihlal', () => assert.equal(h({ git: { ...gitTam, terfiEtiketi: { ...gitTam.terfiEtiketi, mesaj: 'ok' } } }).sonuc, 'ihlal'));
ol('kaynak GERİDE (1.3.3 < 1.3.4) → ihlal', () => assert.equal(h({ kaynaklar: panelVar('1.3.3') }).sonuc, 'ihlal'));
ol('kaynakta yayın YOK (404) → ihlal (ölçülemedi DEĞİL — ölçüldü, yok)', () =>
  assert.equal(h({ kaynaklar: [{ ne: 'panel latest.yml', url: 'u', durum: 'yok' }] }).sonuc, 'ihlal'));
ol('kaynak OKUNAMADI → ÖLÇÜLEMEDİ', () =>
  assert.equal(h({ kaynaklar: [{ ne: 'panel latest.yml', url: 'u', durum: 'olculemedi', neden: 'curl 7' }] }).sonuc, 'olculemedi'));
ol('okunamayan kaynak + ihlal eden git şartı → ihlal (kesin kırmızı önce)', () =>
  assert.equal(h({ git: { ...gitTam, terfiEtiketi: null }, kaynaklar: [{ ne: 'p', url: 'u', durum: 'olculemedi', neden: 'x' }] }).sonuc, 'ihlal'));
ol('kuru kip (kaynaklar null): git şartları ölçülür, kaynak ölçülmez → uyumlu + "ÖLÇÜLMEDİ" satırı', () => {
  const r = h({ kaynaklar: null });
  assert.equal(r.sonuc, 'uyumlu');
  assert.ok(r.satirlar.some((s) => /ÖLÇÜLMEDİ \(kuru kip/.test(s)));
});
ol('tablet: OTA okunamadı ama APK künyesi ≥ X → uyumlu (aynı tablet-v çizgisi)', () => assert.equal(h({ urun: 'tablet', kaynaklar: [
  { ne: 'ota', url: 'u', durum: 'olculemedi', neden: 'x' }, { ne: 'apk', url: 'u', durum: 'var', surum: '1.3.4' }] }).sonuc, 'uyumlu'));
ol('tablet: OTA geride + APK okunamadı → ÖLÇÜLEMEDİ', () => assert.equal(h({ urun: 'tablet', kaynaklar: [
  { ne: 'ota', url: 'u', durum: 'var', surum: '1.3.3' }, { ne: 'apk', url: 'u', durum: 'olculemedi', neden: 'x' }] }).sonuc, 'olculemedi'));
ol('--terfi-atla cümlesiz ("") → ihlal', () => assert.equal(h({ atla: '' }).sonuc, 'ihlal'));
ol('--terfi-atla kısa ("acil") → ihlal', () => assert.equal(h({ atla: 'acil' }).sonuc, 'ihlal'));
ol('--terfi-atla="<cümle>" → uyumlu + atlandi, git/kaynak ölçülmeden', () => {
  const r = h({ atla: 'fabrika çöktü, test turu beklemeden çıkar', git: null, kaynaklar: null });
  assert.equal(r.sonuc, 'uyumlu');
  assert.equal(r.atlandi.cumle, 'fabrika çöktü, test turu beklemeden çıkar');
});
ol('terfiKaynagi olmayan kanal → uyumlu (gerekmez); kaçış verilirse → ihlal', () => {
  assert.equal(h({ kaynak: null, git: null, kaynaklar: null }).gerekmez, true);
  assert.equal(h({ kaynak: null, git: null, kaynaklar: null, atla: 'fabrika çöktü, test turu beklemeden çıkar' }).sonuc, 'ihlal');
});

// §5c — uçtan uca: geçici depo + CLI (kanal-kapisi terfi) + sahte ssh/curl/git
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-terfi-'));
try {
  // Hermetik git: makinenin global/sistem ayarı OKUNMAZ ve kimlik yalnız depo ayarından gelir
  // (CI koşucusunda global kimlik yok; yerelde vardı, testi sessizce ondan besliyordu).
  const gitGlobal = path.join(T, 'gitconfig-global');
  fs.writeFileSync(gitGlobal, '[user]\n\tuseConfigOnly = true\n');
  const temizEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: gitGlobal, GIT_CONFIG_NOSYSTEM: '1', TEKSERP_YAYIN_BILDIRIMI: '0',
  };
  const gercekGit = execFileSync('/usr/bin/env', ['sh', '-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const uzak = path.join(T, 'uzak');
  const log = path.join(T, 'cagri.jsonl');
  const bin = path.join(T, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(log, '');
  const sahte = path.join(T, 'sahte.mjs');
  fs.writeFileSync(sahte, String.raw`
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [arac, ...a] = process.argv.slice(2);
const yaz = (o) => fs.appendFileSync(process.env.CAGRI_LOG, JSON.stringify({ arac, ...o }) + '\n');
const VDS = '/opt/stack/apps/tekserp-guncelleme/html/';
if (arac === 'curl') { yaz({ ANONIM_HTTP: a.join(' ') }); process.exit(6); }
if (arac === 'ssh') {
  const k = [...a];
  while (k.length && k[0].startsWith('-')) { const o = k.shift(); if (o === '-o' || o === '-p') k.shift(); }
  const host = k.shift();
  const komut = k.join(' ');
  const m = /^test -f '([^']+)' \|\| exit 44; cat '\1'$/.exec(komut);
  if (!m || !m[1].startsWith(VDS)) { yaz({ host, YABANCI_KOMUT: komut }); process.exit(97); }
  yaz({ host, yol: m[1] });
  if (process.env.SAHTE_SSH_KOPUK && m[1].includes(process.env.SAHTE_SSH_KOPUK)) { process.stderr.write('ssh: connect to host: Connection refused\n'); process.exit(255); }
  if (process.env.SAHTE_SSH_KOD) { process.stderr.write('Permission denied\n'); process.exit(Number(process.env.SAHTE_SSH_KOD)); }
  const dosya = path.join(process.env.SAHTE_UZAK, m[1]);
  if (!fs.existsSync(dosya)) process.exit(44);
  process.stdout.write(fs.readFileSync(dosya));
  process.exit(0);
}
if (arac === 'git') {
  if (a[0] === 'push') { yaz({ ENGELLENDI: a.join(' ') }); process.exit(1); }
  const r = spawnSync(process.env.GERCEK_GIT, a, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
process.exit(97);
`);
  for (const arac of ['ssh', 'curl', 'git']) {
    fs.writeFileSync(path.join(bin, arac), `#!/bin/sh\nexec "${process.execPath}" "${sahte}" ${arac} "$@"\n`);
    fs.chmodSync(path.join(bin, arac), 0o755);
  }
  // Geçici depo: kapının kendi dosyaları (KOK = depo) + kayıt defteri.
  const depo = path.join(T, 'depo');
  for (const rel of ['scripts/kanal-kapisi.mjs', 'scripts/lib/kanallar.mjs', 'scripts/lib/surum.mjs', 'scripts/lib/terfi.mjs', 'scripts/lib/kullanici-cumlesi.mjs', 'scripts/lib/yayin-okuma.mjs', 'scripts/lib/yayin-hedefi.mjs', 'scripts/lib/derleme-bagi.mjs', 'scripts/lib/backend-yayin.mjs', 'scripts/lib/dagitim.mjs', 'scripts/lib/panel-kimlik.mjs', 'deploy/kanallar.json']) {
    fs.mkdirSync(path.dirname(path.join(depo, rel)), { recursive: true });
    fs.copyFileSync(path.join(KOK, rel), path.join(depo, rel));
  }
  fs.copyFileSync(path.join(KOK, 'scripts/lib/yayin-bildirim.mjs'), path.join(depo, 'scripts/lib/yayin-bildirim.mjs'));
  const dg = (...a) => execFileSync(gercekGit, ['-c', 'user.email=bekci@test', '-c', 'user.name=bekci', ...a], { cwd: depo, env: temizEnv, encoding: 'utf8' }).trim();
  dg('init', '-q');
  dg('config', 'user.email', 'bekci@test');
  dg('config', 'user.name', 'bekci');
  dg('commit', '-q', '--allow-empty', '-m', 'onceki');
  dg('commit', '-q', '--allow-empty', '-m', 'surum');
  const kaynakYml = path.join(uzak, 'opt/stack/apps/tekserp-guncelleme/html/testfabrika/electron/latest.yml');
  fs.mkdirSync(path.dirname(kaynakYml), { recursive: true });
  const cli = (args, ortamEk = {}) => {
    const r = spawnSync(process.execPath, [path.join(depo, 'scripts/kanal-kapisi.mjs'), ...args], {
      cwd: depo, encoding: 'utf8',
      env: { ...temizEnv, PATH: `${bin}:${process.env.PATH}`, SAHTE_UZAK: uzak, CAGRI_LOG: log, GERCEK_GIT: gercekGit, ...ortamEk },
    });
    return { kod: r.status, cikti: `${r.stdout}${r.stderr}` };
  };
  const cagrilar = () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s));
  const terfi = (ek = [], ortamEk = {}) => cli(['terfi', 'adnansahin', 'panel', '1.3.4', ...ek], ortamEk);

  ol('E2E testfabrika (terfiKaynagi yok) → çıkış 0, sessiz, ağ YOK', () => {
    const r = cli(['terfi', 'testfabrika', 'panel', '1.3.4']);
    assert.equal(r.kod, 0, r.cikti);
    assert.equal(r.cikti.trim(), '');
    assert.equal(cagrilar().length, 0);
  });
  ol('E2E etiketsiz HEAD → çıkış 1 (panel-v1.3.4 yok · onay etiketi yok)', () => {
    const r = terfi();
    assert.equal(r.kod, 1, r.cikti);
    assert.match(r.cikti, /panel-v1\.3\.4 etiketi YOK/);
    assert.match(r.cikti, /onay etiketi YOK/);
  });
  dg('tag', '-a', 'panel-v1.3.4', 'HEAD~1', '-m', 'panel 1.3.4');
  ol('E2E HEAD ≠ panel-v1.3.4 (etiket bir önceki commit\'te) → çıkış 1', () => {
    const r = terfi();
    assert.equal(r.kod, 1, r.cikti);
    assert.match(r.cikti, /HEAD \([0-9a-f]+\) ≠ panel-v1\.3\.4/);
  });
  dg('tag', '-d', 'panel-v1.3.4');
  dg('tag', '-a', 'panel-v1.3.4', 'HEAD', '-m', 'panel 1.3.4');
  ol('E2E panel-v1.3.4 HEAD\'de ama terfi etiketi YOK → çıkış 1', () => {
    const r = terfi();
    assert.equal(r.kod, 1, r.cikti);
    assert.match(r.cikti, /✓ ① HEAD == panel-v1\.3\.4/);
    assert.match(r.cikti, /onay etiketi YOK/);
  });
  dg('tag', '-a', 'terfi/adnansahin/panel-v1.3.4', 'HEAD', '-m', `${ONAY} — 2026-09-28 14:00`);
  ol('E2E kaynak kanalda yayın yok (404) → çıkış 1 (GERİDE)', () => {
    const r = terfi();
    assert.equal(r.kod, 1, r.cikti);
    assert.match(r.cikti, /GERİDE — panel latest\.yml: yayın yok/);
  });
  fs.writeFileSync(kaynakYml, 'version: 1.3.3\npath: TeksERP-1.3.3-Setup.exe\n');
  ol('E2E kaynak GERİDE (1.3.3) → çıkış 1', () => assert.equal(terfi().kod, 1));
  fs.writeFileSync(kaynakYml, 'version: 1.3.4\npath: TeksERP-1.3.4-Setup.exe\n');
  ol('E2E ⭐ POZİTİF: üç şart tutuyor → çıkış 0, onay cümlesi basılır, tek okuma kaynak latest.yml (SSH, VDS diski; anonim HTTP YOK)', () => {
    fs.writeFileSync(log, '');
    const r = terfi();
    assert.equal(r.kod, 0, r.cikti);
    assert.match(r.cikti, /✓ terfi kapısı: panel 1\.3\.4 → adnansahin/);
    assert.match(r.cikti, /onay: "testfabrikada denendi/);
    assert.deepEqual(cagrilar(), [{ arac: 'ssh', host: 'tekserp-yayin', yol: '/opt/stack/apps/tekserp-guncelleme/html/testfabrika/electron/latest.yml' }]);
  });
  ol('E2E kaynak OKUNAMIYOR (ssh bağlantı reddi) → çıkış 2 (ÖLÇÜLEMEDİ)', () => {
    const r = terfi([], { SAHTE_SSH_KOPUK: '/testfabrika/' });
    assert.equal(r.kod, 2, r.cikti);
    assert.match(r.cikti, /ÖLÇÜLEMEDİ/);
  });
  ol('E2E ssh izin reddi (çıkış 1) → çıkış 2 (ÖLÇÜLEMEDİ, "yok" DEĞİL)', () => assert.equal(terfi([], { SAHTE_SSH_KOD: '1' }).kod, 2));
  ol('E2E --kuru: kaynak okunmaz (ağ yok), git şartları geçer → çıkış 0', () => {
    fs.writeFileSync(log, '');
    const r = terfi(['--kuru'], { SAHTE_SSH_KOPUK: '/testfabrika/' });
    assert.equal(r.kod, 0, r.cikti);
    assert.equal(cagrilar().length, 0);
  });
  ol('E2E --terfi-atla= (cümlesiz) → çıkış 1', () => assert.equal(terfi(['--terfi-atla=']).kod, 1));
  ol('E2E --terfi-atla="acil çıkar" (kısa) → çıkış 1', () => assert.equal(terfi(['--terfi-atla=acil çıkar']).kod, 1));
  ol('E2E --terfi-atla="<cümle>" → çıkış 0, ağ YOK (kaynak okunmadı)', () => {
    fs.writeFileSync(log, '');
    const r = terfi(['--terfi-atla=fabrika çöktü, test turu beklemeden çıkar'], { SAHTE_SSH_KOPUK: '/' });
    assert.equal(r.kod, 0, r.cikti);
    assert.match(r.cikti, /TERFİ KAPISI ATLANDI/);
    assert.equal(cagrilar().length, 0);
  });
  ol('E2E kaçış kaydı: terfi/adnansahin/panel-v1.3.5 AÇIKLAMALI etiketi, mesajı cümle + saat; push ENGELLENDİ (ağ yok)', () => {
    fs.writeFileSync(log, '');
    const cumle = "fabrika paneli açılmıyor, test'siz acil düzeltme";
    const r = cli(['terfi-atla-kaydi', 'adnansahin', 'panel', '1.3.5', cumle]);
    assert.equal(r.kod, 0, r.cikti);
    assert.match(r.cikti, /etiket\) atıldı/, r.cikti);
    assert.equal(dg('cat-file', '-t', 'refs/tags/terfi/adnansahin/panel-v1.3.5'), 'tag');
    const mesaj = dg('for-each-ref', '--format=%(contents)', 'refs/tags/terfi/adnansahin/panel-v1.3.5');
    assert.ok(mesaj.includes(cumle), mesaj);
    assert.match(mesaj, /^TERFİ ATLANDI — panel 1\.3\.5 → adnansahin/);
    assert.match(mesaj, /saat: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+03:00/);
    assert.deepEqual(cagrilar().map((c) => c.ENGELLENDI), ['push origin terfi/adnansahin/panel-v1.3.5']);
  });
  ol('E2E kaçış kaydı var olan etikete DOKUNMAZ (zaten-var)', () => {
    const r = cli(['terfi-atla-kaydi', 'adnansahin', 'panel', '1.3.5', 'ikinci deneme cümlesi burada duruyor']);
    assert.match(r.cikti, /zaten var/);
    assert.ok(!dg('for-each-ref', '--format=%(contents)', 'refs/tags/terfi/adnansahin/panel-v1.3.5').includes('ikinci deneme'));
  });

  // §5d — KALICI SONDA: yüklemden bir şart sökülünce ilgili kontrol kırmızıya dönmeli (bekçi körse yeşil kalırdı).
  const sondaYukle = async (degistir) => {
    const d = path.join(T, `sonda-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(d);
    for (const f of ['kanallar.mjs', 'dagitim.mjs', 'panel-kimlik.mjs', 'surum.mjs', 'yayin-okuma.mjs', 'backend-yayin.mjs', 'kullanici-cumlesi.mjs']) fs.copyFileSync(path.join(KOK, 'scripts/lib', f), path.join(d, f));
    const once = fs.readFileSync(path.join(KOK, 'scripts/lib/terfi.mjs'), 'utf8');
    const sonra = degistir(once);
    if (sonra === once) throw new Error('sonda mutasyonu UYGULANMADI');
    fs.writeFileSync(path.join(d, 'terfi.mjs'), sonra);
    return import(pathToFileURL(path.join(d, 'terfi.mjs')).href);
  };
  const sondalar = [
    ['① HEAD==etiket şartı sökülür → "HEAD ≠ panel-vX" uyumlu olur', (m) => m.replace('else if (git.surumEtiketi !== git.bas)', 'else if (false)'),
      (t) => t.terfiHukmu({ kod: 'adnansahin', urun: 'panel', surum: '1.3.4', kaynak: 'testfabrika', git: { ...gitTam, surumEtiketi: ESKI }, kaynaklar: panelVar('1.3.4') })],
    ['③ kaynak kıyası sökülür → "kaynak geride" uyumlu olur', (m) => m.replace('return c !== null && c >= 0;', 'return true;'),
      (t) => t.terfiHukmu({ kod: 'adnansahin', urun: 'panel', surum: '1.3.4', kaynak: 'testfabrika', git: gitTam, kaynaklar: panelVar('1.3.3') })],
    ['kaçış cümle denetimi sökülür → boş cümle uyumlu olur', (m) => m.replace('if (!c.gecerli) {\n      return { sonuc: \'ihlal\'', 'if (false) {\n      return { sonuc: \'ihlal\''),
      (t) => t.terfiHukmu({ kod: 'adnansahin', urun: 'panel', surum: '1.3.4', kaynak: 'testfabrika', git: null, kaynaklar: null, atla: '' })],
  ];
  for (const [ad, degistir, kos] of sondalar) {
    let sonuc;
    try {
      sonuc = kos(await sondaYukle(degistir)).sonuc;
    } catch (e) {
      sonuc = `HATA ${e.message}`;
    }
    ol(`⭐ SONDA ${ad} (bekçi kontrolü bunu kırmızı görür)`, () => assert.equal(sonuc, 'uyumlu'));
  }
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log(`\n${'='.repeat(60)}`);
if (kaldi.length) {
  console.log(`❌ BAŞARISIZ — ${gecti} geçti, ${kaldi.length} kaldı`);
  for (const a of kaldi) console.log(`   · ${a}`);
  process.exit(1);
}
console.log(`✅ TAMAM — ${gecti} kontrol`);
