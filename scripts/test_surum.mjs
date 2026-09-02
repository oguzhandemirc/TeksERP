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
//
//   node scripts/test_surum.mjs
// =============================================================================

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ayristir,
  etiketDefteriKiyasla,
  karsilastir,
  manifestGovdesindenSurum,
  sonrakiSurumEtiketten,
  yamaArtir,
} from './lib/surum.mjs';

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

console.log(`\n${'='.repeat(60)}`);
if (kaldi.length) {
  console.log(`❌ BAŞARISIZ — ${gecti} geçti, ${kaldi.length} kaldı`);
  for (const a of kaldi) console.log(`   · ${a}`);
  process.exit(1);
}
console.log(`✅ TAMAM — ${gecti} kontrol`);
