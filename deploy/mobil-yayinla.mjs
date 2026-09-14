#!/usr/bin/env node
/**
 * TeksERP Mobil — yayın yükleyici (VPS).
 *
 * `deploy/electron-yayinla.ps1`in ikizidir; Node yazılmıştır çünkü mobil paket
 * Mac'te üretilir (orada PowerShell yok).
 *
 * ⚠️ BU SCRIPT'İN VAR OLMA SEBEBİ — YÜKLEME SIRASI:
 * Manifest, paket dosyalarına İŞARET EDER. Manifest önce yüklenirse, henüz
 * yüklenmemiş varlıkları gösteren bir yayın ortaya çıkar ve o aralıkta
 * güncelleme soran her tablet indirmede patlar. Electron tarafında aynı ders
 * `latest.yml`i EN SONA koydurmuştu. Sıra pazarlık dışıdır ve elle yapılmaz.
 *
 * ⚠️ SON ADIM DIŞARIDAN DOĞRULAMADIR: yalnız "dosya yüklendi" demek yetmez.
 * Manifest'in `Content-Type` + `expo-protocol-version` başlıklarını nginx
 * basıyor; o kural eksik/bozuksa dosya 200 döner ama istemci
 * "Legacy manifests are no longer supported" ile SESSİZCE durur. Script bunu
 * gerçek bir HTTPS isteğiyle ölçer.
 *
 * Kullanım:
 *   node deploy/mobil-yayinla.mjs --paket=<ota-cikti/54.2/1787…>
 *   node deploy/mobil-yayinla.mjs --apk=<yol.apk> --surum=2.9.8 --vc=55
 *   node deploy/mobil-yayinla.mjs --paket=… --kuru      # yalnız ne yapacağını yaz
 *   node deploy/mobil-yayinla.mjs --dogrula=<url>       # yükleme YOK, yayını denetle
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { etiketAt, manifestGovdesindenSurum } from '../scripts/lib/surum.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBIL = path.resolve(HERE, '..', 'mobil');
const { MOBIL_FEED_URL, normalizeFeed, manifestUrl, apkKunyeUrl, feedUrl, musteriOku } =
  await import(
  path.join(MOBIL, 'scripts/lib/feed.cjs')
).then((m) => m.default ?? m);

/* ------------------------------------------------------------------ */

const BAR = '='.repeat(72);
const baslik = (m) => console.log(`\n${BAR}\n  ${m}\n${BAR}`);
const bilgi = (m) => console.log(`  ${m}`);
const uyari = (m) => console.log(`\n  ⚠  ${m}\n`);
function dur(b, ...satirlar) {
  console.error(`\n${BAR}\n  ✖ HATA — ${b}\n${BAR}`);
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

/**
 * Yayın hedefi — `deploy/electron-yayinla.sh` ile AYNI kalıp: ssh takma adı
 * (`~/.ssh/config`te port 2222 tanımlı) + ortam değişkeniyle ezilebilir yollar.
 *
 * ⚠️ Yol düzeni `/<musteri>/<urun>/` — Electron ile aynı standart. Müşteri
 * segmenti alt alan adı yerine YOL olarak ayrılıyor: Cloudflare Origin CA
 * wildcard'ı iki seviyeli alt alan adlarını kapsamıyor.
 */
// ⚠️ 2026-09-01: varsayılan `yenisunucu`dan `tekserp-yayin`e çevrildi — yayın
// 80.253.255.188'e taşındı ve DNS de oraya döndü. `yenisunucu` artık ESKİ
// sunucudur; kullanıcı `yayinci` (sudo YOK). Bkz. docs/ops/VDS-TASIMA.md
const SSH_HEDEF = arg('ssh') || process.env.SSH_HEDEF || 'tekserp-yayin';

// ⚠️ MÜŞTERİ KAPISINDAN ÖNCE: bu kip MUTLAK bir URL alır, dolayısıyla müşteri
// kodunu bilmesine gerek yoktur. Kapının arkasında kalsaydı, "yayını denetle"
// gibi zararsız bir okuma bile müşteri argümanı isterdi — ve dokümandaki komut
// kopyalanınca patlardı (2026-08-28'de tam bu yaşandı).
const dogrulaUrl = arg('dogrula');
if (dogrulaUrl) {
  baslik('YAYIN DENETİMİ (yükleme yok)');
  const beklenenBoyut = Number(arg('boyut')) || undefined;

  // ⚠️ ATLANAN KONTROLÜ SÖYLE. Denetim kipinde yerel paket elde olmayabilir;
  // o zaman boyut kıyası yapılamaz ve YARIM yüklenmiş bir dosya bu kipten
  // "sağlam" diye geçer. Sessizce atlanan bir kontrol, yapılmış SANILIR —
  // "ölçülmemiş olanı ölçülmüş gibi bırakma" kuralının aynısı.
  if (!beklenenBoyut) {
    uyari(
      'Boyut kıyası ATLANDI (--boyut verilmedi).\n' +
        '     Bu kip yalnız ERİŞİLEBİLİRLİK ve ÖNBELLEK tutarlılığını ölçer;\n' +
        '     yarım yüklenmiş bir dosya buradan "sağlam" görünür.\n' +
        '     Tam denetim için: --boyut=<yerel dosyanın bayt sayısı>',
    );
  }

  const ok = await dosyaDogrula(dogrulaUrl, { yerelBoyut: beklenenBoyut });
  bilgi(
    ok
      ? `\n  ✔ Yayın sağlam${beklenenBoyut ? ' (boyut dahil doğrulandı).' : ' — ama yukarıdaki kapsam notuna bak.'}`
      : '\n  ⚠ Yayın erişilebilir ama yukarıdaki uyarıya bak.',
  );
  process.exit(0);
}

/**
 * ⚠️ MÜŞTERİ, KOMUTTAN — hem yükleme yolu hem doğrulama adresi ondan türer.
 * `musteri.json`dan alsaydık kapı dairesel olurdu: paket yanlış müşteriyle
 * üretilmişse beklenen ve gerçek aynı yanlışı gösterir, kontrol geçerdi.
 */
const MUSTERI = arg('musteri');
const AGAC_MUSTERISI = musteriOku();
if (!MUSTERI) {
  dur(
    'HANGİ MÜŞTERİYE YAYINLANIYOR?',
    '`--musteri=<kod>` zorunludur — hedef klasör ve doğrulama adresi ondan çözülür.',
    `Bu ağaç şu an "${AGAC_MUSTERISI.kod}" (${AGAC_MUSTERISI.ad}) için yapılandırılmış.`,
    `Örnek:  node deploy/mobil-yayinla.mjs --musteri=${AGAC_MUSTERISI.kod} --paket=…`,
  );
}
const UZAK_KOK =
  arg('uzak-dizin') ||
  process.env.UZAK_DIZIN ||
  `/opt/stack/apps/tekserp-guncelleme/html/${MUSTERI}/mobil`;
const FEED = normalizeFeed(arg('feed') || process.env.YAYIN_URL || feedUrl(MUSTERI));

/* ------------------------------------------------------------------ *
 * Kabuk yardımcıları
 * ------------------------------------------------------------------ */

function kos(komut, argumanlar, aciklama) {
  bilgi(`${aciklama}`);
  if (KURU) {
    bilgi(`    [kuru] ${komut} ${argumanlar.join(' ')}`);
    return;
  }
  const r = spawnSync(komut, argumanlar, { stdio: 'inherit' });
  if (r.error) dur(`${aciklama} — komut çalıştırılamadı`, String(r.error.message));
  if (r.status !== 0) dur(`${aciklama} — başarısız (çıkış ${r.status})`);
}

const ssh = (uzakKomut, aciklama) => kos('ssh', [SSH_HEDEF, uzakKomut], aciklama);

const scp = (kaynaklar, uzakYol, aciklama) =>
  kos('scp', ['-r', ...kaynaklar, `${SSH_HEDEF}:${uzakYol}`], aciklama);

/**
 * DOSYA DOĞRULAMA — üç ayrı arızayı BİRBİRİNDEN AYIRIR.
 *
 * ⚠️ Tespit etmek yetmez, AYIRT ETMEK gerekir (komşu oturumun 2026-08-26
 * vakasının dersi): "dosya yüklenmemiş" ile "önbellekte kalmış eski yanıt"
 * dışarıdan AYNI görünür ama biri yeniden yüklemekle, diğeri YALNIZ purge ile
 * çözülür. O gün 147 MB'lık paket sunucuda dururken adres 404 döndü ve ayrım
 * elle yapıldı. Burada script yapar.
 *
 * Üç arıza:
 *  ① Önbellekte bayat yanıt → origin doğru, CF eski cevabı tutuyor → PURGE.
 *     ⚠️ Bu dalın 404 biçimi ÖLÇÜLEMEDİ ve öyle kalması iyidir: nginx'teki
 *     `error_page 404 → no-store` ikinci hattı 404'lerin önbelleğe girmesini
 *     baştan engelliyor (ölçüldü: `cf-cache-status: DYNAMIC`). Dal savunma
 *     derinliği olarak duruyor — o kural değişirse tek sinyal bu olur.
 *     Dalın BAŞLIK biçimi ölçüldü (APK içerik tipi bir kez böyle takıldı).
 *  ② Dosya gerçekten yok → origin de hata veriyor → yeniden yükle.
 *  ③ YARIM yüklenmiş dosya → 200 döner, kod ve tip doğrudur, ama EKSİKTİR.
 *     Boyut kıyası olmadan bu sessizce geçer ve tablet indirmede patlar.
 */
async function dosyaDogrula(url, { yerelBoyut, beklenenTip } = {}) {
  const cbUrl = `${url}${url.includes('?') ? '&' : '?'}onbellek-atla=${process.pid}`;
  const temiz = await fetch(url, { method: 'HEAD' });
  const taze = await fetch(cbUrl, { method: 'HEAD' });

  const ozet = (r) =>
    `${r.status}|${r.headers.get('content-type') ?? ''}|${r.headers.get('content-length') ?? '?'}`;

  // ① / ② — temiz URL hatalıysa ayrımı origin söyler.
  if (temiz.status !== 200) {
    if (taze.status === 200) {
      dur(
        'ÖNBELLEK SORUNU — dosya sunucuda VAR ama adres eski yanıtı döndürüyor',
        `Adres      : ${url}`,
        `temiz URL  : HTTP ${temiz.status}  (cf: ${temiz.headers.get('cf-cache-status') ?? '?'})`,
        `önbelleksiz: HTTP ${taze.status}   (cf: ${taze.headers.get('cf-cache-status') ?? '?'})`,
        '',
        'Yeniden yüklemek ÇÖZMEZ. Cloudflare panelinde:',
        '  Caching → Configuration → Purge Cache → Purge by URL',
        `  ${url}`,
      );
    }
    dur(
      'DOSYA YAYINDA DEĞİL',
      `Adres: ${url}`,
      `HTTP ${temiz.status} (önbelleksiz de ${taze.status}) — dosya gerçekten yüklenmemiş.`,
      'Yükleme adımını tekrarla.',
    );
  }

  // ③ — yarım yüklenmiş dosya: kod 200, boyut eksik.
  const uzunluk = Number(temiz.headers.get('content-length') ?? '0');
  if (yerelBoyut && uzunluk && uzunluk !== yerelBoyut) {
    dur(
      'DOSYA EKSİK YÜKLENMİŞ',
      `Adres    : ${url}`,
      `yereldeki: ${yerelBoyut} bayt`,
      `yayındaki: ${uzunluk} bayt`,
      'Aktarım yarıda kalmış olabilir — yükleme adımını tekrarla.',
    );
  }

  // ④ SİLİNEN DOSYA HÂLÂ SERVİS EDİLİYOR: temiz URL 200, origin 404.
  // Sunucudan kaldırılan bozuk/eski bir paket, önbellek süresi dolana dek
  // (burada 7 gün) indirilebilir olmaya devam eder. Silmek YETMEZ — bu, "kötü
  // paketi kaldırdım" diyen kişinin en kolay yanılacağı yer. 2026-08-27'de
  // ölçüldü: yanlış adres taşıyan APK sunucudan silindi, adres yine 200 döndü.
  if (temiz.status === 200 && taze.status === 404) {
    uyari(
      `SİLİNEN DOSYA HÂLÂ SERVİS EDİLİYOR: ${url}\n` +
        `     temiz URL  : HTTP 200 (cf: ${temiz.headers.get('cf-cache-status') ?? '?'}) — ÖNBELLEKTEN\n` +
        '     önbelleksiz: HTTP 404 — sunucuda YOK\n' +
        '     Dosyayı silmek yetmedi; önbellek süresi (7 gün) dolana dek\n' +
        '     indirilebilir kalır. Kesin çözüm: Purge by URL.',
    );
    return false;
  }

  // Bayat BAŞLIK: kod ve boyut doğru olsa bile tip eski olabilir. Bizde
  // protokol başlıkları sözleşmenin parçası olduğu için bu sessiz kalmamalı.
  if (ozet(temiz) !== ozet(taze)) {
    uyari(
      `BAYAT ÖNBELLEK BAŞLIĞI: ${url}\n` +
        `     temiz URL  : ${ozet(temiz)}  (cf: ${temiz.headers.get('cf-cache-status') ?? '?'})\n` +
        `     önbelleksiz: ${ozet(taze)}   (cf: ${taze.headers.get('cf-cache-status') ?? '?'})\n` +
        '     Origin DOĞRU, Cloudflare eski başlığı tutuyor. Kritikse purge et:\n' +
        '     Caching → Configuration → Purge Cache → Purge by URL',
    );
    return false;
  }

  if (beklenenTip && !(temiz.headers.get('content-type') ?? '').includes(beklenenTip)) {
    uyari(`Beklenmeyen içerik tipi: ${temiz.headers.get('content-type')} (beklenen ${beklenenTip})`);
  }
  return true;
}

async function iste(url, yontem = 'GET') {
  const r = await fetch(url, { method: yontem, redirect: 'follow' });
  return {
    durum: r.status,
    basliklar: Object.fromEntries(r.headers.entries()),
    govde: yontem === 'GET' ? await r.text() : '',
  };
}

/* ------------------------------------------------------------------ *
 * OTA paketi
 * ------------------------------------------------------------------ */

async function paketiYayinla(paketDizin) {
  const kunyeYol = path.join(paketDizin, 'yayin.json');
  if (!fs.existsSync(kunyeYol)) {
    dur(
      'Paket klasörü tanınmıyor',
      `\`yayin.json\` yok: ${kunyeYol}`,
      'Önce paketi üret:  cd mobil && npm run yayinla',
    );
  }
  const kunye = JSON.parse(fs.readFileSync(kunyeYol, 'utf8'));
  const { runtimeVersion, damga } = kunye;

  const manifestYol = path.join(paketDizin, 'manifest');
  if (!fs.existsSync(manifestYol)) dur('Pakette `manifest` dosyası yok');

  // Bayat paket kapısı: klasör adı ile künye aynı damgayı söylemeli.
  if (path.basename(paketDizin) !== damga) {
    dur(
      'Klasör adı ile künye uyuşmuyor',
      `klasör: ${path.basename(paketDizin)} · yayin.json: ${damga}`,
      'Elle kopyalanmış/karışmış bir klasör olabilir.',
    );
  }
  if (!kunye.imzali) {
    uyari('Bu paket İMZASIZ. Kod imzalama açık bir APK onu REDDEDER.');
  }

  // ⚠️ Paketin ÜRETİLDİĞİ müşteri ile yayınlandığı müşteri aynı olmalı: paketin
  // varlık URL'leri müşteri segmentini TAŞIR. Başka bir müşteriye yüklenirse o
  // fabrikanın tabletleri BAŞKA bir fabrikanın adreslerinden indirmeye çalışır
  // (404) ve güncelleme sessizce hiç gelmez.
  // ⚠️ OTORİTE KÜNYE DEĞİL, MANİFESTİN KENDİSİ.
  //
  // İlk yazımda bu kontrol `yayin.json`daki `musteri` alanına bakıyordu ve
  // ÖLÇÜMDE ATEŞLEMEDİ: alan taşımayan (eski script'le üretilmiş) bir paket
  // kontrolden geçti ve yanlış müşteriye YÜKLENDİ. Künye bir beyandır; paketin
  // tabletleri gerçekte nereye göndereceğini manifest'teki varlık URL'leri
  // söyler. Kontrol beyana değil artefakta bakmalı.
  const manifestMetni = fs.readFileSync(manifestYol, 'utf8');
  const paketAdresleri = [...new Set(manifestMetni.match(/https?:\/\/[^"\\]+?\/mobil\//g) ?? [])];
  const beklenenOnEk = normalizeFeed(feedUrl(MUSTERI));
  const yabanci = paketAdresleri.filter((u) => !u.startsWith(beklenenOnEk));

  if (paketAdresleri.length === 0) {
    dur(
      'PAKETTE VARLIK ADRESİ BULUNAMADI',
      'Manifest beklenen biçimde değil — yükleme yapılmadı.',
      manifestYol,
    );
  }
  if (yabanci.length) {
    dur(
      'PAKET BAŞKA BİR MÜŞTERİ İÇİN ÜRETİLMİŞ',
      `yayın komutu   : ${MUSTERI}`,
      `beklenen ön ek : ${beklenenOnEk}`,
      `pakette bulunan: ${yabanci.slice(0, 2).join(' , ')}`,
      kunye.musteri ? `künye          : ${kunye.musteri}` : 'künye          : (müşteri alanı yok)',
      '',
      'Paketin içindeki adresler DEĞİŞTİRİLEMEZ (imzalı) — yeniden üret:',
      `  cd mobil && npm run yayinla -- --musteri=${MUSTERI}`,
    );
  }
  bilgi(`  paket adresleri: ${paketAdresleri.length} farklı ön ek, hepsi ${MUSTERI}`);

  baslik('OTA PAKETİ YAYINLANIYOR');
  bilgi(`Müşteri: ${MUSTERI}`);
  bilgi(`Sürüm  : ${runtimeVersion}`);
  bilgi(`Damga  : ${damga}`);
  bilgi(`Feed   : ${FEED}`);
  bilgi(`Hedef  : ${SSH_HEDEF}:${UZAK_KOK}/ota/${runtimeVersion}`);
  console.log('');

  const uzakSurum = `${UZAK_KOK}/ota/${runtimeVersion}`;
  ssh(`mkdir -p '${uzakSurum}/${damga}'`, '(1/4) uzak klasör hazırlanıyor');

  // (2) ÖNCE varlıklar — manifest onlara işaret ediyor.
  const icerik = fs
    .readdirSync(paketDizin)
    .filter((ad) => !ad.startsWith('manifest'))
    .map((ad) => path.join(paketDizin, ad));
  scp(icerik, `${uzakSurum}/${damga}/`, '(2/4) paket dosyaları yükleniyor');

  // (3) SONRA manifest — yayını AÇAN adım budur.
  scp(
    [manifestYol, path.join(paketDizin, `manifest-${damga}`)],
    `${uzakSurum}/`,
    '(3/4) manifest yükleniyor (yayını AÇAN adım)',
  );

  if (KURU) {
    bilgi('\n  [kuru] doğrulama atlandı.');
    return;
  }

  /* (4) Dışarıdan doğrulama */
  baslik('(4/4) DOĞRULAMA — dışarıdan, gerçek HTTPS ile');
  const url = manifestUrl(FEED, runtimeVersion);
  // Önce ayrım yapan kontrol: 404 ise "önbellek mi, eksik mi" sorusunu O cevaplar.
  await dosyaDogrula(url, { beklenenTip: 'multipart/mixed' });
  const y = await iste(url);

  bilgi(`${url}`);
  bilgi(`  durum        : ${y.durum}`);
  bilgi(`  content-type : ${y.basliklar['content-type'] ?? '(yok)'}`);
  bilgi(`  protokol     : ${y.basliklar['expo-protocol-version'] ?? '(yok)'}`);

  const sorunlar = [];
  if (y.durum !== 200) sorunlar.push(`HTTP ${y.durum} (beklenen 200)`);
  if (y.basliklar['expo-protocol-version'] !== '1') {
    sorunlar.push('`expo-protocol-version: 1` başlığı YOK — nginx kuralı eksik');
  }
  if (!/multipart\/mixed;\s*boundary=/i.test(y.basliklar['content-type'] ?? '')) {
    sorunlar.push('`content-type` multipart/mixed + boundary taşımıyor — nginx kuralı eksik');
  }
  if (!y.govde.includes(`"runtimeVersion":"${runtimeVersion}"`)) {
    sorunlar.push('Gövde beklenen runtimeVersion\'ı taşımıyor (bayat manifest?)');
  }
  if (!y.govde.includes(`"id":"${kunye.manifestId}"`)) {
    sorunlar.push(`Yayındaki manifest id beklenen değil (${kunye.manifestId})`);
  }

  if (sorunlar.length) {
    dur(
      'YAYIN AÇIK DEĞİL',
      ...sorunlar.map((x) => `• ${x}`),
      '',
      'Dosyalar yüklenmiş olabilir ama tabletler bu paketi ALMAZ.',
      'nginx kuralı için: deploy/guncelleme-sunucusu/README.md',
    );
  }

  // Bundle gerçekten erişilebilir mi (manifest ona işaret ediyor).
  const bundleUrl = `${FEED}ota/${runtimeVersion}/${damga}/${kunye.bundle}`;
  const yerelBundle = fs.statSync(path.join(paketDizin, kunye.bundle)).size;
  await dosyaDogrula(bundleUrl, { yerelBoyut: yerelBundle });
  bilgi(`  bundle       : ${yerelBundle} bayt — yayındaki boyutla eşleşti`);

  console.log('');
  bilgi('  ✔ YAYIN AÇIK. Tabletler bir sonraki açılışta (ya da 10 dk içinde');
  bilgi('    ön plana dönünce) güncellemeyi alır.');
  console.log('');
}

/* ------------------------------------------------------------------ *
 * APK
 * ------------------------------------------------------------------ */

/**
 * APK'nın İÇİNDEKİ güncelleme adresini okur (AndroidManifest.xml).
 *
 * ⚠️ NEDEN GEREKLİ (2026-08-27'de ısırdı): adres APK'ya DERLEME ANINDA
 * gömülür. Feed sabiti derlemeden SONRA değişirse elde kalan APK eski adresi
 * taşır ve bu hiçbir yerde görünmez — kurulan tablet güncelleme sorar, 404
 * alır ve sessizce bir daha hiç güncelleme almaz. Tam olarak bu yaşandı:
 * yol standardı `/adnansahin/` olarak değişti, APK ondan önce derlenmişti ve
 * yayınlandı. `build-apk.mjs`in kapısı bunu yakalıyordu ama derlemeden sonra
 * koşmadığı için yayın adımına ulaşamadı. Artık YAYIN da soruyor.
 *
 * AndroidManifest.xml ikili biçimdedir; dize havuzu UTF-16LE olduğu için
 * adres düz metin olarak okunabilir (ölçüldü).
 */
function apkicindekiAdres(apkYol) {
  const buf = fs.readFileSync(apkYol);
  // ZIP merkezi dizinini taramak yerine yerel başlıkları gez: dosya büyük ama
  // AndroidManifest.xml her zaman başlarda durur.
  const imza = Buffer.from('AndroidManifest.xml', 'latin1');
  let i = buf.indexOf(imza);
  while (i > 0) {
    const bas = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), i);
    if (bas < 0) break;
    const yontem = buf.readUInt16LE(bas + 8);
    const sikBoyut = buf.readUInt32LE(bas + 18);
    const adUz = buf.readUInt16LE(bas + 26);
    const ekUz = buf.readUInt16LE(bas + 28);
    const veriBas = bas + 30 + adUz + ekUz;
    try {
      const ham = buf.subarray(veriBas, veriBas + sikBoyut);
      const icerik = yontem === 8 ? zlib.inflateRawSync(ham) : ham;
      const metin = icerik.toString('utf16le');
      const m = /https?:\/\/[\x20-\x7E]{5,120}?manifest/.exec(metin);
      if (m) return m[0];
    } catch {
      /* bu girdi değilse sonrakine bak */
    }
    i = buf.indexOf(imza, i + 1);
  }
  return null;
}

async function apkYayinla(apkYol) {
  if (!fs.existsSync(apkYol)) dur('APK bulunamadı', apkYol);
  const surum = arg('surum');
  const vc = Number(arg('vc'));
  if (!surum || !Number.isFinite(vc)) {
    dur('APK yayını için --surum ve --vc gerekli', 'Örnek: --surum=2.9.8 --vc=55');
  }

  // SÜRÜM NOTU KAPISI — sahaya çıkışın SON adımı da not ister (2026-09-14).
  // OTA yolu (`yayinla-ota.mjs`) ve panel paketleme bu kapıyı taşıyordu, APK
  // yolu taşımıyordu: native değişiklikle çıkan sürüm notsuz kuruluyordu.
  // ⚠️ DAİRESEL DEĞİL: sürüm `--surum` ARGÜMANINDAN gelir, not dosyası onu
  // üretmez yalnız doğrular. Bekçi çalıştırılamazsa da DURUR (ÖLÇÜLEMEDİ):
  // koşmayan bir kapı, geçmiş bir kapı değildir.
  {
    const bekci = path.join(HERE, '..', 'scripts', 'check-surum-notlari.mjs');
    const r = spawnSync(process.execPath, [bekci, `--tablet=${surum}`], { stdio: 'inherit' });
    if (r.error) dur('SÜRÜM NOTU KAPISI ÖLÇÜLEMEDİ', `Bekçi çalıştırılamadı: ${r.error.message}`, `Denenen: ${bekci}`);
    if (r.status !== 0) {
      dur(
        'SÜRÜM NOTU KAPISI KIRMIZI',
        `${surum} için operatör notu yok ya da not kuralları ihlal edilmiş.`,
        "1) surum-notlari.json'a bu sürüm için kayıt ekle",
        '2) node scripts/surum-notlari-kopyala.mjs',
        '3) komutu tekrarla',
      );
    }
  }

  const ad = `TeksERP-${surum}-vc${vc}.apk`;
  if (!/^[\x20-\x7E]+$/.test(ad) || /\s/.test(ad)) {
    // Electron'da `Ş` + boşluk taşıyan dosya adı aktarımda bozulup 404 üretmişti.
    dur('APK dosya adı ASCII ve boşluksuz olmalı', ad);
  }

  // ⚠️ YÜKLEMEDEN ÖNCE: APK'nın taşıdığı adres ile bugünkü feed aynı mı?
  const apkAdres = apkicindekiAdres(apkYol);
  if (!apkAdres) {
    uyari('APK içindeki güncelleme adresi OKUNAMADI — kapı atlandı, elle doğrula.');
  } else if (!apkAdres.startsWith(normalizeFeed(feedUrl(MUSTERI)))) {
    dur(
      'APK YANLIŞ GÜNCELLEME ADRESİNİ TAŞIYOR',
      `APK içinde : ${apkAdres}`,
      `Beklenen   : ${normalizeFeed(FEED)}ota/<runtimeVersion>/manifest`,
      '',
      'Bu APK kurulan tablet güncelleme sorar, 404 alır ve bir daha HİÇ',
      'güncelleme almaz — üstelik bu hiçbir yerde görünmez.',
      '',
      'Sebep neredeyse her zaman aynı: feed adresi derlemeden SONRA değişti.',
      'Çözüm:  npx expo prebuild --platform android  &&  npm run build:apk',
    );
  } else {
    bilgi(`  APK içindeki adres: ${apkAdres}`);
  }

  const icerik = fs.readFileSync(apkYol);
  const kunye = {
    versionCode: vc,
    versionName: surum,
    dosya: ad,
    sha256: crypto.createHash('sha256').update(icerik).digest('hex'),
    boyut: icerik.length,
    zorunlu: argv.includes('--zorunlu'),
    notlar: arg('notlar') ?? null,
    yayinTarihi: new Date().toISOString(),
    indirmeUrl: `${FEED}apk/${ad}`,
  };

  baslik('KURULUM DOSYASI YAYINLANIYOR');
  bilgi(`Sürüm : ${surum} (vc ${vc})`);
  bilgi(`Boyut : ${(icerik.length / 1048576).toFixed(1)} MB`);
  console.log('');

  const gecici = path.join(path.dirname(apkYol), 'surum.json');
  fs.writeFileSync(gecici, JSON.stringify(kunye, null, 2));

  ssh(`mkdir -p '${UZAK_KOK}/apk'`, '(1/3) uzak klasör hazırlanıyor');
  // ÖNCE apk, SONRA künye — ters sırada künye olmayan bir dosyayı işaret eder.
  kos('scp', [apkYol, `${SSH_HEDEF}:${UZAK_KOK}/apk/${ad}`], '(2/3) APK yükleniyor');
  scp([gecici], `${UZAK_KOK}/apk/`, '(3/3) künye yükleniyor (yayını AÇAN adım)');

  if (KURU) return;

  const y = await iste(apkKunyeUrl(FEED));
  if (y.durum !== 200 || !y.govde.includes(`"versionCode": ${vc}`)) {
    dur('Künye yayında değil ya da bayat', `HTTP ${y.durum}`, y.govde.slice(0, 200));
  }
  await dosyaDogrula(kunye.indirmeUrl, {
    yerelBoyut: icerik.length,
    beklenenTip: 'application/vnd.android.package-archive',
  });
  bilgi(`  APK        : ${icerik.length} bayt — yayındaki boyutla eşleşti`);
  bilgi('\n  ✔ Kurulum dosyası yayında.');
}

/* ------------------------------------------------------------------ */

/**
 * Yayınlanan OTA paketinin sürümü — donmuş manifestin `extra.expoClient`inden.
 *
 * ⚠️ `mobil/app.json` OKUNMAZ: yayınlanan şey PAKETTİR ve paket üretildikten
 * sonra çalışma ağacındaki sürüm değişmiş olabilir. Etiket, yayınlanan baytın
 * taşıdığı numarayı göstermeli.
 */
function yayinlananPaketSurumu(paketDizin) {
  try {
    return manifestGovdesindenSurum(fs.readFileSync(path.join(paketDizin, 'manifest'), 'utf8'));
  } catch {
    return null;
  }
}

// Yükleme yapmadan mevcut bir yayını denetle. Yayın sonrası "hâlâ ayakta mı"
// sorusunun ucuz cevabı; ayrıca doğrulama mantığının kendisini sınamanın yolu.
const paket = arg('paket');
const apk = arg('apk');
if (!paket && !apk) {
  dur(
    'Ne yayınlanacağı belirtilmedi',
    'OTA paketi : node deploy/mobil-yayinla.mjs --paket=mobil/ota-cikti/54.2/<damga>',
    'Kurulum    : node deploy/mobil-yayinla.mjs --apk=<yol> --surum=2.9.8 --vc=55',
  );
}
if (paket) await paketiYayinla(path.resolve(paket));
if (apk) await apkYayinla(path.resolve(apk));

/* ------------------------------------------------------------------ *
 * Sürüm etiketi
 * ------------------------------------------------------------------ */
// Bir sonraki turun tabanı budur (`mobil/scripts/yayinla-ota.mjs` okur).
// Etiket YAYIN BİTTİKTEN sonra atılır — "sahaya çıkan kod tam olarak buydu"
// kaydıdır, elle verilen bir karar değil.
//
// ⚠️ BEST-EFFORT: yayın zaten yapıldı; etiketleme düşerse UYARI basılır.
// Var olan etiket TAŞINMAZ (aynı turda ikinci müşteri).
//
// ⚠️ OTA ve APK AYNI ÇİZGİDEDİR: `app.json > expo.version` hem paketin sürümü
// hem APK'nın `versionName`idir. İki ayrı ön ek, aynı numarayı iki yerde
// saydırıp çizgiyi ikiye bölerdi.
{
  const etiketSurumu = paket ? yayinlananPaketSurumu(path.resolve(paket)) : arg('surum');
  if (etiketSurumu) {
    const t = etiketAt('tablet', etiketSurumu);
    const mesaj = {
      atildi: `  ✓ sürüm etiketi atıldı: ${t.ad}`,
      'zaten-var': `  · sürüm etiketi zaten var: ${t.ad} (aynı tur)`,
      basarisiz: `  ⚠️ sürüm etiketi atılamadı: ${t.ad} (yayın etkilenmedi)`,
    }[t.durum];
    console.log(`\n${mesaj}${t.not ? ` — ${t.not}` : ''}`);
  }
}
