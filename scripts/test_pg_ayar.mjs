#!/usr/bin/env node
// =============================================================================
// test_pg_ayar — deploy/pg/pg-ayar.ps1 (mevcut PostgreSQL'e ayar profili, KURU varsayılan)
// =============================================================================
// Betik GERÇEK pwsh'ta, SAHTE psql'e karşı koşar (sahte psql her SQL'i günlüğe yazar, senaryo
// dosyalarından pg_settings / pg_file_settings / pg_available_extensions cevabı verir). DB'siz, ağsız.
//   §1 diller arası kâhin: -YalnizHedef bellek + disk vektörlerini (pg-sablon-vektorleri.json) ve şablonun
//      sabit değerlerini (JS motoru yapilandirmaUret) BAYT-EŞİT üretir — 4/8/32 GB dahil her vektör
//   §2 ⭐ KURU kip (varsayılan): hiçbir ALTER SYSTEM / CREATE EXTENSION / pg_reload_conf YOK; tablo
//      "ezilmedi" + [RESTART] işaretli; çıkış 0
//   §3 -Uygula: farklı ayarlar yazılır; postgresql.auto.conf'taki FARKLI değer EZİLMEZ; uzantı yalnız
//      'postgres' DB'sine; pg_reload_conf; yeniden başlatma söylenir, betik Restart-Service ÇAĞIRMAZ
//   §4 uzantı kümede yok: shared_preload_libraries + pg_stat_statements.* + CREATE EXTENSION yazılmaz
//   §5 var olan ön yükleme korunur, liste her öğe AYRI literal ('a', 'b')
//   §6 süper olmayan kullanıcı: çıkış 1, yazma yok
//   §7 ⭐ .control var ama LOAD düşüyor (DLL yok/uyumsuz): kuru ve -Uygula'da ön yükleme + uzantı.* + CREATE
//      EXTENSION yazılmaz ("kütüphane yüklenemedi"); CREATE EXTENSION ilk ALTER SYSTEM'den ÖNCE
//   §9 liste: harf duyarsız (yineleme yok) · auto.conf boş liste başka liste değil · postgresql.conf'ta restart
//      bekleyen farklı liste → yazılmaz + ipucu. §3 ⭐ ön yüklü olmayan uzantı.* → ERTELENDI (sahte psql PG 16 gibi
//      tanımsız parametreyi reddeder), ikinci koşumda yazılır
//   §8 auto.conf'ta uzantısız başka liste: bayraksız ezilmez + uzantı ayarları atlanır (elle komut ipucu);
//      -OnYuklemeBirlestir ile 'liste', 'pg_stat_statements' yazılır
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (pwsh yok).
//   node scripts/test_pg_ayar.mjs            # dinlenme
//   node scripts/test_pg_ayar.mjs --sonda    # kalıcı negatif sondalar (betiğin / vektörün bozuk kopyası)
// =============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { confAyristir, jsonOku, metinOku, ORNEK_REL, VEKTOR_REL, yapilandirmaUret } from '../deploy/pg/lib/pg-ornegi.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BETIK_REL = 'deploy/pg/pg-ayar.ps1';

if (spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status !== 0) {
  console.log('⛔ ÖLÇÜLEMEDİ — pwsh yok (betik yalnız gerçek kabukta ölçülür)');
  process.exit(2);
}

const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'test-pg-ayar-'));
process.on('exit', () => fs.rmSync(GECICI, { recursive: true, force: true }));

// Sahte psql: argv'den -d ve -tAc'yi alır, günlüğe yazar, senaryodan cevap verir.
const SAHTE_BIN = path.join(GECICI, 'bin');
fs.mkdirSync(SAHTE_BIN);
fs.writeFileSync(path.join(SAHTE_BIN, 'psql'), `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const a = process.argv.slice(2); const d = a[a.indexOf('-d') + 1]; const sql = a[a.indexOf('-tAc') + 1];
const S = process.env.SAHTE_SENARYO;
fs.appendFileSync(path.join(S, 'gunluk'), JSON.stringify({ d, sql }) + '\\n');
const oku = (ad) => { try { return fs.readFileSync(path.join(S, ad), 'utf8'); } catch { return ''; } };
let c = '';
const tanimsiz = /^ALTER SYSTEM SET (pg_stat_statements\.\w+)/.exec(sql);
if (tanimsiz && !oku('mevcut').split('\\n').some((l) => l.startsWith(tanimsiz[1] + '|'))) {
  // PG 16: modül ön yüklü değilken ALTER SYSTEM tanımsız parametreyi reddeder (gerçek PG 16.15'te ölçüldü).
  process.stderr.write('ERROR:  unrecognized configuration parameter "' + tanimsiz[1] + '"'); process.exit(1);
}
if (/rolsuper/.test(sql)) c = oku('su') || 't';
else if (/pg_file_settings.*NOT LIKE/.test(sql)) c = oku('conf');
else if (/FROM pg_settings WHERE lower\\(name\\) IN/.test(sql)) c = oku('mevcut');
else if (/pg_file_settings/.test(sql)) c = oku('oto');
else if (/pg_available_extensions/.test(sql)) c = oku('uzanti') || '1';
else if (/FROM pg_extension/.test(sql)) c = '0';
else if (/pending_restart/.test(sql)) c = oku('bekleyen');
else if (/^LOAD /.test(sql) && oku('load')) { process.stderr.write('ERROR:  could not load library "pg_stat_statements.dll": The specified module could not be found.'); process.exit(1); }
process.stdout.write(c);
`, { mode: 0o755 });

// Adnan ölçümü (2026-11-07): eski installer varsayılanları; work_mem önceden ALTER SYSTEM ile 8MB.
const ADNAN = {
  mevcut: [
    'shared_buffers|160MB|postmaster', 'effective_cache_size|4GB|user', 'maintenance_work_mem|64MB|user', 'work_mem|8MB|user',
    'random_page_cost|4|user', 'shared_preload_libraries||postmaster', 'track_io_timing|off|superuser',
    'log_min_duration_statement|-1|superuser', "log_line_prefix|%m [%p] |sighup",
  ].join('\n'),
  oto: 'work_mem|8MB',
};

/** betikDizini: pg-ayar.ps1 + pg-ornegi.json + şablon (sondada bozuk kopya). */
function kos(betikDizini, argumanlar, senaryo = {}) {
  const S = fs.mkdtempSync(path.join(GECICI, 's-'));
  for (const [ad, icerik] of Object.entries(senaryo)) fs.writeFileSync(path.join(S, ad), icerik);
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(betikDizini, 'pg-ayar.ps1'), ...argumanlar], {
    encoding: 'utf8', env: { ...process.env, SAHTE_SENARYO: S }, timeout: 60000,
  });
  const gunlukYol = path.join(S, 'gunluk');
  const gunluk = fs.existsSync(gunlukYol) ? fs.readFileSync(gunlukYol, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : [];
  return { kod: r.status, cikti: `${r.stdout}${r.stderr}`, gunluk };
}
const BAG = ['-PgBin', SAHTE_BIN, '-Parola', 'sahte', '-RamMB', '32768'];
const YAZAN = /\bALTER\s+SYSTEM\b|\bCREATE\s+EXTENSION\b|pg_reload_conf/i;

function olc(betikDizini, vektorYolu) {
  const k = [];
  const ok = (bolum, kosul, ne) => { if (!kosul) k.push(`${bolum} ${ne}`); };

  // §1 — kâhin
  const vektor = JSON.parse(fs.readFileSync(vektorYolu, 'utf8'));
  const ornek = jsonOku(ORNEK_REL);
  const ayarAdi = Object.fromEntries(Object.entries(ornek.yapilandirma.bellek).map(([a, f]) => [a, f.ayar]));
  const diskAdi = ornek.yapilandirma.disk.ayarlar;
  for (const v of vektor.bellek) {
    const r = kos(betikDizini, ['-YalnizHedef', '-RamMB', String(v.ramMB)]);
    let h;
    try { h = JSON.parse(r.cikti.trim().split('\n').pop()); } catch { ok('§1', false, `${v.ramMB} MB: JSON yok (${r.cikti.slice(0, 120)})`); continue; }
    for (const [a, deger] of Object.entries(v.beklenen)) ok('§1', h[ayarAdi[a]] === deger, `${v.ramMB} MB ${ayarAdi[a]} = ${h[ayarAdi[a]]} — vektör ${deger}`);
    if (v.ramMB === 4096) {
      // Şablonun sabit değerleri JS motoruyla aynı (diller arası tek kaynak).
      const js = confAyristir(yapilandirmaUret({ ramMB: 4096, port: 5432 }, { ornek, confSablon: metinOku(ornek.yapilandirma.confSablonu), hbaSablon: metinOku(ornek.yapilandirma.hbaSablonu) }).conf).ayarlar;
      for (const a of ornek.yapilandirma.hariciBakim.ayarlar) ok('§1', h[a] === js.get(a)?.deger, `${a} PS "${h[a]}" ≠ JS "${js.get(a)?.deger}"`);
    }
  }
  for (const v of vektor.disk.filter((x) => !x.beklenen.hata)) {
    const r = kos(betikDizini, ['-YalnizHedef', '-RamMB', '4096', '-Disk', v.disk.toUpperCase()]);
    let h = {};
    try { h = JSON.parse(r.cikti.trim().split('\n').pop()); } catch { /* aşağıda kırmızı */ }
    for (const [a, deger] of Object.entries(v.beklenen)) ok('§1', h[diskAdi[a]] === deger, `disk ${v.disk} ${diskAdi[a]} = ${h[diskAdi[a]]} — vektör ${deger}`);
  }

  // §2 — KURU kip
  const kuru = kos(betikDizini, BAG, ADNAN);
  ok('§2', kuru.kod === 0, `kuru çıkış ${kuru.kod}: ${kuru.cikti.slice(-300)}`);
  const kuruYazan = kuru.gunluk.filter((g) => YAZAN.test(g.sql));
  ok('§2', kuru.gunluk.length > 0 && kuruYazan.length === 0, `⭐ KURU kipte yazan SQL: ${kuruYazan.map((g) => g.sql).join(' | ') || '(psql hiç çağrılmadı)'}`);
  ok('§2', /work_mem.*ezilmedi/.test(kuru.cikti), 'work_mem (auto.conf 8MB) satırı "ezilmedi" demiyor');
  ok('§2', /shared_buffers.*\[RESTART\]/.test(kuru.cikti) && /shared_preload_libraries.*\[RESTART\]/.test(kuru.cikti), 'shared_buffers / shared_preload_libraries [RESTART] işaretli değil');
  ok('§2', /KURU: \d+ ayar yazilacak - HICBIR SEY YAZILMADI/.test(kuru.cikti), 'KURU özeti yok');

  // §3 — -Uygula
  const uy = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, bekleyen: 'shared_buffers' });
  const alter = uy.gunluk.filter((g) => /ALTER SYSTEM/.test(g.sql)).map((g) => g.sql);
  ok('§3', uy.kod === 0, `uygula çıkış ${uy.kod}: ${uy.cikti.slice(-300)}`);
  ok('§3', alter.includes("ALTER SYSTEM SET shared_buffers = '8GB'") && alter.includes("ALTER SYSTEM SET random_page_cost = '1.1'") && alter.includes("ALTER SYSTEM SET log_line_prefix = '%m [%p] %q%u@%d '"), `beklenen ALTER SYSTEM yok: ${alter.join(' | ')}`);
  // ⭐ Adnan: ön yükleme boş → uzantı parametresi tanımsız; yazılmaz, ERTELENDI, döngü sonuna kadar gider.
  ok('§3', !alter.some((s) => /pg_stat_statements\./.test(s)) && /pg_stat_statements\.max.*ERTELENDI/.test(uy.cikti) && /pg_stat_statements\.track.*ERTELENDI/.test(uy.cikti), `⭐ ön yüklü olmayan uzantı ayarı ERTELENMEDİ: ${alter.filter((s) => /pg_stat_statements\./.test(s)).join(' | ')}`);
  ok('§3', /ERTELENDI \(.*\): on yukleme restart ile etkinlesince ayni komutu yeniden kos/.test(uy.cikti), 'ertelenen için ikinci koşum ipucu yok');
  // Ön yükleme etkin (restart sonrası ikinci koşum): uzantı parametreleri pg_settings'te → yazılır.
  const ikinci = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, mevcut: ADNAN.mevcut.replace('shared_preload_libraries||', 'shared_preload_libraries|pg_stat_statements|') + '\npg_stat_statements.max|1000|postmaster\npg_stat_statements.track|all|superuser' });
  ok('§3', ikinci.kod === 0 && ikinci.gunluk.some((g) => g.sql === "ALTER SYSTEM SET pg_stat_statements.max = '5000'") && ikinci.gunluk.some((g) => g.sql === "ALTER SYSTEM SET pg_stat_statements.track = 'top'") && !ikinci.gunluk.some((g) => /SET shared_preload_libraries/.test(g.sql)), `ikinci koşum: ${ikinci.gunluk.filter((g) => /ALTER/.test(g.sql)).map((g) => g.sql).join(' | ')} (çıkış ${ikinci.kod})`);
  ok('§3', !alter.some((s) => /\bwork_mem\b/.test(s) && !/maintenance/.test(s)), '⭐ auto.conf\'taki farklı work_mem EZİLDİ');
  ok('§3', alter.some((s) => /effective_cache_size/.test(s)) && alter.some((s) => /maintenance_work_mem/.test(s)), 'effective_cache_size/maintenance_work_mem farkı yazılmadı');
  const ext = uy.gunluk.filter((g) => /CREATE EXTENSION/.test(g.sql));
  ok('§3', ext.length === 1 && ext[0].d === 'postgres', `CREATE EXTENSION yalnız 'postgres' DB'sinde olmalı: ${JSON.stringify(ext)}`);
  ok('§3', uy.gunluk.some((g) => /pg_reload_conf/.test(g.sql)), 'pg_reload_conf çağrılmadı');
  ok('§3', /YENIDEN BASLATMA GEREKLI.*shared_buffers.*shared_preload_libraries/.test(uy.cikti), 'yeniden başlatma listesi söylenmedi');
  const betik = fs.readFileSync(path.join(betikDizini, 'pg-ayar.ps1'), 'utf8');
  ok('§3', !betik.split('\n').some((s) => /^\s*(Restart-Service|Stop-Service|pg_ctl)/.test(s) || /^\s*&.*pg_ctl/.test(s)), 'betik PostgreSQL\'i kendisi yeniden başlatıyor');
  ok('§3', !/[^\t\n\r\x20-\x7e]/.test(betik), 'betik ASCII dışı karakter taşıyor (PowerShell 5.1 ANSI okur)');

  // §4 — uzantı kümede yok
  const yok = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, uzanti: '0' });
  const yokYazan = yok.gunluk.filter((g) => /shared_preload_libraries|pg_stat_statements\.|CREATE EXTENSION/.test(g.sql) && YAZAN.test(g.sql));
  ok('§4', yok.kod === 0 && yokYazan.length === 0, `uzantı yokken yazıldı: ${yokYazan.map((g) => g.sql).join(' | ')}`);
  ok('§4', /shared_preload_libraries.*kumede yok/.test(yok.cikti), 'ATLANDI satırı yok');

  // §5 — var olan ön yükleme korunur, ayrı literaller
  const on = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, mevcut: ADNAN.mevcut.replace('shared_preload_libraries||', 'shared_preload_libraries|auto_explain|') });
  ok('§5', on.gunluk.some((g) => g.sql === "ALTER SYSTEM SET shared_preload_libraries = 'auto_explain', 'pg_stat_statements'"), `ön yükleme listesi: ${on.gunluk.filter((g) => /preload/.test(g.sql)).map((g) => g.sql).join(' | ')}`);

  // §3b — sıra: uzantı kurulumu ön yüklemeden ÖNCE (kütüphane yüklenemezse hiçbir ayar yazılmadan durulur)
  const iExt = uy.gunluk.findIndex((g) => /CREATE EXTENSION/.test(g.sql));
  const iAlter = uy.gunluk.findIndex((g) => /ALTER SYSTEM/.test(g.sql));
  ok('§3', iExt >= 0 && iAlter > iExt, `CREATE EXTENSION (${iExt}) ilk ALTER SYSTEM'den (${iAlter}) önce değil`);

  // §7 — LOAD sondası
  for (const [kip, arg] of [['kuru', BAG], ['uygula', [...BAG, '-Uygula']]]) {
    const ld = kos(betikDizini, arg, { ...ADNAN, load: 'hata' });
    const ldYazan = ld.gunluk.filter((g) => YAZAN.test(g.sql) && /shared_preload_libraries|pg_stat_statements\.|CREATE EXTENSION/.test(g.sql));
    ok('§7', ld.kod === 0 && ldYazan.length === 0, `⭐ ${kip}: kütüphane yüklenemiyorken yazıldı: ${ldYazan.map((g) => g.sql).join(' | ')} (çıkış ${ld.kod})`);
    ok('§7', /shared_preload_libraries.*kutuphane yuklenemedi/.test(ld.cikti), `${kip}: "kutuphane yuklenemedi" satırı yok`);
    if (kip === 'uygula') ok('§7', ld.gunluk.some((g) => g.sql === "ALTER SYSTEM SET shared_buffers = '8GB'"), 'uzantı dışı ayarlar yine yazılmalı');
  }

  // §8 — auto.conf'ta uzantısız başka ön yükleme listesi
  const otoAE = { ...ADNAN, oto: 'work_mem|8MB\nshared_preload_libraries|auto_explain' };
  const ae = kos(betikDizini, [...BAG, '-Uygula'], otoAE);
  const aeYazan = ae.gunluk.filter((g) => YAZAN.test(g.sql) && /shared_preload_libraries|pg_stat_statements\.|CREATE EXTENSION/.test(g.sql));
  ok('§8', ae.kod === 0 && aeYazan.length === 0, `bayraksız: auto.conf listesi ezildi / uzantı ayarları yazıldı: ${aeYazan.map((g) => g.sql).join(' | ')}`);
  ok('§8', /OnYuklemeBirlestir ya da elle: ALTER SYSTEM SET shared_preload_libraries = 'auto_explain', 'pg_stat_statements'/.test(ae.cikti), 'elle komut ipucu yok');
  const aeB = kos(betikDizini, [...BAG, '-Uygula', '-OnYuklemeBirlestir'], otoAE);
  ok('§8', aeB.kod === 0 && aeB.gunluk.some((g) => g.sql === "ALTER SYSTEM SET shared_preload_libraries = 'auto_explain', 'pg_stat_statements'"), `-OnYuklemeBirlestir birleşimi yazmadı: ${aeB.gunluk.filter((g) => /ALTER/.test(g.sql)).map((g) => g.sql).join(' | ')}`);

  // §9 — liste kenarları: harf duyarsız · auto.conf boş liste · postgresql.conf'ta bekleyen liste
  const buyuk = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, mevcut: ADNAN.mevcut.replace('shared_preload_libraries||', 'shared_preload_libraries|PG_STAT_STATEMENTS|') });
  ok('§9', !buyuk.gunluk.some((g) => /SET shared_preload_libraries/.test(g.sql)), `harf farkıyla ön yükleme yinelendi: ${buyuk.gunluk.filter((g) => /preload/.test(g.sql) && /ALTER/.test(g.sql)).map((g) => g.sql).join(' | ')}`);
  const bos = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, oto: 'work_mem|8MB\nshared_preload_libraries|' });
  ok('§9', bos.gunluk.some((g) => g.sql === "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"), `auto.conf boş liste "başka liste" sayıldı: ${bos.cikti.split('\n').filter((l) => /shared_preload/.test(l)).join(' / ')}`);
  const conf = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, conf: 'auto_explain|f' });
  ok('§9', conf.kod === 0 && !conf.gunluk.some((g) => /SET shared_preload_libraries/.test(g.sql)), `postgresql.conf bekleyen listeye rağmen ön yükleme yazıldı`);
  ok('§9', /restart bekleyen farkli liste var \(auto_explain\).*ALTER SYSTEM SET shared_preload_libraries = 'auto_explain', 'pg_stat_statements'/.test(conf.cikti), 'postgresql.conf bekleyen liste uyarısı/ipucu yok');

  // §6 — süper değil
  const su = kos(betikDizini, [...BAG, '-Uygula'], { ...ADNAN, su: 'f' });
  ok('§6', su.kod === 1 && !su.gunluk.some((g) => YAZAN.test(g.sql)), `süper olmayan: çıkış ${su.kod}`);
  return k;
}

function kopya(mutasyon) {
  const d = fs.mkdtempSync(path.join(GECICI, 'kopya-'));
  for (const f of ['pg-ayar.ps1', 'pg-ornegi.json', 'postgresql.tekserp.conf.sablon']) fs.copyFileSync(path.join(KOK, 'deploy/pg', f), path.join(d, f));
  const yol = path.join(d, 'pg-ayar.ps1');
  const eski = fs.readFileSync(yol, 'utf8');
  const yeni = mutasyon ? mutasyon(eski) : eski;
  fs.writeFileSync(yol, yeni);
  return { d, uygulandi: yeni !== eski };
}

const DIZIN = path.join(KOK, 'deploy/pg');
const VEKTOR = path.join(KOK, VEKTOR_REL);

if (process.argv.includes('--sonda')) {
  console.log('test_pg_ayar — kalıcı sondalar\n');
  const vBozuk = path.join(GECICI, 'vektor-bozuk.json');
  const v = JSON.parse(fs.readFileSync(VEKTOR, 'utf8'));
  v.bellek.find((b) => b.ramMB === 8192).beklenen.SHARED_BUFFERS = '4GB';
  fs.writeFileSync(vBozuk, JSON.stringify(v));
  const S = [
    ['N1 KURU koruması söküldü (if ($Uygula) → if ($true)) → §2', (m) => m.replace('if ($Uygula) {', 'if ($true) {'), VEKTOR, '§2'],
    ['N2 "ezilmez" kuralı söküldü → §3', (m) => m.replace('elseif ($oto.ContainsKey($ad)) {', 'elseif ($false) {'), VEKTOR, '§3'],
    ['N3 uzantı varlık denetimi söküldü → §4', (m) => m.replace('if (-not $uzantiVar -and $uzantiAyari) {', 'if ($false) {'), VEKTOR, '§4'],
    ['N4 ön yükleme tek literal → §5', (m) => m.replace(/\$deger = if \(\$r\.ad -ceq "shared_preload_libraries"\)/, '$deger = if ($false)'), VEKTOR, '§5'],
    ['N5 bakım belleği formülü sapmış (bölen yok sayıldı) → §1', (m) => m.replace('if ($null -ne $f.bolen)', 'if ($false)'), VEKTOR, '§1'],
    ['N6 8 GB vektörü bozuldu → §1', null, vBozuk, '§1'],
    ['N7 LOAD sondası söküldü → §7', (m) => m.replace('if ($yukle.kod -ne 0) {', 'if ($false) {'), VEKTOR, '§7'],
    ['N8 auto.conf ön yükleme engeli söküldü → §8', (m) => m.replace('-and -not $OnYuklemeBirlestir', '-and $false'), VEKTOR, '§8'],
    ['N10 erteleme söküldü → §3', (m) => m.replace('elseif ($ad.StartsWith("$uzanti.") -and -not $mevcut.ContainsKey($ad)) {', 'elseif ($false) {'), VEKTOR, '§3'],
    ['N11 harf duyarsız birleşim söküldü → §9', (m) => m.replace('foreach ($k in @($ek)) { if ($l -notcontains $k)', 'foreach ($k in @($ek)) { if ($l -cnotcontains $k)').replace('return ((@($v -csplit \',\' | ForEach-Object { $_.Trim().Trim(\'"\').ToLowerInvariant() } | Where-Object { $_ }) | Sort-Object -Unique)', 'return ((@($v -csplit \',\' | ForEach-Object { $_.Trim().Trim(\'"\') } | Where-Object { $_ }) | Sort-Object)'), VEKTOR, '§9'],
    ['N12 auto.conf boş liste kuralı söküldü → §9', (m) => m.replace('$otoListe = $otoVar -and (@($onYukleme).Count -gt 0)', '$otoListe = $otoVar'), VEKTOR, '§9'],
    ['N13 postgresql.conf bekleyen liste denetimi söküldü → §9', (m) => m.replace('elseif ($ad -ceq "shared_preload_libraries" -and $null -ne $confBekleyen) {', 'elseif ($false) {'), VEKTOR, '§9'],
    ['N9 uzantı ALTER SYSTEM\'den sonra kuruluyor → §3', (m) => m.replace('  if ($uzantiYaz) {', '  if ($false) {').replace('  $a = Psql "postgres" "SELECT pg_reload_conf()"', '  if ($uzantiYaz) { [void](Psql $uzantiVt "CREATE EXTENSION IF NOT EXISTS $uzanti") }\n  $a = Psql "postgres" "SELECT pg_reload_conf()"'), VEKTOR, '§3'],
  ];
  let kaldi = 0;
  for (const [ad, mut, vek, iz] of S) {
    const { d, uygulandi } = kopya(mut);
    const k = olc(d, vek);
    const tamam = (mut ? uygulandi : true) && k.some((x) => x.startsWith(iz));
    if (!tamam) kaldi += 1;
    console.log(`${tamam ? '✅' : '❌'} ${ad}${mut && !uygulandi ? ' — MUTASYON UYGULANMADI' : ''} · ${k[0] ?? 'YEŞİL kaldı'}`);
  }
  console.log(`\n=== Sonuç: ${S.length - kaldi} geçti, ${kaldi} başarısız ===`);
  process.exit(kaldi ? 1 : 0);
}

console.log('test_pg_ayar — deploy/pg/pg-ayar.ps1 (sahte psql, gerçek pwsh)\n');
const k = olc(DIZIN, VEKTOR);
for (const x of k) console.log(`❌ ${x}`);
console.log(k.length ? `\n=== Sonuç: KIRMIZI (${k.length}) ===` : '✅ §1 kâhin · §2 KURU yazmaz · §3 uygula/ezilmez/uzantı postgres DB · §4 uzantısız atlar · §5 ön yükleme · §6 süper değil · §7 LOAD sondası · §8 auto.conf listesi · §9 liste kenarları · ERTELENDI\n\n=== Sonuç: yeşil ===');
process.exit(k.length ? 1 : 0);
