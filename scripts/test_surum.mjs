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
// §5 TERFİ KAPISI (K5, scripts/lib/terfi.mjs): saf hüküm + kalıcı sonda (yüklemden bir şart sökülünce
//    ilgili kontrolün kırmızıya döndüğü ölçülür). Grup terfisinin uçtan ucu test_grup_yayin_kapisi'nde.
//
//   node scripts/test_surum.mjs
// =============================================================================

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
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

// §5c (eski kanal yolu uçtan uca) O15'te kalktı: grup terfisinin uçtan ucu test_grup_yayin_kapisi/test_backend_yayin'de.
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-terfi-'));
try {
  // §5d — KALICI SONDA: yüklemden bir şart sökülünce ilgili kontrol kırmızıya dönmeli (bekçi körse yeşil kalırdı).
  const sondaYukle = async (degistir) => {
    const d = path.join(T, `sonda-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(d);
    for (const f of ['dagitim.mjs', 'surum.mjs', 'yayin-okuma.mjs', 'backend-yayin.mjs', 'kullanici-cumlesi.mjs']) fs.copyFileSync(path.join(KOK, 'scripts/lib', f), path.join(d, f));
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
