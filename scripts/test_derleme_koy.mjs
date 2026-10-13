#!/usr/bin/env node
// =============================================================================
// BEKÇİ — DERLEME KOY (deploy/satici/derleme-koy.mjs) · zero-dep, DB'siz, AĞSIZ (sahte ssh/scp)
// =============================================================================
// Betik satıcının `derlemeler/` deposuna (VDS) dosya koyar. Burada GERÇEK süreç olarak, PATH'in önündeki sahte
// `ssh`/`scp` ile koşar; her çağrı deftere düşer ve uzak komut `lisans-devreye/lib/ag.mjs` salt-okuma sözleşmesiyle
// OKUMA / YAZMA diye sınıflanır. `vds-dogrula.sh` gerçek betiktir (sahte ssh + geçici taban).
//   §1 KURU temiz: çıkış 0 · VDS'e yalnız OKUMA (tek ssh) · scp YOK · vds-dogrula koşmaz · plan tam (scp, sha256sum -c,
//      yardımcı konteyner `--network none --user 0`, dizin sahibiyle 0644, vds-dogrula iki kez)
//   §2 aynı ad + FARKLI içerik → DUR 1 (KURU ve --uygula): yalnız okuma, scp/yazma/vds YOK
//   §3 aynı ad + AYNI içerik → 0, iş yok, yazma YOK
//   §4 yerel kapılar (ssh'tan ÖNCE): satıcının ad kuralı · PROVA adı üretime · yanındaki .sha256 · kullanım
//   §5 VDS kapıları: bağ salt okunur değil/başka yol · bağ yok · yardımcı imaj etiketsiz · dizin okunamaz · disk · yarım yazım
//   §6 ssh kopuk → ÖLÇÜLEMEDİ 2
//   §7 --uygula mutlu yol: sıra vds(önce) → yazımlar → ölçüm → vds(sonra); her yazım ilk vds'ten SONRA, son çağrı vds
//   §8 vds-dogrula sonra FARK ya da çıktısı öncekinden farklı → DUR 1 · §9 vds-dogrula önce FARK → DUR 1, yazma YOK
//   §10 konteyner betiği (IC_BETIK) geçici dizinde: yeni dosya yayınlanır, gizli ad kalmaz · var olan dosya EZİLMEZ (3)
//   §11 ad kuralı satıcının kaynağından okunur; bulunamazsa ÖLÇÜLEMEDİ · §12 yazım çağrıları yalnız uygula() içinde
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (bash yok). Cırcır değil.
// Çalışıyor mu: §2–§9 kalıcı negatif senaryolar her koşumda; betikteki kapılar tek tek kapatılınca kırmızı verdiği
//   ÖLÇÜLDÜ (Teks-Erp/docs/BEKCI-HARITASI.md satırı, ✓B). Gerekli mi: ÖLÇÜLMEDİ — betik bu bekçiyle birlikte doğdu.
//   node scripts/test_derleme_koy.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BETIK = path.join(KOK, 'deploy/satici/derleme-koy.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let gecti = 0;
let kaldi = 0;
function check(ad, ok, detay = '') {
  if (ok) gecti += 1;
  else kaldi += 1;
  console.log(`${ok ? '✅' : '❌'} ${ad}${!ok && detay ? ` — ${String(detay).replace(/\s+/g, ' ').slice(0, 400)}` : ''}`);
}
if (spawnSync('bash', ['--version']).error) {
  console.log('⛔ ÖLÇÜLEMEDİ — bash yok\n\n=== Sonuç: ÖLÇÜLEMEDİ ===');
  process.exit(2);
}

const { sshDenetle } = await import(path.join(KOK, 'deploy/lisans-devreye/lib/ag.mjs'));
const m = await import(BETIK);
const depo = await import(path.join(KOK, 'scripts/lib/derleme-deposu.mjs'));

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-derleme-koy-')));
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
const yol = (...p) => path.join(TMP, ...p);
const BIN = yol('bin');
const SAHTE = yol('sahte');
const LOG = yol('log.tsv');
fs.mkdirSync(BIN);
fs.mkdirSync(SAHTE);
fs.mkdirSync(yol('ev'));
fs.writeFileSync(path.join(BIN, 'ssh'), `#!/usr/bin/env bash
cmd="\${@: -1}"; hedef="\${@: -2:1}"
printf 'ssh\\t%s\\t%s\\n' "$hedef" "$(printf '%s' "$cmd" | tr '\\n' ' ')" >> "$SAHTE_LOG"
[ -n "\${SAHTE_KOPUK:-}" ] && exit 255
case "$cmd" in
  *@@YEDEK*) [ "$hedef" = tekserp-vds ] && cat "$SAHTE_DIR/vds-yedek" ;;
  *@@KOK*)
    n=$(cat "$SAHTE_DIR/vds-sayac" 2>/dev/null || echo 0); echo $((n+1)) > "$SAHTE_DIR/vds-sayac"
    if [ "$n" -ge 1 ] && [ -f "$SAHTE_DIR/vds-sonra" ]; then cat "$SAHTE_DIR/vds-sonra"; else cat "$SAHTE_DIR/vds"; fi ;;
  *@@BAG*) if [ -f "$SAHTE_DIR/yazildi" ]; then cat "$SAHTE_DIR/olcum-sonra"; else cat "$SAHTE_DIR/olcum"; fi ;;
  "sha256sum "*) if [ -f "$SAHTE_DIR/yazildi" ]; then cat "$SAHTE_DIR/sha-sonra"; else cat "$SAHTE_DIR/sha"; fi ;;
  *"docker run"*) touch "$SAHTE_DIR/yazildi"; cat "$SAHTE_DIR/koy" ;;
  *) : ;;
esac
exit 0
`, { mode: 0o755 });
fs.writeFileSync(path.join(BIN, 'scp'), '#!/usr/bin/env bash\nprintf \'scp\\t%s\\n\' "$*" >> "$SAHTE_LOG"\ndst="${@: -1}"\ncase "$dst" in *.yarim) [ -n "${SAHTE_INDIR:-}" ] && cp "$SAHTE_INDIR" "$dst" ;; esac\nexit 0\n', { mode: 0o755 });

// vds-dogrula tabanı: sahte ssh çıktısından (gerçek betik --taban-yaz ile). Bayt ölçümü ve yedek ölçümü iki ayrı
// ssh'tir; yedek yalnız docker erişimli tekserp-vds hedefinden cevap alır (yayinci docker grubunda değil).
function vdsCikti(bozuk = false) {
  const h = (i) => (i === 3 && bozuk ? 'f' : 'a').repeat(2) + i.toString(16).padStart(62, '0');
  return [...Array.from({ length: 310 }, (_, i) => `${h(i)}  adnansahin/electron/d${i}.bin`), '@@KOK', `${h(900)}  electron/latest.yml`, '@@DIGER', `${h(901)}  /opt/x/defter.tsv`, '@@LS', 'adnansahin', 'electron', ''].join('\n');
}
const TABAN = yol('taban');
fs.writeFileSync(path.join(SAHTE, 'vds'), vdsCikti());
fs.writeFileSync(path.join(SAHTE, 'vds-yedek'), ['@@YEDEK', '20261012_090000', 'satici_20261013_030000.dump.tkenc', 'anahtarlar_20261013_030000.tar.tkenc.tkenc', ''].join('\n'));
{
  const r = spawnSync('bash', [path.join(KOK, 'deploy/vds-dogrula.sh'), `--taban=${TABAN}`, '--taban-yaz'], { encoding: 'utf8', env: { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, SAHTE_LOG: yol('taban-log'), SAHTE_DIR: SAHTE } });
  if (r.status !== 0) {
    console.log(`⛔ ÖLÇÜLEMEDİ — vds-dogrula tabanı yazılamadı: ${r.stdout}${r.stderr}\n\n=== Sonuç: ÖLÇÜLEMEDİ ===`);
    process.exit(2);
  }
}

// Yerel dosyalar
const D = '/opt/stack/apps/tekserp-satici-uretim/derlemeler';
const AD = 'TeksERP-Kurulum-test-9.9.9.zip';
const VERI = crypto.randomBytes(70_000);
const DOSYA = yol('girdi', AD);
fs.mkdirSync(yol('girdi'));
fs.writeFileSync(DOSYA, VERI);
fs.writeFileSync(`${DOSYA}.sha256`, `${sha(VERI)}  ${AD}\n`);
const OZ = sha(VERI);
const YEDEK = 'tekserp-satici-yedek:abc123def456';

function olcum({ d = D, bag = `${d} false`, yardimci = YEDEK, imajlar = ['tekserp-satici:abc123def456', YEDEK], dizin = '0:0 755', ls = [], bos = 50_000_000, kap = ls, baglanti = [] } = {}) {
  const lsSatir = (x) => `-rw-r--r-- 1 0 0 ${x[1]} Oct  1 00:47 ${x[0]}`;
  return ['@@BAG', bag, '@@YARDIMCI', yardimci, '@@IMAJLAR', ...imajlar, '@@DIZIN', dizin,
    '@@LS', 'total 8', 'drwxr-xr-x 2 0 0 4096 Oct  1 00:47 .', 'drwxr-xr-x 9 0 0 4096 Oct  1 00:47 ..', '-rw-r--r-- 1 0 0 1234 Oct  1 00:47 TeksERP-1.4.2-Setup.exe', ...ls.map(lsSatir),
    '@@DF', 'Filesystem 1024-blocks Used Available Capacity Mounted on', `/dev/sda1 100000000 1 ${bos} 50% /`, `/dev/sda1 100000000 1 ${bos} 50% /`,
    '@@KAP', 'total 8', '-rw-r--r-- 1 root root 1234 Oct  1 00:47 TeksERP-1.4.2-Setup.exe', ...kap.map((x) => `-rw-r--r-- 1 root root ${x[1]} Oct  1 00:47 ${x[0]}`), ...(baglanti === null ? [] : ['@@BAGLANTI', ...baglanti]), '@@SON', ''].join('\n');
}

function kos(args, s = {}) {
  for (const f of fs.readdirSync(SAHTE)) if (f !== 'vds' && f !== 'vds-yedek') fs.rmSync(path.join(SAHTE, f));
  fs.rmSync(LOG, { force: true });
  fs.writeFileSync(path.join(SAHTE, 'olcum'), s.olcum ?? olcum());
  fs.writeFileSync(path.join(SAHTE, 'olcum-sonra'), s.olcumSonra ?? olcum({ ls: [[AD, VERI.length]] }));
  fs.writeFileSync(path.join(SAHTE, 'sha'), s.sha ?? '');
  fs.writeFileSync(path.join(SAHTE, 'sha-sonra'), s.shaSonra ?? `${OZ}  ${D}/${AD}\n`);
  fs.writeFileSync(path.join(SAHTE, 'koy'), s.koy ?? `${OZ}  ${AD}\n`);
  if (s.vdsSonra) fs.writeFileSync(path.join(SAHTE, 'vds-sonra'), s.vdsSonra);
  const env = { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, HOME: yol('ev'), TEKSERP_VDS_TABAN: TABAN, TEKSERP_YEDEK_SSH_HEDEF: '', SAHTE_LOG: LOG, SAHTE_DIR: SAHTE, LC_ALL: 'C' };
  if (s.kopuk) env.SAHTE_KOPUK = '1';
  if (s.indir) env.SAHTE_INDIR = s.indir;
  const r = spawnSync(process.execPath, [s.betik ?? BETIK, ...args], { encoding: 'utf8', env, timeout: 60_000 });
  const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => {
    const [arac, ...rest] = l.split('\t');
    const hedef = arac === 'ssh' ? rest.shift() : null;
    const cmd = rest.join('\t');
    let okuma = false;
    if (arac === 'ssh') {
      try {
        sshDenetle(cmd.trim());
        okuma = true;
      } catch {
        okuma = false;
      }
    }
    // vds-dogrula iki ssh açar (bayt @@KOK + yedek @@YEDEK); ikisi de vds sayılır, sıra listelerinde yedek bayta katlanır.
    return { arac, hedef, cmd, okuma, vds: cmd.includes('@@KOK') || cmd.includes('@@YEDEK'), vdsYedek: cmd.includes('@@YEDEK') };
  }) : [];
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}`, log, yazma: log.filter((x) => !x.okuma) };
}

console.log('test_derleme_koy — satıcının derleme deposuna koyma (sahte ssh/scp)\n');

// §1 KURU temiz
{
  const r = kos(['--ortam', 'uretim', '--dosya', DOSYA]);
  check('§1a KURU temiz: çıkış 0 · SONUC: KURU-TEMIZ', r.kod === 0 && /SONUC: KURU-TEMIZ/.test(r.cikti), `kod ${r.kod} ${r.cikti.slice(-300)}`);
  check('§1b KURU: VDS\'e yalnız OKUMA (tek ssh, ag.mjs sözleşmesinden geçer) · scp YOK · vds-dogrula koşmaz', r.log.length === 1 && r.yazma.length === 0 && !r.log.some((x) => x.vds), JSON.stringify(r.log).slice(0, 300));
  const p = r.cikti;
  const plan = [
    'scp -P 2222 -o BatchMode=yes', 'sha256sum -c derleme-koy.sha256', 'docker run --rm --network none --user 0', `-v ${D}:/k`, `--entrypoint sh ${YEDEK} /g/derleme-koy-ic.sh 0 0 ${AD}`,
    'install -m 0644 -o "$U" -g "$G"', 'ln "/k/.yarim-$f" "/k/$f"', 'rm -rf "$HOME/derleme-koy-', 'vds-dogrula (önce)', 'vds-dogrula (sonra, öncekiyle AYNI)',
  ];
  const eksik = plan.filter((x) => !p.includes(x));
  check('§1c plan tam: scp · sha256sum -c · yardımcı konteyner (--network none --user 0, dizin sahibi 0:0) · ln (ezmez) · vds-dogrula iki kez', eksik.length === 0, `eksik: ${eksik.join(' | ')}`);
}

// §2 aynı ad + farklı içerik
{
  const s = { olcum: olcum({ ls: [[AD, VERI.length]] }), sha: `${'b'.repeat(64)}  ${D}/${AD}\n` };
  const r = kos(['--ortam', 'uretim', '--dosya', DOSYA], s);
  check('§2a aynı ad FARKLI içerik (KURU) → DUR 1, "üstüne YAZILMAZ", yalnız okuma (2 ssh), scp yok', r.kod === 1 && /ZATEN VAR ve içeriği FARKLI/.test(r.cikti) && r.yazma.length === 0 && r.log.length === 2, `kod ${r.kod} · ${r.log.length} çağrı · ${r.yazma.length} yazma`);
  const u = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--uygula'], s);
  check('§2b aynı ad FARKLI içerik (--uygula) → DUR 1, scp/yazma YOK, vds-dogrula bile koşmaz', u.kod === 1 && u.yazma.length === 0 && !u.log.some((x) => x.vds), `kod ${u.kod} · ${JSON.stringify(u.yazma).slice(0, 200)}`);
}

// §3 aynı ad + aynı içerik
{
  const s = { olcum: olcum({ ls: [[AD, VERI.length]] }), sha: `${OZ}  ${D}/${AD}\n` };
  const r = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--uygula'], s);
  check('§3 aynı ad AYNI içerik (--uygula) → 0, YAPILACAK-IS-YOK, yazma YOK', r.kod === 0 && /YAPILACAK-IS-YOK/.test(r.cikti) && r.yazma.length === 0, `kod ${r.kod} · ${r.yazma.length} yazma`);
}

// §4 yerel kapılar — ssh'tan önce
{
  const bosluk = yol('girdi', 'kurulum paketi.zip');
  fs.writeFileSync(bosluk, 'x');
  const yedi = yol('girdi', 'kurulum.7z');
  fs.writeFileSync(yedi, 'x');
  const a = kos(['--ortam', 'uretim', '--dosya', bosluk]);
  const b = kos(['--ortam', 'uretim', '--dosya', yedi]);
  check('§4a satıcının ad kuralı (boşluk · .7z) → DUR 1, ssh YOK', a.kod === 1 && b.kod === 1 && a.log.length === 0 && b.log.length === 0 && /LİSTELEMEZ/.test(a.cikti) && /izinli değil/.test(b.cikti), `${a.kod}/${b.kod} · ${a.log.length + b.log.length} çağrı`);
  const prova = yol('girdi', 'TeksERP-Kurulum-demofabrika-9.9.9-PROVA-IMZASIZ.zip');
  fs.writeFileSync(prova, 'p');
  const c = kos(['--ortam', 'uretim', '--dosya', prova]);
  const ch = kos(['--ortam', 'hazirlik', '--dosya', prova]);
  check('§4b PROVA adı üretime → DUR 1 (ssh yok) · emekli hazırlık ortamı → kullanım 2, ssh yok', c.kod === 1 && c.log.length === 0 && /PROVA/.test(c.cikti) && ch.kod === 2 && ch.log.length === 0, `üretim ${c.kod} · hazırlık ${ch.kod}`);
  const bozuk = yol('girdi', 'TeksERP-Kurulum-x-1.0.0.zip');
  fs.writeFileSync(bozuk, 'yarim');
  fs.writeFileSync(`${bozuk}.sha256`, `${'c'.repeat(64)}  TeksERP-Kurulum-x-1.0.0.zip\n`);
  const d = kos(['--ortam', 'uretim', '--dosya', bozuk]);
  check('§4c yanındaki .sha256 tutmuyor → DUR 1, ssh yok', d.kod === 1 && d.log.length === 0 && /TUTMUYOR/.test(d.cikti), `kod ${d.kod}`);
  const e = kos(['--dosya', DOSYA]);
  const f = kos(['--ortam', 'canli', '--dosya', DOSYA]);
  const g = kos(['--ortam', 'uretim']);
  check('§4d kullanım: --ortam yok · tanınmayan ortam · --dosya yok → 2, ssh yok', e.kod === 2 && f.kod === 2 && g.kod === 2 && e.log.length + f.log.length + g.log.length === 0, `${e.kod}/${f.kod}/${g.kod}`);
}

// §5 VDS kapıları
{
  const rw = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ bag: `${D} true` }) });
  const baska = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ bag: '/srv/baska false' }) });
  check('§5a satıcı bağı salt okunur değil / başka yol → DUR 1', rw.kod === 1 && baska.kod === 1 && /portal GÖRMEZ/.test(baska.cikti), `${rw.kod}/${baska.kod}`);
  const yok = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ bag: '' }) });
  const imaj = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ imajlar: ['tekserp-satici:abc123def456'] }) });
  check('§5b bağ okunamadı · yardımcı imaj etiketsiz → ÖLÇÜLEMEDİ 2', yok.kod === 2 && imaj.kod === 2, `${yok.kod}/${imaj.kod}`);
  const izin = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ dizin: '0:0 750' }) });
  const disk = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ bos: 1000 }) });
  const yarim = kos(['--ortam', 'uretim', '--dosya', DOSYA], { olcum: olcum({ ls: [['.yarim-eski.zip', 5]] }) });
  check('§5c dizin satıcıya kapalı · disk yetmez · yarım kalmış önceki yazım → DUR 1, yazma yok', izin.kod === 1 && disk.kod === 1 && yarim.kod === 1 && [izin, disk, yarim].every((x) => x.yazma.length === 0), `${izin.kod}/${disk.kod}/${yarim.kod}`);
}

// §6 ssh kopuk
{
  const r = kos(['--ortam', 'uretim', '--dosya', DOSYA], { kopuk: true });
  check('§6 ssh kopuk → ÖLÇÜLEMEDİ 2', r.kod === 2 && /ÖLÇÜLEMEDİ/.test(r.cikti), `kod ${r.kod}`);
}

// §7 --uygula mutlu yol
{
  const r = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--uygula']);
  check('§7a --uygula: çıkış 0 · SONUC: YAZILDI', r.kod === 0 && /SONUC: YAZILDI/.test(r.cikti), `kod ${r.kod} ${r.cikti.slice(-400)}`);
  const ilkVds = r.log.findIndex((x) => x.vds);
  const ilkYazma = r.log.findIndex((x) => !x.okuma);
  const tur = r.log.filter((x) => !x.vdsYedek).map((x) => (x.vds ? 'vds' : x.arac === 'scp' ? 'scp' : x.okuma ? 'oku' : /docker run/.test(x.cmd) ? 'koy' : /^install -d/.test(x.cmd) ? 'dizin' : /sha256sum -c/.test(x.cmd) ? 'ozet' : /^rm -rf/.test(x.cmd) ? 'sil' : '?'));
  const beklenen = ['oku', 'vds', 'dizin', 'scp', 'ozet', 'koy', 'sil', 'oku', 'oku', 'vds'];
  check('§7b sıra: ölç → vds(önce) → dizin → scp → sha256sum -c → yardımcı konteyner → sil → ölç → özet → vds(sonra)', JSON.stringify(tur) === JSON.stringify(beklenen) && ilkVds >= 0 && ilkYazma > ilkVds, tur.join(','));
  // Her vds-dogrula koşumu = bayt ssh'i tekserp-yayin'e + hemen ardından yedek ssh'i docker erişimli tekserp-vds'e.
  const vdsCift = r.log.filter((x) => x.vds).map((x) => `${x.vdsYedek ? 'yedek' : 'bayt'}@${x.hedef}`);
  check('§7d vds-dogrula iki kez, her biri bayt@tekserp-yayin → yedek@tekserp-vds', JSON.stringify(vdsCift) === JSON.stringify(['bayt@tekserp-yayin', 'yedek@tekserp-vds', 'bayt@tekserp-yayin', 'yedek@tekserp-vds']), vdsCift.join(','));
  const scp = r.log.find((x) => x.arac === 'scp')?.cmd ?? '';
  const koy = r.log.find((x) => /docker run/.test(x.cmd))?.cmd ?? '';
  check('§7c scp yerel dosya + konteyner betiği + özet listesi → oguzhan@VDS:~/derleme-koy-<damga>/ · konteyner yalnız /g:ro + depo bağlı',
    scp.includes(DOSYA) && /derleme-koy-ic\.sh/.test(scp) && /derleme-koy\.sha256/.test(scp) && /oguzhan@80\.253\.255\.188:derleme-koy-\d{8}-\d{6}-[0-9a-f]{6}\/$/.test(scp.trim())
      && koy.includes(':/g:ro"') && koy.includes(`-v ${D}:/k`) && koy.includes('--network none') && koy.includes(`${YEDEK} /g/derleme-koy-ic.sh 0 0 ${AD}`), `${scp.slice(-160)} || ${koy.slice(0, 200)}`);
}

// §8 vds sonra farklı · §9 vds önce FARK
{
  const r = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--uygula'], { vdsSonra: vdsCikti(true) });
  check('§8a vds-dogrula SONRA FARK → DUR 1 (yazım ölçüldü ama sonuç kırmızı)', r.kod === 1 && /vds-dogrula \(sonra\)/.test(r.cikti), `kod ${r.kod} ${r.cikti.slice(-200)}`);
  const ls = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--uygula'], { vdsSonra: vdsCikti().replace('@@LS\nadnansahin', '@@LS\nadnansahin\nyeni-dizin') });
  check('§8b vds-dogrula sonra AYNI ama çıktısı öncekinden farklı (html/ + defter/ listesi) → DUR 1', ls.kod === 1 && /öncekinden FARKLI/.test(ls.cikti), `kod ${ls.kod} ${ls.cikti.slice(-200)}`);
  fs.writeFileSync(path.join(SAHTE, 'vds'), vdsCikti(true));
  const o = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--uygula']);
  fs.writeFileSync(path.join(SAHTE, 'vds'), vdsCikti());
  check('§9 vds-dogrula ÖNCE FARK → DUR 1, hiçbir yazım/scp yok', o.kod === 1 && o.yazma.length === 0 && /hiçbir şey yazılmadı/.test(o.cikti), `kod ${o.kod} · ${o.yazma.length} yazma`);
}

// §10 konteyner betiği gerçek kabukta (yollar geçici dizine çevrilir; sahip = bu kullanıcı)
{
  const g = yol('ic', 'g');
  const k = yol('ic', 'k');
  fs.mkdirSync(g, { recursive: true });
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(g, 'yeni.zip'), 'YENI');
  fs.writeFileSync(path.join(g, 'eski.zip'), 'YENI-EZMEYE-CALISAN');
  fs.writeFileSync(path.join(k, 'eski.zip'), 'ESKI');
  const betik = m.IC_BETIK.replaceAll('/g/', `${g}/`).replaceAll('/k/', `${k}/`).replace('cd /k', `cd ${k}`);
  const uid = String(process.getuid());
  const gid = String(process.getgid());
  const a = spawnSync('sh', ['-c', betik, 'sh', uid, gid, 'yeni.zip'], { encoding: 'utf8' });
  const kalan = fs.readdirSync(k).filter((x) => x.startsWith('.yarim-'));
  check('§10a yeni dosya yayınlanır (0644), gizli ad kalmaz, özet basılır', a.status === 0 && fs.readFileSync(path.join(k, 'yeni.zip'), 'utf8') === 'YENI' && (fs.statSync(path.join(k, 'yeni.zip')).mode & 0o777) === 0o644 && kalan.length === 0 && a.stdout.includes(`${sha(Buffer.from('YENI'))}  yeni.zip`), `${a.status} ${a.stderr}`);
  const b = spawnSync('sh', ['-c', betik, 'sh', uid, gid, 'eski.zip'], { encoding: 'utf8' });
  check('§10b var olan dosya EZİLMEZ → çıkış 3, içerik aynı kalır', b.status === 3 && fs.readFileSync(path.join(k, 'eski.zip'), 'utf8') === 'ESKI' && /VAR \(ezilmez\)/.test(b.stderr), `${b.status} ${b.stderr}`);
  const c = spawnSync('sh', ['-c', betik, 'sh', uid, gid, '../kacak.zip'], { encoding: 'utf8' });
  check('§10c yol taşıyan ad → 2', c.status === 2, `${c.status}`);
}

// §11 ad kuralı satıcının kaynağından
{
  const gercek = fs.readFileSync(path.join(KOK, depo.DEPO_REL), 'utf8');
  const k = depo.derlemeAdiKuraliMetinden(gercek);
  check('§11a kural storage.ts\'ten: TeksERP-Kurulum-…zip geçer · noktalı/boşluklu/.7z düşer', depo.derlemeAdiHatasi(AD, k) === null && depo.derlemeAdiHatasi('.gizli.zip', k) && depo.derlemeAdiHatasi('a b.zip', k) && depo.derlemeAdiHatasi('x.7z', k), k.desen.source);
  let olc = false;
  try {
    depo.derlemeAdiKuraliMetinden(gercek.replace('const BUILD_NAME =', 'const DERLEME_ADI ='));
  } catch (e) {
    olc = e instanceof depo.Olculemedi;
  }
  check('§11b BUILD_NAME yeri değişirse ÖLÇÜLEMEDİ (sessiz yedek yok)', olc);
  check('§11c arşiv grubu portalın INSTALL_ARCHIVE deseninden: test/genel okunur, grupsuz eski ad ve exe null; ad üretimi gidiş-dönüş',
    depo.arsivGrubu('TeksERP-Kurulum-test-2.15.6.zip', k) === 'test' && depo.arsivGrubu('TeksERP-Kurulum-genel-2.15.6-prova.abc-PROVA-IMZASIZ.zip', k) === 'genel' &&
      depo.arsivGrubu('TeksERP-Kurulum-2.15.6.zip', k) === null && depo.arsivGrubu('TeksERP-Kurulum-test-2.15.6.exe', k) === null &&
      depo.kurulumArsiviAdi('oncu', '2.15.6', '', k) === 'TeksERP-Kurulum-oncu-2.15.6.zip', k.arsiv.source);
  let olc2 = false;
  try {
    depo.derlemeAdiKuraliMetinden(gercek.replace('const INSTALL_ARCHIVE =', 'const ARSIV ='));
  } catch (e) {
    olc2 = e instanceof depo.Olculemedi;
  }
  check('§11d INSTALL_ARCHIVE yeri değişirse ÖLÇÜLEMEDİ', olc2);
}

// §12 yazım çağrıları yalnız uygula() içinde
{
  const metin = fs.readFileSync(BETIK, 'utf8');
  const bas = metin.indexOf('async function uygula(');
  const son = metin.indexOf('\nasync function main(');
  const satirBasi = (i) => metin.slice(metin.lastIndexOf('\n', i) + 1, i);
  const disari = [...metin.matchAll(/\b(sshYaz|yaz)\(/g)]
    .filter((x) => x.index < bas || x.index > son)
    .filter((x) => !/^(function |const sshYaz = )/.test(satirBasi(x.index)))
    .map((x) => metin.slice(x.index, x.index + 30));
  const icerde = [...metin.slice(bas, son).matchAll(/\b(sshYaz|yaz)\(/g)].length;
  check('§12 yazan çağrılar (yaz/sshYaz) yalnız uygula() gövdesinde', bas > 0 && son > bas && icerde >= 5 && disari.length === 0, `içeride ${icerde} · dışarıda: ${disari.join(' | ')}`);
}

// §13 kaldırma (--kaldir) ve yenileme (--yenile): KURU varsayılan · aktif bağlantıda RED · Mac arşivi sha eşitliği
{
  const ESKI = 'TeksERP-Kurulum-test-9.9.8.zip';
  const ESKI_VERI = crypto.randomBytes(50_000);
  const ESKI_OZ = sha(ESKI_VERI);
  const ESKI_DOSYA = yol('uzak-eski', ESKI);
  fs.mkdirSync(yol('uzak-eski'));
  fs.writeFileSync(ESKI_DOSYA, ESKI_VERI);
  const AKTIF = 'TeksERP-Kurulum-test-9.9.7.zip';
  const ONAYLI = 'TeksERP-Kurulum-genel-9.9.6.zip';
  const GRUPSUZ = 'TeksERP-Kurulum-9.9.5.zip';
  const lsEski = [[ESKI, ESKI_VERI.length], [AKTIF, 4000], [ONAYLI, 4000], [GRUPSUZ, 4000]];
  const arsivDizini = () => yol('arsiv', String(Math.random()).slice(2));
  const shaEski = `${ESKI_OZ}  ${D}/${ESKI}\n${'c'.repeat(64)}  ${D}/${AKTIF}\n`;
  const temel = { olcum: olcum({ ls: lsEski, baglanti: [`${AKTIF}|1`] }), sha: shaEski };

  const ar = arsivDizini();
  const k = kos(['--ortam', 'uretim', '--kaldir', ESKI, '--arsiv', ar], temel);
  check('§13a --kaldir varsayılan KURU: 0 · KURU-TEMIZ · yalnız OKUMA (ölçüm + özet, sözleşmeden geçer) · scp YOK · Mac arşivi yazılmadı',
    k.kod === 0 && /SONUC: KURU-TEMIZ/.test(k.cikti) && k.log.length === 2 && k.yazma.length === 0 && !k.log.some((x) => x.arac === 'scp') && !fs.existsSync(ar), `kod ${k.kod} · ${k.log.map((x) => x.arac).join(',')} · ${k.cikti.slice(-300)}`);
  check('§13b KURU plan: Mac arşivine indir · özet eşitliği · konteynerde `sha256sum -c` sonra `rm` (--network none, yalnız depo bağlı) · aktif bağlantı yeniden ölçülür',
    /Mac arşivine indir/.test(k.cikti) && /sha256sum -c -; rm --/.test(k.cikti) && /--network none --user 0 -v \/opt\/stack\/apps\/tekserp-satici-uretim\/derlemeler:\/k --entrypoint/.test(k.cikti) && /aktif bağlantıyı yeniden ölç/.test(k.cikti) && k.cikti.includes(`${ESKI_OZ} ${ESKI}`), k.cikti.slice(-500));
  const ag = await import(path.join(KOK, 'deploy/lisans-devreye/lib/ag.mjs'));
  let sozlesme = 'geçti';
  try { ag.sshDenetle(m.olcumKomutu('uretim')); } catch (e) { sozlesme = e.message; }
  check('§13c aktif bağlantı sorgusu ölçüm komutunda ve salt-okuma sözleşmesinden geçer (psql SELECT, `>` yok)', sozlesme === 'geçti' && m.olcumKomutu('uretim').includes("durum = 'AKTIF' AND now() < bitis"), sozlesme);

  const a = kos(['--ortam', 'uretim', '--kaldir', AKTIF, '--arsiv', arsivDizini(), '--uygula'], temel);
  check('§13d --kaldir AKTİF bağlantılı dosya (--uygula) → DUR 1, scp/yazma/vds YOK', a.kod === 1 && /AKTİF indirme bağlantısı/.test(a.cikti) && a.yazma.length === 0 && !a.log.some((x) => x.arac === 'scp' || x.vds), `kod ${a.kod} · ${a.cikti.slice(-300)}`);

  const yok = kos(['--ortam', 'uretim', '--kaldir', ESKI, '--arsiv', arsivDizini()], { ...temel, olcum: olcum({ ls: lsEski, baglanti: null }) });
  check('§13e bağlantı tablosu okunamadı → ÖLÇÜLEMEDİ 2, hiçbir şey kaldırılmaz', yok.kod === 2 && /aktif indirme bağlantıları okunamadı/.test(yok.cikti) && yok.yazma.length === 0, `kod ${yok.kod}`);

  const farkli = arsivDizini();
  fs.mkdirSync(farkli, { recursive: true });
  fs.writeFileSync(path.join(farkli, ESKI), 'BASKA');
  const f = kos(['--ortam', 'uretim', '--kaldir', ESKI, '--arsiv', farkli, '--uygula'], temel);
  check('§13f Mac arşivinde aynı adlı FARKLI dosya → DUR 1, üzerine yazılmaz, kaldırma yok', f.kod === 1 && /FARKLI içerikli/.test(f.cikti) && f.yazma.length === 0 && fs.readFileSync(path.join(farkli, ESKI), 'utf8') === 'BASKA', `kod ${f.kod}`);

  const g = kos(['--ortam', 'uretim', '--kaldir', '../x.zip'], temel);
  check('§13g yol taşıyan ad → DUR 1, ssh YOK', g.kod === 1 && g.log.length === 0, `kod ${g.kod}`);
  const h = kos(['--ortam', 'uretim', '--kaldir', ESKI, '--dosya', DOSYA], temel);
  check('§13h --kaldir + --dosya birlikte → kullanım 2 (yeni + eski birlikte: --yenile)', h.kod === 2 && /--yenile/.test(h.cikti) && h.log.length === 0, `kod ${h.kod}`);

  const uyg = arsivDizini();
  const u = kos(['--ortam', 'uretim', '--kaldir', ESKI, '--arsiv', uyg, '--uygula'], { ...temel, olcumSonra: olcum({ ls: [[AKTIF, 4000]], baglanti: [`${AKTIF}|1`] }), indir: ESKI_DOSYA, koy: '' });
  const tur = u.log.filter((x) => !x.vdsYedek).map((x) => (x.vds ? 'vds' : x.arac === 'scp' ? 'scp' : x.cmd.includes('docker run') ? 'kaldir' : x.cmd.includes('@@BAG') ? 'olc' : x.cmd.startsWith('sha256sum') ? 'ozet' : '?'));
  const kaldirCmd = u.log.find((x) => x.cmd.includes('docker run'))?.cmd ?? '';
  check('§13i --kaldir --uygula: 0 · KALDIRILDI · sıra ölç → özet → vds(önce) → ölç(taze) → scp(Mac) → kaldır → ölç → vds(sonra)',
    u.kod === 0 && /SONUC: KALDIRILDI/.test(u.cikti) && JSON.stringify(tur) === JSON.stringify(['olc', 'ozet', 'vds', 'olc', 'scp', 'kaldir', 'olc', 'vds']), `kod ${u.kod} · ${tur.join(',')} · ${u.cikti.slice(-300)}`);
  check('§13j Mac arşivinde dosya uzak özetle aynı · konteyner komutu özet+ad çifti taşır, $HOME bağı yok',
    fs.existsSync(path.join(uyg, ESKI)) && sha(fs.readFileSync(path.join(uyg, ESKI))) === ESKI_OZ && kaldirCmd.includes(`${ESKI_OZ} ${ESKI}`) && !kaldirCmd.includes('$HOME') && /--network none/.test(kaldirCmd), kaldirCmd.slice(0, 200));

  const yenile = kos(['--ortam', 'uretim', '--dosya', DOSYA, '--yenile', '--arsiv', arsivDizini()], temel);
  check('§13k --yenile KURU: yeni arşiv yazılacak · AKTİF bağlantılı eski KORUNUR (raporlanır) · bağlantısız eski kaldırılacak · başka tür dosyaya (Setup.exe) dokunulmaz',
    yenile.kod === 0 && /KURU-TEMIZ/.test(yenile.cikti) && new RegExp(`⚠ ${AKTIF.replace(/\./g, '\\.')}: 1 AKTİF`).test(yenile.cikti) && new RegExp(`- ${ESKI.replace(/\./g, '\\.')}: aktif bağlantı yok`).test(yenile.cikti) && !/kaldır \(özet tutarsa rm\):[^\n]*(9\.9\.7|Setup)/.test(yenile.cikti) && yenile.yazma.length === 0, yenile.cikti.slice(-600));
  check('§13n ⭐ --yenile yalnız YENİ ARŞİVİN GRUBUNU yeniler: test yayını onaylı (genel) paketi ve grupsuz eski adı kaldırmaz',
    yenile.kod === 0 && !yenile.cikti.includes(ONAYLI) && !yenile.cikti.includes(GRUPSUZ), yenile.cikti.slice(-600));
  const grupsuzAd = yol('girdi-grupsuz', 'TeksERP-Kurulum-demofabrika-9.9.9.zip');
  fs.mkdirSync(path.dirname(grupsuzAd), { recursive: true });
  fs.writeFileSync(grupsuzAd, VERI);
  const gy = kos(['--ortam', 'uretim', '--dosya', grupsuzAd, '--yenile', '--arsiv', arsivDizini()], temel);
  check('§13o ⭐ --yenile grup adı taşımayan / dağıtım grubu olmayan arşivle → DUR 1, VDS\'e bağlanılmaz', gy.kod === 1 && /yalnız grup adlı ortak arşivle/.test(gy.cikti) && gy.log.length === 0, `kod ${gy.kod} · ${gy.cikti.slice(-300)}`);
  const y = await import(path.join(KOK, 'deploy/satici/derleme-koy.mjs'));
  const ad = y.yenileAdaylari([ESKI, AKTIF, ONAYLI, GRUPSUZ, AD], new Set(['TeksERP-Kurulum-genel-9.9.9.zip']));
  check('§13p terfi yayını (genel) yalnız genel arşivleri aday sayar; test ve grupsuz dokunulmaz', JSON.stringify(ad) === JSON.stringify([ONAYLI]), JSON.stringify(ad));

  // Konteyner kaldırma betiği gerçek kabukta: özet tutarsa siler, tutmazsa dosya KALIR.
  const kd = yol('kaldir-k');
  fs.mkdirSync(kd);
  fs.writeFileSync(path.join(kd, 'a.zip'), 'AAA');
  fs.writeFileSync(path.join(kd, 'b.zip'), 'BBB');
  const betik = m.KALDIR_BETIK.replaceAll('cd /k', `cd ${kd}`);
  const t1 = spawnSync('sh', ['-c', betik, 'sh', sha(Buffer.from('AAA')), 'a.zip'], { encoding: 'utf8' });
  const t2 = spawnSync('sh', ['-c', betik, 'sh', sha(Buffer.from('XXX')), 'b.zip'], { encoding: 'utf8' });
  const t3 = spawnSync('sh', ['-c', betik, 'sh', 'x', '../a.zip'], { encoding: 'utf8' });
  const sha256sumVar = !spawnSync('sha256sum', ['--version']).error;
  check('§13l kaldırma betiği: özet tutan dosya silinir · tutmayan KALIR (çıkış ≠ 0) · yol taşıyan ad 2', !sha256sumVar || (t1.status === 0 && !fs.existsSync(path.join(kd, 'a.zip')) && t2.status !== 0 && fs.existsSync(path.join(kd, 'b.zip')) && t3.status === 2), `${t1.status}/${t2.status}/${t3.status} ${t2.stderr}`);

  // Negatif sonda: aktif bağlantı kapısı sökülmüş kopya §13d'yi geçirir → bekçi o kapıyı ölçüyor.
  const sonda = path.join(path.dirname(BETIK), 'derleme-koy.sonda.mjs');
  const kaynak = fs.readFileSync(BETIK, 'utf8');
  const sokuk = kaynak.replace('const aktif = olcum.baglanti.get(ad) ?? 0;', 'const aktif = 0;');
  fs.writeFileSync(sonda, sokuk);
  try {
    const sk = kos(['--ortam', 'uretim', '--kaldir', AKTIF, '--arsiv', arsivDizini()], { ...temel, betik: sonda });
    check('§13m SONDA: aktif bağlantı kapısı sökülünce AKTİF dosya kaldırma planına girer (kapı gerçekten bu satır)', sokuk !== kaynak && sk.kod === 0 && /KURU-TEMIZ/.test(sk.cikti), `değişti ${sokuk !== kaynak} · kod ${sk.kod}`);
  } finally {
    fs.rmSync(sonda, { force: true });
  }
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
