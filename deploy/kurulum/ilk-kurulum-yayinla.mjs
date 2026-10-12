#!/usr/bin/env node
// =============================================================================
// İLK KURULUM DEPOSU — grubun ortak kurulum arşivini (setup + backend + PG + panel) satıcı deposunda yeniler
// =============================================================================
// Portal ilk kurulum bağlantısı satıcının derleme deposundaki BİR arşive bağlanır; arşivin adı grubu taşır
// (`TeksERP-Kurulum-<grup>-<sürüm>.zip`) ve portal listede "Test grubu · yalnız deneme kurulumu" / "Onaylı · <grup>"
// diye gösterir. Kural:
//   · kök grup (test, `terfiKaynagi` yok): grubun Windows yayınıyla OTOMATİK yenilenir — yalnız deneme kurulumları için.
//   · terfi alan grup (oncu/genel): `terfi/<grup>/backend-v<s>` AÇIKLAMALI etiketi `backend-v<s>` commit'inde olmalı
//     (kullanıcının terfi onayı); yoksa DUR — müşteri paketi yalnız terfiyle güncellenir.
// Adımlar: grup (dağıtım kaydı) → backend sürümü (PAKET.json) → terfi kapısı → grupta yayındaki Windows backend
//   sürümü = arşivin sürümü (VDS, salt okuma) → grubun paneli (latest.yml + exe, güncelleme sunucusundan salt okuma)
//   → `kurulum-arsivi.mjs` (bütün imza/künye kapıları orada) → `derleme-koy.mjs --yenile` (aynı grubun eskisi
//   arşivlenip kalkar; AKTİF bağlantılı eski korunur). `--uygula` yoksa derleme-koy KURU koşar (depoya yazma yok).
// `deploy/backend-yayinla.mjs` Windows yayınının sonunda bunu `--uygula` ile çağırır (girdiler verildiyse).
//
//   node deploy/kurulum/ilk-kurulum-yayinla.mjs --grup <test|oncu|genel> --backend <imzalı tekserp-backend-*.zip>
//        --setup <TeksERP-Kurulum-<sürüm>.exe> --pg <postgresql-*.zip> --pg-kunye <pg.json> [--tkpub <etkili.tkpub>]
//        [--cikti <dizin>] [--uygula]
// Çıkış: 0 tamam · 1 kapı (DUR) · 2 kullanım / ÖLÇÜLEMEDİ · alt aracın kodu (kurulum-arsivi / derleme-koy).
// Bekçi: scripts/test_ilk_kurulum_yayinla.mjs
// =============================================================================

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GrupIhlali, grupCoz, grupHedefi, kaynakGrupSurumleri } from '../../scripts/lib/grup-yayin.mjs';
import { Olculemedi as DagitimOlculemedi } from '../../scripts/lib/dagitim.mjs';
import { gitOlgulari } from '../../scripts/lib/terfi.mjs';
import { etiketAdi, terfiEtiketAdi } from '../../scripts/lib/surum.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEGERLI = ['--grup', '--backend', '--setup', '--pg', '--pg-kunye', '--tkpub', '--cikti'];
const ZORUNLU = ['--grup', '--backend', '--setup', '--pg', '--pg-kunye'];
const KULLANIM = 'Kullanım: --grup <grup> --backend <zip> --setup <TeksERP-Kurulum-<sürüm>.exe> --pg <zip> --pg-kunye <pg.json> [--tkpub <dosya>] [--cikti <dizin>] [--uygula]';
const SURUM_DESENI = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const PANEL_ADI = /^TeksERP-[0-9][0-9A-Za-z.-]*-Setup\.exe$/;
const YOK_KODU = 44;

export class Dur extends Error {
  constructor(kod, mesaj, satirlar = []) {
    super(mesaj);
    this.kod = kod;
    this.satirlar = satirlar;
  }
}

export function argAyristir(argv) {
  const a = { uygula: false };
  const hatalar = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--uygula') { a.uygula = true; continue; }
    if (!DEGERLI.includes(x)) { hatalar.push(`tanınmayan argüman: ${x}`); continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { hatalar.push(`${x} değer ister`); continue; }
    if (a[x.slice(2)] !== undefined) hatalar.push(`${x} birden çok kez verildi`);
    a[x.slice(2)] = v;
    i++;
  }
  for (const z of ZORUNLU) if (a[z.slice(2)] === undefined) hatalar.push(`${z} gerekli`);
  return { a, hatalar };
}

/** Grup çözümü: biçim · eski kanal kodu değil · dağıtım kaydında. Kaynak grup (terfiKaynagi) döner. */
export function grupKarari(grup, secenek = {}) {
  try {
    return grupCoz(grup, secenek);
  } catch (e) {
    if (e instanceof GrupIhlali) throw new Dur(2, e.message, e.satirlar ?? []);
    if (e instanceof DagitimOlculemedi) throw new Dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
    throw e;
  }
}

/**
 * Terfi kapısı — saf. Kök grup otomatik; terfi alan grup `terfi/<grup>/backend-v<s>` AÇIKLAMALI etiketini
 * `backend-v<s>` commit'inde ister (onaylanan kod = arşivdeki paketin kodu).
 */
export function terfiKarari({ grup, kaynak, surum, git }) {
  if (kaynak === null) return { ok: true, satir: `grup "${grup}" kök grup — terfi istemez; arşiv yalnız deneme/test kurulumları içindir` };
  const t = terfiEtiketAdi(grup, 'backend', surum);
  const e = etiketAdi('backend', surum);
  if (!git?.terfiEtiketi) return { ok: false, neden: `${t} etiketi YOK — "${grup}" grubunun (müşteri) paketi yalnız terfiyle güncellenir; terfi onayı yokken arşiv yenilenmez` };
  if (git.terfiEtiketi.tur !== 'tag') return { ok: false, neden: `${t} AÇIKLAMALI değil (tür ${git.terfiEtiketi.tur}) — onay cümlesi taşımayan etiket terfi sayılmaz` };
  if (!git.surumEtiketi) return { ok: false, neden: `${e} etiketi yok — terfi edilen kod ölçülemiyor` };
  if (git.terfiEtiketi.commit !== git.surumEtiketi) return { ok: false, neden: `${t} (${git.terfiEtiketi.commit.slice(0, 12)}) ${e} commit'inde (${git.surumEtiketi.slice(0, 12)}) değil` };
  return { ok: true, satir: `✓ ${t} → ${e} (${git.surumEtiketi.slice(0, 12)}) — onaylı` };
}

/** Sunucu kurulumunun adı paketin sürümünü taşımalı (setup kendi güncelleyicisini taşır; aynı derleme). */
export function setupAdiHatasi(setupAd, surum) {
  return setupAd === `TeksERP-Kurulum-${surum}.exe` ? null : `sunucu kurulumu "${setupAd}" — paket ${surum} için TeksERP-Kurulum-${surum}.exe beklenir (deploy/korumali-thinkpad.sh üretir)`;
}

/** latest.yml'den panel kurulumunun adı (yalnız güvenli tek bileşen). */
export function latestYmlPaneli(metin) {
  const yol = /^path:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(String(metin ?? ''))?.[1] ?? null;
  return yol && PANEL_ADI.test(yol) ? yol : null;
}

function paketSurumu(zip) {
  let pj;
  try {
    pj = JSON.parse(execFileSync('unzip', ['-p', zip, 'PAKET.json'], { maxBuffer: 1 << 24 }).toString('utf8'));
  } catch (e) {
    throw new Dur(1, `backend zip kökünde PAKET.json okunamadı: ${zip}`, [String(e.message ?? e).split('\n')[0]]);
  }
  const v = String(pj.uygulamaSurumu ?? '');
  if (!SURUM_DESENI.test(v) || pj.prova === true) throw new Dur(1, `backend paketi yayın sürümü değil: "${v}"${pj.prova === true ? ' (PROVA)' : ''} — ilk kurulum deposuna yalnız yayınlanan sürüm girer`);
  return v;
}

function sshOku(hedef, dosya) {
  const r = spawnSync('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', hedef, 'bash', '-s', '--', dosya], {
    input: `test -f "$1" || exit ${YOK_KODU}\ncat -- "$1"\n`, encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 22,
  });
  if (r.status === YOK_KODU) return { durum: 'yok' };
  if (r.status === 0) return { durum: 'var', metin: r.stdout };
  return { durum: 'olculemedi', neden: `${hedef}:${dosya} okunamadı (ssh çıkış ${r.status ?? r.error?.code ?? '?'})` };
}

function grupPaneli(grup, dizin) {
  const h = grupHedefi(grup, 'panel');
  const k = sshOku(h.ssh, `${h.vds}/latest.yml`);
  if (k.durum === 'yok') throw new Dur(1, `"${grup}" grubunda panel yayında değil (${h.vds}/latest.yml yok) — arşiv grubun panelini taşır`);
  if (k.durum !== 'var') throw new Dur(2, `ÖLÇÜLEMEDİ — ${k.neden}`);
  const ad = latestYmlPaneli(k.metin);
  if (!ad) throw new Dur(1, `"${grup}" grubunun latest.yml'i panel kurulumu göstermiyor (path:) — elle incele`);
  fs.writeFileSync(path.join(dizin, 'latest.yml'), k.metin);
  const r = spawnSync('scp', ['-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `${h.ssh}:${h.vds}/${ad}`, path.join(dizin, ad)], { encoding: 'utf8', timeout: 900_000 });
  if (r.status !== 0) throw new Dur(2, `ÖLÇÜLEMEDİ — panel indirilemedi: ${h.ssh}:${h.vds}/${ad} (scp çıkış ${r.status ?? r.error?.code ?? '?'})`);
  return { exe: path.join(dizin, ad), kunye: path.join(dizin, 'latest.yml'), ad };
}

function yayindakiBackend(grup, surum) {
  const s = kaynakGrupSurumleri(grup, 'backend');
  const olc = s.filter((x) => x.durum === 'olculemedi');
  if (s.some((x) => x.durum === 'var' && x.surum === surum)) return;
  if (olc.length) throw new Dur(2, `ÖLÇÜLEMEDİ — "${grup}" grubunda yayındaki Windows backend okunamadı`, olc.map((x) => x.neden));
  const var_ = s.filter((x) => x.durum === 'var').map((x) => `${x.ne} ${x.surum}`);
  throw new Dur(1, `"${grup}" grubunda yayındaki Windows backend ${var_.join(', ') || 'YOK'} — arşiv yalnız grubun yayındaki sürümünü (${surum}) taşır`);
}

function kos(betik, args) {
  const r = spawnSync(process.execPath, [path.join(KOK, betik), ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Dur(r.status ?? 1, `${betik} çıkış ${r.status ?? r.signal}`);
}

async function main() {
  const { a, hatalar } = argAyristir(process.argv.slice(2));
  if (hatalar.length) throw new Dur(2, KULLANIM, hatalar);
  const { kaynak } = grupKarari(a.grup);
  for (const k of ['backend', 'setup', 'pg', 'pg-kunye', 'tkpub']) {
    if (a[k] !== undefined && !fs.statSync(a[k], { throwIfNoEntry: false })?.isFile()) throw new Dur(2, `--${k} dosyası yok: ${a[k]}`);
  }
  const surum = paketSurumu(a.backend);
  const sh = setupAdiHatasi(path.basename(a.setup), surum);
  if (sh) throw new Dur(1, sh);
  console.log(`== İlk kurulum deposu: grup ${a.grup} · backend ${surum}${a.uygula ? ' — UYGULA' : ' — KURU (depoya yazma yok)'} ==`);

  let git = null;
  if (kaynak !== null) {
    try {
      git = gitOlgulari({ kod: a.grup, urun: 'backend', surum });
    } catch (e) {
      throw new Dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
    }
  }
  const t = terfiKarari({ grup: a.grup, kaynak, surum, git });
  if (!t.ok) throw new Dur(1, `TERFİ YOK — ${t.neden}`, ['Portal bu grup için "onaylı paket yok" der ya da önceki onaylı paketi gösterir.']);
  console.log(`  terfi          : ${t.satir}`);

  yayindakiBackend(a.grup, surum);
  console.log(`  yayında        : "${a.grup}" grubunda Windows backend ${surum}`);
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'ilk-kurulum-panel-'));
  try {
    const panel = grupPaneli(a.grup, gecici);
    console.log(`  panel          : ${panel.ad} (grup ${a.grup}, güncelleme sunucusundan)`);
    const kokDizin = path.join(os.homedir(), '.tekserp', 'ilk-kurulum');
    fs.mkdirSync(kokDizin, { recursive: true });
    const cikti = a.cikti ?? fs.mkdtempSync(path.join(kokDizin, `${a.grup}-${surum}-`));
    fs.mkdirSync(cikti, { recursive: true });
    kos('deploy/kurulum/kurulum-arsivi.mjs', ['--setup', a.setup, '--backend', a.backend, '--pg', a.pg, '--pg-kunye', a['pg-kunye'],
      '--panel', panel.exe, '--panel-kunye', panel.kunye, ...(a.tkpub ? ['--tkpub', a.tkpub] : []), '--cikti', cikti]);
    const arsiv = path.join(cikti, `TeksERP-Kurulum-${a.grup}-${surum}.zip`);
    if (!fs.existsSync(arsiv)) throw new Dur(1, `kurulum-arsivi beklenen arşivi bırakmadı: ${arsiv}`);
    kos('deploy/satici/derleme-koy.mjs', ['--ortam', 'uretim', '--dosya', arsiv, '--yenile', ...(a.uygula ? ['--uygula'] : [])]);
    console.log(`SONUC: ${a.uygula ? 'DEPO-GUNCEL' : 'KURU'} · ${path.basename(arsiv)}`);
  } finally {
    fs.rmSync(gecici, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    if (e instanceof Dur) {
      console.error(`✖ ${e.message}`);
      for (const s of e.satirlar) console.error(`  - ${s}`);
      process.exit(e.kod);
    }
    console.error(e);
    process.exit(1);
  });
}
