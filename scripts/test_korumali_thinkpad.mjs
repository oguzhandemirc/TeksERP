#!/usr/bin/env node
// =============================================================================
// BEKÇİ — deploy/korumali-thinkpad.sh İKİ KİP (prova | gercek): Mac kapıları + uçtan uca sahte derleme
// =============================================================================
// Zero-dep, ağsız: her şey GEÇİCİ dizinde (çıplak "origin" + çalışma deposu, HOME/git yapılandırması geçici);
// ssh/scp/npm PATH'te SAHTE (thinkpad'e bağlanılmaz, derleme koşulmaz). NE ÖLÇER:
//   §1 kuru kip (`--kuru`, ssh/scp HİÇ çağrılmaz): varsayılan kip prova (-Prova) · gercek'te --surum yoksa DUR ·
//      tanınmayan kip DUR · belge yok · kirli/izlenmeyen ağaç · origin/main'de olmayan commit · kaynak ≠ HEAD ·
//      etiket başka commit'te · sürüm son etiketten büyük değil → DUR; uyan gerçek koşu planı -Prova'sız
//      `-Korumali -Surum x -EtiketAtma` ve atılacak `backend-vX → HEAD` etiketini söyler
//   §2 sahte uçtan uca (yalnız macOS — betik bsdtar/iconv/shasum ister): uzak paketle komutu kipe göre (-Prova
//      yalnız provada) · özet kapısı kip ⇔ PAKET.json prova İKİ YÖNLÜ (yanlış kipte künye ve etiket YOK) ·
//      gerçek koşu künyeye kip/sürüm yazar, `backend-vX` açıklamalı etiketini HEAD'e YEREL atar (origin'e itmez),
//      ağaç temiz kalır
// Koşum: node scripts/test_korumali_thinkpad.mjs   (çıkış 0 yeşil · 1 kırmızı)
// =============================================================================
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BETIK = path.join(KOK, 'deploy', 'korumali-thinkpad.sh');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'korumali-thinkpad-'));
let gecti = 0;
let kaldi = 0;
function check(ad, ok, ek = '') {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? '✅' : '❌'} ${ad}${!ok && ek ? ` — ${ek}` : ''}`);
}

const SAHTE = path.join(TEMP, 'sahte-bin');
const SSH_LOG = path.join(TEMP, 'ssh.log');
const GITCFG = path.join(TEMP, 'gitconfig');
fs.mkdirSync(SAHTE);
fs.writeFileSync(GITCFG, '[init]\n\tdefaultBranch = main\n[tag]\n\tgpgSign = false\n[commit]\n\tgpgSign = false\n');
const ENV = {
  PATH: `${SAHTE}:${process.env.PATH}`,
  HOME: path.join(TEMP, 'ev'),
  TMPDIR: path.join(TEMP, 'tmp'),
  LANG: 'en_US.UTF-8',
  GIT_CONFIG_GLOBAL: GITCFG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'bekci', GIT_AUTHOR_EMAIL: 'bekci@ornek.invalid',
  GIT_COMMITTER_NAME: 'bekci', GIT_COMMITTER_EMAIL: 'bekci@ornek.invalid',
  SSH_LOG,
};
fs.mkdirSync(ENV.HOME);
fs.mkdirSync(ENV.TMPDIR);

// Sahte ssh: EncodedCommand'ı çözer, günlüğe yazar, komuta göre cevap verir (thinkpad'e bağlanılmaz).
fs.writeFileSync(path.join(SAHTE, 'ssh'), `#!/bin/bash
son="\${@: -1}"; b64="\${son##* }"
cmd=$(printf '%s' "$b64" | base64 -d 2>/dev/null | iconv -f UTF-16LE -t UTF-8)
printf 'SSH %s\\n=====\\n' "$cmd" >> "$SSH_LOG"
case "$cmd" in
  *BatteryStatus*) if [ -n "$TP_SAHTE_KIRLI" ]; then printf 'tamam: node v26 \\xb7 C: 100 GB bos\\r\\n'; else echo "tamam: node v26 · C: 100 GB bos"; fi; printf 'TSIP=100.70.47.46\\r\\n' ;;
  *paketle.ps1*) echo "  PAKET HAZIR (sahte)" ;;
  *Get-ChildItem*) echo "$(basename "$TP_SAHTE_ZIP")|$(shasum -a 256 "$TP_SAHTE_ZIP" | cut -d' ' -f1)" ;;
esac
exit 0
`, { mode: 0o755 });
// Sahte scp: indirme (kaynak uzak) hazır zip'i kopyalar; yükleme yalnız günlüğe.
fs.writeFileSync(path.join(SAHTE, 'scp'), `#!/bin/bash
printf 'SCP %s\\n' "$*" >> "$SSH_LOG"
hedef="\${@: -1}"; kaynak="\${@: -2:1}"
case "$kaynak" in *:tkd/*) cp "$TP_SAHTE_ZIP" "$hedef" ;; esac
exit 0
`, { mode: 0o755 });
// Sahte npm: Rust derlemesi yerine sabit baytlı parçaları beklenen yerlere yazar.
fs.writeFileSync(path.join(SAHTE, 'npm'), `#!/bin/bash
case "$*" in
  *derle:win:uretim*) mkdir -p dist-uretim && printf 'sahte-node' > dist-uretim/lisans-cekirdek.win32-x64-msvc.node ;;
  *derle:hizmetler:win*) d="$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release"; mkdir -p "$d"; printf 'sahte-hizmet' > "$d/tekserp-hizmet.exe"; printf 'sahte-guncelleyici' > "$d/tekserp-guncelleyici.exe" ;;
esac
exit 0
`, { mode: 0o755 });

const ORIGIN = path.join(TEMP, 'origin.git');
const DEPO = path.join(TEMP, 'depo');
function git(args, cwd = DEPO) {
  const r = spawnSync('git', args, { cwd, env: { ...process.env, ...ENV }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const yaz = (rel, icerik) => {
  const f = path.join(DEPO, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, icerik);
};
// Geçici depodaki belge yolu (gerçek repoya çapa değil — check-docs düz yolu çapa sayar).
const belge = (v) => ['docs', 'surumler', `backend-${v}.md`].join('/');
const commitle = (mesaj) => { git(['add', '-A']); git(['commit', '-q', '-m', mesaj]); return git(['rev-parse', 'HEAD']); };

git(['init', '-q', '--bare', '-b', 'main', ORIGIN], TEMP);
git(['init', '-q', '-b', 'main', DEPO], TEMP);
git(['remote', 'add', 'origin', ORIGIN]);
fs.mkdirSync(path.join(DEPO, 'deploy'));
fs.copyFileSync(BETIK, path.join(DEPO, 'deploy', 'korumali-thinkpad.sh'));
fs.chmodSync(path.join(DEPO, 'deploy', 'korumali-thinkpad.sh'), 0o755);
yaz('Teks-Erp/native/lisans-cekirdek/README', 'sahte\n');
yaz('docs/surumler/SABLON.md', '# şablon\n');
const TABAN = commitle('taban');
git(['tag', '-a', 'backend-v2.14.0', '-m', 'backend 2.14.0']);
git(['push', '-q', 'origin', 'main', '--tags']);

function kos(args, ek = {}) {
  fs.writeFileSync(SSH_LOG, '');
  const r = spawnSync('bash', [path.join(DEPO, 'deploy', 'korumali-thinkpad.sh'), ...args], {
    cwd: DEPO, env: { ...process.env, ...ENV, ...ek }, encoding: 'utf8', timeout: 120_000,
  });
  return { kod: r.status, cikti: r.stdout ?? '', hata: r.stderr ?? '', ssh: fs.readFileSync(SSH_LOG, 'utf8') };
}
const ozet = (r) => `çıkış ${r.kod} · ${(r.hata || r.cikti).trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`;

// ── §1 kuru kip ──────────────────────────────────────────────────────────────
console.log('\n§1 kuru kip (Mac kapıları; thinkpad yok)');
{
  const r = kos(['--kuru']);
  check('§1a varsayılan kip PROVA: plan -Korumali -Prova, etiket yok, ssh/scp çağrılmadı',
    r.kod === 0 && /kip\s+prova/.test(r.cikti) && /paketle\s+deploy\\paketle\.ps1 -Korumali -Prova$/m.test(r.cikti) && !/etiket\s/.test(r.cikti) && r.ssh === '', ozet(r));
  const p = kos(['--kip', 'prova', '--surum', '2.14.1', '--kuru']);
  check('§1b prova + --surum: -Korumali -Prova -Surum 2.14.1', p.kod === 0 && /-Korumali -Prova -Surum 2\.14\.1$/m.test(p.cikti), ozet(p));
  const s = kos(['--kip', 'gercek', '--kuru']);
  check('§1c ⭐ gercek kipte --surum yok → DUR (2)', s.kod === 2 && /--surum x\.y\.z ZORUNLU/.test(s.hata) && s.ssh === '', ozet(s));
  const t = kos(['--kip', 'uretim', '--kuru']);
  check('§1d tanınmayan kip → 2', t.kod === 2 && /--kip prova\|gercek/.test(t.hata), ozet(t));
  const t2 = kos(['--kip']);
  check('§1d\' değersiz --kip → 2', t2.kod === 2, ozet(t2));
  const b = kos(['--kip', 'gercek', '--surum', '2.14.1', '--kuru']);
  check('§1e ⭐ gercek: sürüm belgesi commit\'te yok → DUR (3)', b.kod === 3 && /sürüm belgesi YOK: docs\/surumler\/backend-2\.14\.1\.md/.test(b.hata), ozet(b));
}
for (const v of ['2.14.1', '2.13.5', '2.14.0']) yaz(belge(v), `# Backend ${v}\n`);
const SURUM_COMMIT = commitle('belge');
git(['push', '-q', 'origin', 'main']);
{
  const r = kos(['--kip', 'gercek', '--surum', '2.14.1', '--kuru']);
  check('§1f ⭐ uyan gerçek koşu: plan -Prova\'SIZ `-Korumali -Surum 2.14.1 -EtiketAtma`, etiket backend-v2.14.1 → HEAD, ssh yok',
    r.kod === 0 && /paketle\s+deploy\\paketle\.ps1 -Korumali -Surum 2\.14\.1 -EtiketAtma$/m.test(r.cikti) && !/-Prova/.test(r.cikti) &&
      r.cikti.includes(`etiket   backend-v2.14.1 → ${SURUM_COMMIT}`) && r.cikti.includes(`kaynak   ${SURUM_COMMIT} (HEAD)`) && r.ssh === '', ozet(r));

  yaz('docs/surumler/SABLON.md', '# şablon değişti\n');
  const k = kos(['--kip', 'gercek', '--surum', '2.14.1', '--kuru']);
  git(['checkout', '-q', '--', 'docs/surumler/SABLON.md']);
  check('§1g ⭐ kirli ağaç → DUR', k.kod === 3 && /kirli/.test(k.hata), ozet(k));
  yaz('izlenmeyen.txt', 'x\n');
  const u = kos(['--kip', 'gercek', '--surum', '2.14.1', '--kuru']);
  fs.rmSync(path.join(DEPO, 'izlenmeyen.txt'));
  check('§1g\' ⭐ izlenmeyen dosya → DUR', u.kod === 3 && /kirli/.test(u.hata), ozet(u));

  yaz('yerel.txt', 'itilmemiş\n');
  commitle('yerel');
  const m = kos(['--kip', 'gercek', '--surum', '2.14.1', '--kuru']);
  git(['reset', '-q', '--hard', SURUM_COMMIT]);
  check('§1h ⭐ commit origin/main\'de değil → DUR', m.kod === 3 && /origin\/main'de değil/.test(m.hata), ozet(m));

  const f = kos(['--kip', 'gercek', '--surum', '2.14.1', '--ref', TABAN, '--kuru']);
  check('§1i ⭐ kaynak ≠ HEAD (betik başka commit\'ten) → DUR', f.kod === 3 && /betiğin commit'i/.test(f.hata), ozet(f));

  const e = kos(['--kip', 'gercek', '--surum', '2.14.0', '--kuru']);
  check('§1j ⭐ etiket başka commit\'te (backend-v2.14.0 tabanda) → DUR', e.kod === 3 && /backend-v2\.14\.0 zaten başka commit'te/.test(e.hata), ozet(e));
  const d = kos(['--kip', 'gercek', '--surum', '2.13.5', '--kuru']);
  check('§1k ⭐ sürüm son etiketten büyük değil → DUR', d.kod === 3 && /son etiket backend-v2\.14\.0'dan büyük değil/.test(d.hata), ozet(d));
}

// ── §2 sahte uçtan uca ───────────────────────────────────────────────────────
const sha = (b) => createHash('sha256').update(b).digest('hex');
function zipKur(ad, { prova, surum }) {
  const k = path.join(TEMP, `paket-${ad}`);
  for (const d of ['dist', 'runtime', 'native']) fs.mkdirSync(path.join(k, d), { recursive: true });
  fs.writeFileSync(path.join(k, 'dist', 'server.jsc'), 'jsc');
  fs.writeFileSync(path.join(k, 'dist', 'server-kunye.json'), JSON.stringify({ commit: SURUM_COMMIT, jscUretildi: true, guvenCapasi: 'uretim' }));
  fs.writeFileSync(path.join(k, 'runtime', 'node.exe'), 'node');
  fs.writeFileSync(path.join(k, 'runtime', 'tekserp-hizmet.exe'), 'sahte-hizmet');
  fs.writeFileSync(path.join(k, 'runtime', 'tekserp-guncelleyici.exe'), 'sahte-guncelleyici');
  fs.writeFileSync(path.join(k, 'native', 'lisans-cekirdek.win32-x64-msvc.node'), 'sahte-node');
  fs.writeFileSync(path.join(k, 'PAKET.json'), JSON.stringify({
    commit: SURUM_COMMIT.slice(0, 9), calismaAgaciTemiz: true, korumali: true, korumaHedef: 'win-x64', prova, uygulamaSurumu: surum,
    hizmetIkilileri: { 'tekserp-hizmet.exe': { sha256: sha('sahte-hizmet') }, 'tekserp-guncelleyici.exe': { sha256: sha('sahte-guncelleyici') } },
  }));
  const zip = path.join(TEMP, `zip-${ad}`, `tekserp-backend-${ad}.zip`);
  fs.mkdirSync(path.dirname(zip));
  spawnSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: k });
  return zip;
}
const paketleSatiri = (r) => (r.ssh.split('=====').find((b) => b.includes('paketle.ps1')) ?? '').split('\n').find((s) => s.includes('paketle.ps1')) ?? '';
const yerelEtiket = () => { try { return git(['rev-parse', '-q', '--verify', 'refs/tags/backend-v2.14.1^{commit}']); } catch { return ''; } };

if (process.platform !== 'darwin') {
  console.log('\n⏭  §2 sahte uçtan uca yalnız macOS\'ta (betik bsdtar/iconv/shasum ister)');
} else {
  console.log('\n§2 sahte uçtan uca (ssh/scp/npm sahte)');
  const PROVA_SURUM = `2.14.1-prova.${SURUM_COMMIT.slice(0, 7)}`;
  const z = {
    gercek: zipKur('gercek', { prova: false, surum: '2.14.1' }),
    prova: zipKur('prova', { prova: true, surum: PROVA_SURUM }),
  };
  const cikti = (ad) => path.join(TEMP, `cikti-${ad}`);

  const a = kos(['--kip', 'gercek', '--surum', '2.14.1', '--cikti', cikti('a')], { TP_SAHTE_ZIP: z.prova });
  check('§2a ⭐ gerçek koşu PROVA paketi getirdi → özet kapısı DUR; künye ve etiket YOK',
    a.kod === 1 && /ÖZET KAPISI: kip gercek ama paket prova=true/.test(a.hata) && !fs.existsSync(path.join(cikti('a'), `${path.basename(z.prova)}.derleme.json`)) && yerelEtiket() === '', ozet(a));
  check('§2a\' gerçek koşunun uzak paketle komutu -Prova TAŞIMAZ, -Surum 2.14.1 -EtiketAtma taşır',
    /paketle\.ps1 -Korumali -Surum 2\.14\.1 -EtiketAtma -NativeYol/.test(paketleSatiri(a)) && !/-Prova/.test(paketleSatiri(a)), paketleSatiri(a).slice(0, 160));

  const b = kos(['--cikti', cikti('b')], { TP_SAHTE_ZIP: z.gercek });
  check('§2b ⭐ prova koşusu GERÇEK paket getirdi → özet kapısı DUR', b.kod === 1 && /ÖZET KAPISI: kip prova ama paket prova=false/.test(b.hata), ozet(b));
  check('§2b\' prova koşusunun uzak paketle komutu -Prova taşır', /paketle\.ps1 -Korumali -Prova -NativeYol/.test(paketleSatiri(b)), paketleSatiri(b).slice(0, 160));

  const c = kos(['--kip', 'prova', '--surum', '2.14.1', '--cikti', cikti('c')], { TP_SAHTE_ZIP: z.prova });
  const kc = (() => { try { return JSON.parse(fs.readFileSync(path.join(cikti('c'), `${path.basename(z.prova)}.derleme.json`), 'utf8')); } catch { return null; } })();
  check('§2c prova koşusu + prova paketi → künye kip prova, sürüm tabanı 2.14.1, etiket ATILMADI',
    c.kod === 0 && kc?.kip === 'prova' && kc?.surum === '2.14.1' && yerelEtiket() === '' && !/backend-v2\.14\.1/.test(c.cikti), ozet(c));

  const g = kos(['--kip', 'gercek', '--surum', '2.14.1', '--cikti', cikti('g')], { TP_SAHTE_ZIP: z.gercek });
  const kg = (() => { try { return JSON.parse(fs.readFileSync(path.join(cikti('g'), `${path.basename(z.gercek)}.derleme.json`), 'utf8')); } catch { return null; } })();
  check('§2d ⭐ gerçek koşu + gerçek paket → künye {kip gercek · surum 2.14.1 · kaynak = betik = HEAD}',
    g.kod === 0 && kg?.kip === 'gercek' && kg?.surum === '2.14.1' && kg?.kaynak?.commit === SURUM_COMMIT && kg?.betik?.commit === SURUM_COMMIT && kg?.kaynak?.ref === 'HEAD', ozet(g));
  let tur = '';
  try { tur = git(['cat-file', '-t', 'backend-v2.14.1']); } catch { /* yok */ }
  check('§2e ⭐ backend-v2.14.1 AÇIKLAMALI etiketi HEAD\'e yerelde atıldı', yerelEtiket() === SURUM_COMMIT && tur === 'tag', `${yerelEtiket()} ${tur}`);
  check('§2f ⭐ etiket origin\'e İTİLMEDİ (push komutu yalnız söylendi)',
    git(['ls-remote', '--tags', 'origin', 'refs/tags/backend-v2.14.1']) === '' && /git push origin backend-v2\.14\.1/.test(g.cikti), g.cikti.slice(-200));
  check('§2g Mac ağacı temiz kaldı (sürüm belgesi repoda yazılmadı)', git(['status', '--porcelain']) === '');

  // UTF-8 dışı bayt (Windows kod sayfası "·") + CRLF içeren uzak çıktı: UTF-8 yerelinde tr/grep/sed düşmemeli.
  const k = kos(['--kip', 'prova', '--surum', '2.14.1', '--cikti', cikti('k')], { TP_SAHTE_ZIP: z.prova, TP_SAHTE_KIRLI: '1', LC_ALL: 'en_US.UTF-8' });
  check('§2i ⭐ uzak çıktıda UTF-8 dışı bayt + CRLF → kapı düşmez (LC_ALL=C), Tailscale IP ölçülür',
    k.kod === 0 && !/Illegal byte sequence/.test(k.hata) && !/Tailscale IP ölçülemedi/.test(k.cikti + k.hata), ozet(k));

  const t = kos(['--kip', 'gercek', '--surum', '2.14.1', '--kuru']);
  check('§2h yeniden koşu: etiket zaten HEAD\'de → kapı geçer, "yeniden atılmaz" der', t.kod === 0 && /zaten .*yeniden atılmaz/.test(t.cikti), ozet(t));
}

fs.rmSync(TEMP, { recursive: true, force: true });
console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi === 0 ? 0 : 1);
