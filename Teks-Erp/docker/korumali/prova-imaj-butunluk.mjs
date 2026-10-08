#!/usr/bin/env node
// =============================================================================
// İMAJ İÇİ BÜTÜNLÜK PROVASI (G13) — test kökünden çalışan konteynerin `/health/yerel`ine uçtan uca
// =============================================================================
// Kriptoyu YAZMAZ; törenin ve imzanın GERÇEK araçlarını sırayla koşturur:
//   test kökü (`anahtar.ts kok-uret`) → `pkt-2099-1` (kök imzalı PAKET sertifikası) → deponun GEÇİCİ kopyasında
//   test kökü çapaya eklenir (`guven-capasi-ekle.ts kok --kok=<kopya>`; TS + `anchor.rs`) → native üretim
//   derlemesi (linux-x64, test kökü gömülü) → korumalı imaj (Dockerfile AYNEN) → `imaj-imzala.mjs` (zincir-yalnız,
//   öz-denetim dahil) → konteyner (ağı iç, lisans sunucusu `kapali`) içinden `/health/yerel`:
//   cekirdek native · butunluk GECERLI. Negatif sondalar (her biri ayrı açılış): imza dosyaları silindi ·
//   yalnız liste silindi · kapsamda bir dosya değişti · imza ÇAPADA OLMAYAN kökün sertifikasıyla → GECERLI DEĞİL.
// Gerçek köke, PAKET anahtarına, satıcıya, lisans sunucusuna, ~/.tekserp'e DOKUNMAZ: anahtar araçları geçici
// HOME'la, parolalar bellekte rastgele (diske/ekrana yazılmaz). Test çapalı imaj yalnız bu Mac'te doğar ve
// prova sonunda silinir (`--birak` hariç); var olan imajlara dokunulmaz.
//
// Kullanım (repo kökünden; önkoşul `Teks-Erp`, `satici/sunucu` npm ci · cargo + zig · Docker Desktop):
//   node scripts/agir-is.mjs -- node Teks-Erp/docker/korumali/prova-imaj-butunluk.mjs [--birak]
// Çıkış: 0 bütün adımlar GEÇTİ · 1 en az bir adım KALDI · 2 prova kurulamadı.
// =============================================================================
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const TEKS = path.resolve(BURASI, '..', '..');
const KOK = path.resolve(TEKS, '..');
const SATICI = path.join(KOK, 'satici', 'sunucu');
const BIRAK = process.argv.includes('--birak');
const EK = randomBytes(3).toString('hex');

const KOK1 = 'kok-2099-1';
const KOK2 = 'kok-2099-2';
const PKT1 = 'pkt-2099-1';
const PKT2 = 'pkt-2099-2';
const CI_ATLA = 'Prova betiği: Docker imajı bu Mac üzerinde derlendi, geçici test kökünde liste imzalanıyor';
const TABAN = `tekserp-korumali:prova-g13-${EK}-imzasiz`;
const IMZALI = `tekserp-korumali:prova-g13-${EK}`;
const AG = `tekserp-prova-g13-${EK}`;
const PG = `tekserp-prova-g13-${EK}-pg`;

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-imaj-prova-'));
const yol = (...p) => path.join(T, ...p);
const P = { [KOK1]: randomBytes(18).toString('hex'), [KOK2]: randomBytes(18).toString('hex'), [PKT1]: randomBytes(18).toString('hex'), [PKT2]: randomBytes(18).toString('hex'), pg: randomBytes(18).toString('hex') };
const GIZLI = Object.values(P);
const imajlar = [];
const konteynerler = [];

// Anahtar araçları geçici HOME'la (gerçek ~/.tekserp'e yazılmaz); docker gerçek HOME'la (Desktop bağlamı).
const TEMIZ = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^TEKSERP_|^DATABASE_URL$|^ANAHTAR_DIZINI$|^GUVEN_CAPASI_DOSYASI$|^NODE_OPTIONS$/.test(k)));
const ARAC = { ...TEMIZ, HOME: yol('ev') };
fs.mkdirSync(yol('ev'), { recursive: true });

let gecti = 0;
let kaldi = 0;
let no = 0;
const temiz = (s) => (GIZLI.some((g) => String(s).includes(g)) ? '‹çıktı parola içerdiği için basılmadı›' : String(s));
function adim(ad, ok, ayrinti = '') {
  no++;
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "GEÇTİ" : "KALDI"}  [${String(no).padStart(2, "0")}] ${ad}${!ok && ayrinti ? `\n         ${temiz(ayrinti)}` : ''}`);
  return ok;
}
class Durdu extends Error {}
function sart(ad, ok, ayrinti) {
  if (!adim(ad, ok, ayrinti)) throw new Durdu(ad);
}
function kos(komut, args, o = {}) {
  const r = spawnSync(komut, args, { encoding: 'utf8', timeout: 3_600_000, maxBuffer: 256 * 1024 * 1024, ...o });
  return { kod: r.status, cikti: r.stdout ?? '', hata: `${r.stderr ?? ''}${r.error ? ` ${r.error.message}` : ''}` };
}
const tsx = (cwd, argv, girdi = '', env = ARAC) => kos(process.execPath, ['--import', 'tsx', ...argv], { cwd, input: girdi, env });
const docker = (args, o = {}) => kos('docker', args, { env: TEMIZ, ...o });
const kuyruk = (r) => `çıkış ${r.kod}: ${(r.hata || r.cikti).trim().split('\n').slice(-4).join(' | ').slice(-500)}`;
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sonJson = (s) => JSON.parse(s.trim().split('\n').pop() || '{}');

function kokKur(kid) {
  const k = tsx(SATICI, ['scripts/anahtar.ts', 'kok-uret', `--kid=${kid}`, `--dizin=${yol(kid)}`], `${P[kid]}\n${P[kid]}\n`);
  const dosya = yol(kid, `${kid}.kok.json`);
  if (k.kod === 0 && fs.existsSync(dosya)) {
    const kj = json(dosya);
    fs.writeFileSync(yol(`${kid}-capa.json`), `${JSON.stringify([{ kid: kj.kid, x: kj.x, classes: kj.siniflar }])}\n`);
  }
  sart(`test kökü ${kid} (kok-uret) + test çapası`, fs.existsSync(yol(`${kid}-capa.json`)), kuyruk(k));
  return { dosya, capa: yol(`${kid}-capa.json`) };
}

function pktKur(kid, kok) {
  const d = yol(kid);
  const a = tsx(TEKS, ['scripts/build-korumali-imza.ts', 'anahtar-uret', `--kid=${kid}`, `--dizin=${d}`, '--json'], `${P[kid]}\n${P[kid]}\n`);
  let ozet = {};
  try { ozet = sonJson(a.cikti); } catch { /* aşağıda kalır */ }
  const sert = yol(`${kid}-sertifika.json`);
  const s = a.kod === 0 ? tsx(SATICI, ['scripts/anahtar.ts', 'paket-sertifika-uret', `--x=${ozet.x}`, `--kid=${kid}`, `--kok=${kok}`, `--kok-dizin=${yol(kok)}`, '--gun=395', `--cikti=${sert}`], `${P[kok]}\n`) : a;
  const e = s.kod === 0 ? tsx(TEKS, ['scripts/build-korumali-imza.ts', 'sertifika-ekle', `--anahtar=${ozet.dosya}`, `--sertifika=${sert}`, `--kok-capa=${yol(`${kok}-capa.json`)}`]) : s;
  sart(`${kid}: parolalı anahtar + ${kok} imzalı PAKET sertifikası + sertifika-ekle`, e.kod === 0 && fs.existsSync(path.join(d, `${kid}.sertifika.json`)), kuyruk(e));
  return ozet.dosya;
}

/** Deponun izlenen + izlenmeyen (yok sayılmayan) dosyaları geçici kopyaya — çalışma ağacının bugünkü hâli. */
function depoKopyala(hedef) {
  const r = kos('git', ['-C', KOK, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (r.kod !== 0) return 0;
  let n = 0;
  for (const rel of r.cikti.split('\0').filter(Boolean)) {
    const k = path.join(KOK, rel);
    let st;
    try { st = fs.lstatSync(k); } catch { continue; }
    if (!st.isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(hedef, rel)), { recursive: true });
    fs.copyFileSync(k, path.join(hedef, rel));
    n++;
  }
  return n;
}

/** Türetilmiş imaj: imzalı imajın üstünde root ile koşan tek RUN (negatif sonda). */
function turet(ad, satir) {
  const d = yol(`turet-${ad}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'Dockerfile'), `FROM ${IMZALI}\nUSER 0\n${satir}\nUSER 10001:10001\n`);
  const etiket = `tekserp-korumali:prova-g13-${EK}-${ad}`;
  const r = docker(['build', '--platform', 'linux/amd64', '--pull=false', '-q', '-t', etiket, d]);
  if (r.kod === 0) imajlar.push(etiket);
  return { etiket, r };
}

/** Konteyneri açar, `/health/yerel` lisans alanı gelene dek içeriden yoklar, kapatır. */
function olc(imaj, ad) {
  const mid = yol('machine-id');
  if (!fs.existsSync(mid)) fs.writeFileSync(mid, `${randomBytes(16).toString('hex')}\n`);
  const c = `tekserp-prova-g13-${EK}-${ad}`;
  const r = docker([
    'run', '-d', '--name', c, '--platform', 'linux/amd64', '--network', AG, '--read-only', '--tmpfs', '/tmp:size=256m,mode=1777',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '-v', '/var/lib/tekserp/lisans', '-v', '/var/lib/tekserp/yedek', '-v', '/var/lib/tekserp/yedek-anahtar', '-v', `${mid}:/etc/machine-id:ro`,
    '-e', 'PORT=4000', '-e', `DATABASE_URL=postgresql://tekserp:${P.pg}@${PG}:5432/tekserp?schema=public`,
    '-e', `JWT_SECRET=${randomBytes(48).toString('hex')}`, '-e', 'LICENSE_SERVER_URL=kapali', '-e', 'SEED_ON_EMPTY=0',
    imaj,
  ]);
  if (r.kod !== 0) return { hata: kuyruk(r) };
  konteynerler.push(c);
  const sinir = Date.now() + 600_000;
  let son = null;
  try {
    while (Date.now() < sinir) {
      const e = docker(['exec', c, 'node', '-e', "fetch('http://127.0.0.1:4000/health/yerel').then(async r=>console.log(await r.text())).catch(()=>process.exit(1))"], { timeout: 30_000 });
      if (e.kod === 0) {
        try { son = JSON.parse(e.cikti.trim()); } catch { son = null; }
        if (son?.lisans) return { yerel: son };
      }
      const durum = docker(['inspect', '-f', '{{.State.Running}}', c]).cikti.trim();
      if (durum !== 'true') return { hata: `konteyner durdu: ${docker(['logs', '--tail', '15', c]).cikti.trim().slice(-600)}` };
      spawnSync('sleep', ['3']);
    }
    return { hata: `zaman aşımı (son: ${JSON.stringify(son)?.slice(0, 200)}) · ${docker(['logs', '--tail', '8', c]).cikti.trim().slice(-400)}` };
  } finally {
    docker(['rm', '-f', '-v', c]);
    konteynerler.splice(konteynerler.indexOf(c), 1);
  }
}
const ozetle = (o) => (o.yerel ? `cekirdek ${o.yerel.lisans.cekirdek} · butunluk ${o.yerel.lisans.butunluk} · kip ${o.yerel.lisans.kip} · db ${o.yerel.db}` : o.hata);

function prova() {
  console.log(`İMAJ İÇİ BÜTÜNLÜK PROVASI — geçici dizin ${BIRAK ? T : '(sonda silinir)'} · ek ${EK}`);

  // ── 1. Test kökleri: biri çapaya girer, öbürü (yabancı) girmez ──
  const kok1 = kokKur(KOK1);
  kokKur(KOK2);
  const pkt1 = pktKur(PKT1, KOK1);
  const pkt2 = pktKur(PKT2, KOK2);

  // ── 2. Test çapalı derleme: deponun geçici kopyası, çapaya yalnız KOK1 ──
  const depo = yol('depo');
  const n = depoKopyala(depo);
  sart(`deponun çalışma ağacı geçici kopyada (${n} dosya)`, n > 1000);
  const capa = tsx(TEKS, ['scripts/guven-capasi-ekle.ts', 'kok', `--dosya=${kok1.dosya}`, `--kok=${depo}`, '--yaz']);
  const anchorRs = fs.readFileSync(path.join(depo, 'Teks-Erp', 'native', 'tekserp-dogrulama', 'src', 'anchor.rs'), 'utf8');
  sart(`kopyada çapaya ${KOK1} eklendi (TS + anchor.rs; gerçek depo değişmedi)`, capa.kod === 0 && anchorRs.includes(KOK1)
    && !fs.readFileSync(path.join(TEKS, 'native', 'tekserp-dogrulama', 'src', 'anchor.rs'), 'utf8').includes(KOK1), kuyruk(capa));
  const nat = kos(process.execPath, ['scripts/derle.mjs', 'linux-x64', '--uretim'], {
    cwd: path.join(depo, 'Teks-Erp', 'native', 'lisans-cekirdek'),
    env: { ...TEMIZ, PATH: [path.join(os.homedir(), '.cargo', 'bin'), TEMIZ.PATH].join(path.delimiter) },
  });
  sart('native üretim derlemesi (linux-x64, GLIBC ≤ 2.28, test kökü gömülü)', nat.kod === 0, kuyruk(nat));
  const sha = kos('git', ['-C', KOK, 'rev-parse', 'HEAD']).cikti.trim();
  const der = docker(['buildx', 'build', '--platform', 'linux/amd64', '-f', 'Teks-Erp/docker/korumali/Dockerfile', '--build-arg', `TEKSERP_COMMIT=${sha}`, '-t', TABAN, '--load', '.'], { cwd: depo, timeout: 5_400_000 });
  if (der.kod === 0) imajlar.push(TABAN);
  sart(`korumalı imaj (Dockerfile aynen) → ${TABAN}`, der.kod === 0, kuyruk(der));

  // ── 3. İmza: zincir-yalnız (pkt-2099-1), öz-denetim imaj-imzala içinde ──
  const imza = kos(process.execPath, [path.join(BURASI, 'imaj-imzala.mjs'), TABAN, IMZALI, `--kok-capa=${kok1.capa}`, `--ci-atla=${CI_ATLA}`], {
    env: { ...TEMIZ, TEKSERP_PAKET_ANAHTARI: pkt1 }, input: `${P[PKT1]}\n`, cwd: KOK,
  });
  if (imza.kod === 0) imajlar.push(IMZALI);
  sart(`imaj-imzala → ${IMZALI} (öz-denetim GECERLI + bekçi --imzali)`, imza.kod === 0 && /öz-denetim butunluk-zincir\.jws: GECERLI/.test(imza.cikti), kuyruk(imza));

  // ── 4. Çalışan konteyner (PG16, ağı iç) ──
  sart('iç ağ', docker(['network', 'create', '--internal', AG]).kod === 0);
  const pg = docker(['run', '-d', '--name', PG, '--network', AG, '-e', 'POSTGRES_USER=tekserp', '-e', `POSTGRES_PASSWORD=${P.pg}`, '-e', 'POSTGRES_DB=tekserp', 'postgres:16-bookworm']);
  if (pg.kod === 0) konteynerler.push(PG);
  sart('PostgreSQL 16 (yerel imaj, ağı iç)', pg.kod === 0, kuyruk(pg));
  const ok = olc(IMZALI, 'gecerli');
  adim(`imzalı imaj: /health/yerel cekirdek native · butunluk GECERLI — ${ozetle(ok)}`, ok.yerel?.lisans?.cekirdek === 'native' && ok.yerel?.lisans?.butunluk === 'GECERLI');

  // ── 5. Negatif sondalar: hiçbiri GECERLI olmaz ──
  const sonda = (ad, satir, beklenen) => {
    const t = turet(ad, satir);
    if (t.r.kod !== 0) return adim(`N ${ad}: türetilmiş imaj derlenemedi`, false, kuyruk(t.r));
    const o = olc(t.etiket, ad);
    return adim(`N ${ad} → GECERLI DEĞİL — ${ozetle(o)}`, Boolean(o.yerel) && o.yerel.lisans.butunluk !== 'GECERLI' && beklenen(o.yerel.lisans));
  };
  sonda('imza-silindi', 'RUN rm /app/butunluk-liste.txt /app/butunluk-zincir.jws', (l) => l.butunluk === 'GECERSIZ' && l.cekirdek === 'yok');
  sonda('liste-silindi', 'RUN rm /app/butunluk-liste.txt', (l) => l.cekirdek === 'yok');
  sonda('dosya-degisti', 'RUN printf "\\n" >> /app/dist/tools/seed.cjs', (l) => l.butunluk === 'GECERSIZ' && l.cekirdek === 'native');

  // Yabancı kök: aynı /app, aynı araç, çapada OLMAYAN kökün sertifikalı anahtarı (öz-denetim imaj-imzala'nın
  // kendisinde düşeceği için imza burada elle katmanlanır).
  const yd = yol('yabanci');
  fs.mkdirSync(yd);
  const cid = docker(['create', '--platform', 'linux/amd64', TABAN]).cikti.trim();
  const cp = docker(['cp', `${cid}:/app`, path.join(yd, 'app')]);
  docker(['rm', cid]);
  const surum = cp.kod === 0 ? json(path.join(yd, 'app', 'package.json')).version : '0.0.0';
  const yi = cp.kod === 0
    ? tsx(TEKS, ['scripts/build-korumali-imza.ts', 'imzala', `--kok=${path.join(yd, 'app')}`, `--anahtar=${pkt2}`, `--surum=${surum}`, '--urun=backend-docker', `--kok-capa=${yol(`${KOK2}-capa.json`)}`, `--ci-atla=${CI_ATLA}`], `${P[PKT2]}\n`)
    : cp;
  if (yi.kod === 0) {
    for (const f of ['butunluk-liste.txt', 'butunluk-zincir.jws']) fs.copyFileSync(path.join(yd, 'app', f), path.join(yd, f));
    fs.writeFileSync(path.join(yd, 'Dockerfile'), `FROM ${TABAN}\nCOPY --chown=0:0 --chmod=0644 butunluk-liste.txt butunluk-zincir.jws /app/\n`);
    fs.rmSync(path.join(yd, 'app'), { recursive: true, force: true });
    const et = `tekserp-korumali:prova-g13-${EK}-yabanci`;
    const b = docker(['build', '--platform', 'linux/amd64', '--pull=false', '-q', '-t', et, yd]);
    if (b.kod === 0) {
      imajlar.push(et);
      const o = olc(et, 'yabanci');
      adim(`N yabanci-kok (${PKT2} ← ${KOK2}, çapada yok) → GECERLI DEĞİL — ${ozetle(o)}`, Boolean(o.yerel) && o.yerel.lisans.butunluk !== 'GECERLI' && o.yerel.lisans.cekirdek === 'yok');
    } else adim('N yabanci-kok: katman derlenemedi', false, kuyruk(b));
  } else adim('N yabanci-kok: imza atılamadı', false, kuyruk(yi));
}

let cikis = 0;
try {
  prova();
} catch (e) {
  if (!(e instanceof Durdu)) {
    console.error(`prova kurulamadı: ${temiz(e?.stack || e)}`);
    cikis = 2;
  }
} finally {
  for (const c of [...konteynerler].reverse()) docker(['rm', '-f', '-v', c]);
  docker(['network', 'rm', AG]);
  if (!BIRAK) {
    for (const i of [...imajlar].reverse()) docker(['image', 'rm', i]);
    fs.rmSync(T, { recursive: true, force: true });
  } else console.log(`bırakıldı: ${T} · imajlar ${imajlar.join(' ')}`);
}
console.log(`\n${gecti} GEÇTİ · ${kaldi} KALDI`);
process.exit(cikis || (kaldi > 0 ? 1 : 0));
