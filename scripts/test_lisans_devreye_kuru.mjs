#!/usr/bin/env node
// =============================================================================
// BEKÇİ — LİSANS DEVREYE ALMA BETİKLERİ KURU KİPTE AĞA ÇIKMAZ · zero-dep, DB'siz, ağsız
// =============================================================================
// `deploy/lisans-devreye/` (runbook docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md) canlı VDS'e ve testfabrika'ya
// bakan ölçüm betikleridir. Sözleşme: varsayılan KURU (plan basar, hiçbir bağlantı açmaz); `--olc` ile bile
// yalnız OKUMA (HTTP GET/HEAD · ssh/PowerShell salt-okuma izin listesi). Bu bekçi ölçer:
//   §1 STATİK — §1a ağ/süreç API'si yalnız tek boğazda (lib/ag.mjs) · §1b boğazın her kapısında sıra:
//      sözleşme denetimi → `if (!this.olc) return kuru` → ağ çağrısı; fetch/spawnSync tek yerde · §1c kip yalnız
//      `--olc`tan · §1d HTTP yalnız GET/HEAD
//   §2 DİNAMİK — betikler ağ/süreç TUZAĞI altında (fetch · child_process · http(s) · net) kuru koşar: sıfır
//      girişim, her kontrol plan satırı basar; POZİTİF KONTROL: aynı tuzak `--olc` girişimini YAKALAR
//   §3 SÖZLEŞME BİRİMİ — sshDenetle/psDenetle/httpDenetle sabit vektörlerle (izin listesi sessizce gevşemesin)
//   §4 SONDALAR (her koşumda, geçici kopyada) — NEGATİF N1…N5 kırmızı vermeli; POZİTİF P1 temiz kopya ve
//      P2 meşru yeni salt-okuma kontrolü eklenmiş kopya YEŞİL kalmalı (kapı meşru eklemeyi engellemez)
//   §5 deploy/vds-dogrula.sh — tek ssh, uzak komut §3'ün izin listesinden (ag.mjs sshDenetle), yerel yazım yalnız
//      taban dizinine; sahte `ssh` ile AYNI · FARK · ÖLÇÜLEMEDİ · taban ezilmez. Sondalar N6…N10 kırmızı, P3/P4 yeşil
//   §6 T4 özeti (lib/gozlem.mjs, ağsız) — etkinleşmemiş kurulumun `gecerlilik≠GECERLI` örneği AYRI sayılır, yanlış
//      pozitif DEĞİLDİR; etkin örnekte aynı durum IHLAL kalır; hiç etkin örnek yoksa ÖLÇÜLEMEDİ. Sondalar N11/N12, P5
//   §7 Aşama 7.1 satıcı kıyası (lib/asamalar-c.mjs, ağsız) — detay ucu satıcıyı yalnız HOST olarak döner; 7.1
//      kökün host'uyla kıyaslar: aynı host UYUMLU, farklı host ya da port IHLAL. Sonda N13, P6
//   §8 BEKLENTİ PARAMETRELERİ (ağsız) — 7.1 HAK sınıfını `--hak-sinif`ten, 4.3 PAKET kid önekini `--paket-kid`ten
//      bekler (varsayılan bugünkü TEST · paket-hazirlik); TEST HAK'ında patron-bulut hâlâ IHLAL. Sondalar N14/N15, P7
//
// Koşum: node scripts/test_lisans_devreye_kuru.mjs     (çıkış 0 yeşil · 1 kırmızı)
// =============================================================================
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEDEF = path.join(KOK, 'deploy/lisans-devreye');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lisans-devreye-kuru-')));
let kirmizi = 0;
const yaz = (ok, ad, ayrinti = '') => {
  if (!ok) kirmizi += 1;
  console.log(`${ok ? '✅' : '❌'} ${ad}${ayrinti ? `  [${ayrinti}]` : ''}`);
};

// ---- Denetimler: statik (kaynak metni) ve dinamik (tuzak altında koşum) ----
const BOGAZ = 'lib/ag.mjs';
const AG_API = [/from\s+['"](node:)?(child_process|http|https|net|tls|dgram|http2|worker_threads)['"]/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bprocess\.binding\b/, /\bimport\s*\(/];

function dosyalar(kok) {
  const out = [];
  const gez = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith('.mjs')) out.push(path.relative(kok, p));
    }
  };
  gez(kok);
  return out.sort();
}

/** Yöntem gövdesi: `ad(` ile başlayan sınıf yöntemini, bir sonraki yönteme ya da sınıf sonuna kadar. */
function yontemGovdesi(kaynak, ad) {
  const bas = kaynak.search(new RegExp(`\\n  (async )?${ad.replace('#', '\\#')}\\(`));
  if (bas < 0) return null;
  const sonraki = kaynak.slice(bas + 1).search(/\n  (async )?#?\w+\(|\n}/);
  return kaynak.slice(bas, sonraki < 0 ? undefined : bas + 1 + sonraki);
}

/** Statik denetim: [{ ad, ok, ayrinti }] */
function statikDenetim(kok) {
  const sonuc = [];
  const ekle = (ad, ok, ayrinti = '') => sonuc.push({ ad, ok, ayrinti });
  const liste = dosyalar(kok);
  ekle('§1a betik dosyaları bulundu', liste.length >= 3 && liste.includes(BOGAZ), liste.join(', '));
  for (const f of liste) {
    if (f === BOGAZ) continue;
    const k = fs.readFileSync(path.join(kok, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const ihlal = AG_API.filter((r) => r.test(k)).map(String);
    ekle(`§1a ${f}: ağ/süreç API'si yalnız ${BOGAZ}'ta`, ihlal.length === 0, ihlal.join(' '));
  }
  const ag = fs.readFileSync(path.join(kok, BOGAZ), 'utf8');
  const sira = { http: [/httpDenetle\(/, /\bfetch\s*\(/], ssh: [/sshDenetle\(/, /this\.#kos\(/], tp: [/psDenetle\(/, /this\.#kos\(/], yerelBetik: [/YEREL_BETIKLER\.includes\(/, /this\.#kos\(/] };
  for (const [ad, [denetle, cagri]] of Object.entries(sira)) {
    const g = yontemGovdesi(ag, ad);
    const iD = g ? g.search(denetle) : -1;
    const iK = g ? g.search(/if \(!this\.olc\) return this\.#kuru\(/) : -1;
    const iC = g ? g.search(cagri) : -1;
    ekle(`§1b Ag.${ad}: sözleşme → kuru dönüş → ağ çağrısı sırası`, iD >= 0 && iK > iD && iC > iK, g ? `denetle@${iD} kuru@${iK} çağrı@${iC}` : 'yöntem yok');
  }
  const fetchSay = (ag.match(/\bfetch\s*\(/g) ?? []).length;
  const spawnSay = (ag.match(/\bspawnSync\s*\(/g) ?? []).length;
  const kosGovde = yontemGovdesi(ag, '#kos') ?? '';
  ekle('§1b fetch yalnız Ag.http, spawnSync yalnız Ag.#kos', fetchSay === 1 && spawnSay === 1 && /spawnSync\(/.test(kosGovde), `fetch ${fetchSay} · spawnSync ${spawnSay}`);
  const kosCagrilari = (ag.match(/this\.#kos\(/g) ?? []).length;
  ekle('§1b #kos yalnız ssh/tp/yerelBetik içinden (3 çağrı)', kosCagrilari === 3, `${kosCagrilari}`);
  ekle("§1c kip yalnız `--olc`tan (varsayılan KURU)", /return \{ olc: argv\.includes\('--olc'\) \};/.test(ag), 'kipOku gövdesi');
  const acanlar = liste.filter((f) => /\bolc\s*[:=]\s*(true|!)/.test(fs.readFileSync(path.join(kok, f), 'utf8')));
  ekle('§1c hiçbir betik olc=true varsayılanı koymaz', acanlar.length === 0, acanlar.join(', '));
  const yontemler = liste.filter((f) => /yontem\s*:\s*['"](?!GET['"]|HEAD['"])/.test(fs.readFileSync(path.join(kok, f), 'utf8')));
  ekle('§1d HTTP çağrıları yalnız GET/HEAD', yontemler.length === 0, yontemler.join(', '));
  return sonuc;
}

const TUZAK = `import cp from 'node:child_process'; import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const kaydet = (ad, x) => { fs.appendFileSync(process.env.TUZAK_DEFTER, ad + '\\t' + String(x).slice(0, 160) + '\\n'); throw new Error('TUZAK ' + ad); };
for (const f of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[f] = (a) => kaydet('child_process.' + f, a);
for (const m of [http, https]) { m.request = (a) => kaydet('http.request', a); m.get = (a) => kaydet('http.get', a); }
net.connect = net.createConnection = (a) => kaydet('net.connect', JSON.stringify(a));
net.Socket.prototype.connect = function (a) { return kaydet('net.Socket.connect', JSON.stringify(a)); };
globalThis.fetch = (u) => kaydet('fetch', u);
syncBuiltinESMExports();
`;

/** Betiği tuzak altında koşar: { kod, cikti, girisimler[] } */
function tuzakliKos(kok, tmp, betik, args) {
  fs.mkdirSync(tmp, { recursive: true });
  const tuzak = path.join(tmp, 'tuzak.mjs');
  if (!fs.existsSync(tuzak)) fs.writeFileSync(tuzak, TUZAK);
  const defter = path.join(tmp, `defter-${Date.now()}-${Math.random().toString(36).slice(2)}.tsv`);
  fs.writeFileSync(defter, '');
  const r = spawnSync(process.execPath, ['--import', tuzak, path.join(kok, betik), ...args], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, TUZAK_DEFTER: defter, HOME: tmp },
  });
  const girisimler = fs.readFileSync(defter, 'utf8').split('\n').filter(Boolean);
  return { kod: r.status, cikti: `${r.stdout}${r.stderr}`, girisimler };
}

/** Dinamik denetim: kuru koşumlar SIFIR girişim + plan basar; `--olc` koşumu girişim yakalar (pozitif kontrol). */
function dinamikDenetim(kok, tmp) {
  const sonuc = [];
  const ekle = (ad, ok, ayrinti = '') => sonuc.push({ ad, ok, ayrinti });
  const a = tuzakliKos(kok, tmp, 'asama-dogrula.mjs', ['--asama=hepsi']);
  const planSatiri = (a.cikti.match(/^\s{6}(HTTP|ssh|tp|yerel)\b/gm) ?? []).length;
  ekle('§2a asama-dogrula kuru: çıkış 0, sıfır ağ/süreç girişimi', a.kod === 0 && a.girisimler.length === 0, `kod ${a.kod} · girişim ${a.girisimler.length} ${a.girisimler.slice(0, 2).join(' | ')}${a.kod ? ` · ${a.cikti.trim().split('\n').pop()}` : ''}`);
  ekle('§2a asama-dogrula kuru: her kontrol plan satırı bastı (≥ 30)', planSatiri >= 30, `${planSatiri} plan satırı`);
  const t = tuzakliKos(kok, tmp, 't4-gozlem.mjs', []);
  ekle('§2b t4-gozlem kuru: çıkış 0, sıfır girişim, dosya yazmaz', t.kod === 0 && t.girisimler.length === 0 && !fs.existsSync(path.join(tmp, '.tekserp')), `kod ${t.kod} · girişim ${t.girisimler.length}`);
  const o = tuzakliKos(kok, tmp, 'asama-dogrula.mjs', ['--asama=2', '--olc', '--satici-sha=000000000000']);
  ekle('§2c pozitif kontrol: --olc girişimi TUZAĞA düşer (tuzak kör değil)', o.girisimler.length > 0, `girişim ${o.girisimler.length}`);
  return sonuc;
}

async function sozlesmeBirimi() {
  const ag = await import(path.join(HEDEF, 'lib/ag.mjs'));
  const dener = (f, x) => { try { f(x); return true; } catch { return false; } };
  const izinli = ['docker ps --format "{{.Names}}"', 'docker exec tekserp-satici-hazirlik ls -1 /anahtarlar', 'head -3 /opt/x/latest.yml',
    'docker exec x-db psql -U satici -d satici -tAc "select migration_name from _prisma_migrations"', 'curl -s https://x/saglik'];
  const yasak = ['docker compose up -d', 'rm -rf /opt/x', 'echo a > /tmp/b', 'sudo ls', 'docker exec x-db psql -c "alter table t add c int"',
    'find /x -delete', 'cat /opt/x/.env', 'curl -s -X POST https://x', 'curl -s -d a=b https://x', 'docker network connect a traefik', 'ls $(id)'];
  const psIzinli = ["'a=' + (Get-Content 'C:\\x' -Raw)", '(Get-CimInstance Win32_Process).StartName', '(Get-Date).AddDays(1)',
    'Invoke-CimMethod -InputObject $_ -MethodName GetOwner', "Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4000/health"];
  const psYasak = ['Set-Content a b', 'Restart-Service x', 'Stop-Process -Id 1', '& pm2 list', 'Get-Content x > y', 'Invoke-WebRequest -Method Post x',
    'Invoke-CimMethod -MethodName Terminate', 'Start-Process node', 'Register-ScheduledTask x', 'schtasks /run /tn x', 'Remove-Item C:\\x'];
  const kotuIzin = izinli.filter((x) => !dener(ag.sshDenetle, x));
  const kotuYasak = yasak.filter((x) => dener(ag.sshDenetle, x));
  yaz(kotuIzin.length === 0 && kotuYasak.length === 0, '§3 ssh salt-okuma sözleşmesi (izinli geçer, yazan reddedilir)', [...kotuIzin, ...kotuYasak].join(' | '));
  const psKotuIzin = psIzinli.filter((x) => !dener(ag.psDenetle, x));
  const psKotuYasak = psYasak.filter((x) => dener(ag.psDenetle, x));
  yaz(psKotuIzin.length === 0 && psKotuYasak.length === 0, '§3 PowerShell salt-okuma sözleşmesi', [...psKotuIzin, ...psKotuYasak].join(' | '));
  const http = [['GET', true], ['HEAD', true], ['POST', false], ['PUT', false], ['DELETE', false]].filter(([y, b]) => dener((u) => ag.httpDenetle(u, y), 'https://x') !== b);
  yaz(http.length === 0, '§3 HTTP yalnız GET/HEAD', http.map(([y]) => y).join(','));
  yaz(ag.kipOku([]).olc === false && ag.kipOku(['--kuru']).olc === false && ag.kipOku(['--olc']).olc === true, '§3 kipOku: varsayılan kuru');
}

/** Kopya üzerinde statik + dinamik denetim; kırmızı sayısı. */
function kopyaDenetle(kopya, tmp) {
  return [...statikDenetim(kopya), ...dinamikDenetim(kopya, tmp)].filter((x) => !x.ok);
}

function kopyala(ad, degistir) {
  const d = path.join(TMP, ad);
  fs.cpSync(HEDEF, d, { recursive: true });
  for (const [dosya, eski, yeni] of degistir) {
    const f = path.join(d, dosya);
    const k = fs.readFileSync(f, 'utf8');
    if (!k.includes(eski)) throw new Error(`sonda ${ad}: '${eski.slice(0, 40)}' ${dosya}'da yok — sonda uygulanamadı`);
    fs.writeFileSync(f, k.replace(eski, yeni));
  }
  const tmp = path.join(TMP, `${ad}-tmp`);
  fs.mkdirSync(tmp);
  return { d, tmp };
}

const SONDALAR = [
  ['N1 boğaz dışı fetch (asamalar-b 4.2)', '§1a lib/asamalar-b', [['lib/asamalar-b.mjs', "kos: (ag, g) => ag.http(`${g.tpKok}/health`)", "kos: async (ag, g) => { await fetch(`${g.tpKok}/health`); return ag.http(`${g.tpKok}/health`); }"]], false],
  ['N2 kuru dönüş ağ çağrısından SONRA (Ag.http)', '§1b Ag.http', [['lib/ag.mjs', "    if (!this.olc) return this.#kuru(`HTTP ${yontem} ${url}${belirtec ? ' (Bearer)' : ''}`);\n", ''],
    ['lib/ag.mjs', "      return { kuru: false, durum: r.status", "      if (!this.olc) return this.#kuru(`HTTP ${yontem} ${url}`);\n      return { kuru: false, durum: r.status"]], false],
  ['N3 varsayılan kip ÖLÇÜM (kipOku)', '§1c kip', [['lib/ag.mjs', "return { olc: argv.includes('--olc') };", "return { olc: !argv.includes('--kuru') };"]], false],
  ['N4 ssh komutunda yazma (compose up)', '§2a asama-dogrula kuru: çıkış 0', [['lib/asamalar-a.mjs', "ag.ssh('docker inspect traefik --format", "ag.ssh('docker compose up -d && docker inspect traefik --format"]], false],
  ['N5 PowerShell yazma fiili (Restart-Service)', '§2a asama-dogrula kuru: çıkış 0', [['lib/asamalar-b.mjs', "\"'surum=' + $k.uygulamaSurumu\",", "\"Restart-Service TeksERP\",\n  \"'surum=' + $k.uygulamaSurumu\","]], false],
  ['P1 temiz kopya', null, [], true],
  ['P2 meşru yeni salt-okuma kontrolü', null, [['lib/asamalar-b.mjs', "export const ASAMA_5 = [", "export const ASAMA_5 = [\n  { no: '5.0', ad: 'sonda', kos: (ag) => ag.ssh('docker ps --format \"{{.Names}}\"', { hedef: 'yayin' }), degerlendir: () => ({ sonuc: 'UYUMLU', not: '' }) },"]], true],
];

// ---- §5 deploy/vds-dogrula.sh: VDS'e yalnız OKUMA (tek ssh, uzak komut ag.mjs izin listesinden), yerel yazım
// yalnız taban dizinine; davranış sahte `ssh` ile (AYNI · FARK · ÖLÇÜLEMEDİ · taban ezilmez) ----
const VDS_BETIK = path.join(KOK, 'deploy/vds-dogrula.sh');
const kodSatirlari = (metin) => metin.split('\n').filter((x) => !/^\s*#/.test(x));
const SAHTE_SSH = '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$SAHTE_ARG"\ncat "$SAHTE_CIKTI"\nexit "${SAHTE_KOD:-0}"\n';

function sahteCikti(bozuk = false) {
  const h = (i) => (i === 7 && bozuk ? 'f' : 'a').repeat(2) + i.toString(16).padStart(62, '0');
  const a = Array.from({ length: 320 }, (_, i) => `${h(i)}  adnansahin/electron/d${i}.bin`);
  return [...a, '@@KOK', `${h(900)}  electron/latest.yml`, '@@DIGER', `${h(901)}  /opt/x/defter.tsv`, '@@LS', 'adnansahin', 'electron', ''].join('\n');
}

async function vdsDogrulaDenetimi(betik, tmp) {
  const sonuc = [];
  const ekle = (ad, ok, ayrinti = '') => sonuc.push({ ad, ok, ayrinti });
  const { sshDenetle } = await import(path.join(HEDEF, 'lib/ag.mjs'));
  const kod = kodSatirlari(fs.readFileSync(betik, 'utf8'));
  const ssh = kod.filter((x) => /(^|[\s;|&(])ssh\s/.test(x));
  ekle('§5a tek ssh çağrısı: -n BatchMode, yalnız "$SSH_HEDEF" "$UZAK"', ssh.length === 1 && /ssh -n -o BatchMode=yes -o ConnectTimeout=10 "\$SSH_HEDEF" "\$UZAK"\)/.test(ssh[0]), `${ssh.length} ssh satırı`);
  const yasak = kod.filter((x) => /(^|[\s;|&(])(scp|rsync|sftp|curl|wget|docker|nc|rm|mv|cp|tee|chmod|chown|sudo|dd|truncate|touch)(?=\s|$)/.test(x));
  ekle('§5b yerel yazma/ağ aracı yok (rm · mv · cp · docker · scp · curl …)', yasak.length === 0, yasak.map((x) => x.trim().slice(0, 60)).join(' | '));
  const hedefler = kod.flatMap((x) => [...x.matchAll(/\d?>>?\s*([^\s;)]+)/g)].map((m) => m[1]));
  const disari = hedefler.filter((h) => h !== '/dev/null' && h !== '&2' && !/^"\$TABAN\/[a-z]+\.sha"$/.test(h));
  ekle('§5c yerel yazım yalnız taban dizinine ("$TABAN/<ad>.sha")', hedefler.length >= 3 && disari.length === 0, disari.join(' ') || `${hedefler.length} yönlendirme`);

  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'ssh'), SAHTE_SSH, { mode: 0o755 });
  const argDosya = path.join(tmp, 'ssh-arg.txt');
  const ciktiDosya = path.join(tmp, 'ssh-cikti.txt');
  const kos = (args, { cikti = sahteCikti(), kodu = '0' } = {}) => {
    fs.rmSync(argDosya, { force: true });
    fs.writeFileSync(ciktiDosya, cikti);
    const r = spawnSync('bash', [betik, ...args], { encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: tmp, LC_ALL: 'C', TEKSERP_VDS_TABAN: '', SAHTE_ARG: argDosya, SAHTE_CIKTI: ciktiDosya, SAHTE_KOD: kodu } });
    return { kod: r.status, cikti: `${r.stdout}${r.stderr}`, ssh: fs.existsSync(argDosya) ? fs.readFileSync(argDosya, 'utf8').split('\n') : null };
  };
  const k = kos(['--komut-yaz']);
  const uzak = k.cikti.trim();
  let denetim = 'geçti';
  try { sshDenetle(uzak); } catch (e) { denetim = e.message.slice(0, 120); }
  ekle('§5d --komut-yaz: bağlanmaz, tek uzak komut ag.mjs salt-okuma izin listesinden geçer', k.kod === 0 && k.ssh === null && uzak.split('\n').length === 1 && denetim === 'geçti', `kod ${k.kod} · ssh ${k.ssh ? 'ÇAĞRILDI' : 'yok'} · ${denetim}`);
  const taban = path.join(tmp, 'taban');
  const y = kos([`--taban=${taban}`, '--taban-yaz']);
  const olc = kos([`--taban=${taban}`]);
  const sshOk = olc.ssh !== null && olc.ssh.includes('BatchMode=yes') && olc.ssh.includes('tekserp-yayin') && olc.ssh.includes(uzak);
  ekle('§5e taban-yaz → ölç: AYNI (çıkış 0), ssh uzak komutu --komut-yaz ile birebir', y.kod === 0 && olc.kod === 0 && /AYNI/.test(olc.cikti) && sshOk, `yaz ${y.kod} · ölç ${olc.kod} · ssh arg ${sshOk ? 'uyumlu' : 'UYUMSUZ'}`);
  const fark = kos([`--taban=${taban}`], { cikti: sahteCikti(true) });
  ekle('§5f tek bayt farkı → FARK (çıkış 1)', fark.kod === 1 && /FARK: html\/adnansahin/.test(fark.cikti), `çıkış ${fark.kod}`);
  const once = fs.readFileSync(path.join(taban, 'adnansahin.sha'), 'utf8');
  const ez = kos([`--taban=${taban}`, '--taban-yaz'], { cikti: sahteCikti(true) });
  const yok = kos([`--taban=${path.join(tmp, 'yok')}`]);
  const kopuk = kos([`--taban=${taban}`], { kodu: '255' });
  const az = kos([`--taban=${taban}`], { cikti: '@@KOK\n@@DIGER\n@@LS\n' });
  ekle('§5g ÖLÇÜLEMEDİ (çıkış 2): taban ezilmez · taban yok · ssh kopuk · az dosya', ez.kod === 2 && fs.readFileSync(path.join(taban, 'adnansahin.sha'), 'utf8') === once && yok.kod === 2 && kopuk.kod === 2 && az.kod === 2,
    `ez ${ez.kod} · yok ${yok.kod} · kopuk ${kopuk.kod} · az ${az.kod}`);
  return sonuc;
}

const VDS_SONDALAR = [
  ['N6 uzak komutta silme', '§5d', [["ls -1 $K/html $K/defter\"", "ls -1 $K/html $K/defter; rm -f $K/html/x\""]], false],
  ['N7 uzak komutta docker', '§5d', [["echo '@@LS';", "docker restart traefik; echo '@@LS';"]], false],
  ['N8 ikinci ssh (yazan)', '§5a', [['rc=0\n', 'rc=0\nssh -n "$SSH_HEDEF" "touch /tmp/x"\n']], false],
  ['N9 taban dışına yerel yazım', '§5c', [['rc=0\n', 'rc=0\nprintf x > "$HOME/vds-iz"\n']], false],
  ['N10 var olan taban ezilir', '§5g', [['[ -e "$TABAN/$f" ] && {', '[ -e "$TABAN/$f" ] && false && {']], false],
  ['P3 temiz kopya', null, [], true],
  ['P4 meşru salt-okuma ekleme (uzak komuta ls)', null, [["ls -1 $K/html $K/defter\"", "ls -1 $K/html $K/defter; ls -1 $K/nginx\""]], true],
];

// ---- §6 T4 özeti: etkinleşmemiş kurulumun örneği hüküm dışı (testfabrika O4: T4 etkinleşmeden başlatılsaydı
// ilk örnekler `gecerlilik≠GECERLI` diye YANLIŞ POZİTİF sayılırdı) ----
async function t4OzetDenetimi(dizin, tmp) {
  const g = await import(path.join(dizin, 'lib/gozlem.mjs'));
  fs.mkdirSync(tmp, { recursive: true });
  const sonuc = [];
  const ekle = (ad, ok, ayrinti = '') => sonuc.push({ ad, ok, ayrinti });
  let n = 0;
  const satir = (etkin, gecerlilik, { kademe = 'NORMAL', istek = 0 } = {}) => g.satirKur(`2026-09-30T00:00:${String(n++).padStart(2, '0')}Z`,
    { durum: 200, json: { data: { kurulum: { etkin }, parmakIzi: { karar: 'ESLESTI', olculen: { f1: true } }, yoklama: {}, gozlem: { reddedilecekIstek: istek, reddedilecekModul: 0 } } } },
    { durum: 200, json: { license: { kip: 'GOZLEM', gecerlilik, uygulananKademe: kademe, nedenler: [] } } });
  const tsv = (satirlar) => {
    const f = path.join(tmp, `t4-${n++}.tsv`);
    fs.writeFileSync(f, g.tsvBaslik() + satirlar.map(g.tsvSatir).join(''));
    return g.tsvOku(f);
  };
  const iki = (satirlar) => [g.ozet(satirlar), g.ozet(tsv(satirlar))]; // bellekten (boolean) ve dosyadan (metin)
  const kisa = (o) => `${o.sonuc} yp=${o.yanlisPozitif.length} etkinlesmemis=${o.etkinlesmemis}`;
  const a = iki([satir(false, 'GECERSIZ', { kademe: 'KISITLI' }), satir(true, 'GECERLI')]);
  ekle('§6a ⭐ etkinleşmemiş örnek (gecerlilik≠GECERLI) yanlış pozitif DEĞİL, ayrı sayılır',
    a.every((o) => o.sonuc === 'UYUMLU' && o.yanlisPozitif.length === 0 && o.etkinlesmemis === 1), a.map(kisa).join(' · '));
  const b = iki([satir(true, 'GECERLI'), satir(true, 'GECERSIZ')]);
  ekle('§6b etkin örnekte gecerlilik≠GECERLI hâlâ IHLAL (kapı körleşmedi)', b.every((o) => o.sonuc === 'IHLAL' && o.yanlisPozitif.length === 1), b.map(kisa).join(' · '));
  const c = iki([satir(false, 'GECERSIZ'), satir(false, 'OLCULEMEDI')]);
  ekle('§6c hiç etkin örnek yok → ÖLÇÜLEMEDİ (UYUMLU değil)', c.every((o) => o.sonuc === 'OLCULEMEDI' && o.yanlisPozitif.length === 0 && o.etkinlesmemis === 2), c.map(kisa).join(' · '));
  const d = iki([satir(false, 'GECERSIZ', { istek: 5 }), satir(true, 'GECERLI', { istek: 0 }), satir(true, 'GECERLI', { istek: 1 })]);
  ekle('§6d gözlem sayacı yalnız ardışık ETKİN örnekler arasında (0→1 IHLAL, etkinleşme sınırı sayılmaz)',
    d.every((o) => o.sonuc === 'IHLAL' && o.yanlisPozitif.length === 1 && /reddedilecekIstek/.test(o.yanlisPozitif[0].sebep)), d.map(kisa).join(' · '));
  const eskiF = path.join(tmp, 't4-eski.tsv');
  const eskiKol = g.KOLONLAR.filter((k) => k !== 'etkin');
  fs.writeFileSync(eskiF, `${eskiKol.join('\t')}\n${eskiKol.map((k) => ({ zaman: 'z', durum: 'OLCULDU', gecerlilik: 'GECERSIZ', kademe: 'NORMAL' })[k] ?? '').join('\t')}\n`);
  const e = g.ozet(g.tsvOku(eskiF));
  ekle('§6e `etkin` kolonsuz eski TSV bugünkü gibi hükme girer (IHLAL)', e.sonuc === 'IHLAL' && e.etkinlesmemis === 0, kisa(e));
  ekle('§6f özet metni etkinleşmemiş sayısını basar', /etkinleşmemiş 1/.test(g.ozetYaz(g.ozet(tsv([satir(false, 'GECERSIZ'), satir(true, 'GECERLI')])))));
  return sonuc;
}

// ---- §8 beklenti parametreleri: hazırlıktan üretim satıcısına geçişte 7.1/4.3 sabit TEST/paket-hazirlik
// beklentisiyle sahte IHLAL vermesin; varsayılan bugünkü davranış ----
async function beklentiDenetimi(dizin) {
  const { parametreler } = await import(path.join(dizin, 'asama-dogrula.mjs'));
  const { ASAMA_4 } = await import(path.join(dizin, 'lib/asamalar-b.mjs'));
  const { ASAMA_7 } = await import(path.join(dizin, 'lib/asamalar-c.mjs'));
  const sonuc = [];
  const ekle = (ad, ok, ayrinti = '') => sonuc.push({ ad, ok, ayrinti });
  const v = parametreler(['--asama=7']).g;
  const u = parametreler(['--asama=7', '--hak-sinif=URETIM', '--paket-kid=paket-2026', '--satici-kok=https://lisans.etkiliyazilim.com']).g;
  ekle('§8a varsayılan beklenti bugünkü (TEST · paket-hazirlik); parametre okunur',
    v.hakSinif === 'TEST' && v.paketKidOnek === 'paket-hazirlik' && u.hakSinif === 'URETIM' && u.paketKidOnek === 'paket-2026', `${v.hakSinif}/${v.paketKidOnek} → ${u.hakSinif}/${u.paketKidOnek}`);
  const k71 = ASAMA_7.find((k) => k.no === '7.1');
  const detay = (g, sinif, moduller) => ({ durum: 200, json: { data: { kurulum: { etkin: true, kurulumId: 'k' }, hak: { sinif, moduller }, kira: { kiraId: 'r', bitis: 'b' }, yoklama: { saticiAdresi: new URL(g.saticiKok).host, sonBasari: 'z' } } } });
  const r = [
    k71.degerlendir(detay(v, 'TEST', ['production.enabled']), v).sonuc,
    k71.degerlendir(detay(u, 'URETIM', ['production.enabled', 'patron-bulut']), u).sonuc,
    k71.degerlendir(detay(v, 'URETIM', ['production.enabled', 'patron-bulut']), v).sonuc,
    k71.degerlendir(detay(v, 'TEST', ['production.enabled', 'patron-bulut']), v).sonuc,
  ];
  ekle('§8b 7.1 sınıfı --hak-sinif\'ten bekler (TEST✓ · URETIM+patron-bulut --hak-sinif=URETIM✓ · URETIM varsayılanla✗ · TEST+patron-bulut✗)', r.join() === 'UYUMLU,UYUMLU,IHLAL,IHLAL', r.join(' · '));
  const k43 = ASAMA_4.find((k) => k.no === '4.3');
  const tp = (g, kid) => ({ kod: 0, cikti: ['surum=2.12.1', 'korumali=True', 'kanal=testfabrika', `butunlukKid=${kid}`, 'native=True', 'jws=True', 'liste=True', 'jsc=True', 'lisansDizini=True', `saticiAdresi=${g.saticiKok}`, 'nodeSahipleri=SYSTEM'].join('\n') });
  const p = [k43.degerlendir(tp(v, 'paket-hazirlik'), v).sonuc, k43.degerlendir(tp(u, 'paket-2026'), u).sonuc, k43.degerlendir(tp(v, 'paket-2026'), v).sonuc];
  ekle('§8c 4.3 PAKET kid önekini --paket-kid\'ten bekler (hazırlık✓ · paket-2026 --paket-kid=paket-2026✓ · paket-2026 varsayılanla✗)', p.join() === 'UYUMLU,UYUMLU,IHLAL', p.join(' · '));
  return sonuc;
}

const BEKLENTI_SONDALAR = [
  ['N14 7.1 sınıfı sabit TEST', '§8b', [['lib/asamalar-c.mjs', 'if (d.hak?.sinif !== g.hakSinif)', "if (d.hak?.sinif !== 'TEST')"]], false],
  ['N15 4.3 PAKET kid önekini yok sayar', '§8c', [['lib/asamalar-b.mjs', "startsWith(g.paketKidOnek)", "startsWith('paket-hazirlik')"]], false],
  ['P7 temiz kopya', null, [], true],
];

const T4_SONDALAR = [
  ['N11 etkinleşmemiş filtresi kalktı', '§6a', [['lib/gozlem.mjs', "if (String(r.etkin) === 'false') {", 'if (false) {']], false],
  ['N12 etkin örneksiz özet UYUMLU', '§6c', [['lib/gozlem.mjs', 'etkinOrnek === 0 || ', '']], false],
  ['P5 temiz kopya', null, [], true],
];

// ---- §7 Aşama 7.1: detay ucu satıcıyı `new URL(vendorUrl).host` olarak döner (license-view.service); tam kökle
// kıyas etkin kurulumda YANLIŞ KIRMIZI verir (testfabrika P5 B1) ----
async function asama7Denetimi(dizin) {
  const { ASAMA_7 } = await import(path.join(dizin, 'lib/asamalar-c.mjs'));
  const { VARSAYILAN } = await import(path.join(dizin, 'lib/ortak.mjs'));
  const k = ASAMA_7.find((x) => x.no === '7.1');
  const sonuc = [];
  const ekle = (ad, ok, ayrinti = '') => sonuc.push({ ad, ok, ayrinti });
  const yuk = (saticiAdresi) => ({ durum: 200, json: { success: true, data: { kurulum: { etkin: true, kurulumId: 'k' }, hak: { sinif: 'TEST', moduller: [] },
    kira: { kiraId: 'r', bitis: 'b' }, yoklama: { saticiAdresi, sonBasari: '2026-09-30T13:29:56.747Z' } } } });
  const host = new URL(VARSAYILAN.saticiKok).host;
  const kisa = (r) => `${r.sonuc} ${r.not}`.trim();
  const esit = k.degerlendir(yuk(host), { ...VARSAYILAN });
  ekle('§7a ⭐ 7.1: detayın host biçimi satıcı köküyle eşleşir (UYUMLU)', esit.sonuc === 'UYUMLU', kisa(esit));
  const farkli = k.degerlendir(yuk('baska.example.com'), { ...VARSAYILAN });
  ekle('§7b 7.1: farklı host IHLAL (kapı körleşmedi)', farkli.sonuc === 'IHLAL' && farkli.not.includes('baska.example.com'), kisa(farkli));
  const port = k.degerlendir(yuk(host), { ...VARSAYILAN, saticiKok: `https://${host}:8443` });
  ekle('§7c 7.1: port da host\'un parçası — farklı port IHLAL', port.sonuc === 'IHLAL', kisa(port));
  return sonuc;
}

const A7_SONDALAR = [
  ['N13 7.1 satıcıyı tam kökle kıyaslar', '§7a', [['lib/asamalar-c.mjs', 'saticiAdresi !== saticiHost)', 'saticiAdresi !== g.saticiKok)']], false],
  ['P6 temiz kopya', null, [], true],
];

async function main() {
  console.log('── §1 statik');
  for (const x of statikDenetim(HEDEF)) yaz(x.ok, x.ad, x.ok ? '' : x.ayrinti);
  console.log('── §2 dinamik (tuzak altında)');
  for (const x of dinamikDenetim(HEDEF, path.join(TMP, 'asil'))) yaz(x.ok, x.ad, x.ayrinti);
  console.log('── §3 sözleşme birimi');
  await sozlesmeBirimi();
  console.log('── §4 sondalar (geçici kopya)');
  let negatif = 0;
  for (const [ad, beklenenKirmizi, degistir, yesilBeklenir] of SONDALAR) {
    const { d, tmp } = kopyala(ad.split(' ')[0], degistir);
    const kotu = kopyaDenetle(d, tmp);
    if (!yesilBeklenir) negatif += 1;
    // Negatif sonda DOĞRU kontrolde kırmızı vermeli — başka bir yerden gelen kırmızı sondayı geçersiz kılar.
    const ok = yesilBeklenir ? kotu.length === 0 : kotu.some((x) => x.ad.startsWith(beklenenKirmizi));
    yaz(ok, `${ad} → ${yesilBeklenir ? 'YEŞİL' : `KIRMIZI (${beklenenKirmizi})`} beklenir`, `kırmızı ${kotu.length}${kotu.length ? `: ${kotu.map((x) => x.ad.slice(0, 40)).join(' | ')}` : ''}`);
  }
  console.log('── §5 deploy/vds-dogrula.sh (VDS salt okuma · sahte ssh)');
  for (const x of await vdsDogrulaDenetimi(VDS_BETIK, path.join(TMP, 'vds-asil'))) yaz(x.ok, x.ad, x.ayrinti);
  for (const [ad, beklenenKirmizi, degistir, yesilBeklenir] of VDS_SONDALAR) {
    const d = path.join(TMP, `vds-${ad.split(' ')[0]}`);
    fs.mkdirSync(d, { recursive: true });
    let k = fs.readFileSync(VDS_BETIK, 'utf8');
    for (const [eski, yeni] of degistir) {
      if (!k.includes(eski)) throw new Error(`sonda ${ad}: '${eski.slice(0, 40)}' vds-dogrula.sh'ta yok — sonda uygulanamadı`);
      k = k.replace(eski, () => yeni);
    }
    fs.writeFileSync(path.join(d, 'vds-dogrula.sh'), k);
    const kotu = (await vdsDogrulaDenetimi(path.join(d, 'vds-dogrula.sh'), path.join(d, 'tmp'))).filter((x) => !x.ok);
    if (!yesilBeklenir) negatif += 1;
    const ok = yesilBeklenir ? kotu.length === 0 : kotu.some((x) => x.ad.startsWith(beklenenKirmizi));
    yaz(ok, `${ad} → ${yesilBeklenir ? 'YEŞİL' : `KIRMIZI (${beklenenKirmizi})`} beklenir`, `kırmızı ${kotu.length}${kotu.length ? `: ${kotu.map((x) => x.ad.slice(0, 40)).join(' | ')}` : ''}`);
  }
  console.log('── §6 T4 özeti (etkinleşmemiş kurulum hüküm dışı)');
  for (const x of await t4OzetDenetimi(HEDEF, path.join(TMP, 't4-asil'))) yaz(x.ok, x.ad, x.ayrinti);
  for (const [ad, beklenenKirmizi, degistir, yesilBeklenir] of T4_SONDALAR) {
    const { d, tmp } = kopyala(`t4-${ad.split(' ')[0]}`, degistir);
    const kotu = (await t4OzetDenetimi(d, tmp)).filter((x) => !x.ok);
    if (!yesilBeklenir) negatif += 1;
    const ok = yesilBeklenir ? kotu.length === 0 : kotu.some((x) => x.ad.startsWith(beklenenKirmizi));
    yaz(ok, `${ad} → ${yesilBeklenir ? 'YEŞİL' : `KIRMIZI (${beklenenKirmizi})`} beklenir`, `kırmızı ${kotu.length}${kotu.length ? `: ${kotu.map((x) => x.ad.slice(0, 40)).join(' | ')}` : ''}`);
  }
  console.log('── §7 aşama 7.1 satıcı kıyası (detay host döner)');
  for (const x of await asama7Denetimi(HEDEF)) yaz(x.ok, x.ad, x.ayrinti);
  for (const [ad, beklenenKirmizi, degistir, yesilBeklenir] of A7_SONDALAR) {
    const { d } = kopyala(`a7-${ad.split(' ')[0]}`, degistir);
    const kotu = (await asama7Denetimi(d)).filter((x) => !x.ok);
    if (!yesilBeklenir) negatif += 1;
    const ok = yesilBeklenir ? kotu.length === 0 : kotu.some((x) => x.ad.startsWith(beklenenKirmizi));
    yaz(ok, `${ad} → ${yesilBeklenir ? 'YEŞİL' : `KIRMIZI (${beklenenKirmizi})`} beklenir`, `kırmızı ${kotu.length}${kotu.length ? `: ${kotu.map((x) => x.ad.slice(0, 40)).join(' | ')}` : ''}`);
  }
  console.log('── §8 beklenti parametreleri (hazırlık → üretim satıcısı geçişi)');
  for (const x of await beklentiDenetimi(HEDEF)) yaz(x.ok, x.ad, x.ayrinti);
  for (const [ad, beklenenKirmizi, degistir, yesilBeklenir] of BEKLENTI_SONDALAR) {
    const { d } = kopyala(`bk-${ad.split(' ')[0]}`, degistir);
    const kotu = (await beklentiDenetimi(d)).filter((x) => !x.ok);
    if (!yesilBeklenir) negatif += 1;
    const ok = yesilBeklenir ? kotu.length === 0 : kotu.some((x) => x.ad.startsWith(beklenenKirmizi));
    yaz(ok, `${ad} → ${yesilBeklenir ? 'YEŞİL' : `KIRMIZI (${beklenenKirmizi})`} beklenir`, `kırmızı ${kotu.length}${kotu.length ? `: ${kotu.map((x) => x.ad.slice(0, 40)).join(' | ')}` : ''}`);
  }
  const toplam = SONDALAR.length + VDS_SONDALAR.length + T4_SONDALAR.length + A7_SONDALAR.length + BEKLENTI_SONDALAR.length;
  console.log(`\n${kirmizi === 0 ? '✅ YEŞİL' : `❌ ${kirmizi} kırmızı`} · ${negatif} negatif + ${toplam - negatif} pozitif sonda`);
  fs.rmSync(TMP, { recursive: true, force: true });
  return kirmizi === 0 ? 0 : 1;
}

main().then((k) => process.exit(k), (e) => { console.error(e); process.exit(1); });
