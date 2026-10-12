#!/usr/bin/env node
// =============================================================================
// DERLEME KOY — ilk kurulum dosyasını satıcının `derlemeler/` deposuna koyar (portal "Bağlantı ver" oradan okur)
// =============================================================================
// Depo satıcı konteynerine SALT OKUNUR bağlıdır (`/derlemeler:ro`, compose); dizin root 0755 (`vds/uretim-hazirla.sh`),
// oguzhan'ın sudo'su etkileşimsiz parola ister → yazım yardımcı konteynerle (SATICI-KURULUM.md §13.4 kalıbı).
//   KURU (varsayılan): yerel denetim (dosya · sha256 · satıcının ad kuralı · yanındaki .sha256) + VDS'te YALNIZ OKUMA
//     (tek ssh, `lisans-devreye/lib/ag.mjs` salt-okuma sözleşmesinden geçer): satıcının gerçekten okuduğu bağ,
//     yardımcı imaj, dizin sahibi/izni, aynı adlı dosya, disk boşluğu → `--uygula`nın koşacağı komutların TAM listesi.
//   --uygula: aynı ölçüm → vds-dogrula (önce, AYNI olmalı) → ~/derleme-koy-<damga> → scp → sha256sum -c →
//     yardımcı konteynerde `install -m 0644 -o <dizin sahibi>` gizli ada + `ln` (var olanı EZMEZ, atomik yayın) →
//     özet ölçümü → geçici dizin silinir → yeniden ölçüm (satıcı konteyneri görüyor mu) → vds-dogrula (sonra, öncekiyle AYNI).
// Aynı adlı dosya: içerik AYNIYSA dokunulmaz (iş yok), FARKLIYSA DUR — hiçbir dosya yazılmaz, üstüne yazılmaz.
// KALDIRMA (`--kaldir <ad>` · `--yenile`): dosya yalnız AKTİF (süresi dolmamış, IPTAL olmayan) indirme bağlantısı ona
//   işaret etmiyorsa (satıcı DB'si, salt okuma; uygulamada yeniden ölçülür) ve önce Mac arşivine (`--arsiv`, varsayılan
//   ~/.tekserp/arsiv/derlemeler) uzaktakiyle sha256-EŞİT indirildikten sonra yardımcı konteynerde `sha256sum -c` + `rm`
//   ile kalkar. `--kaldir`da aktif bağlantı DUR'dur; `--yenile` (yeni arşivi koy + depodaki AYNI GRUPTAKİ öteki
//   TeksERP-Kurulum-<grup>-*.zip'leri arşivle-kaldır; test yayını onaylı paketi ASLA kaldırmaz) aktif bağlantılı eskiyi
//   KORUR ve raporlar (bağlantı donmuş sha'yla iner, dosya kalkarsa 410 olur).
//
//   node deploy/satici/derleme-koy.mjs --ortam uretim --dosya <yerel> [--dosya <yerel> …] [--yenile] [--arsiv <dizin>] [--uygula]
//   node deploy/satici/derleme-koy.mjs --ortam uretim --kaldir <ad> [--kaldir <ad> …] [--arsiv <dizin>] [--uygula]
//
// ÇIKIŞ: 0 tamam (KURU: denetim temiz + plan · UYGULA: yazıldı ve ölçüldü) · 1 DUR · 2 ÖLÇÜLEMEDİ / kullanım.
// Belge: docs/ops/SATICI-KURULUM.md §14 · bekçi: node scripts/test_derleme_koy.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ag, SozlesmeIhlali, VDS } from '../lisans-devreye/lib/ag.mjs';
import { Olculemedi as DepoOlculemedi, arsivGrubu, derlemeAdiHatasi, derlemeAdiKurali } from '../../scripts/lib/derleme-deposu.mjs';
import { KAYIT_REL as DAGITIM_REL, kayitAyristir } from '../../scripts/lib/dagitim.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VDS_DOGRULA = path.join(KOK, 'deploy', 'vds-dogrula.sh');
// Yerleşim: SATICI-KURULUM.md §13 (`K=`) + ornek*.env DERLEME_DIZINI_HOST; gerçek bağ her koşumda ölçülür.
export const ORTAMLAR = Object.freeze({
  uretim: Object.freeze({ kok: '/opt/stack/apps/tekserp-satici-uretim', satici: 'tekserp-satici-uretim', yedek: 'tekserp-satici-uretim-yedek', db: 'tekserp-satici-uretim-db' }),
});
const PAY = 256 * 1024 * 1024;
const KULLANIM = 'Kullanım: --ortam uretim (--dosya <yerel> [--dosya …] [--yenile] | --kaldir <ad> [--kaldir …]) [--arsiv <dizin>] [--uygula]';
/**
 * `--yenile`nin eski sayıp arşivleyeceği adlar: yalnız yeni arşivlerin GRUBUNDAKİ ortak kurulum arşivleri (başka grup,
 * başka tür ve grupsuz dosyaya dokunulmaz). Yeni arşiv grup adlı değilse ya da grup dağıtım kaydında yoksa DUR.
 */
export function yenileAdaylari(adlar, yeniAdlar, kural = derlemeAdiKurali(), gruplar = dagitimGruplari()) {
  const yeniGruplar = new Set();
  for (const ad of yeniAdlar) {
    const g = arsivGrubu(ad, kural);
    if (g === null || !gruplar.includes(g)) throw new Dur(1, `--yenile yalnız grup adlı ortak arşivle (TeksERP-Kurulum-<${gruplar.join('|')}>-<sürüm>.zip): "${ad}"`);
    yeniGruplar.add(g);
  }
  return [...adlar].filter((ad) => !yeniAdlar.has(ad) && yeniGruplar.has(arsivGrubu(ad, kural))).sort();
}

function dagitimGruplari() {
  try {
    return (kayitAyristir(fs.readFileSync(path.join(KOK, DAGITIM_REL), 'utf8')).gruplar ?? []).map((g) => g.kod);
  } catch (e) {
    throw new Dur(2, `ÖLÇÜLEMEDİ — dağıtım kaydı (${DAGITIM_REL}): ${e.message}`);
  }
}
export const ARSIV_DIZINI_VARSAYILAN = path.join(os.homedir(), '.tekserp', 'arsiv', 'derlemeler');

// Konteyner içinde root olarak koşar (yalnız /g:ro ve /k bağlı): gizli ada yaz, `ln` ile yayınla — hedef varsa ln
// düşer, hiçbir dosya ezilmez; portal noktayla başlayan adı listelemez (BUILD_NAME).
export const IC_BETIK = `set -eu
U="$1"; G="$2"; shift 2
for f in "$@"; do
  case "$f" in ''|.*|*/*) echo "ad gecersiz: $f" >&2; exit 2;; esac
  [ ! -e "/k/$f" ] || { echo "VAR (ezilmez): $f" >&2; exit 3; }
done
for f in "$@"; do
  install -m 0644 -o "$U" -g "$G" "/g/$f" "/k/.yarim-$f"
  ln "/k/.yarim-$f" "/k/$f" || { rm -f "/k/.yarim-$f"; echo "VAR (ezilmez): $f" >&2; exit 3; }
  rm "/k/.yarim-$f"
done
cd /k && sha256sum "$@"
`;

class Dur extends Error {
  constructor(kod, mesaj, satirlar = []) {
    super(mesaj);
    this.kod = kod;
    this.satirlar = satirlar;
  }
}

// ---------------------------------------------------------------- argümanlar
export function argAyristir(argv) {
  const a = { dosyalar: [], kaldir: [], uygula: false, yenile: false, ortam: null, arsiv: null };
  const hatalar = [];
  for (let i = 0; i < argv.length; i += 1) {
    const x = argv[i];
    const esit = x.indexOf('=');
    const ad = esit > 0 ? x.slice(0, esit) : x;
    if (ad === '--uygula' && esit < 0) { a.uygula = true; continue; }
    if (ad === '--yenile' && esit < 0) { a.yenile = true; continue; }
    if (!['--ortam', '--dosya', '--kaldir', '--arsiv'].includes(ad)) { hatalar.push(`bilinmeyen argüman: ${x}`); continue; }
    const v = esit > 0 ? x.slice(esit + 1) : argv[(i += 1)];
    if (v === undefined || v === '' || v.startsWith('--')) { hatalar.push(`${ad} bir değer ister`); continue; }
    if (ad === '--dosya') a.dosyalar.push(v);
    else if (ad === '--kaldir') a.kaldir.push(v);
    else if (ad === '--arsiv') { if (a.arsiv !== null) hatalar.push('--arsiv TEK verilir'); else a.arsiv = v; }
    else if (a.ortam !== null) hatalar.push('--ortam TEK verilir');
    else a.ortam = v;
  }
  if (!a.ortam) hatalar.push('--ortam gerekli');
  else if (!Object.hasOwn(ORTAMLAR, a.ortam)) hatalar.push(`--ortam uretim (gelen: ${a.ortam})`);
  if (!a.dosyalar.length && !a.kaldir.length) hatalar.push('en az bir --dosya ya da --kaldir gerekli');
  if (a.yenile && !a.dosyalar.length) hatalar.push('--yenile yeni arşivi (--dosya) ister');
  if (a.yenile && a.kaldir.length) hatalar.push('--yenile ile --kaldir birlikte verilmez (yenile eskileri kendisi seçer)');
  if (a.kaldir.length && a.dosyalar.length) hatalar.push('--kaldir ile --dosya birlikte verilmez (yeni + eski birlikte: --yenile)');
  if (new Set(a.kaldir).size !== a.kaldir.length) hatalar.push('aynı --kaldir adı iki kez');
  a.arsiv = path.resolve(a.arsiv ?? ARSIV_DIZINI_VARSAYILAN);
  return { a, hatalar };
}

// ---------------------------------------------------------------- yerel denetim
function akisOzeti(yol) {
  const h = createHash('sha256');
  const fd = fs.openSync(yol, 'r');
  const tampon = Buffer.alloc(4 * 1024 * 1024);
  let boyut = 0;
  try {
    for (let n; (n = fs.readSync(fd, tampon, 0, tampon.length, null)) > 0;) {
      h.update(tampon.subarray(0, n));
      boyut += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { sha256: h.digest('hex'), boyut };
}

export function yerelDenetim(ortam, yollar) {
  let kural;
  try {
    kural = derlemeAdiKurali();
  } catch (e) {
    if (e instanceof DepoOlculemedi) throw new Dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
    throw e;
  }
  const hatalar = [];
  const dosyalar = [];
  const adlar = new Set();
  for (const ham of yollar) {
    const yol = path.resolve(ham);
    const ad = path.basename(yol);
    const st = fs.statSync(yol, { throwIfNoEntry: false });
    if (!st || !st.isFile() || st.size === 0) { hatalar.push(`dosya yok / düzenli değil / boş: ${yol}`); continue; }
    const h = derlemeAdiHatasi(ad, kural);
    if (h) { hatalar.push(`${h} — portal bu dosyayı LİSTELEMEZ`); continue; }
    if (adlar.has(ad)) { hatalar.push(`aynı ad iki kez: ${ad}`); continue; }
    adlar.add(ad);
    if (ortam === 'uretim' && /prova/i.test(ad)) { hatalar.push(`PROVA yapıtı üretim satıcısına konmaz: ${ad}`); continue; }
    const o = akisOzeti(yol);
    const yan = `${yol}.sha256`;
    if (fs.existsSync(yan)) {
      const m = /^([0-9a-f]{64}) {2}(\S+)\s*$/.exec(fs.readFileSync(yan, 'utf8'));
      if (!m || m[2] !== ad || m[1] !== o.sha256) { hatalar.push(`${ad}: yanındaki ${path.basename(yan)} dosyayla TUTMUYOR (bozuk/yarım kopya)`); continue; }
    }
    dosyalar.push({ yol, ad, ...o, yanOzet: fs.existsSync(yan) });
  }
  if (hatalar.length) throw new Dur(1, `YEREL DENETİM (${hatalar.length})`, hatalar);
  return dosyalar;
}

// ---------------------------------------------------------------- VDS ölçümü (salt okuma, ag.mjs sözleşmesi)
/** Derleme adına göre AKTİF (IPTAL değil, süresi dolmamış) indirme bağlantısı sayısı — salt okuma (`ag.mjs`). */
export function baglantiSorgusu(ortam) {
  return `docker exec ${ORTAMLAR[ortam].db} psql -U satici -d satici -At -c "SELECT \\"derlemeAdi\\", count(*) FROM indirme_baglantisi WHERE durum = 'AKTIF' AND now() < bitis AND \\"derlemeAdi\\" IS NOT NULL GROUP BY 1"`;
}

export function olcumKomutu(ortam) {
  const o = ORTAMLAR[ortam];
  const D = `${o.kok}/derlemeler`;
  return [
    'echo @@BAG', `docker inspect ${o.satici} --format '{{range .Mounts}}{{if eq .Destination "/derlemeler"}}{{.Source}} {{.RW}}{{end}}{{end}}'`,
    'echo @@YARDIMCI', `docker inspect ${o.yedek} --format '{{.Config.Image}}'`,
    'echo @@IMAJLAR', "docker images --format '{{.Repository}}:{{.Tag}}'",
    'echo @@DIZIN', `stat -c '%u:%g %a' ${D}`,
    'echo @@LS', `ls -lna ${D}`,
    'echo @@DF', `df -Pk ${D} $HOME`,
    'echo @@KAP', `docker exec ${o.satici} ls -la /derlemeler`,
    'echo @@BAGLANTI', baglantiSorgusu(ortam),
    'echo @@SON',
  ].join('; ');
}

function bolumler(cikti) {
  const b = {};
  let ad = null;
  for (const s of cikti.split('\n')) {
    const m = /^@@([A-Z]+)$/.exec(s.trim());
    if (m) { ad = m[1]; b[ad] = []; continue; }
    if (ad && s.trim()) b[ad].push(s.replace(/\s+$/, ''));
  }
  return b;
}

/** `ls -lna` satırları → ad → {boyut, mod, uid, gid} (ad boşluk taşımaz: satıcının ad kuralı). */
function lsCoz(satirlar) {
  const r = new Map();
  for (const s of satirlar) {
    const p = s.split(/\s+/);
    if (p.length < 9 || !/^[-dl]/.test(p[0])) continue;
    const ad = p.slice(8).join(' ');
    if (ad === '.' || ad === '..') continue;
    r.set(ad, { mod: p[0], uid: p[2], gid: p[3], boyut: Number(p[4]) });
  }
  return r;
}

export function olcumuCoz(ortam, cikti) {
  const o = ORTAMLAR[ortam];
  const D = `${o.kok}/derlemeler`;
  const b = bolumler(cikti);
  if (!b.SON) throw new Dur(2, 'ÖLÇÜLEMEDİ — VDS ölçümü yarım döndü (@@SON yok)');
  const bag = (b.BAG ?? [])[0] ?? '';
  const yardimci = ((b.YARDIMCI ?? [])[0] ?? '').trim();
  const imajlar = new Set((b.IMAJLAR ?? []).map((s) => s.trim()));
  const dz = /^(\d+):(\d+) ([0-7]{3,4})$/.exec(((b.DIZIN ?? [])[0] ?? '').trim());
  const df = (b.DF ?? []).slice(1).map((s) => s.split(/\s+/)).filter((p) => p.length >= 6).map((p) => ({ bos: Number(p[3]) * 1024, nokta: p[5] }));
  let baglanti = null;
  if (b.BAGLANTI) {
    baglanti = new Map();
    for (const s of b.BAGLANTI) {
      const m = /^([^|]+)\|(\d+)$/.exec(s.trim());
      if (!m) { baglanti = null; break; }
      baglanti.set(m[1], Number(m[2]));
    }
  }
  return { D, bag: bag.trim(), yardimci, imajVar: imajlar.has(yardimci), dizin: dz ? { uid: dz[1], gid: dz[2], mod: dz[3] } : null, ls: lsCoz(b.LS ?? []), df, kap: lsCoz(b.KAP ?? []), baglanti };
}

function vdsOku(ag, komut) {
  let r;
  try {
    r = ag.ssh(komut);
  } catch (e) {
    if (e instanceof SozlesmeIhlali) throw new Dur(2, `SÖZLEŞME — uzak komut salt-okuma değil, gönderilmedi: ${e.message}`);
    throw e;
  }
  if (r.kod !== 0) throw new Dur(2, `ÖLÇÜLEMEDİ — ssh ${VDS.hedef} -p ${VDS.port} çıkış ${r.kod}: ${(r.hata || '').trim().split('\n').slice(-2).join(' · ')}`);
  return r.cikti;
}

/** Ölçümü kararlara çevirir: hangi dosya yazılacak, hangisi zaten yerinde; engel varsa DUR. */
export function karar(ortam, olcum, dosyalar, uzakOzet, { kaldir = [], yenile = false, arsiv = ARSIV_DIZINI_VARSAYILAN } = {}) {
  const hatalar = [];
  if (!olcum.bag) throw new Dur(2, `ÖLÇÜLEMEDİ — ${ORTAMLAR[ortam].satici} konteynerinde /derlemeler bağı okunamadı (konteyner yok mu?)`);
  if (olcum.bag !== `${olcum.D} false`) hatalar.push(`satıcı /derlemeler'i "${olcum.bag}" olarak bağlamış — beklenen "${olcum.D} false" (salt okunur); dosya oraya konursa portal GÖRMEZ`);
  if (!olcum.yardimci) throw new Dur(2, `ÖLÇÜLEMEDİ — yardımcı konteyner imajı okunamadı (${ORTAMLAR[ortam].yedek})`);
  if (!olcum.imajVar) throw new Dur(2, `ÖLÇÜLEMEDİ — yardımcı imaj ${olcum.yardimci} VDS'te etiketli değil`);
  if (!olcum.dizin) throw new Dur(2, `ÖLÇÜLEMEDİ — ${olcum.D} sahibi/izni okunamadı`);
  if ((parseInt(olcum.dizin.mod, 8) & 0o005) !== 0o005) hatalar.push(`${olcum.D} izni ${olcum.dizin.mod} — satıcı (10001) dizini okuyamaz`);
  const yazilacak = [];
  const yerinde = [];
  for (const d of dosyalar) {
    const var_ = olcum.ls.get(d.ad);
    if (!var_) { yazilacak.push(d); continue; }
    const u = uzakOzet.get(d.ad);
    if (u === d.sha256) yerinde.push(d);
    else hatalar.push(`${d.ad} depoda ZATEN VAR ve içeriği FARKLI (uzak ${u ? `${u.slice(0, 16)}…` : 'ölçülemedi'} · yerel ${d.sha256.slice(0, 16)}…) — üstüne YAZILMAZ; yeni ad ver`);
  }
  for (const ad of olcum.ls.keys()) if (ad.startsWith('.yarim-')) hatalar.push(`yarım kalmış önceki yazım: ${ad} — önce elle incele/kaldır`);
  // Kaldırma: --kaldir açık adlar · --yenile depodaki öteki ortak kurulum arşivleri. Aktif bağlantı ölçülemezse karar YOK.
  const yeniAdlar = new Set(dosyalar.map((d) => d.ad));
  const adaylar = yenile ? yenileAdaylari(olcum.ls.keys(), yeniAdlar) : kaldir;
  const kaldirilacak = [];
  const tutulan = [];
  if (adaylar.length && !olcum.baglanti) throw new Dur(2, 'ÖLÇÜLEMEDİ — satıcı DB\'sinden aktif indirme bağlantıları okunamadı (@@BAGLANTI) — hiçbir şey kaldırılmaz');
  for (const ad of adaylar) {
    const l = olcum.ls.get(ad);
    if (!l) { hatalar.push(`${ad} depoda YOK — kaldırılacak bir şey yok`); continue; }
    if (!l.mod.startsWith('-')) { hatalar.push(`${ad} düzenli dosya değil (${l.mod}) — elle incele`); continue; }
    const aktif = olcum.baglanti.get(ad) ?? 0;
    if (aktif > 0) {
      if (yenile) tutulan.push({ ad, aktif });
      else hatalar.push(`${ad}: ${aktif} AKTİF indirme bağlantısı bu dosyayı gösteriyor — kaldırılırsa müşteri indiremez; önce portalda bağlantıyı iptal et ya da süresinin dolmasını bekle`);
      continue;
    }
    const u = uzakOzet.get(ad);
    if (!u) throw new Dur(2, `ÖLÇÜLEMEDİ — ${ad} uzak özeti okunamadı`);
    const yerel = path.join(arsiv, ad);
    let arsivde = false;
    if (fs.existsSync(yerel)) {
      if (akisOzeti(yerel).sha256 !== u) { hatalar.push(`${ad}: Mac arşivinde (${yerel}) AYNI ADLI ama FARKLI içerikli dosya var — üstüne yazılmaz, kaldırma yok`); continue; }
      arsivde = true;
    }
    kaldirilacak.push({ ad, sha256: u, boyut: l.boyut, yerel, arsivde });
  }
  const toplam = yazilacak.reduce((t, d) => t + d.boyut, 0);
  if (toplam && olcum.df.length >= 2) {
    const [depo, ev] = olcum.df;
    const ayniFs = depo.nokta === ev.nokta;
    if (ayniFs && depo.bos < 2 * toplam + PAY) hatalar.push(`disk: ${depo.nokta} boş ${Math.floor(depo.bos / 2 ** 20)} MiB — geçici + kalıcı ${Math.ceil((2 * toplam + PAY) / 2 ** 20)} MiB gerekir`);
    if (!ayniFs && (depo.bos < toplam + PAY || ev.bos < toplam + PAY)) hatalar.push(`disk: depo ${Math.floor(depo.bos / 2 ** 20)} MiB · ev ${Math.floor(ev.bos / 2 ** 20)} MiB boş — her biri ≥ ${Math.ceil((toplam + PAY) / 2 ** 20)} MiB olmalı`);
  } else if (toplam) throw new Dur(2, 'ÖLÇÜLEMEDİ — df çıktısı okunamadı');
  if (hatalar.length) throw new Dur(1, `VDS DENETİMİ (${hatalar.length}) — hiçbir şey yazılmadı`, hatalar);
  return { yazilacak, yerinde, kaldirilacak, tutulan };
}

// ---------------------------------------------------------------- plan (KURU'nun bastığı = --uygula'nın koştuğu)
const sshTemel = () => ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-p', VDS.port, VDS.hedef];

// Konteynerde (yalnız depo bağlı, ağ yok): her çift için önce özet tutmalı, sonra sil; tutmayan ilk çiftte durur.
export const KALDIR_BETIK = 'set -eu; cd /k; while [ $# -gt 1 ]; do case "$2" in ""|.*|*/*) echo "ad gecersiz: $2" >&2; exit 2;; esac; printf "%s  %s\\n" "$1" "$2" | sha256sum -c -; rm -- "$2"; shift 2; done';

export function kaldirKomutu(olcum, kaldirilacak) {
  return `docker run --rm --network none --user 0 -v ${olcum.D}:/k --entrypoint sh ${olcum.yardimci} -c '${KALDIR_BETIK}' sh ${kaldirilacak.map((k) => `${k.sha256} ${k.ad}`).join(' ')}`;
}

export function planKur(ortam, olcum, yazilacak, damga, kaldirilacak = [], arsiv = ARSIV_DIZINI_VARSAYILAN) {
  const G = `derleme-koy-${damga}`;
  const adlar = yazilacak.map((d) => d.ad);
  const yazim = `docker run --rm --network none --user 0 -v "$HOME/${G}:/g:ro" -v ${olcum.D}:/k --entrypoint sh ${olcum.yardimci} /g/derleme-koy-ic.sh ${olcum.dizin.uid} ${olcum.dizin.gid} ${adlar.join(' ')}`;
  const ekle = yazilacak.length ? [
      { ad: 'geçici dizin', tur: 'ssh', uzak: `install -d -m 700 "$HOME/${G}"` },
      { ad: 'gönder', tur: 'scp', args: ['-P', VDS.port, '-o', 'BatchMode=yes', ...yazilacak.map((d) => d.yol), '<yerel>/derleme-koy.sha256', '<yerel>/derleme-koy-ic.sh', `${VDS.hedef}:${G}/`] },
      { ad: 'uzakta özet', tur: 'ssh', uzak: `cd "$HOME/${G}" && sha256sum -c derleme-koy.sha256` },
      { ad: `yaz (0644 ${olcum.dizin.uid}:${olcum.dizin.gid}, ezmez)`, tur: 'ssh', uzak: yazim },
      { ad: 'geçici dizini sil', tur: 'ssh', uzak: `rm -rf "$HOME/${G}"` },
  ] : [];
  const cikar = kaldirilacak.length ? [
      { ad: 'aktif bağlantıyı yeniden ölç (salt okuma)', tur: 'olc' },
      ...kaldirilacak.filter((k) => !k.arsivde).map((k) => ({ ad: `Mac arşivine indir (${k.ad})`, tur: 'scp', args: ['-P', VDS.port, '-o', 'BatchMode=yes', `${VDS.hedef}:${olcum.D}/${k.ad}`, `${arsiv}/.${k.ad}.yarim`] })),
      { ad: `Mac arşivi = uzak özet (${kaldirilacak.length} dosya, ${arsiv})`, tur: 'yerelOlc' },
      { ad: `kaldır (özet tutarsa rm): ${kaldirilacak.map((k) => k.ad).join(', ')}`, tur: 'ssh', uzak: kaldirKomutu(olcum, kaldirilacak) },
  ] : [];
  return {
    G,
    adimlar: [
      { ad: 'vds-dogrula (önce)', tur: 'yerel', komut: VDS_DOGRULA, args: [] },
      ...ekle,
      ...cikar,
      { ad: 'ölç (salt okuma)', tur: 'olc' },
      { ad: 'vds-dogrula (sonra, öncekiyle AYNI)', tur: 'yerel', komut: VDS_DOGRULA, args: [] },
    ],
  };
}

const kabuk = (s) => (/^[\w./=:@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
function planBas(plan, ortam) {
  console.log(`\n  --uygula şunları koşacak (damga her koşumda yeni; ${ORTAMLAR[ortam].kok}):`);
  plan.adimlar.forEach((a, i) => {
    const n = `${i + 1}`.padStart(2);
    if (a.tur === 'yerel') console.log(`  ${n}. ${a.ad}: ${a.komut}`);
    else if (a.tur === 'ssh') console.log(`  ${n}. ${a.ad}: ssh ${sshTemel().map(kabuk).join(' ')} ${kabuk(a.uzak)}`);
    else if (a.tur === 'scp') console.log(`  ${n}. ${a.ad}: scp ${a.args.map(kabuk).join(' ')}`);
    else if (a.tur === 'yerelOlc') console.log(`  ${n}. ${a.ad}`);
    else console.log(`  ${n}. ${a.ad}: ssh … '${olcumKomutu(ortam).slice(0, 60)}…' + sha256sum <yeni dosyalar>`);
  });
  if (plan.adimlar.some((a) => a.ad === 'gönder')) {
    console.log('      derleme-koy-ic.sh (konteynerde, root):');
    for (const s of IC_BETIK.trimEnd().split('\n')) console.log(`        ${s}`);
  }
}

// ---------------------------------------------------------------- yazım (yalnız --uygula)
function yaz(komut, args, { girdiAkisi = false } = {}) {
  const r = spawnSync(komut, args, { encoding: 'utf8', stdio: girdiAkisi ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'], timeout: 60 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  return { kod: r.status ?? (r.error ? 255 : 1), cikti: `${r.stdout ?? ''}`, hata: `${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
}
const sshYaz = (uzak) => yaz('ssh', [...sshTemel(), uzak]);

function vdsDogrula(ag, ne) {
  const r = ag.yerelBetik(VDS_DOGRULA);
  const metin = `${r.cikti}${r.hata}`.trim();
  if (r.kod === 2 || r.kod === null) throw new Dur(2, `ÖLÇÜLEMEDİ — vds-dogrula (${ne}): ${metin.split('\n').slice(-2).join(' · ')}`);
  if (r.kod !== 0) throw new Dur(1, `vds-dogrula (${ne}) FARK — adnansahin baytları tabanla aynı değil${ne === 'önce' ? ', hiçbir şey yazılmadı' : ''}`, metin.split('\n').slice(0, 12));
  return r.cikti;
}

function uzakOzetleri(ag, D, adlar) {
  if (!adlar.length) return new Map();
  const c = vdsOku(ag, `sha256sum ${adlar.map((a) => `${D}/${a}`).join(' ')}`);
  const m = new Map();
  for (const s of c.split('\n')) {
    const r = /^([0-9a-f]{64}) {2}(\S+)$/.exec(s.trim());
    if (r) m.set(path.posix.basename(r[2]), r[1]);
  }
  return m;
}

async function uygula(ag, ortam, olcum, yazilacak, kaldirilacak = [], arsiv = ARSIV_DIZINI_VARSAYILAN) {
  const damga = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')}-${randomBytes(3).toString('hex')}`;
  const plan = planKur(ortam, olcum, yazilacak, damga, kaldirilacak, arsiv);
  const no = (a) => plan.adimlar.indexOf(a) + 1;
  const bul = (ad) => plan.adimlar.find((a) => a.ad === ad || a.ad.startsWith(ad));
  const adim = (a, r) => {
    if (r.kod !== 0) throw new Dur(1, `adım ${no(a)} (${a.ad}) çıkış ${r.kod}`, `${r.cikti}${r.hata}`.trim().split('\n').slice(-6));
    console.log(`  ✓ ${no(a)}. ${a.ad}`);
    return r;
  };
  const once = vdsDogrula(ag, 'önce');
  console.log('  ✓ vds-dogrula (önce): AYNI');
  if (yazilacak.length) {
    const yerel = fs.mkdtempSync(path.join(os.tmpdir(), 'derleme-koy-'));
    const sil = bul('geçici dizini sil');
    let uzakDizin = false;
    try {
      fs.writeFileSync(path.join(yerel, 'derleme-koy-ic.sh'), IC_BETIK);
      const icOzet = createHash('sha256').update(IC_BETIK).digest('hex');
      fs.writeFileSync(path.join(yerel, 'derleme-koy.sha256'), `${[...yazilacak.map((d) => `${d.sha256}  ${d.ad}`), `${icOzet}  derleme-koy-ic.sh`].join('\n')}\n`);
      const gd = bul('geçici dizin');
      adim(gd, sshYaz(gd.uzak));
      uzakDizin = true;
      const gn = bul('gönder');
      adim(gn, yaz('scp', gn.args.map((x) => x.replace('<yerel>', yerel)), { girdiAkisi: true }));
      const uo = bul('uzakta özet');
      adim(uo, sshYaz(uo.uzak));
      const yz = bul('yaz (');
      const r5 = adim(yz, sshYaz(yz.uzak));
      const yazildi = new Map(r5.cikti.split('\n').map((s) => /^([0-9a-f]{64}) {2}(\S+)$/.exec(s.trim())).filter(Boolean).map((m) => [m[2], m[1]]));
      const tutmayan = yazilacak.filter((d) => yazildi.get(d.ad) !== d.sha256);
      if (tutmayan.length) throw new Dur(1, `depoya yazılan bayt yerelle TUTMUYOR: ${tutmayan.map((d) => d.ad).join(', ')} — portal bağlantısı VERME, elle incele`);
    } finally {
      if (uzakDizin) {
        const r = sshYaz(sil.uzak);
        console.log(r.kod === 0 ? `  ✓ ${no(sil)}. geçici dizini sil` : `  ⚠ ${no(sil)}. geçici dizin silinemedi (~/${plan.G}) — elle: ssh … 'rm -rf "$HOME/${plan.G}"'`);
      }
      fs.rmSync(yerel, { recursive: true, force: true });
    }
  }
  if (kaldirilacak.length) {
    // Bağlantı ölçümü ile rm arasındaki pencere kısa tutulur: yeniden ölç, sonra arşivle, sonra kaldır.
    const taze = olcumuCoz(ortam, vdsOku(ag, olcumKomutu(ortam)));
    if (!taze.baglanti) throw new Dur(2, 'ÖLÇÜLEMEDİ — aktif bağlantılar yeniden okunamadı — hiçbir şey kaldırılmadı');
    const aktif = kaldirilacak.filter((k) => (taze.baglanti.get(k.ad) ?? 0) > 0);
    if (aktif.length) throw new Dur(1, `bu arada AKTİF bağlantı doğdu: ${aktif.map((k) => k.ad).join(', ')} — hiçbir şey kaldırılmadı`);
    console.log(`  ✓ ${no(bul('aktif bağlantıyı'))}. aktif bağlantı yok (yeniden ölçüldü)`);
    fs.mkdirSync(arsiv, { recursive: true });
    for (const k of kaldirilacak.filter((x) => !x.arsivde)) {
      const a = bul(`Mac arşivine indir (${k.ad})`);
      adim(a, yaz('scp', a.args, { girdiAkisi: true }));
      const yarim = a.args[a.args.length - 1];
      if (akisOzeti(yarim).sha256 !== k.sha256) { fs.rmSync(yarim, { force: true }); throw new Dur(1, `${k.ad}: Mac'e inen kopya uzak özetle TUTMUYOR — hiçbir şey kaldırılmadı`); }
      if (fs.existsSync(k.yerel)) throw new Dur(1, `${k.yerel} bu arada doğdu — ezilmez, hiçbir şey kaldırılmadı`);
      fs.renameSync(yarim, k.yerel);
    }
    const tutmayan = kaldirilacak.filter((k) => !fs.existsSync(k.yerel) || akisOzeti(k.yerel).sha256 !== k.sha256);
    if (tutmayan.length) throw new Dur(1, `Mac arşivi uzak özetle TUTMUYOR: ${tutmayan.map((k) => k.ad).join(', ')} — hiçbir şey kaldırılmadı`);
    console.log(`  ✓ ${no(bul('Mac arşivi'))}. Mac arşivi = uzak özet (${arsiv})`);
    const kd = bul('kaldır (');
    adim(kd, sshYaz(kd.uzak));
  }
  // Ölç: yazılanlar depoda ve satıcının konteynerinde; kaldırılanlar hiçbirinde.
  const sonra = olcumuCoz(ortam, vdsOku(ag, olcumKomutu(ortam)));
  const ozet = uzakOzetleri(ag, sonra.D, yazilacak.map((d) => d.ad));
  const sorun = [];
  for (const d of yazilacak) {
    const l = sonra.ls.get(d.ad);
    if (!l || l.boyut !== d.boyut || l.mod !== '-rw-r--r--' || l.uid !== sonra.dizin.uid || l.gid !== sonra.dizin.gid) sorun.push(`${d.ad}: depoda ${l ? `${l.mod} ${l.uid}:${l.gid} ${l.boyut} B` : 'YOK'}`);
    if (ozet.get(d.ad) !== d.sha256) sorun.push(`${d.ad}: özet tutmuyor`);
    if (!sonra.kap.has(d.ad)) sorun.push(`${d.ad}: satıcı konteyneri /derlemeler'de GÖRMÜYOR`);
  }
  for (const k of kaldirilacak) if (sonra.ls.has(k.ad) || sonra.kap.has(k.ad)) sorun.push(`${k.ad}: kaldırıldı denmişti ama depoda/konteynerde hâlâ görünüyor`);
  if (sorun.length) throw new Dur(1, 'YAZIM SONRASI ÖLÇÜM', sorun);
  console.log(`  ✓ ${no(bul('ölç (salt okuma)'))}. ölçüm: ${yazilacak.length ? 'yeni dosya depoda 0644, sahibi dizinle aynı, özet yerelle aynı, satıcı konteyneri görüyor' : ''}${yazilacak.length && kaldirilacak.length ? ' · ' : ''}${kaldirilacak.length ? 'kaldırılanlar depoda ve konteynerde yok' : ''}`);
  const sonraVds = vdsDogrula(ag, 'sonra');
  if (sonraVds !== once) throw new Dur(1, 'vds-dogrula (sonra) çıktısı öncekinden FARKLI — adnansahin tarafında değişiklik var, incele', ['önce:', ...once.trim().split('\n'), 'sonra:', ...sonraVds.trim().split('\n')]);
  console.log(`  ✓ ${plan.adimlar.length}. vds-dogrula (sonra): AYNI, çıktı öncekiyle birebir`);
}

// ---------------------------------------------------------------- ana akış
async function main() {
  const { a, hatalar } = argAyristir(process.argv.slice(2));
  if (hatalar.length) throw new Dur(2, KULLANIM, hatalar);
  const o = ORTAMLAR[a.ortam];
  console.log(`== Derleme koy: ${a.ortam} (${o.kok}/derlemeler)${a.uygula ? ' — UYGULA' : ' — KURU (yalnız okuma)'} ==`);
  const dosyalar = a.dosyalar.length ? yerelDenetim(a.ortam, a.dosyalar) : [];
  if (a.yenile) yenileAdaylari([], new Set(dosyalar.map((d) => d.ad)));
  if (a.kaldir.length) {
    const kural = derlemeAdiKurali();
    const kh = a.kaldir.map((ad) => derlemeAdiHatasi(ad, kural)).filter(Boolean);
    if (kh.length) throw new Dur(1, `KALDIRILACAK AD (${kh.length})`, kh);
  }
  for (const d of dosyalar) console.log(`  yerel          : ${d.ad} · ${d.boyut} B · ${d.sha256}${d.yanOzet ? ' (= yanındaki .sha256)' : ''}`);

  // Okuma her iki kipte de gerçek bağlantıdır; Ag sözleşmesi yazma komutunu bağlantıdan ÖNCE reddeder.
  const ag = new Ag({ olc: true, zamanAsimiMs: 30_000 });
  const olcum = olcumuCoz(a.ortam, vdsOku(ag, olcumKomutu(a.ortam)));
  console.log(`  satıcı bağı    : ${olcum.bag} · yardımcı imaj ${olcum.yardimci} · dizin ${olcum.dizin ? `${olcum.dizin.uid}:${olcum.dizin.gid} ${olcum.dizin.mod}` : '?'} · ${olcum.ls.size} girdi · boş ${olcum.df[0] ? `${(olcum.df[0].bos / 2 ** 30).toFixed(1)} GiB` : '?'}`);
  const yeniAdlar = new Set(dosyalar.map((d) => d.ad));
  const eskiler = a.yenile ? yenileAdaylari(olcum.ls.keys(), yeniAdlar) : a.kaldir.filter((ad) => olcum.ls.has(ad));
  const ozetAdlari = [...new Set([...dosyalar.filter((d) => olcum.ls.has(d.ad)).map((d) => d.ad), ...eskiler])];
  const { yazilacak, yerinde, kaldirilacak, tutulan } = karar(a.ortam, olcum, dosyalar, uzakOzetleri(ag, olcum.D, ozetAdlari), { kaldir: a.kaldir, yenile: a.yenile, arsiv: a.arsiv });
  for (const d of yerinde) console.log(`  = ${d.ad}: depoda ZATEN VAR, içerik aynı — dokunulmaz`);
  for (const t of tutulan) console.log(`  ⚠ ${t.ad}: ${t.aktif} AKTİF bağlantı gösteriyor — KORUNUR (bağlantı bitince yeniden --yenile/--kaldir)`);
  for (const k of kaldirilacak) console.log(`  - ${k.ad}: aktif bağlantı yok · ${k.boyut} B · ${k.sha256} · Mac arşivi ${k.arsivde ? 'VAR (özet eşit)' : `yok → ${k.yerel}`}`);
  if (!yazilacak.length && !kaldirilacak.length) {
    console.log('SONUC: YAPILACAK-IS-YOK');
    return;
  }
  if (!a.uygula) {
    planBas(planKur(a.ortam, olcum, yazilacak, '<damga>', kaldirilacak, a.arsiv), a.ortam);
    console.log(`\n  Bu KURU koşumdu: VDS'e yalnız okuma gitti. Yazmak/kaldırmak için aynı komuta --uygula ekle.`);
    console.log('SONUC: KURU-TEMIZ');
    return;
  }
  await uygula(ag, a.ortam, olcum, yazilacak, kaldirilacak, a.arsiv);
  if (yazilacak.length) console.log(`  portal: Kurulum → İlk kurulum → Bağlantı ver → derleme ${yazilacak.map((d) => d.ad).join(', ')}`);
  if (kaldirilacak.length) console.log(`  kaldırıldı (Mac arşivinde): ${kaldirilacak.map((k) => k.yerel).join(', ')}`);
  console.log(yazilacak.length ? 'SONUC: YAZILDI' : 'SONUC: KALDIRILDI');
}

const anaModul = (() => {
  try {
    return fs.realpathSync(process.argv[1] ?? '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (anaModul) {
  main().catch((e) => {
    if (e instanceof Dur) {
      console.error(`\n  ✖ ${e.message}`);
      for (const s of e.satirlar) console.error(`    - ${s}`);
      console.error(`\nSONUC: ${e.kod === 2 ? 'OLCULEMEDI' : 'DUR'}\n`);
      process.exit(e.kod);
    }
    console.error(`\n  ✖ BEKLENMEYEN HATA: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  });
}
