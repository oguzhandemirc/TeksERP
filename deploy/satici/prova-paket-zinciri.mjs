#!/usr/bin/env node
// =============================================================================
// PAKET ZİNCİRİ PROVASI (3.9 D7) — test kökünden fabrikadaki güncelleyiciye uçtan uca, GEÇİCİ dizinde
// =============================================================================
// Kriptoyu YAZMAZ; törenin ve yayının gerçek araçlarını sırayla koşturur ve güncelleyicinin GERÇEK motorunu
// (`tekserp-guncelleyici`, sahte dünya: dosya sistemi gerçek, hizmet/ağ/saat sahte) provanın ürettiği dosyalara karşı koşar:
//   test kökü (`anahtar.ts kok-uret`, TEKSERP_TEST_KOK_CAPASI) → iki PAKET sertifikası (pkt-2099-1 · pkt-2099-2) →
//   zincir-yalnız paket + PG künyesi + sürüm bildirimi (kid'siz zincirli ad) → yeniden imza (yanına
//   `surum-zincir-<kid>.json` · `pg-zincir-<kid>.json`) → birincinin dağıtım iptali → tören girdisinde iptalli elenir →
//   motor: kid'siz ad okunur · çift kid'de en geç bitiş · iptalde seçim ikinciye geçer (sürüm + PG) · `son-zincir.json`
//   yeniden imzalıyla DEĞİŞMEZSE kanal TAKILIR (runbook URETIM-SATICI-TOREN.md §10.4 adım 2'nin gerekçesi).
// Gerçek köke, satıcıya, VDS'e, Cloudflare'e, ~/.tekserp'e DOKUNMAZ: HOME geçici dizin, parolalar bellekte rastgele
// (diske/ekrana yazılmaz), ağ yok, DB yok. Motor tarafı: Teks-Erp/native/tekserp-guncelleyici/tests/paket_prova.rs.
//
// Kullanım (repo kökünden; önkoşul `Teks-Erp` ve `satici/sunucu`'da npm ci, cargo):
//   node scripts/agir-is.mjs -- node deploy/satici/prova-paket-zinciri.mjs [--birak]
//     --birak  geçici dizini silmez (yolunu basar)
// Çıkış: 0 bütün adımlar GEÇTİ · 1 en az bir adım KALDI · 2 prova kurulamadı (araç/önkoşul).
// =============================================================================
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEKS = path.join(KOK, 'Teks-Erp');
const SATICI = path.join(KOK, 'satici', 'sunucu');
const NATIVE = path.join(TEKS, 'native');
const BIRAK = process.argv.includes('--birak');

const KOK_KID = 'kok-2099-1';
const PKT1 = 'pkt-2099-1';
const PKT2 = 'pkt-2099-2';
const GRUP = 'test';
const PG_ETIKET = '16.15-4';
const CI_ATLA = 'Prova betiği: CI koşusu yok, geçici test kökünde deneme paketi imzalanıyor';

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-paket-prova-'));
const yol = (...p) => path.join(T, ...p);
const P = { kok: randomBytes(18).toString('hex'), [PKT1]: randomBytes(18).toString('hex'), [PKT2]: randomBytes(18).toString('hex') };
const GIZLI = Object.values(P);

/** Alt süreç ortamı: TEKSERP_* ve DB/çapa ezmeleri geçmez; HOME geçici; test kök çapası prova köküne. */
const ORTAM = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^TEKSERP_|^DATABASE_URL$|^ANAHTAR_DIZINI$|^GUVEN_CAPASI_DOSYASI$|^NODE_OPTIONS$/.test(k)));
Object.assign(ORTAM, { HOME: yol('ev'), TEKSERP_TEST_PAKET_CAPASI: '', TEKSERP_TEST_KOK_CAPASI: yol('kok-capa.json') });
ORTAM.PATH = [path.join(os.homedir(), '.cargo', 'bin'), ORTAM.PATH].join(path.delimiter);
fs.mkdirSync(yol('ev'), { recursive: true });

let gecti = 0;
let kaldi = 0;
let no = 0;
/** Ekrana gidecek her metin: parola baytı varsa hiç basılmaz. */
const temiz = (s) => (GIZLI.some((g) => String(s).includes(g)) ? '‹çıktı parola içerdiği için basılmadı›' : String(s));
function adim(ad, ok, ayrinti = '') {
  no++;
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  [${String(no).padStart(2, '0')}] ${ad}${!ok && ayrinti ? `\n         ${temiz(ayrinti)}` : ''}`);
  return ok;
}
class Durdu extends Error {}
/** Sonraki adımların dayandığı adım: kalırsa prova durur (kalan adımlar koşulmaz). */
function sart(ad, ok, ayrinti) {
  if (!adim(ad, ok, ayrinti)) throw new Durdu(ad);
}

function tsx(cwd, argv, girdi = '') {
  const r = spawnSync(process.execPath, ['--import', 'tsx', ...argv], { cwd, input: girdi, env: ORTAM, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
  return { kod: r.status, cikti: r.stdout ?? '', hata: `${r.stderr ?? ''}${r.error ? ` ${r.error.message}` : ''}` };
}
const kuyruk = (r) => `çıkış ${r.kod}: ${(r.hata || r.cikti).trim().split('\n').slice(-3).join(' | ').slice(-400)}`;
function cargoProva(test) {
  const r = spawnSync('cargo', ['test', '-q', '-p', 'tekserp-guncelleyici', '--test', 'paket_prova', '--', '--ignored', '--exact', test], {
    cwd: NATIVE,
    // HOME geçici kalır; araç zinciri yerini gerçek evden bilir.
    env: { ...ORTAM, RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(os.homedir(), '.rustup'), CARGO_HOME: process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo'), TEKSERP_PAKET_PROVA: yol('motor') }, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024,
  });
  return { kod: r.status, cikti: r.stdout ?? '', hata: `${r.stderr ?? ''}${r.error ? ` ${r.error.message}` : ''}` };
}
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sonJson = (s) => JSON.parse(s.trim().split('\n').pop() || '{}');
/** İşaretçi dosyasındaki (`{v, bildirim}`) imzalı belgenin başlığı + yükü — doğrulamadan, yalnız gözlem. */
function belge(f) {
  const [h, y] = json(f).bildirim.split('.');
  const b64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  return { baslik: b64(h), yuk: b64(y) };
}
function zipListesi(zip) {
  const r = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}
function kopyala(kaynak, hedef) {
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.copyFileSync(kaynak, hedef, fs.constants.COPYFILE_EXCL);
}

const SURUM_D = yol('yayin', GRUP, 'backend', '2.13.0');
const PG_D = yol('yayin', GRUP, 'backend', 'pg', PG_ETIKET);
const URL_S = `/${GRUP}/backend/2.13.0`;
const URL_PG = `/${GRUP}/backend/pg/${PG_ETIKET}`;
const anahtar = {};

function pktKur(kid, gun) {
  const d = yol(kid);
  const a = tsx(TEKS, ['scripts/build-korumali-imza.ts', 'anahtar-uret', `--kid=${kid}`, `--dizin=${d}`, '--json'], `${P[kid]}\n${P[kid]}\n`);
  let ozet = {};
  try { ozet = sonJson(a.cikti); } catch { /* aşağıda kalır */ }
  const sert = yol(`${kid}-sertifika.json`);
  const s = a.kod === 0 ? tsx(SATICI, ['scripts/anahtar.ts', 'paket-sertifika-uret', `--x=${ozet.x}`, `--kid=${kid}`, `--kok=${KOK_KID}`, `--kok-dizin=${yol('kok')}`, `--gun=${gun}`, `--cikti=${sert}`], `${P.kok}\n`) : a;
  const e = s.kod === 0 ? tsx(TEKS, ['scripts/build-korumali-imza.ts', 'sertifika-ekle', `--anahtar=${ozet.dosya}`, `--sertifika=${sert}`]) : s;
  anahtar[kid] = { dosya: ozet.dosya, sert };
  sart(`${kid}: parolalı anahtar + kök imzalı PAKET sertifikası (${gun} gün) + sertifika-ekle (test kök çapasıyla)`,
    e.kod === 0 && fs.existsSync(path.join(d, `${kid}.sertifika.json`)), kuyruk(e));
}

function prova() {
  console.log(`PAKET ZİNCİRİ PROVASI — geçici dizin ${BIRAK ? T : '(sonda silinir)'}`);

  // ── 1. Test kökü + çapa ──
  const k = tsx(SATICI, ['scripts/anahtar.ts', 'kok-uret', `--kid=${KOK_KID}`, `--dizin=${yol('kok')}`], `${P.kok}\n${P.kok}\n`);
  const kokDosya = yol('kok', `${KOK_KID}.kok.json`);
  if (k.kod === 0 && fs.existsSync(kokDosya)) {
    const kj = json(kokDosya);
    fs.writeFileSync(yol('kok-capa.json'), `${JSON.stringify([{ kid: kj.kid, x: kj.x, classes: kj.siniflar }])}\n`);
  }
  sart(`test kökü ${KOK_KID} (kok-uret) + TEKSERP_TEST_KOK_CAPASI dosyası`, fs.existsSync(yol('kok-capa.json')), kuyruk(k));

  // ── 2. İki PAKET sertifikası: ikincinin bitişi daha geç (çift kid'de kazanan belirlenimli) ──
  pktKur(PKT1, 390);
  pktKur(PKT2, 395);

  // ── 3. Motorun sürüm ağacı + PG sahnesi (sahte dünyanın biçimi) ──
  const h = cargoProva('prova_hazirla');
  sart('motor dünyasının sürüm ağacı + PG sahnesi (cargo test paket_prova::prova_hazirla)', h.kod === 0 && fs.existsSync(yol('motor', 'hazirlik.json')), kuyruk(h));
  const hz = json(yol('motor', 'hazirlik.json'));

  // ── 4. Zincir-yalnız paket (pkt-2099-1) ──
  const pk = yol('paket');
  fs.cpSync(yol('motor', 'paket-agaci'), pk, { recursive: true });
  const commit = '0123456789abcdef0123456789abcdef01234567';
  fs.writeFileSync(path.join(pk, 'dist', 'server-kunye.json'), `${JSON.stringify({ commit, zaman: '2026-10-01T00:00:00.000Z' })}\n`);
  const dosyaSayisi = fs.readdirSync(pk, { recursive: true }).filter((f) => fs.statSync(path.join(pk, f)).isFile()).length + 1;
  fs.writeFileSync(path.join(pk, 'PAKET.json'), `${JSON.stringify({ korumali: true, korumaHedef: 'win-x64', uygulamaSurumu: hz.surum, dosyaSayisi, commit, backendKanal: null, runtimeNodeSurumu: '24.18.0', migrationSayisi: hz.gocSayisi })}\n`);
  fs.mkdirSync(SURUM_D, { recursive: true });
  const zip1 = path.join(SURUM_D, `TeksERP-Backend-${hz.surum}.zip`);
  spawnSync('zip', ['-q', '-r', '-X', zip1, '.'], { cwd: pk });
  const zi = tsx(TEKS, ['scripts/build-korumali-imza.ts', 'zip', `--zip=${zip1}`, `--anahtar=${anahtar[PKT1].dosya}`, `--ci-atla=${CI_ATLA}`], `${P[PKT1]}\n`);
  const l1 = zipListesi(zip1);
  sart(`ortak paket ${hz.surum} zincir-yalnız imzalı (butunluk-zincir.jws var, butunluk.jws YOK)`, zi.kod === 0 && l1.includes('butunluk-zincir.jws') && !l1.includes('butunluk.jws'), kuyruk(zi));

  // ── 5. PG künyesi (pkt-2099-1) → pg-zincir.json ──
  const pgZip = path.join(PG_D, `postgresql-${PG_ETIKET}-tekserp.zip`);
  fs.mkdirSync(PG_D, { recursive: true });
  spawnSync('zip', ['-q', '-r', '-X', pgZip, '.'], { cwd: yol('motor', 'pg-sahne') });
  const pi = tsx(TEKS, ['scripts/backend-bildirim.ts', 'pg-imzala', `--zip=${pgZip}`, `--anahtar=${anahtar[PKT1].dosya}`, `--cikti=${yol('pg1')}`], `${P[PKT1]}\n`);
  const pgZincir = yol('pg1', 'pg-zincir.json');
  sart('PG künyesi zincir-yalnız: pg-zincir.json (kid\'siz ad, pkt-2099-1), pg.json YOK',
    pi.kod === 0 && fs.existsSync(pgZincir) && !fs.existsSync(yol('pg1', 'pg.json')) && belge(pgZincir).baslik.kid === PKT1, kuyruk(pi));
  kopyala(pgZincir, path.join(PG_D, 'pg-zincir.json'));

  // ── 6. Sürüm bildirimi (pkt-2099-1, PG hedefli) → surum-zincir.json ──
  const ozet = yol('ozet.txt');
  fs.writeFileSync(ozet, 'Prova sürümü\n');
  const bi = tsx(TEKS, ['scripts/backend-bildirim.ts', 'imzala', '--ortak', `--zip=${zip1}`, `--kanal=${GRUP}`, '--guven-capasi=uretim', '--pg-cizgi=16', '--pg-en-az=16.9',
    `--pg-kunye=${path.join(PG_D, 'pg-zincir.json')}`, `--ozet-dosyasi=${ozet}`, `--cikti=${yol('b1')}`, `--anahtar=${anahtar[PKT1].dosya}`], `${P[PKT1]}\n`);
  const ilk = yol('b1', 'surum-zincir.json');
  const by = fs.existsSync(ilk) ? belge(ilk).yuk : {};
  sart('sürüm bildirimi: surum-zincir.json (kid\'siz ad), imzalayan pkt-2099-1, PG hedefi künyeden, surum.json YOK',
    bi.kod === 0 && by.paketImzaKid === PKT1 && by.pg?.hedef?.surum === '16.15' && !fs.existsSync(yol('b1', 'surum.json')), kuyruk(bi));
  kopyala(ilk, path.join(SURUM_D, 'surum-zincir.json'));
  const yayindaOnce = Object.fromEntries([zip1, path.join(SURUM_D, 'surum-zincir.json'), path.join(PG_D, 'pg-zincir.json'), pgZip].map((f) => [f, sha(f)]));

  // ── 7. Yeniden imza (pkt-2099-2): dizin kipi, yanına yeni adlar ──
  const ri = tsx(TEKS, ['scripts/backend-bildirim.ts', 'yeniden-imzala', `--surum-dizini=${SURUM_D}`, `--anahtar=${anahtar[PKT2].dosya}`, `--kanal=${GRUP}`, `--cikti=${yol('r2')}`], `${P[PKT2]}\n`);
  const ikinci = yol('r2', `surum-zincir-${PKT2}.json`);
  const zip2Ad = `TeksERP-Backend-${hz.surum}-${PKT2}.zip`;
  const rs = fs.existsSync(yol('r2', 'sonuc.json')) ? json(yol('r2', 'sonuc.json')) : {};
  sart(`yeniden imza: surum-zincir-${PKT2}.json + ${zip2Ad}; girdi kid'siz surum-zincir.json, ${PKT1} → ${PKT2}`,
    ri.kod === 0 && fs.existsSync(ikinci) && fs.existsSync(yol('r2', zip2Ad)) && rs.girdi === 'surum-zincir.json' && rs.eskiKid === PKT1 && rs.yeniKid === PKT2 && belge(ikinci).yuk.paket?.ad === zip2Ad, kuyruk(ri));
  const pr = tsx(TEKS, ['scripts/backend-bildirim.ts', 'pg-yeniden-imzala', `--pg-dizini=${PG_D}`, `--anahtar=${anahtar[PKT2].dosya}`, `--cikti=${yol('p2')}`], `${P[PKT2]}\n`);
  const pgIkinci = yol('p2', `pg-zincir-${PKT2}.json`);
  sart(`PG yeniden imza: pg-zincir-${PKT2}.json (yük aynı, imzalayan ${PKT2})`,
    pr.kod === 0 && fs.existsSync(pgIkinci) && belge(pgIkinci).baslik.kid === PKT2 && JSON.stringify(belge(pgIkinci).yuk.paket) === JSON.stringify(belge(pgZincir).yuk.paket), kuyruk(pr));
  kopyala(ikinci, path.join(SURUM_D, path.basename(ikinci)));
  kopyala(yol('r2', zip2Ad), path.join(SURUM_D, zip2Ad));
  kopyala(pgIkinci, path.join(PG_D, path.basename(pgIkinci)));
  adim('yayındaki dosyalar EZİLMEDİ: yeni adlar yanına kondu, eski zip/bildirim/künye bayt-aynı',
    Object.entries(yayindaOnce).every(([f, s]) => sha(f) === s) && fs.readdirSync(SURUM_D).length === 4 && fs.readdirSync(PG_D).length === 3);

  // ── 8. Birincinin dağıtım iptali (kök) ──
  const iptalDosya = yol('iptal', 'paket-iptal.json');
  fs.mkdirSync(yol('iptal'), { recursive: true });
  const ip = tsx(SATICI, ['scripts/anahtar.ts', 'paket-iptal-uret', `--kok=${KOK_KID}`, `--kok-dizin=${yol('kok')}`, `--cikti=${iptalDosya}`, `--iptal=${anahtar[PKT1].sert}`, '--neden=prova birinci sertifika emekli'], `${P.kok}\n`);
  const iptalJws = yol('iptal', 'paket-iptal.jws');
  if (ip.kod === 0 && fs.existsSync(iptalDosya)) fs.writeFileSync(iptalJws, `${json(iptalDosya).belge}\n`);
  sart(`dağıtım iptali (paket-iptal-uret, kök imzalı): ${PKT1}`, fs.existsSync(iptalJws), kuyruk(ip));

  // ── 9. Tören girdisi (YERLEŞİK + iptal): iptalli kid'siz elenir, seçim ikinciye geçer ──
  const ti = tsx(TEKS, ['scripts/backend-bildirim.ts', 'yeniden-imzala', `--surum-dizini=${SURUM_D}`, `--anahtar=${anahtar[PKT2].dosya}`, `--kanal=${GRUP}`, `--paket-iptal=${iptalDosya}`, `--cikti=${yol('r3')}`], `${P[PKT2]}\n`);
  adim(`tören girdisi iptalle: surum-zincir.json (${PKT1}) ELENİR, seçilen ${PKT2}'nin bildirimi ("zaten ${PKT2} ile imzalı" → yazma yok)`,
    ti.kod !== 0 && /elendi surum-zincir\.json: PAKET_SERTIFIKA_IPTAL/.test(ti.hata) && new RegExp(`zaten ${PKT2} ile imzalı`).test(ti.hata) && !fs.existsSync(yol('r3', 'sonuc.json')), kuyruk(ti));

  // ── 10. Güncelleyici motoru (Rust) — provanın dosyalarıyla ──
  const ilkYayin = {
    [`/${GRUP}/backend/son-zincir.json`]: ilk,
    [`${URL_S}/surum-zincir.json`]: path.join(SURUM_D, 'surum-zincir.json'),
    [`${URL_S}/${path.basename(zip1)}`]: zip1,
    [`${URL_PG}/pg-zincir.json`]: path.join(PG_D, 'pg-zincir.json'),
    [`${URL_PG}/${path.basename(pgZip)}`]: pgZip,
  };
  const yanina = {
    ...ilkYayin,
    [`${URL_S}/${path.basename(ikinci)}`]: path.join(SURUM_D, path.basename(ikinci)),
    [`${URL_S}/${zip2Ad}`]: path.join(SURUM_D, zip2Ad),
    [`${URL_PG}/${path.basename(pgIkinci)}`]: path.join(PG_D, path.basename(pgIkinci)),
  };
  const sonDegisti = { ...yanina, [`/${GRUP}/backend/son-zincir.json`]: ikinci };
  const S = (ad, dosyalar, hedef, iptal, beklenen) => ({ ad, dosyalar, hedef, iptal: iptal ? iptalJws : null, beklenen });
  const kurulur = (kid, ...secim) => ({ durum: 'Succeeded', surum: hz.surum, pg: PG_ETIKET, kurulanKid: kid, secim });
  const takilir = { durum: '!Succeeded', kod: 'PAKET_SERTIFIKA_IPTAL', surum: hz.kurulu, pg: '16.9-1', kurulanKid: null };
  const secS = `${URL_S}/surum-zincir-${PKT2}.json seçildi; elenen: surum-zincir.json (PAKET_SERTIFIKA_IPTAL)`;
  const secPg = `${URL_PG}/pg-zincir-${PKT2}.json seçildi; elenen: pg-zincir.json (PAKET_SERTIFIKA_IPTAL)`;
  const senaryolar = [
    S(`ilk yayın, sabitsiz: son-zincir.json (${PKT1}) → backend + PG kid'siz künyeyle kurulur`, ilkYayin, null, false, kurulur(PKT1)),
    S('eski ad: sabitli hedefte yalnız kid\'siz surum-zincir.json → okunur, kurulur', ilkYayin, hz.surum, false, kurulur(PKT1)),
    S(`çift kid, iptal yok, sabitli: en geç bitişli ${PKT2} seçilir`, sonDegisti, hz.surum, false, kurulur(PKT2)),
    S(`${PKT1} iptal, sabitli: kid'siz elenir, seçim ${PKT2}'ye geçer (sürüm + PG)`, sonDegisti, hz.surum, true, kurulur(PKT2, `sürüm bildirimi: ${secS}`, `PG künyesi: ${secPg}`)),
    S(`${PKT1} iptal, sabitsiz, son-zincir.json yeniden imzalıyla DEĞİŞTİ: kurulur, PG kid'li künyeden`, sonDegisti, null, true, kurulur(PKT2, `PG künyesi: ${secPg}`)),
    S(`${PKT1} iptal, sabitsiz, son-zincir.json DEĞİŞMEDİ: kanal TAKILIR (PAKET_SERTIFIKA_IPTAL, kurulu sürüm/PG yerinde)`, yanina, null, true, takilir),
    S(`${PKT1} iptal, sabitli, son-zincir.json DEĞİŞMEDİ: kid'li ad bilinmez, TAKILIR`, yanina, hz.surum, true, takilir),
  ];
  fs.writeFileSync(yol('motor', 'senaryolar.json'), `${JSON.stringify({ kanal: GRUP, kokler: json(yol('kok-capa.json')), senaryolar }, null, 2)}\n`);
  const m = cargoProva('prova_motor');
  sart('motor koşumu (cargo test paket_prova::prova_motor)', m.kod === 0 && fs.existsSync(yol('motor', 'motor-sonuc.json')), kuyruk(m));
  const sonuc = json(yol('motor', 'motor-sonuc.json')).senaryolar;
  senaryolar.forEach((s, i) => {
    const r = sonuc[i] ?? {};
    const b = s.beklenen;
    const durumOk = b.durum.startsWith('!') ? r.durum !== b.durum.slice(1) : r.durum === b.durum;
    const secimOk = (b.secim ?? []).every((satir) => (r.secim ?? []).includes(satir));
    const ok = r.ad === s.ad && durumOk && (b.kod === undefined || r.kod === b.kod) && r.surum === b.surum && r.pg === b.pg && r.kurulanKid === b.kurulanKid && secimOk;
    adim(`motor: ${s.ad}`, ok, `durum ${r.durum} kod ${r.kod} sürüm ${r.surum} pg ${r.pg} kid ${r.kurulanKid} seçim ${JSON.stringify(r.secim)} — ${String(r.mesaj ?? '').slice(0, 200)}`);
  });
}

let kod = 0;
try {
  prova();
  kod = kaldi === 0 ? 0 : 1;
} catch (e) {
  if (e instanceof Durdu) {
    console.log(`         → prova bu adımda durdu; sonraki adımlar koşulmadı`);
    kod = 1;
  } else {
    console.error(`PROVA KURULAMADI: ${temiz(e?.stack ?? e)}`);
    kod = 2;
  }
} finally {
  console.log(`\n=== Prova: ${gecti} GEÇTİ, ${kaldi} KALDI ===${BIRAK ? `\n    geçici dizin: ${T}` : ''}`);
  if (!BIRAK) fs.rmSync(T, { recursive: true, force: true });
}
process.exit(kod);
