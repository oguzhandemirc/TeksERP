#!/usr/bin/env node
// =============================================================================
// BEKÇİ — HERKESE AÇIK YASAL SAYFALAR (tekserp.etkiliyazilim.com/gizlilik · /yonetim-gizlilik; eski /patron-gizlilik → 301) · zero-dep, DB'siz, ağsız
// =============================================================================
// Kaynak: deploy/gizlilik-sayfasi/ (VDS /opt/stack/apps/tekserp-gizlilik) + docs/legal/{GIZLILIK,PATRON-GIZLILIK}-POLITIKASI.md.
//   §1 tek kaynak: her sayfa (uret.mjs SAYFALAR) html = uret(kaynak) bayt-eşit; sayfada betik/dış kaynak yok;
//      her e-posta/mailto <!--email_off--> içinde (Cloudflare karartması çözücü betik ister, CSP onu engeller)
//   §2 compose: proje/konteyner adı, salt-okunur kök + salt-okunur bağlar, Host = ADRES, websecure+tls,
//      yalnız kendi önekli etiketler (indir/eski güncelleme sitesinin adı ve adresi yok)
//   §3 kenar zinciri (deploy/traefik/kenar-zinciri.mjs): CF ipallowlist = satıcı CLOUDFLARE_NETWORKS birebir → hız seddi
//   §4 nginx: `always` yalnız no-store/no-cache başlığında · dizin listesi kapalı · nokta-dosya 404 ilk regex ·
//      göreli yönlendirme · her sayfanın konumu = yolu ve dosyası (+ yol/ → 301) · emekli yol (+ yol/) → 301 yeni · 404 no-store
//   §5 adres tutarlılığı: ADRES kurulum/ölçüm betiğinde, kaynak notta, Play form belgesinde, sunucu envanterinde aynı;
//      PATRON_ADRES kurulum/ölçüm betiğinde, kendi kaynağında, mağaza runbook'unda; #hesap-silme çapası sayfada ve runbook'ta
//   §6 kablolama: commit kancası + CI bu bekçiyi koşar
//   §7 Patron metni ↔ kod: saklama süreleri (patron/sunucu maintenance.ts + config.ts varsayılanları) ve native push
//      cümlesi (patron/uygulama push/support.ts NATIVE_PUSH) metinde koddaki değerle yazılı
//   §8 vds-kur.sh: çok satırlı `sh -c '…'` gövdesi kesme işareti taşımaz (tırnağı erken kapatır, kalanını uzak bash koşar)
// Köşeli parantezli yer tutucu bekçiyi KIRMIZI yapmaz (taslak meşru); yayını vds-kur.sh durdurur — burada ⏳ basılır.
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ. Cırcır değil.
//   node scripts/test_gizlilik_sayfasi.mjs          # dinlenme durumu
//   node scripts/test_gizlilik_sayfasi.mjs --sonda  # kalıcı negatif + pozitif sondalar (bellekteki kopyalara karşı)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { kenarZinciriSorunlari } from '../deploy/traefik/kenar-zinciri.mjs';
import { HTML_REL, KAYNAK_REL, PATRON_HTML_REL, PATRON_KAYNAK_REL, SAYFALAR, YONLENDIRMELER, uret } from '../deploy/gizlilik-sayfasi/uret.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ADRES = 'https://tekserp.etkiliyazilim.com/gizlilik';
export const PATRON_ADRES = 'https://tekserp.etkiliyazilim.com/yonetim-gizlilik';
const SILME_CAPASI = 'hesap-silme';
const PROJE = 'tekserp-gizlilik';
const PROJE_DIZINI = `/opt/stack/apps/${PROJE}`;
const YABANCI = ['tekserp-indir', 'tekserpguncelleme', 'indir.etkiliyazilim.com', 'guncelleme.etkiliyazilim.com'];

const COMPOSE_REL = 'deploy/gizlilik-sayfasi/docker-compose.yml';
const NGINX_REL = 'deploy/gizlilik-sayfasi/nginx/default.conf';
const URET_REL = 'deploy/gizlilik-sayfasi/uret.mjs';
const KUR_REL = 'deploy/gizlilik-sayfasi/vds-kur.sh';
const OLC_REL = 'deploy/gizlilik-sayfasi/olc.mjs';
const FORM_REL = 'docs/ops/PLAY-KONSOL-FORMLARI.md';
const ENVANTER_REL = 'docs/ops/SUNUCU-ENVANTERI.md';
const CF_REL = 'satici/sunucu/src/http/client-address.ts';
const ZINCIR_REL = 'deploy/traefik/kenar-zinciri.mjs';
const KANCA_REL = 'scripts/hooks/pre-commit.mjs';
const CI_REL = '.github/workflows/ci.yml';
const BEN_REL = 'scripts/test_gizlilik_sayfasi.mjs';
const MAGAZA_REL = 'docs/ops/PATRON-MAGAZA-ANDROID.md';
const BAKIM_REL = 'patron/sunucu/src/services/maintenance.ts';
const AYAR_REL = 'patron/sunucu/src/config.ts';
const PUSH_REL = 'patron/uygulama/src/push/support.ts';
/** NATIVE_PUSH kapalıyken metinde DURMASI, açıkken DURMAMASI gereken cümle. */
const PUSH_YOK_CUMLESI = 'Android uygulamasında anlık bildirim bu sürümde yoktur';

/** Commit tetiği: bekçinin okuduğu her dosya (§6 listenin kancada aynen geçtiğini ölçer). */
export const TETIK = Object.freeze([KAYNAK_REL, HTML_REL, PATRON_KAYNAK_REL, PATRON_HTML_REL, COMPOSE_REL, NGINX_REL, URET_REL, KUR_REL, OLC_REL, FORM_REL, ENVANTER_REL, MAGAZA_REL, BAKIM_REL, AYAR_REL, PUSH_REL, CF_REL, ZINCIR_REL, BEN_REL]);
const OKUNAN = [KAYNAK_REL, HTML_REL, PATRON_KAYNAK_REL, PATRON_HTML_REL, COMPOSE_REL, NGINX_REL, KUR_REL, OLC_REL, FORM_REL, ENVANTER_REL, MAGAZA_REL, BAKIM_REL, AYAR_REL, PUSH_REL, CF_REL, KANCA_REL, CI_REL];

function dosyalariOku() {
  const d = {};
  for (const rel of OKUNAN) {
    try {
      d[rel] = fs.readFileSync(path.join(KOK, rel), 'utf8');
    } catch {
      d[rel] = undefined;
    }
  }
  return d;
}

function etiketler(metin) {
  const e = {};
  for (const m of metin.matchAll(/^\s*-\s*"?(traefik\.[A-Za-z0-9._-]+)=(.*?)"?\s*$/gm)) e[m[1]] = m[2];
  return e;
}

function cloudflareAglari(kaynak) {
  const govde = /CLOUDFLARE_NETWORKS[^=]*=\s*\[([\s\S]*?)\]/.exec(kaynak)?.[1] ?? '';
  const liste = [...govde.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return liste.length > 0 ? liste : null;
}

function konumlar(metin) {
  return [...metin.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((m) => ({ desen: m[1].trim(), govde: m[2] }));
}

/** Yayını durduran yer tutucular: `[BÜYÜK HARFLİ …]`. */
export function yerTutucular(html) {
  return [...html.matchAll(/\[[A-ZÇĞİÖŞÜ][^\]\n]{1,80}\]/g)].map((m) => m[0]);
}

/** email_off bölgelerinin DIŞINDA kalan e-posta adresleri ve mailto bağları (boş = temiz). */
export function emailOffDisi(html) {
  const dis = html.replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, '');
  return [...dis.matchAll(/mailto:[^"'\s>]*|[a-z0-9._-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)].map((m) => m[0]);
}

/** Saf ölçüm: girdiler enjekte edilebilir (sondalar). */
export function olc(d) {
  const s = { kirmizi: [], olculemedi: [] };
  for (const rel of OKUNAN) if (typeof d[rel] !== 'string') s.olculemedi.push(`${rel} okunamadı`);
  if (s.olculemedi.length) return s;
  const { host, pathname } = new URL(ADRES);

  // §1
  for (const { kaynak, html } of SAYFALAR) {
    const h = d[html];
    try {
      if (uret(d[kaynak]) !== h) s.kirmizi.push(`§1 ${html} kaynaktan üretilenle aynı değil (node ${URET_REL})`);
    } catch (e) {
      s.kirmizi.push(`§1 ${kaynak} çevrilemedi: ${e.message}`);
    }
    if (/<script|<link|<iframe|<img|\ssrc=/i.test(h)) s.kirmizi.push(`§1 ${html} sayfada betik/dış kaynak var (CSP default-src none)`);
    const acik = emailOffDisi(h);
    if (acik.length) s.kirmizi.push(`§1 email_off dışında e-posta/mailto (Cloudflare karartır, CSP çözücüyü engeller): ${html}: ${[...new Set(acik)].join(', ')}`);
    if (!/<html lang="tr">/.test(h) || !/name="viewport"/.test(h)) s.kirmizi.push(`§1 ${html} lang="tr" ya da mobil viewport yok`);
  }

  // §2
  const c = d[COMPOSE_REL];
  const et = etiketler(c);
  const r = (alt) => et[`traefik.http.routers.${PROJE}.${alt}`];
  if (!new RegExp(`^name:\\s*${PROJE}\\s*$`, 'm').test(c)) s.kirmizi.push(`§2 compose proje adı ${PROJE} değil`);
  if (!new RegExp(`^\\s*container_name:\\s*${PROJE}\\s*$`, 'm').test(c)) s.kirmizi.push(`§2 container_name ${PROJE} değil`);
  if (!/^\s*read_only:\s*true\s*$/m.test(c)) s.kirmizi.push('§2 read_only: true yok');
  if (!/^\s*-\s*\.\/html:\/usr\/share\/nginx\/html:ro\s*$/m.test(c)) s.kirmizi.push('§2 html bağı salt-okunur değil');
  if (!/^\s*-\s*\.\/nginx\/default\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro\s*$/m.test(c)) s.kirmizi.push('§2 nginx conf bağı salt-okunur değil');
  if (/^\s*ports:/m.test(c)) s.kirmizi.push('§2 port yayımlanıyor (köken yalnız Traefik ağından)');
  if (r('rule') !== `Host(\`${host}\`)`) s.kirmizi.push(`§2 yönlendirici kuralı Host(\`${host}\`) değil: ${r('rule') ?? 'YOK'}`);
  if (r('entrypoints') !== 'websecure') s.kirmizi.push('§2 entrypoints websecure değil');
  if (r('tls') !== 'true') s.kirmizi.push('§2 tls=true yok');
  if (et['traefik.enable'] !== 'true') s.kirmizi.push('§2 traefik.enable=true yok');
  for (const ad of new Set(Object.keys(et).map((k) => k.split('.')[3]).filter(Boolean))) {
    if (!ad.startsWith(PROJE)) s.kirmizi.push(`§2 etiket adı "${ad}" kendi önekinde (${PROJE}) değil`);
  }
  const yorumsuz = c.split('\n').filter((x) => !/^\s*#/.test(x)).join('\n');
  for (const y of YABANCI) if (yorumsuz.includes(y)) s.kirmizi.push(`§2 compose başka sitenin adını/adresini anıyor: ${y}`);

  // §3
  const cf = cloudflareAglari(d[CF_REL]);
  if (cf === null) s.olculemedi.push(`§3 ${CF_REL} CLOUDFLARE_NETWORKS okunamadı`);
  else for (const x of kenarZinciriSorunlari(et, PROJE, cf)) s.kirmizi.push(`§3 ${x}`);
  for (const hk of (r('middlewares') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (hk.includes('@') || !hk.startsWith(`${PROJE}-`)) s.kirmizi.push(`§3 ara katman "${hk}" bu servisin kendi etiketi değil`);
  }

  // §4
  const n = d[NGINX_REL];
  for (const satir of n.split('\n')) {
    if (/^\s*#/.test(satir) || !/\badd_header\b/.test(satir) || !/\balways\s*;/.test(satir)) continue;
    if (!/add_header\s+Cache-Control\s+"no-(store|cache)[^"]*"\s+always;/.test(satir)) s.kirmizi.push(`§4 always yalnız no-store/no-cache başlığında olur: ${satir.trim()}`);
  }
  const k = konumlar(n);
  if (k.length < 4) s.olculemedi.push(`§4 nginx konum blokları ayrıştırılamadı (${k.length})`);
  if (!/^\s*autoindex\s+off;/m.test(n)) s.kirmizi.push('§4 autoindex off yok');
  if (!/^\s*absolute_redirect\s+off;/m.test(n)) s.kirmizi.push('§4 absolute_redirect off yok (yönlendirme http:// mutlak adrese gider)');
  const regexler = k.filter((x) => x.desen.startsWith('~'));
  const nokta = k.find((x) => x.desen === '~ (^|/)\\.');
  if (!nokta || !/return\s+404;/.test(nokta.govde)) s.kirmizi.push('§4 nokta-dosya konumu 404 dönmüyor');
  else if (regexler.indexOf(nokta) !== 0) s.kirmizi.push('§4 nokta-dosya konumu ilk regex değil');
  if (SAYFALAR[0].yol !== pathname) s.kirmizi.push(`§4 uret.mjs SAYFALAR ilk sayfası ${pathname} değil`);
  if (!SAYFALAR.some((x) => x.yol === new URL(PATRON_ADRES).pathname && x.html === PATRON_HTML_REL)) s.kirmizi.push('§4 uret.mjs SAYFALAR Patron sayfasını taşımıyor');
  // Emekli yol kalıcı 301'dir: Play'e/dışarıya verilmiş eski adres (ve #çapası) kırılmaz; sayfa yolu olamaz.
  if (!YONLENDIRMELER.some((x) => x.eski === '/patron-gizlilik' && x.yeni === new URL(PATRON_ADRES).pathname)) s.kirmizi.push('§4 uret.mjs YONLENDIRMELER /patron-gizlilik → Patron sayfası yok');
  for (const { eski, yeni } of YONLENDIRMELER) {
    if (!SAYFALAR.some((x) => x.yol === yeni)) s.kirmizi.push(`§4 ${eski} → ${yeni}: hedef bir sayfa değil`);
    if (SAYFALAR.some((x) => x.yol === eski)) s.kirmizi.push(`§4 ${eski} hem sayfa hem emekli yol`);
    for (const desen of [`= ${eski}`, `= ${eski}/`]) {
      const y = k.find((x) => x.desen === desen);
      if (!y || !new RegExp(`^\\s*return\\s+301\\s+${yeni};\\s*$`).test(y.govde)) s.kirmizi.push(`§4 "location ${desen}" → 301 ${yeni} yok`);
    }
  }
  for (const { yol, html } of SAYFALAR) {
    const sayfa = k.find((x) => x.desen === `= ${yol}`);
    const dosya = `/${path.posix.basename(html)}`;
    if (dosya !== `${yol}.html`) s.kirmizi.push(`§4 ${yol} sayfasının dosyası ${dosya} (beklenen ${yol}.html — vds-kur.sh bu eşleşmeye dayanır)`);
    if (!sayfa) s.kirmizi.push(`§4 "location = ${yol}" yok`);
    else {
      if (!new RegExp(`try_files\\s+${dosya.replace('.', '\\.')}\\s+=404;`).test(sayfa.govde)) s.kirmizi.push(`§4 ${yol} konumu ${dosya}'ı sunmuyor`);
      const yas = /Cache-Control\s+"[^"]*max-age=([0-9]+)/.exec(sayfa.govde)?.[1];
      if (!yas || Number(yas) > 3600) s.kirmizi.push(`§4 ${yol} önbelleği kısa değil (max-age=${yas ?? 'YOK'}, tavan 3600)`);
      if (!/Content-Security-Policy\s+"default-src 'none'/.test(sayfa.govde)) s.kirmizi.push(`§4 ${yol} konumunda CSP default-src none yok`);
    }
    const bolu = k.find((x) => x.desen === `= ${yol}/`);
    if (!bolu || !new RegExp(`return\\s+301\\s+${yol};`).test(bolu.govde)) s.kirmizi.push(`§4 "location = ${yol}/" → 301 ${yol} yok`);
  }
  const bulunamadi = k.find((x) => x.desen === '@bulunamadi');
  if (!/error_page\s+404\s*=\s*@bulunamadi;/.test(n) || !bulunamadi || !/Cache-Control\s+"no-store"\s+always;/.test(bulunamadi.govde)) s.kirmizi.push('§4 404 no-store hattı yok');

  // §5
  for (const rel of [KUR_REL, OLC_REL, KAYNAK_REL, FORM_REL, ENVANTER_REL]) if (!d[rel].includes(ADRES)) s.kirmizi.push(`§5 ${rel} adresi (${ADRES}) anmıyor`);
  if (!d[KUR_REL].includes(PROJE_DIZINI)) s.kirmizi.push(`§5 ${KUR_REL} proje dizinini (${PROJE_DIZINI}) anmıyor`);
  for (const rel of [KUR_REL, OLC_REL, PATRON_KAYNAK_REL, MAGAZA_REL]) if (!d[rel].includes(PATRON_ADRES)) s.kirmizi.push(`§5 ${rel} Patron adresini (${PATRON_ADRES}) anmıyor`);
  const silmeAdresi = `${PATRON_ADRES}#${SILME_CAPASI}`;
  for (const rel of [PATRON_KAYNAK_REL, MAGAZA_REL]) if (!d[rel].includes(silmeAdresi)) s.kirmizi.push(`§5 ${rel} hesap silme adresini (${silmeAdresi}) anmıyor`);
  if (!d[PATRON_HTML_REL].includes(`<h2 id="${SILME_CAPASI}">`)) s.kirmizi.push(`§5 ${PATRON_HTML_REL} #${SILME_CAPASI} çapasını taşımıyor (Play hesap silme adresi kırılır)`);
  if (!/^\*\*Metin sürümü:\*\* `YONETIM-GP-\d{4}\.\d+`$/m.test(d[PATRON_KAYNAK_REL]) || !/^\*\*Yürürlük:\*\* \S/m.test(d[PATRON_KAYNAK_REL])) s.kirmizi.push(`§5 ${PATRON_KAYNAK_REL} metin sürümü (YONETIM-GP-YYYY.N) ya da yürürlük satırı yok`);
  const kurSayfa = /^SAYFALAR="([^"]*)"$/m.exec(d[KUR_REL])?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  const beklenenSayfa = SAYFALAR.map((x) => path.posix.basename(x.html, '.html'));
  if (kurSayfa.join(' ') !== beklenenSayfa.join(' ')) s.kirmizi.push(`§5 ${KUR_REL} SAYFALAR="${kurSayfa.join(' ')}" ≠ uret.mjs (${beklenenSayfa.join(' ')})`);
  for (const ad of beklenenSayfa) {
    if (!d[KUR_REL].includes(`html/${ad}.html`)) s.kirmizi.push(`§5 ${KUR_REL} html/${ad}.html'ı taşımıyor`);
    if (!d[OLC_REL].includes(`html/${ad}.html`)) s.kirmizi.push(`§5 ${OLC_REL} html/${ad}.html'ı ölçmüyor`);
  }

  // §6
  const kanca = d[KANCA_REL];
  if (!kanca.includes(`"${BEN_REL}"`)) s.kirmizi.push('§6 commit kancasında bu bekçinin adımı yok');
  // Tetik bu bekçinin KENDİ kümesinde aranır: aynı yol başka bekçinin kümesinde geçince bu bekçi tetiklenmez.
  const kume = new RegExp('const GIZLILIK_SAYFASI_TETIK = new Set\\(\\[([\\s\\S]*?)\\]\\);').exec(kanca)?.[1];
  if (kume === undefined) s.kirmizi.push('§6 commit kancasında GIZLILIK_SAYFASI_TETIK kümesi yok');
  for (const t of TETIK) if (!(kume ?? '').includes(`"${t}"`)) s.kirmizi.push(`§6 commit kancası tetiği "${t}"i kapsamıyor`);
  if (!d[CI_REL].includes(`node ${BEN_REL} && node ${BEN_REL} --sonda`)) s.kirmizi.push('§6 CI bu bekçiyi (+ --sonda) koşmuyor');

  // §7 — metindeki süreler ve bildirim cümlesi koddaki değerden ayrışırsa politika yalan söyler.
  const sabit = (metin, ad) => { const m = new RegExp(`export const ${ad} = (\\d+);`).exec(metin); return m ? Number(m[1]) : null; };
  const varsayilan = (ad) => { const m = new RegExp(`${ad}:\\s*positiveInt\\([^)]*\\)\\.default\\((\\d+)\\)`).exec(d[AYAR_REL]); return m ? Number(m[1]) : null; };
  const silme = sabit(d[BAKIM_REL], 'IDENTITY_PURGE_DAYS');
  const ip = sabit(d[BAKIM_REL], 'IP_RETENTION_DAYS');
  const giris = varsayilan('DENETIM_GIRIS_SAKLAMA_GUN');
  const denetim = varsayilan('DENETIM_SAKLAMA_GUN');
  const pushM = /export const NATIVE_PUSH = (true|false);/.exec(d[PUSH_REL]);
  if (silme === null || ip === null) s.olculemedi.push(`§7 ${BAKIM_REL} IDENTITY_PURGE_DAYS / IP_RETENTION_DAYS okunamadı`);
  if (giris === null || denetim === null) s.olculemedi.push(`§7 ${AYAR_REL} DENETIM_GIRIS_SAKLAMA_GUN / DENETIM_SAKLAMA_GUN varsayılanı okunamadı`);
  if (!pushM) s.olculemedi.push(`§7 ${PUSH_REL} NATIVE_PUSH okunamadı`);
  if (s.olculemedi.length) return s;
  const md = d[PATRON_KAYNAK_REL].replace(/\s+/g, ' ');
  const yil = denetim / 365;
  if (!Number.isInteger(yil)) s.kirmizi.push(`§7 DENETIM_SAKLAMA_GUN=${denetim} tam yıl değil — metin "${yil} yıl" yazamaz, ${PATRON_KAYNAK_REL} elle güncellenir ve bu bekçi uyarlanır`);
  const gerekli = [
    `IP adresi ${ip} gün sonra silinir`,
    `Başarısız giriş kayıtları ${giris} gün, diğer güvenlik kayıtları ${yil} yıl saklanır`,
    `kapanıştan ${silme} gün sonra silinir`,
    `Kapanıştan sonraki ${silme}. günde`,
    `(başarısız giriş ${giris} gün, diğerleri ${yil} yıl)`,
    `IP adresi ${ip} gün sonra çıkarılır`,
  ];
  for (const c of gerekli) if (!md.includes(c)) s.kirmizi.push(`§7 ${PATRON_KAYNAK_REL} koddaki süreyi yazmıyor: "${c}"`);
  const pushKapali = pushM[1] === 'false';
  if (pushKapali !== md.includes(PUSH_YOK_CUMLESI)) {
    s.kirmizi.push(pushKapali
      ? `§7 NATIVE_PUSH kapalı ama ${PATRON_KAYNAK_REL} "${PUSH_YOK_CUMLESI}" demiyor`
      : `§7 NATIVE_PUSH AÇIK ama ${PATRON_KAYNAK_REL} hâlâ "${PUSH_YOK_CUMLESI}" diyor — §2/§4 (cihaz anahtarı, Google/Apple/Expo) + PATRON-MAGAZA-ANDROID §4.2 birlikte güncellenir`);
  }
  // §8 — 2026-10-16 canlıda ölçüldü: gövdedeki `onceki/'de` tırnağı kapattı, --uygula yarıda durdu.
  const govdeler = [...d[KUR_REL].matchAll(/-c '\n([\s\S]*?)\n'\n/g)];
  if (!govdeler.length) s.olculemedi.push(`§8 ${KUR_REL} çok satırlı sh -c '…' gövdesi bulunamadı`);
  for (const [, g] of govdeler) {
    const satir = g.split('\n').find((x) => x.includes("'"));
    if (satir !== undefined) s.kirmizi.push(`§8 ${KUR_REL} sh -c gövdesinde kesme işareti (tırnağı erken kapatır): ${satir.trim()}`);
  }
  return s;
}

function sondalar(taban) {
  const deg = (rel, f) => (d) => { d[rel] = f(d[rel]); };
  const C = (f) => deg(COMPOSE_REL, f);
  const N = (f) => deg(NGINX_REL, f);
  const liste = [
    ['P0 dokunulmamış', 'yesil', () => {}],
    ['N1 kaynak değişti, html üretilmedi', 'kirmizi', deg(KAYNAK_REL, (t) => t.replace('## 10. Çocuklar', '## 10. Çocuklar ve gençler'))],
    ['N2 html elle değişti', 'kirmizi', deg(HTML_REL, (t) => t.replace('</main>', '<p>ek</p>\n</main>'))],
    ['N3 sayfaya betik', 'kirmizi', deg(HTML_REL, (t) => t.replace('</body>', '<script src="x.js"></script></body>'))],
    ['N4 kök yazılabilir', 'kirmizi', C((t) => t.replace('read_only: true', 'read_only: false'))],
    ['N5 html bağı yazılabilir', 'kirmizi', C((t) => t.replace('./html:/usr/share/nginx/html:ro', './html:/usr/share/nginx/html'))],
    ['N6 Host indir adresi', 'kirmizi', C((t) => t.replace('Host(`tekserp.etkiliyazilim.com`)', 'Host(`indir.etkiliyazilim.com`)'))],
    ['N7 indir ara katmanına bağlı', 'kirmizi', C((t) => t.replace('middlewares=tekserp-gizlilik-cf,tekserp-gizlilik-hiz', 'middlewares=tekserp-indir-cf,tekserp-indir-hiz'))],
    ['N8 CF aralığı eksik', 'kirmizi', C((t) => t.replace('173.245.48.0/20,', ''))],
    ['N9 zincir sırası ters', 'kirmizi', C((t) => t.replace('middlewares=tekserp-gizlilik-cf,tekserp-gizlilik-hiz', 'middlewares=tekserp-gizlilik-hiz,tekserp-gizlilik-cf'))],
    ['N10 tls yok', 'kirmizi', C((t) => t.replace(/^.*routers\.tekserp-gizlilik\.tls=true\n/m, ''))],
    ['N11 port yayımlandı', 'kirmizi', C((t) => t.replace('    networks: [web]\n', '    ports: ["8088:80"]\n    networks: [web]\n'))],
    ['N12 sayfa önbelleğinde always', 'kirmizi', N((t) => t.replace('"public, max-age=300";', '"public, max-age=300" always;'))],
    ['N13 güvenlik başlığında always', 'kirmizi', N((t) => t.replace('"nosniff";', '"nosniff" always;'))],
    ['N14 uzun önbellek', 'kirmizi', N((t) => t.replace('max-age=300', 'max-age=604800'))],
    ['N15 autoindex açık', 'kirmizi', N((t) => t.replace('autoindex off;', 'autoindex on;'))],
    ['N16 mutlak yönlendirme', 'kirmizi', N((t) => t.replace('absolute_redirect off;', ''))],
    ['N17 nokta-dosya konumu yok', 'kirmizi', N((t) => t.replace(/location ~ \(\^\|\/\)\\\. \{\s*return 404;\s*\}/, ''))],
    ['N18 sayfa yolu farklı', 'kirmizi', N((t) => t.replace('location = /gizlilik {', 'location = /gizlilik-politikasi {'))],
    ['N19 404 no-store hattı yok', 'kirmizi', N((t) => t.replace('error_page 404 = @bulunamadi;', ''))],
    ['N20 kurulum betiği başka adres', 'kirmizi', deg(KUR_REL, (t) => t.replaceAll(ADRES, 'https://x.etkiliyazilim.com/gizlilik'))],
    ['N21 form belgesi adresi anmıyor', 'kirmizi', deg(FORM_REL, (t) => t.replaceAll(ADRES, 'https://etkiliyazilim.com/tekserp/gizlilik'))],
    ['N22 kancada adım yok', 'kirmizi', deg(KANCA_REL, (t) => t.replaceAll(`"${BEN_REL}"`, '"x"'))],
    ['N23 kanca tetiği html kapsamıyor', 'kirmizi', deg(KANCA_REL, (t) => t.replace(`"${HTML_REL}"`, '"y"'))],
    ['N23b kanca tetiği client-address.ts yalnız başka bekçinin kümesinde', 'kirmizi', deg(KANCA_REL, (t) => t.replace(/(const GIZLILIK_SAYFASI_TETIK = new Set\(\[[\s\S]*?)"satici\/sunucu\/src\/http\/client-address\.ts", /, '$1'))],
    ['N24 CI koşmuyor', 'kirmizi', deg(CI_REL, (t) => t.replaceAll(BEN_REL, 'scripts/x.mjs'))],
    ['N25 mailto email_off dışında', 'kirmizi', deg(HTML_REL, (t) => t.replaceAll('<!--email_off-->', '').replaceAll('<!--/email_off-->', '')), '§1 email_off dışında'],
    ['N26 düz e-posta email_off dışında', 'kirmizi', deg(HTML_REL, (t) => t.replace('</main>', '<p>destek@etkiliyazilim.com</p>\n</main>')), '§1 email_off dışında'],
    ['P1 kaynağa yeni e-posta + üretildi', 'yesil', (d) => { d[KAYNAK_REL] = d[KAYNAK_REL].replace('## 10. Çocuklar', 'Ek: destek@etkiliyazilim.com\n\n## 10. Çocuklar'); d[HTML_REL] = uret(d[KAYNAK_REL]); }],
    ['N27 Patron kaynağı değişti, html üretilmedi', 'kirmizi', deg(PATRON_KAYNAK_REL, (t) => t.replace('## 8. Çocuklar', '## 8. Çocuklar ve gençler')), '§1'],
    ['N28 hesap silme başlığı değişti (çapa kırıldı), html üretildi', 'kirmizi', (d) => { d[PATRON_KAYNAK_REL] = d[PATRON_KAYNAK_REL].replace('## 9. Hesap silme', '## 9. Hesabımı sil'); d[PATRON_HTML_REL] = uret(d[PATRON_KAYNAK_REL]); }, '§5'],
    ['N29 nginx Patron konumu yok', 'kirmizi', N((t) => t.replace('location = /yonetim-gizlilik {', 'location = /yonetim-gizlilik-eski {')), '§4'],
    ['N30 nginx Patron 301 konumu yok', 'kirmizi', N((t) => t.replace(/location = \/yonetim-gizlilik\/ \{\s*return 301 \/yonetim-gizlilik;\s*\}/, '')), '§4'],
    ['N30b emekli /patron-gizlilik 301 yok', 'kirmizi', N((t) => t.replace(/location = \/patron-gizlilik \{\s*return 301 \/yonetim-gizlilik;\s*\}/, '')), '§4'],
    ['N30c emekli /patron-gizlilik/ 301 yok', 'kirmizi', N((t) => t.replace(/location = \/patron-gizlilik\/ \{\s*return 301 \/yonetim-gizlilik;\s*\}/, '')), '§4'],
    ['N30d emekli yol eski sayfaya dönüyor', 'kirmizi', N((t) => t.replace(/(location = \/patron-gizlilik \{\s*)return 301 \/yonetim-gizlilik;/, '$1try_files /yonetim-gizlilik.html =404;')), '§4'],
    ['N31 Patron sayfasına betik', 'kirmizi', deg(PATRON_HTML_REL, (t) => t.replace('</body>', '<script>1</script></body>')), '§1'],
    ['N32 kimlik silme süresi kodda 45', 'kirmizi', deg(BAKIM_REL, (t) => t.replace('export const IDENTITY_PURGE_DAYS = 30;', 'export const IDENTITY_PURGE_DAYS = 45;')), '§7'],
    ['N33 IP saklama kodda 60', 'kirmizi', deg(BAKIM_REL, (t) => t.replace('export const IP_RETENTION_DAYS = 30;', 'export const IP_RETENTION_DAYS = 60;')), '§7'],
    ['N34 denetim saklama varsayılanı 1095', 'kirmizi', deg(AYAR_REL, (t) => t.replace(/(DENETIM_SAKLAMA_GUN:\s*positiveInt\([^)]*\)\.default\()\d+/, '$11095')), '§7'],
    ['N35 native push açıldı, metin aynı', 'kirmizi', deg(PUSH_REL, (t) => t.replace('export const NATIVE_PUSH = false;', 'export const NATIVE_PUSH = true;')), '§7'],
    ['N36 metinden push cümlesi silindi, kapı kapalı', 'kirmizi', (d) => { d[PATRON_KAYNAK_REL] = d[PATRON_KAYNAK_REL].replace(PUSH_YOK_CUMLESI, 'Android uygulaması bildirim gönderir'); d[PATRON_HTML_REL] = uret(d[PATRON_KAYNAK_REL]); }, '§7'],
    ['N37 mağaza runbook\'u silme adresini anmıyor', 'kirmizi', deg(MAGAZA_REL, (t) => t.replaceAll(`${PATRON_ADRES}#${SILME_CAPASI}`, `${PATRON_ADRES}#silme`)), '§5'],
    ['N38 kurulum betiği Patron sayfasını taşımıyor', 'kirmizi', deg(KUR_REL, (t) => t.replace('SAYFALAR="gizlilik yonetim-gizlilik"', 'SAYFALAR="gizlilik"')), '§5'],
    ['N39 ölçüm betiği Patron sayfasını ölçmüyor', 'kirmizi', deg(OLC_REL, (t) => t.replaceAll('html/yonetim-gizlilik.html', 'html/x.html')), '§5'],
    ['N39b mağaza runbook\'u hâlâ eski adresi veriyor', 'kirmizi', deg(MAGAZA_REL, (t) => t.replaceAll(PATRON_ADRES, 'https://tekserp.etkiliyazilim.com/patron-gizlilik')), '§5'],
    ['N40 metin sürümü satırı yok', 'kirmizi', (d) => { d[PATRON_KAYNAK_REL] = d[PATRON_KAYNAK_REL].replace(/^\*\*Metin sürümü:\*\*.*\n/m, ''); d[PATRON_HTML_REL] = uret(d[PATRON_KAYNAK_REL]); }, '§5'],
    ['N41 kanca tetiği maintenance.ts kapsamıyor', 'kirmizi', deg(KANCA_REL, (t) => t.replace(`"${BAKIM_REL}"`, '"z"')), '§6'],
    ['N42 sh -c gövdesinde kesme işaretli yorum', 'kirmizi', deg(KUR_REL, (t) => t.replace("-c '\n", "-c '\n  # dosya onceki/'de kalır\n")), '§8'],
    ['P2 native push açıldı + metin güncellendi + üretildi', 'yesil', (d) => { d[PUSH_REL] = d[PUSH_REL].replace('export const NATIVE_PUSH = false;', 'export const NATIVE_PUSH = true;'); d[PATRON_KAYNAK_REL] = d[PATRON_KAYNAK_REL].replace(PUSH_YOK_CUMLESI, 'Android uygulaması anlık bildirim için cihazın bildirim anahtarını kaydeder'); d[PATRON_HTML_REL] = uret(d[PATRON_KAYNAK_REL]); }],
    ['O1 CF kaynağı okunamadı', 'olculemedi', deg(CF_REL, () => undefined)],
    ['O2 CLOUDFLARE_NETWORKS adı değişti', 'olculemedi', deg(CF_REL, (t) => t.replaceAll('CLOUDFLARE_NETWORKS', 'CF_AGLARI'))],
    ['O3 IDENTITY_PURGE_DAYS adı değişti', 'olculemedi', deg(BAKIM_REL, (t) => t.replaceAll('IDENTITY_PURGE_DAYS', 'KIMLIK_SILME_GUN'))],
    ['O4 push kapısı okunamadı', 'olculemedi', deg(PUSH_REL, () => undefined)],
  ];
  let kotu = 0;
  for (const [ad, beklenen, boz, ileti] of liste) {
    const d = { ...taban };
    try {
      boz(d);
    } catch (e) {
      console.log(`❌ ${ad} — sonda kurulamadı: ${e.message}`);
      kotu++;
      continue;
    }
    if ((beklenen !== 'yesil' || ad.startsWith('P1') || ad.startsWith('P2')) && Object.keys(d).every((k) => d[k] === taban[k])) { console.log(`❌ ${ad} — bozma metni değiştirmedi (sonda geçersiz)`); kotu++; continue; }
    const s = olc(d);
    const h = s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil';
    const ok = h === beklenen && (!ileti || s.kirmizi.some((x) => x.startsWith(ileti)));
    if (!ok) kotu++;
    console.log(`${ok ? '✅' : '❌'} ${ad} → ${h}${ok ? '' : ` (beklenen ${beklenen}): ${[...s.olculemedi, ...s.kirmizi].join(' · ')}`}`);
  }
  console.log(kotu ? `\n❌ ${kotu} sonda beklenmeyen sonuç verdi` : `\n✅ ${liste.length} sonda beklendiği gibi`);
  return kotu === 0;
}

const girdi = dosyalariOku();
if (process.argv.includes('--sonda')) {
  console.log('test_gizlilik_sayfasi — kalıcı sondalar (bellekteki kopyalara karşı)\n');
  const t = olc(girdi);
  if (t.olculemedi.length || t.kirmizi.length) {
    console.log(`⛔ ÖLÇÜLEMEDİ — sonda tabanı yeşil değil: ${[...t.olculemedi, ...t.kirmizi].join(' · ')}`);
    process.exit(2);
  }
  process.exit(sondalar(girdi) ? 0 : 1);
}
const s = olc(girdi);
for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ ${x}`);
for (const x of s.kirmizi) console.log(`❌ ${x}`);
if (!s.olculemedi.length && !s.kirmizi.length) {
  console.log('✅ yasal sayfalar (/gizlilik · /yonetim-gizlilik · eski /patron-gizlilik 301): kaynak ↔ html bayt-eşit · e-posta email_off içinde · compose ayrı ve salt-okunur · kenar zinciri CF birebir · nginx önbellek/always/404 · adres + #hesap-silme tutarlı · Patron süreleri/push koda eşit · kablolu');
  const yt = SAYFALAR.flatMap(({ html }) => (typeof girdi[html] === 'string' ? yerTutucular(girdi[html]) : []));
  if (yt.length) console.log(`⏳ yayın öncesi doldurulacak yer tutucu (vds-kur.sh --uygula durdurur): ${yt.join(' ')}`);
}
process.exit(s.olculemedi.length ? 2 : s.kirmizi.length ? 1 : 0);
