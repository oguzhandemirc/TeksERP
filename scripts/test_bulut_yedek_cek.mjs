#!/usr/bin/env node
// =============================================================================
// Bekçi: makine dışı yedek ÇEKME modeli (VDS denetimi 2026-11-01 K2) — deploy/bulut/yedek-cek/
// =============================================================================
//   §1 statik: çekici silmez (--delete yok), ezmez (--ignore-existing), yalnız *.dump.tkenc alır, zaman damgasını
//      kaynaktan almaz (-a/-t yok); kapı rrsync -ro -no-del; hazırlayıcı kaynağa rm/mv yazmaz; dosyalar çalıştırılabilir
//   §2 yerel prova (ssh'siz, iki dizin): yalnız şifreli+sihirli dosya çıkışa ve hedefe gider · düz döküm hiçbir
//      aşamada geçmez · kaynakta aynı adla bozulan/silinen dosya hedef kopyayı BOZAMAZ · sihirsiz dosya karantinaya ·
//      kuru kip yazmaz · saklama en yeni EN_AZ'ı korur, eskiyi siler · yaş eşiği aşılınca çıkış 4
//   §3 zorunlu komut zinciri (rrsync varsa): sahte ssh ile cek-kapisi üzerinden çekim çalışır ve damga yazar;
//      yazma isteği ve kabuk isteği REDDEDİLİR (rrsync yoksa beyanlı atlar — CI ubuntu'da var)
//   §4 shellcheck (varsa; CI ubuntu'da kurulu) · §5 barındırma kontrol betiği son çekim yaşını ölçer
//   Gömülü sondalar: betik kopyaları bozulup §1/§2 yeniden koşulur → kırmızı beklenir.
// Koşum: node scripts/test_bulut_yedek_cek.mjs   (çıkış 0 yeşil · 1 kırmızı)
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'deploy/bulut/yedek-cek');
const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');
let passed = 0;
let failed = 0;
let skipped = 0;
function check(name, ok, extra = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra ? ` — ${extra}` : ''}`);
}
const skip = (name, why) => {
  skipped++;
  console.log(`⏭ ${name} — ${why}`);
};
const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-cek-'));
const MAGIC = Buffer.from([0x54, 0x4b, 0x53, 0x45, 0x4e, 0x43, 0x00, 0x01]);
const tkenc = (body) => Buffer.concat([MAGIC, Buffer.from(body)]);

// --- §1 statik --------------------------------------------------------------------
function staticFindings(src) {
  const out = [];
  const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const cek = code(src.cek);
  const args = /RSYNC_ARGS=\(([^)]*)\)/.exec(cek)?.[1] ?? '';
  if (/--delete|--remove-source-files/.test(cek)) out.push('çekici siliyor');
  if (!/--ignore-existing/.test(args)) out.push('çekici var olanı ezebilir');
  if (!/--include='\*\.dump\.tkenc' --exclude='\*'/.test(args)) out.push('süzgeç yalnız .tkenc değil');
  if (/(^|\s)-[a-zA-Z]*[at][a-zA-Z]*(\s|$)|--times|--archive/.test(args)) out.push('zaman damgası kaynaktan alınıyor');
  if (!/sihirli "\$HEDEF\/\$ad"/.test(cek)) out.push('sihirli bayt denetimi yok');
  const kapi = code(src.kapi);
  if (!/"\$RRSYNC" -ro -no-del "\$CIKIS_DIZIN"/.test(kapi)) out.push('kapı salt-okur rrsync değil');
  if (!/"rsync --server --sender "\*\)/.test(kapi)) out.push('kapı gönderici kip dışını kabul ediyor');
  const haz = code(src.haz);
  if (haz.split('\n').some((l) => /\b(rm|mv)\b[^\n]*(\$KAYNAK|"\$yol")/.test(l))) out.push('hazırlayıcı kaynağa yazıyor');
  if (!/sihirli "\$yol"/.test(haz)) out.push('hazırlayıcı sihirli bayt denetlemiyor');
  return out;
}
const SRC = { cek: read('yedek-cek.sh'), kapi: read('cek-kapisi.sh'), haz: read('cikis-hazirla.sh') };
{
  const f = staticFindings(SRC);
  check('§1 ⭐ çekici silmez/ezmez/yalnız .tkenc/zaman damgası almaz; kapı rrsync -ro; hazırlayıcı kaynağa yazmaz', f.length === 0, f.join(' | '));
  for (const n of ['yedek-cek.sh', 'cek-kapisi.sh', 'cikis-hazirla.sh']) {
    check(`§1 ${n} çalıştırılabilir`, (fs.statSync(path.join(DIR, n)).mode & 0o111) !== 0);
  }
  for (const [name, mut] of [
    ['--delete eklendi', { ...SRC, cek: SRC.cek.replace('-r --ignore-existing', '-r --ignore-existing --delete') }],
    ['--ignore-existing çıkarıldı', { ...SRC, cek: SRC.cek.replace('-r --ignore-existing', '-r') }],
    ['-a (zaman damgası) eklendi', { ...SRC, cek: SRC.cek.replace('RSYNC_ARGS=(-r ', 'RSYNC_ARGS=(-a ') }],
    ['düz döküm süzgece girdi', { ...SRC, cek: SRC.cek.replace("--include='*.dump.tkenc' --exclude='*'", "--include='*.dump*' --exclude='*'") }],
    ['kapı yazılabilir', { ...SRC, kapi: SRC.kapi.replace('"$RRSYNC" -ro -no-del', '"$RRSYNC"') }],
  ]) {
    const applied = JSON.stringify(mut) !== JSON.stringify(SRC);
    check(`§1 sonda: ${name} → kırmızı`, applied && staticFindings(mut).length > 0, applied ? '' : 'MUTASYON UYGULANMADI');
  }
}

// --- §2 yerel prova ---------------------------------------------------------------
function run(script, args, env = {}) {
  const r = spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
/** Senaryo: betik dizini parametre — sondalar bozulmuş kopyayla aynı senaryoyu koşar. Döner: kırmızı listesi. */
function scenario(dir, tag, report) {
  const bad = [];
  const ok = (name, cond, extra) => {
    if (report) check(name, cond, extra);
    if (!cond) bad.push(name);
  };
  const w = path.join(tmp, tag);
  const [src, out, dst] = ['kaynak', 'cikis', 'hedef'].map((d) => path.join(w, d));
  fs.mkdirSync(src, { recursive: true });
  const A = 'tekserp_20261101_030000.dump.tkenc';
  fs.writeFileSync(path.join(src, A), tkenc('asil-govde'));
  fs.writeFileSync(path.join(src, 'tekserp_20261101_030000.dump'), 'DUZ-DOKUM');
  fs.writeFileSync(path.join(src, 'tekserp_20261031_030000.dump.tkenc'), 'XXXXXXXXsihirsiz');
  fs.symlinkSync('/etc/hosts', path.join(src, 'tekserp_20261030_030000.dump.tkenc'));
  const h = run(path.join(dir, 'cikis-hazirla.sh'), ['--kaynak', src, '--cikis', out, '--grup', '']);
  const outList = fs.existsSync(out) ? fs.readdirSync(out).sort() : [];
  ok('§2a hazırlayıcı yalnız şifreli+sihirli dosyayı çıkışa koyar (düz, sihirsiz, bağ YOK); kaynak dokunulmadı',
    h.code === 0 && JSON.stringify(outList) === JSON.stringify([A]) && fs.readdirSync(src).length === 4, `${h.code} ${outList} ${h.out}`);

  const k = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst, '--kuru']);
  ok('§2b kuru kip ne çekileceğini söyler, hedefe yedek YAZMAZ', k.code === 0 && k.out.includes(A) && !fs.existsSync(path.join(dst, A)), k.out);

  const c = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst]);
  ok('§2c ⭐ çekim: şifreli yedek hedefte, düz döküm YOK, damga yazıldı', c.code === 0 && fs.existsSync(path.join(dst, A))
    && !fs.readdirSync(dst).some((f) => f.endsWith('.dump')) && fs.existsSync(path.join(dst, '.son-cekim')), `${c.code} ${c.out}`);

  // Ele geçirilmiş kaynak: aynı adı bozar, sonra siler — hedef kopya bayt-aynı kalmalı.
  fs.writeFileSync(path.join(out, A), tkenc('BOZULMUS-FIDYE'));
  const c2 = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst]);
  fs.rmSync(path.join(out, A));
  const c3 = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst]);
  const kept = fs.existsSync(path.join(dst, A)) ? fs.readFileSync(path.join(dst, A)) : Buffer.alloc(0);
  ok('§2d ⭐ kaynakta bozulan/silinen dosya hedef kopyayı BOZAMAZ ve SİLEMEZ', c2.code === 0 && c3.code === 0 && kept.equals(tkenc('asil-govde')), `${c2.code}/${c3.code} ${kept}`);

  const S = 'tekserp_20261102_030000.dump.tkenc';
  fs.writeFileSync(path.join(out, S), 'XXXXXXXXduz-dokum-kilikli');
  const c4 = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst]);
  ok('§2e .tkenc adlı ama sihirsiz dosya karantinaya gider', fs.existsSync(path.join(dst, 'karantina', S)) && !fs.existsSync(path.join(dst, S)), c4.out);

  const E = 'tekserp_20250101_030000.dump.tkenc';
  fs.writeFileSync(path.join(dst, E), tkenc('eski'));
  const old = new Date(Date.now() - 200 * 86400_000);
  fs.utimesSync(path.join(dst, E), old, old);
  const Y = 'tekserp_20261103_030000.dump.tkenc';
  fs.writeFileSync(path.join(out, Y), tkenc('yeni'));
  const c5 = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst], { EN_AZ: '1', SAKLAMA_GUN: '90' });
  ok('§2f saklama: 90 günden eski silindi, yeniler korundu', c5.code === 0 && !fs.existsSync(path.join(dst, E)) && fs.existsSync(path.join(dst, Y)) && fs.existsSync(path.join(dst, A)), c5.out);

  const c6 = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', out, '--hedef', dst], { AZAMI_SAAT: '-1' });
  ok('§2g yaş eşiği aşılınca çıkış 4 + HATA YEDEK_ESKI', c6.code === 4 && /YEDEK_ESKI/.test(c6.out), `${c6.code} ${c6.out}`);
  const c7 = run(path.join(dir, 'yedek-cek.sh'), ['--kaynak', 'sunucu-adsiz', '--hedef', dst]);
  ok('§2h biçimsiz kaynak çıkış 2', c7.code === 2, `${c7.code}`);

  // §2i: kaynak 30, çıkış 7 gün tutar — saklamadan eski kaynak her saatlik koşumda yeniden kopyalanıp silinmemeli.
  const src2 = path.join(w, 'kaynak-eski');
  const out2 = path.join(w, 'cikis-eski');
  fs.mkdirSync(src2, { recursive: true });
  for (let i = 0; i < 6; i += 1) {
    const f = path.join(src2, `tekserp_202610${String(10 + i).padStart(2, '0')}_030000.dump.tkenc`);
    fs.writeFileSync(f, tkenc(`eski-${i}`));
    const t = new Date(Date.now() - (20 - i) * 86400_000);
    fs.utimesSync(f, t, t);
  }
  const P = 'premigrate_20261101_030000.dump.tkenc';
  fs.writeFileSync(path.join(src2, P), tkenc('premigrate'));
  const hz = () => run(path.join(dir, 'cikis-hazirla.sh'), ['--kaynak', src2, '--cikis', out2, '--grup', ''], { CIKIS_SAKLAMA_GUN: '7', CIKIS_EN_AZ: '3' });
  const h1 = hz();
  const h2 = hz();
  const out2List = fs.existsSync(out2) ? fs.readdirSync(out2) : [];
  ok('§2i ⭐ saklamadan eski kaynak yalnız en yeni EN_AZ kadar kopyalanır; ikinci koşum 0 yeni, silme YOK',
    h1.code === 0 && h2.code === 0 && /tamam: 3 yeni/.test(h1.out) && /tamam: 0 yeni/.test(h2.out)
      && !/saklama: silindi/.test(`${h1.out}${h2.out}`) && out2List.length === 3, `${h1.out} || ${h2.out}`);
  ok('§2j premigrate_ dökümü (şifreli de olsa) çıkışa girmez', !out2List.includes(P), `${out2List}`);
  return bad;
}
if (!has('rsync') || !has('bash')) {
  skip('§2 yerel prova', 'rsync/bash yok');
} else {
  scenario(DIR, 'asil', true);
  // Sondalar: bozulmuş betik kopyası aynı senaryoda kırmızı vermeli.
  const probeDir = (name, file, from, to) => {
    const d = path.join(tmp, `sonda-${name}`);
    fs.mkdirSync(d, { recursive: true });
    for (const f of fs.readdirSync(DIR)) fs.copyFileSync(path.join(DIR, f), path.join(d, f));
    const src = fs.readFileSync(path.join(d, file), 'utf8');
    const mutated = src.replace(from, to);
    fs.writeFileSync(path.join(d, file), mutated);
    const bad = mutated === src ? [] : scenario(d, `s-${name}`, false);
    check(`§2 sonda: ${name} → kırmızı`, bad.length > 0, mutated === src ? 'MUTASYON UYGULANMADI' : '');
  };
  probeDir('ezme', 'yedek-cek.sh', '-r --ignore-existing', '-r');
  probeDir('sihir-yok', 'yedek-cek.sh', '&& sihirli "$HEDEF/$ad"; then', '; then');
  probeDir('hazirlayici-sihir-yok', 'cikis-hazirla.sh', 'if ! sihirli "$yol"; then', 'if false; then');
  probeDir('yas-yok', 'yedek-cek.sh', 'if [ "$YAS_SAAT" -gt "$AZAMI_SAAT" ]', 'if false');
  probeDir('eski-kaynak-tekrar', 'cikis-hazirla.sh', '"$EN_YENI" | grep -Fqx "$ad"; then continue', '"$EN_YENI" | grep -Fqx "$ad"; then :');
  probeDir('premigrate-gecer', 'cikis-hazirla.sh', "AD_DESENI='^tekserp[a-z0-9_]*_", "AD_DESENI='^[a-z0-9_]+_");
}

// --- §3 zorunlu komut zinciri -------------------------------------------------------
const rrsync = process.env.TEKSERP_CEK_RRSYNC || ['/usr/bin/rrsync', '/usr/local/bin/rrsync'].find((p) => fs.existsSync(p));
if (!rrsync || !has('rsync')) {
  skip('§3 zorunlu komut zinciri', 'rrsync yok (rsync >= 3.2.4 ile gelir)');
} else {
  const w = path.join(tmp, 'zincir');
  const out = path.join(w, 'cikis');
  const dst = path.join(w, 'hedef');
  const damga = path.join(w, 'son-cekim');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'tekserp_20261101_030000.dump.tkenc'), tkenc('zincir'));
  const env = { TEKSERP_CEK_CIKIS: out, TEKSERP_CEK_DAMGA: damga, TEKSERP_CEK_RRSYNC: rrsync };
  // Sahte ssh: seçenekleri ve sunucu adını atlar, kalan komutu SSH_ORIGINAL_COMMAND olarak kapıya verir.
  const fake = path.join(w, 'sahte-ssh.sh');
  fs.writeFileSync(fake, `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case "$1" in -[lpio]) shift 2 ;; -*) shift ;; *) shift; break ;; esac; done\nSSH_ORIGINAL_COMMAND="$*" exec bash ${JSON.stringify(path.join(DIR, 'cek-kapisi.sh'))}\n`, { mode: 0o755 });
  const c = run(path.join(DIR, 'yedek-cek.sh'), ['--kaynak', 'tekserp-cek@musteri:', '--hedef', dst], { ...env, CEK_SSH_KOMUTU: fake });
  check('§3a ⭐ kapı üzerinden çekim çalışır ve başarı damgası yazılır', c.code === 0 && fs.existsSync(path.join(dst, 'tekserp_20261101_030000.dump.tkenc')) && fs.existsSync(damga), `${c.code} ${c.out}`);
  const gate = (cmd) => spawnSync('bash', [path.join(DIR, 'cek-kapisi.sh')], { encoding: 'utf8', env: { ...process.env, ...env, SSH_ORIGINAL_COMMAND: cmd } }).status;
  check('§3b kapı kabuk isteğini reddeder', gate('sh -c id') !== 0);
  check('§3c ⭐ kapı YAZMA (alıcı kip) isteğini reddeder', gate('rsync --server -logDtpre.iLsfxCIvu --delete . /') !== 0);
}

// --- §4 shellcheck · §5 kontrol betiği --------------------------------------------------
if (has('shellcheck')) {
  const r = spawnSync('shellcheck', ['yedek-cek.sh', 'cikis-hazirla.sh', 'cek-kapisi.sh'], { cwd: DIR, encoding: 'utf8' });
  check('§4 shellcheck temiz', r.status === 0, r.stdout.slice(0, 600));
} else {
  skip('§4 shellcheck', 'shellcheck yok (CI ubuntu koşucusunda kurulu)');
}
{
  const k = fs.readFileSync(path.join(ROOT, 'deploy/bulut/barindirma-kontrol.sh'), 'utf8');
  check('§5 barındırma kontrol betiği son başarılı çekimin yaşını ölçer (damga yolu kapıyla aynı)',
    k.includes('/var/lib/tekserp-cek/son-cekim') && SRC.kapi.includes('/var/lib/tekserp-cek/son-cekim') && /CEKIM_AZAMI_SAAT/.test(k));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} geçti, ${failed} kaldı${skipped ? `, ${skipped} atlandı` : ''}`);
process.exitCode = failed === 0 ? 0 : 1;
