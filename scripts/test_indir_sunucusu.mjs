#!/usr/bin/env node
// =============================================================================
// BEKÇİ — YENİ İNDİRME KÖKENİ (indir.etkiliyazilim.com, tek ortak paket 3.2) · zero-dep, DB'siz, ağsız
// =============================================================================
// Kaynak: deploy/guncelleme-sunucusu/indir/{docker-compose.yml, nginx/default.conf} (VDS /opt/stack/apps/tekserp-indir).
//   §1 compose ↔ dağıtım kaydı: proje/konteyner adı, Host kuralı = `indirmeKoku`nun ana makinesi, html bağı
//      `vdsKoku`nun kendisi (proje dizini onun ebeveyni), defter kökü konteynere BAĞLANMAZ, salt-okunur bağ
//   §2 ESKİ siteden ayrılık: yönlendirici/servis/ara katman adları eski `tekserpguncelleme` ile ve eski
//      Host ile kesişmez; eski compose yeni host'u anmaz
//   §3 kenar zinciri (deploy/traefik/kenar-zinciri.mjs): Cloudflare ipallowlist = satıcı `CLOUDFLARE_NETWORKS`
//      birebir → Cf-Connecting-Ip hız seddi; yalnız kendi ara katmanları (başka sağlayıcının/servisin adı yok)
//   §4 nginx: uzun önbellekli konumda `always` YOK · OTA manifest sınırlayıcısı = feed.cjs `MULTIPART_BOUNDARY`
//      + expo başlıkları · nokta-dosya (yarım yükleme) 404 · dizin listesi kapalı · 404 no-store
//   §5 kablolama: commit kancası + CI bu bekçiyi koşar
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ. Cırcır değil (taban yok).
//   node scripts/test_indir_sunucusu.mjs          # dinlenme durumu
//   node scripts/test_indir_sunucusu.mjs --sonda  # kalıcı negatif + pozitif sondalar (bellekteki kopyalara karşı)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { KAYIT_REL, KOK, kayitAyristir, kayitHatalari } from './lib/dagitim.mjs';
import { kenarZinciriSorunlari } from '../deploy/traefik/kenar-zinciri.mjs';

const COMPOSE_REL = 'deploy/guncelleme-sunucusu/indir/docker-compose.yml';
const NGINX_REL = 'deploy/guncelleme-sunucusu/indir/nginx/default.conf';
const ESKI_COMPOSE_REL = 'deploy/guncelleme-sunucusu/docker-compose.yml';
const CF_REL = 'satici/sunucu/src/http/client-address.ts';
const FEED_REL = 'mobil/scripts/lib/feed.cjs';
const KANCA_REL = 'scripts/hooks/pre-commit.mjs';
const CI_REL = '.github/workflows/ci.yml';
const BEN_REL = 'scripts/test_indir_sunucusu.mjs';

const PROJE = 'tekserp-indir';
const YONLENDIRICI = 'tekserp-indir';
const ESKI_YONLENDIRICI = 'tekserpguncelleme';
const ESKI_HOST = 'guncelleme.etkiliyazilim.com';

/** Commit tetiği: bekçinin okuduğu her dosya (kanca bunu içe aktarmaz; §5 listenin kancada aynen geçtiğini ölçer). */
export const TETIK = Object.freeze([COMPOSE_REL, NGINX_REL, ESKI_COMPOSE_REL, CF_REL, FEED_REL, KAYIT_REL, BEN_REL, 'deploy/traefik/kenar-zinciri.mjs']);
const OKUNAN = [COMPOSE_REL, NGINX_REL, ESKI_COMPOSE_REL, CF_REL, FEED_REL, KAYIT_REL, KANCA_REL, CI_REL];

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

/** Compose metninden `- traefik.…=değer` etiketleri (tırnaklı ya da tırnaksız). */
export function etiketler(metin) {
  const e = {};
  for (const m of metin.matchAll(/^\s*-\s*"?(traefik\.[A-Za-z0-9._-]+)=(.*?)"?\s*$/gm)) e[m[1]] = m[2];
  return e;
}

function cloudflareAglari(kaynak) {
  if (typeof kaynak !== 'string') return null;
  const govde = /CLOUDFLARE_NETWORKS[^=]*=\s*\[([\s\S]*?)\]/.exec(kaynak)?.[1] ?? '';
  const liste = [...govde.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return liste.length > 0 ? liste : null;
}

/** nginx `location … { … }` blokları (iç içe blok yok — bu dosyada da yok). */
export function konumlar(metin) {
  return [...metin.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g)].map((m) => ({ desen: m[1].trim(), govde: m[2] }));
}

/** Saf ölçüm: girdiler enjekte edilebilir (sondalar). */
export function olc(d) {
  const s = { kirmizi: [], olculemedi: [] };
  for (const rel of OKUNAN) if (typeof d[rel] !== 'string') s.olculemedi.push(`${rel} okunamadı`);
  if (s.olculemedi.length) return s;

  let kayit;
  try {
    kayit = kayitAyristir(d[KAYIT_REL]);
  } catch (e) {
    s.olculemedi.push(e.message);
    return s;
  }
  if (kayitHatalari(kayit).length) {
    s.olculemedi.push(`${KAYIT_REL} geçersiz (önce check-dagitim)`);
    return s;
  }
  const host = new URL(kayit.indirmeKoku).host;
  const projeDizini = path.posix.dirname(kayit.vdsKoku);
  const c = d[COMPOSE_REL];
  const et = etiketler(c);

  // §1
  if (!/^name:\s*tekserp-indir\s*$/m.test(c)) s.kirmizi.push(`§1 compose proje adı "${PROJE}" değil`);
  if (path.posix.basename(projeDizini) !== PROJE) s.kirmizi.push(`§1 vdsKoku'nun ebeveyni (${projeDizini}) proje adıyla (${PROJE}) aynı değil`);
  if (!/^\s*container_name:\s*tekserp-indir\s*$/m.test(c)) s.kirmizi.push('§1 container_name tekserp-indir değil');
  if (path.posix.basename(kayit.vdsKoku) !== 'html' || !/^\s*-\s*\.\/html:\/usr\/share\/nginx\/html:ro\s*$/m.test(c)) {
    s.kirmizi.push(`§1 html bağı "./html:/usr/share/nginx/html:ro" ve vdsKoku …/${PROJE}/html olmalı`);
  }
  const defterAdi = path.posix.basename(kayit.defterKoku);
  if (new RegExp(`^\\s*-\\s*[^\\n]*\\b${defterAdi}\\b[^\\n]*:`, 'm').test(c) || c.includes(kayit.defterKoku)) {
    s.kirmizi.push(`§1 defter kökü (${defterAdi}) konteynere bağlanıyor — yayın defteri internetten okunur olurdu`);
  }
  if (et[`traefik.http.routers.${YONLENDIRICI}.rule`] !== `Host(\`${host}\`)`) {
    s.kirmizi.push(`§1 yönlendirici kuralı Host(\`${host}\`) değil: ${et[`traefik.http.routers.${YONLENDIRICI}.rule`] ?? 'YOK'}`);
  }
  if (et[`traefik.http.routers.${YONLENDIRICI}.entrypoints`] !== 'websecure') s.kirmizi.push('§1 entrypoints websecure değil');
  if (et[`traefik.http.routers.${YONLENDIRICI}.tls`] !== 'true') s.kirmizi.push('§1 tls=true yok');
  if (et['traefik.enable'] !== 'true') s.kirmizi.push('§1 traefik.enable=true yok');

  // §2
  const adlar = Object.keys(et).map((k) => k.split('.')[3]).filter(Boolean);
  for (const ad of new Set(adlar)) {
    if (ad === ESKI_YONLENDIRICI || !ad.startsWith(PROJE)) s.kirmizi.push(`§2 etiket adı "${ad}" yeni sitenin kendi önekinde (${PROJE}) değil`);
  }
  for (const [k, v] of Object.entries(et)) if (v.includes(ESKI_HOST)) s.kirmizi.push(`§2 ${k} eski adresi (${ESKI_HOST}) anıyor`);
  if (d[ESKI_COMPOSE_REL].includes(host)) s.kirmizi.push(`§2 eski compose yeni adresi (${host}) anıyor — eski site değişmez`);

  // §3
  const cf = cloudflareAglari(d[CF_REL]);
  if (cf === null) s.olculemedi.push(`§3 ${CF_REL} CLOUDFLARE_NETWORKS okunamadı`);
  else for (const x of kenarZinciriSorunlari(et, YONLENDIRICI, cf)) s.kirmizi.push(`§3 ${x}`);
  for (const h of (et[`traefik.http.routers.${YONLENDIRICI}.middlewares`] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (h.includes('@') || !h.startsWith(`${PROJE}-`)) s.kirmizi.push(`§3 ara katman "${h}" bu servisin kendi etiketi değil (başka servise bağlanmak indirmeyi onun sağlığına bağlar)`);
  }

  // §4
  const n = d[NGINX_REL];
  const sinir = /MULTIPART_BOUNDARY\s*=\s*'([^']+)'/.exec(d[FEED_REL])?.[1];
  if (!sinir) s.olculemedi.push(`§4 ${FEED_REL} MULTIPART_BOUNDARY okunamadı`);
  const k = konumlar(n);
  if (k.length < 5) s.olculemedi.push(`§4 nginx konum blokları ayrıştırılamadı (${k.length})`);
  for (const { desen, govde } of k) {
    for (const satir of govde.split('\n')) {
      const m = /add_header\s+Cache-Control\s+"([^"]*)"(.*);/i.exec(satir);
      if (!m) continue;
      const yas = /max-age=([0-9]+)/.exec(m[1]);
      if (yas && Number(yas[1]) > 0 && /\balways\b/.test(m[2])) s.kirmizi.push(`§4 "${desen}" uzun önbellek başlığında always (404 bir hafta kenarda kalır)`);
    }
  }
  const manifest = k.find((x) => x.desen.includes('/mobil/ota/') && x.desen.includes('manifest'));
  if (!manifest) s.kirmizi.push('§4 OTA manifest konumu yok');
  else {
    if (sinir && !manifest.govde.includes(`boundary=${sinir}`)) s.kirmizi.push(`§4 manifest sınırlayıcısı feed.cjs'tekiyle (${sinir}) aynı değil`);
    if (!/add_header\s+expo-protocol-version\s+1\s+always;/.test(manifest.govde)) s.kirmizi.push('§4 manifest expo-protocol-version başlığı yok');
    if (!/add_header\s+Cache-Control\s+"no-cache[^"]*"\s+always;/.test(manifest.govde)) s.kirmizi.push('§4 manifest no-cache değil');
  }
  const nokta = k.find((x) => x.desen === '~ (^|/)\\.');
  if (!nokta || !/return\s+404;/.test(nokta.govde)) s.kirmizi.push('§4 nokta-dosya (yarım yükleme) konumu 404 dönmüyor');
  else if (k.indexOf(nokta) !== 0) s.kirmizi.push('§4 nokta-dosya konumu ilk regex değil (önceki konum yarım yüklemeyi sunar)');
  if (!/^\s*autoindex\s+off;/m.test(n)) s.kirmizi.push('§4 autoindex off yok');
  const bulunamadi = k.find((x) => x.desen === '@bulunamadi');
  if (!/error_page\s+404\s*=\s*@bulunamadi;/.test(n) || !bulunamadi || !/Cache-Control\s+"no-store"\s+always;/.test(bulunamadi.govde)) {
    s.kirmizi.push('§4 404 no-store ikinci hattı yok');
  }

  // §5
  const kanca = d[KANCA_REL];
  if (!kanca.includes(`"${BEN_REL}"`)) s.kirmizi.push('§5 commit kancasında bu bekçinin adımı yok');
  for (const t of TETIK) if (!kanca.includes(`"${t}"`)) s.kirmizi.push(`§5 commit kancası tetiği "${t}"i kapsamıyor`);
  if (!d[CI_REL].includes(`node ${BEN_REL} && node ${BEN_REL} --sonda`)) s.kirmizi.push('§5 CI bu bekçiyi (+ --sonda) koşmuyor');
  return s;
}

function sondalar(taban) {
  const deg = (rel, f) => (d) => { d[rel] = f(d[rel]); };
  const C = (f) => deg(COMPOSE_REL, f);
  const N = (f) => deg(NGINX_REL, f);
  const liste = [
    ['P0 dinlenme durumu', 'yesil', () => {}],
    ['P1 hız seddi daha yüksek (40/sn)', 'yesil', C((t) => t.replace('ratelimit.average=20', 'ratelimit.average=40'))],
    ['N1 ara katman zinciri yok', 'kirmizi', C((t) => t.replace(/^.*routers\.tekserp-indir\.middlewares=.*\n/m, ''))],
    ['N2 satıcının ara katmanına bağlanmış', 'kirmizi', C((t) => t.replace('middlewares=tekserp-indir-cf,tekserp-indir-hiz', 'middlewares=tekserp-satici-uretim-cf@docker,tekserp-satici-uretim-hiz@docker'))],
    ['N3 CF listesinden bir aralık eksik', 'kirmizi', C((t) => t.replace('173.245.48.0/20,', ''))],
    ['N4 ipallowlist başlıktan okuyor (ipstrategy)', 'kirmizi', C((t) => t.replace(/(ratelimit\.burst=600\n)/, '$1      - traefik.http.middlewares.tekserp-indir-cf.ipallowlist.ipstrategy.depth=1\n'))],
    ['N5 sıra ters (hız önce)', 'kirmizi', C((t) => t.replace('middlewares=tekserp-indir-cf,tekserp-indir-hiz', 'middlewares=tekserp-indir-hiz,tekserp-indir-cf'))],
    ['N6 Host eski adres', 'kirmizi', C((t) => t.replace('Host(`indir.etkiliyazilim.com`)', 'Host(`guncelleme.etkiliyazilim.com`)'))],
    ['N7 eski yönlendirici adı', 'kirmizi', C((t) => t.replaceAll('routers.tekserp-indir.', 'routers.tekserpguncelleme.'))],
    ['N8 defter konteynere bağlı', 'kirmizi', C((t) => t.replace('      - ./html:/usr/share/nginx/html:ro\n', '      - ./html:/usr/share/nginx/html:ro\n      - ./defter:/defter:ro\n'))],
    ['N9 html bağı yazılabilir', 'kirmizi', C((t) => t.replace('./html:/usr/share/nginx/html:ro', './html:/usr/share/nginx/html'))],
    ['N10 tls yok', 'kirmizi', C((t) => t.replace(/^.*routers\.tekserp-indir\.tls=true\n/m, ''))],
    ['N11 eski compose yeni adresi anıyor', 'kirmizi', deg(ESKI_COMPOSE_REL, (t) => `${t}\n# indir.etkiliyazilim.com\n`)],
    ['N12 exe konumunda always', 'kirmizi', N((t) => t.replace(/(location ~ \\\.\(exe\|blockmap\|zip\)\$ \{[^}]*max-age=604800")/, '$1 always'))],
    ['N13 OTA varlık konumunda always', 'kirmizi', N((t) => t.replace(/(\/\[0-9\]\+\/ \{\s*add_header Cache-Control "public, max-age=604800")/, '$1 always'))],
    ['N14 sınırlayıcı farklı', 'kirmizi', N((t) => t.replace('boundary=tekserpota', 'boundary=baska'))],
    ['N15 nokta-dosya konumu yok', 'kirmizi', N((t) => t.replace(/location ~ \(\^\|\/\)\\\. \{\s*return 404;\s*\}/, ''))],
    ['N16 nokta-dosya konumu sonda (öncekiler yarım yüklemeyi sunar)', 'kirmizi', N((t) => {
      const blok = /\n\s*location ~ \(\^\|\/\)\\\. \{\s*return 404;\s*\}\n/.exec(t)[0];
      return t.replace(blok, '\n').replace('    error_page 404', `${blok}    error_page 404`);
    })],
    ['N17 autoindex açık', 'kirmizi', N((t) => t.replace('autoindex off;', 'autoindex on;'))],
    ['N18 404 no-store hattı yok', 'kirmizi', N((t) => t.replace('error_page 404 = @bulunamadi;', ''))],
    ['N19 kancada adım yok', 'kirmizi', deg(KANCA_REL, (t) => t.replaceAll(`"${BEN_REL}"`, '"x"'))],
    ['N20 CI koşmuyor', 'kirmizi', deg(CI_REL, (t) => t.replaceAll(BEN_REL, 'scripts/x.mjs'))],
    ['N21 kanca tetiği client-address.ts kapsamıyor', 'kirmizi', deg(KANCA_REL, (t) => t.replace(`"${CF_REL}"`, '"y"'))],
    ['O1 CF kaynağı okunamadı', 'olculemedi', deg(CF_REL, () => undefined)],
    ['O2 CLOUDFLARE_NETWORKS adı değişti', 'olculemedi', deg(CF_REL, (t) => t.replaceAll('CLOUDFLARE_NETWORKS', 'CF_AGLARI'))],
    ['O3 feed.cjs sınırlayıcı adı değişti', 'olculemedi', deg(FEED_REL, (t) => t.replace('MULTIPART_BOUNDARY', 'SINIR'))],
    ['O4 dağıtım kaydı bozuk', 'olculemedi', deg(KAYIT_REL, () => '{')],
  ];
  let kotu = 0;
  for (const [ad, beklenen, boz] of liste) {
    const d = { ...taban };
    let once;
    try {
      boz(d);
      once = d[COMPOSE_REL] === taban[COMPOSE_REL] && d[NGINX_REL] === taban[NGINX_REL] && Object.keys(d).every((k) => d[k] === taban[k]);
    } catch (e) {
      console.log(`❌ ${ad} — sonda kurulamadı: ${e.message}`);
      kotu++;
      continue;
    }
    if (beklenen !== 'yesil' && once) { console.log(`❌ ${ad} — bozma metni değiştirmedi (sonda geçersiz)`); kotu++; continue; }
    const s = olc(d);
    const h = s.olculemedi.length ? 'olculemedi' : s.kirmizi.length ? 'kirmizi' : 'yesil';
    const ok = h === beklenen;
    if (!ok) kotu++;
    console.log(`${ok ? '✅' : '❌'} ${ad} → ${h}${ok ? '' : ` (beklenen ${beklenen}): ${[...s.olculemedi, ...s.kirmizi].join(' · ')}`}`);
  }
  console.log(kotu ? `\n❌ ${kotu} sonda beklenmeyen sonuç verdi` : `\n✅ ${liste.length} sonda beklendiği gibi`);
  return kotu === 0;
}

const girdi = dosyalariOku();
if (process.argv.includes('--sonda')) {
  console.log('test_indir_sunucusu — kalıcı sondalar (bellekteki kopyalara karşı)\n');
  const t = olc(girdi);
  if (t.olculemedi.length || t.kirmizi.length) {
    console.log(`⛔ ÖLÇÜLEMEDİ — sonda tabanı yeşil değil; önce dinlenme ölçümü: ${[...t.olculemedi, ...t.kirmizi].join(' · ')}`);
    process.exit(2);
  }
  process.exit(sondalar(girdi) ? 0 : 1);
}
const s = olc(girdi);
for (const x of s.olculemedi) console.log(`⛔ ÖLÇÜLEMEDİ ${x}`);
for (const x of s.kirmizi) console.log(`❌ ${x}`);
if (!s.olculemedi.length && !s.kirmizi.length) console.log('✅ indir kökeni: compose ↔ dağıtım kaydı · eski siteden ayrı · kenar zinciri CF birebir · nginx önbellek/sınırlayıcı/yarım yükleme · kablolu');
process.exit(s.olculemedi.length ? 2 : s.kirmizi.length ? 1 : 0);
