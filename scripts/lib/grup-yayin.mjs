// =============================================================================
// GRUP YAYINI — güncelleme grubuna (test → oncu → genel) çıkışın TEK kitaplığı · zero-dep (O10a · O10b · O11b)
// =============================================================================
// Üç ürün (panel · tablet · backend) aynı kapılardan geçer; ürüne özgü olan yalnız ARTEFAKT tablosudur (aşağıda).
// Ortak paket bir kez derlenir ve gruplara AYNI baytlarla çıkar; her gruba çıkışta künye o grubun adıyla yeniden
// imzalanır (paket dosyası bayt-eşit kalır). Hedef (VDS dizini · adres · defter) YALNIZ `deploy/dagitim.json`dan
// türer; eski kanal kaydı (`deploy/kanallar.json`) buradan okunur ama hiçbir zaman hedef olamaz (grup adı eski kanal
// kodu olamaz). Terfi şartları `scripts/lib/terfi.mjs`in hükmüyle AYNI yüklemden geçer; bu dosya grup zincirine uyarlar:
//   · test (kök grup): terfi etiketi İSTEMEZ (sürüm notu kapısı · temiz ağaç · derleme künyesi · profil matrisi
//     raporu yayın betiğinde ayrıca koşar — `scripts/profil-matrisi-kapisi.mjs`, üç yayıncı da onu çağırır);
//   · oncu/genel: HEAD == <ürün>-vX · terfi/<grup>/<ürün>-vX açıklamalı etiket (onay cümlesi + saat) ·
//     kaynak grupta yayındaki sürüm ≥ X · kaynak grubun artefaktının özeti = yüklenecek artefaktın özeti;
//   · K-6: kaynağı da terfi etiketli bir gruba (genel) çıkış İKİNCİ, AYRI onay ister — kaynak grubun onay etiketi
//     de HEAD'de olmalı ve iki etiketin cümlesi aynı olamaz.
// Üç sonuç: uyumlu · ihlal · ÖLÇÜLEMEDİ (ölçülemeyen şart geçmiş şart değildir).
//
// ⚠️ YENİ ADRES KAPISI (fail-closed): yeni adrese (indir.etkiliyazilim.com) GERÇEK yükleme, 3.9 D5 (zincirli `pkt-*`
//    imzalı listenin kökle doğrulanması + üretim imzası araçları) ve D8 (ilk PAKET sertifikası, kullanıcıyla) YAPILMADAN
//    çıkmaz. `--kuru` (ağsız) ve `--dogrula` (salt okuma) bu kapıdan etkilenmez. Kapıyı AÇMAK = D5 + D8 işini bitiren
//    dilimin `YENI_ADRES_KAPISI.acik`ı bir kararla `true` yapması; bekçi kapalıyken yüklemenin DURDUĞUNU ölçer.
// Bekçiler: scripts/test_grup_yayin_kapisi.mjs (panel) · scripts/test_grup_yayin_tablet.mjs · scripts/test_backend_yayin.mjs §3G
// =============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { AYRILMIS_GRUP_KODLARI, ESKI_KAYIT_REL, GRUP_KODU_DESENI, KAYIT_REL, KOK, Olculemedi, grupZinciri, kayitAyristir, terfiKaynagi, turet } from './dagitim.mjs';
import { dosyaOzeti } from './derleme-bagi.mjs';
import { cumleDenetle } from './kullanici-cumlesi.mjs';
import { gitOlgulari, kaynakSurumleri, terfiHukmu } from './terfi.mjs';
import { ayristir, etiketAdi, terfiEtiketAdi } from './surum.mjs';
import { GUVENLI_YOL, SSH_HEDEF_VARSAYILAN } from './yayin-okuma.mjs';
import { uzakDegerDenetle } from './yayin-hedefi.mjs';

const ADRES = /^https:\/\/[a-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._/-]*$/;
const YOK_KODU = 44;
const SSH_ZAMAN_ASIMI_MS = 120_000;

/**
 * Tablet artefaktları — grubun `mobil/` dizinine göre yol. İki tür vardır ve ikisi de terfide BAYT-EŞİT kopyalanır:
 *   apk: `apk/TeksERP-<sürüm>-vc<vc>.apk` · ota: `ota/<rv>/<damga>/<bundle>` (bundle adı içeriğin özetidir).
 * Tabletin künyeleri (OTA manifesti · `apk/surum.json`) artefakt DEĞİL işaretçidir ve grup başına yeniden imzalanır.
 */
const GORELI_GUVENLI = /^[A-Za-z0-9._/-]+$/;
export const TABLET_ARTEFAKT_GORELI = Object.freeze({
  apk: ({ surum, vc }) => `apk/TeksERP-${surum}-vc${vc}.apk`,
  ota: ({ rv, damga, bundle }) => {
    const b = String(bundle);
    if (!GORELI_GUVENLI.test(b) || b.startsWith('/') || b.split('/').includes('..')) throw new Olculemedi(`OTA bundle yolu tanınmıyor: "${bundle}"`);
    return `ota/${rv}/${damga}/${b}`;
  },
});

export const YENI_ADRES_KAPISI = Object.freeze({
  acik: false,
  sart: Object.freeze([
    '3.9 D5: PAKET zincirli (pkt-*) imzalı listenin kökle doğrulanması + üretim imzası araçları',
    '3.9 D8: ilk PAKET sertifikası (kullanıcıyla yıllık tören)',
  ]),
});

/** Kapı kapalıysa DUR satırları, açıksa boş dizi. */
export function yeniAdresKapisiSatirlari(kapi = YENI_ADRES_KAPISI) {
  if (kapi.acik === true) return [];
  return [
    'Yeni adrese (indir.etkiliyazilim.com) GERÇEK yayın kapalı — şu işler bitmeden açılmaz:',
    ...kapi.sart.map((s) => `  • ${s}`),
    'Denemek için: --kuru (ağsız) ya da --dogrula (salt okuma). Kapı scripts/lib/grup-yayin.mjs YENI_ADRES_KAPISI.',
  ];
}

/**
 * ARTEFAKT tablosu — ürün başına, terfide özet eşitliği (④) ölçülen ANA artefakt. Yol, kaynak grubun ürün dizinine göre.
 *   kaynak: 'dizin'   → yerel dosya ortak paket dizininde (`dizin` + yol) · 'cagiran' → çağıran `artefakt` verir
 *   olculmez          → özet eşitliği beyanlı olarak henüz yok (gerekçeyle); YENI_ADRES_KAPISI açılınca ÖLÇÜLEMEDİ olur
 */
export const ARTEFAKT = Object.freeze({
  panel: Object.freeze({ kaynak: 'dizin', goreli: (surum) => `TeksERP-${surum}-Setup.exe` }),
  tablet: Object.freeze({ kaynak: 'cagiran', goreli: (surum, ek = {}) => TABLET_ARTEFAKT_GORELI.apk({ surum, vc: ek.vc }) }),
  backend: Object.freeze({
    kaynak: null,
    olculmez: 'backend paketinin kaynak grup özeti henüz ölçülmüyor — gerçek yükleme YENI_ADRES_KAPISI ile kapalı; kapıyı açan dilim (D5 + D8) bu satırı tanımlar',
  }),
});

/** Kapının ihlal hatası: `satirlar` ile (CLI `grup-yayin-kapisi.mjs` satırları basıp durur). */
export class GrupIhlali extends Error {
  constructor(mesaj, satirlar = []) {
    super(mesaj);
    this.satirlar = satirlar;
  }
}

/** `deploy/dagitim.json` (okunamazsa ÖLÇÜLEMEDİ). */
export function dagitimKaydi(kok = KOK) {
  try {
    return kayitAyristir(fs.readFileSync(path.join(kok, KAYIT_REL), 'utf8'));
  } catch (e) {
    if (e instanceof Olculemedi) throw e;
    throw new Olculemedi(`${KAYIT_REL} okunamadı: ${e.message}`);
  }
}

/** Eski kanal kodları (`deploy/kanallar.json`) — yalnız OKUNUR; okunamazsa ÖLÇÜLEMEDİ. */
export function eskiKanalKodlari(kok = KOK) {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(path.join(kok, ESKI_KAYIT_REL), 'utf8')).kanallar ?? {});
  } catch (e) {
    throw new Olculemedi(`${ESKI_KAYIT_REL} okunamadı (eski kanal kodu ayrımı ölçülemedi): ${e.message}`);
  }
}

/**
 * Hedef grup geçerli mi: biçim · eski kanal kodu DEĞİL · kayıtlı grup. Fail-closed; hata `GrupIhlali` ya da ÖLÇÜLEMEDİ.
 * @returns {{kayit: object, zincir: string[], kaynak: string|null}}
 */
export function grupCoz(grup, { kok = KOK, kayit, eskiKodlar } = {}) {
  const g = String(grup ?? '');
  if (!GRUP_KODU_DESENI.test(g) || AYRILMIS_GRUP_KODLARI.includes(g)) {
    throw new GrupIhlali(`"${g}" bir güncelleme grubu kodu değil`, [`Grup kodu ${GRUP_KODU_DESENI} biçimindedir ve ayrılmış kod (${AYRILMIS_GRUP_KODLARI.join(', ')}) olamaz.`]);
  }
  const eski = eskiKodlar ?? eskiKanalKodlari(kok);
  if (eski.includes(g)) {
    throw new GrupIhlali(`"${g}" ESKİ KANAL kodu — grup yayınının hedefi olamaz`, [
      'Eski kanallar (deploy/kanallar.json) bu yoldan yayın almaz (eski yayın yolu emekli: eski-kanal-son etiketi, docs/ops/ESKI-KANAL-ACIL.md); grup yayını yalnız dağıtım kaydındaki gruplara gider.',
    ]);
  }
  const k = kayit ?? dagitimKaydi(kok);
  const { zincir, hatalar } = grupZinciri(k.gruplar);
  if (hatalar.length) throw new Olculemedi(`${KAYIT_REL} grup zinciri geçersiz: ${hatalar[0]}`);
  if (!zincir.includes(g)) throw new GrupIhlali(`"${g}" ${KAYIT_REL} içinde kayıtlı bir güncelleme grubu değil`, [`Kayıtlı gruplar: ${zincir.join(' → ')}`]);
  return { kayit: k, zincir, kaynak: terfiKaynagi(k, g) };
}

/**
 * Grubun yayın hedefi — VDS dizini, doğrulama adresi (sondaki `/` yok) ve defter dosyası (hepsi kayıttan türer).
 * @returns {{ssh: string, vds: string, feed: string, defter: string}}
 */
export function grupHedefi(grup, urun, secenek = {}) {
  const { kayit } = grupCoz(grup, secenek);
  const t = turet(kayit).gruplar[grup]?.[urun];
  if (!t) throw new Olculemedi(`bilinmeyen ürün "${urun}" (panel | tablet | backend)`);
  const vds = String(t.vds).replace(/\/+$/, '');
  const feed = String(t.feed).replace(/\/+$/, '');
  for (const [ad, v] of [['vds', vds], ['defter', t.defter]]) {
    if (!GUVENLI_YOL.test(v) || v.split('/').includes('..')) throw new Olculemedi(`grup "${grup}" ${ad} güvenli bir VDS yolu değil: "${v}"`);
  }
  if (!ADRES.test(`${feed}/`)) throw new Olculemedi(`grup "${grup}" yayın adresi https adresi değil: "${feed}"`);
  return { ssh: SSH_HEDEF_VARSAYILAN, vds, feed, defter: t.defter };
}

/** Grubun yayın bloğu, `kaynakSurumleri`nin beklediği kanal biçiminde (adres → VDS yolu eşlemesi için). */
export function grupYayinBlogu(grup, secenek = {}) {
  const { kayit } = grupCoz(grup, secenek);
  const t = turet(kayit).gruplar[grup];
  return {
    yayin: {
      panelFeed: t.panel.feed, vdsPanel: t.panel.vds, panelManifest: t.panel.manifest,
      mobilFeed: t.tablet.feed, vdsMobil: t.tablet.vds, otaManifest: t.tablet.otaManifest, apkKunye: t.tablet.apkKunye,
      backendFeed: t.backend.feed, vdsBackend: t.backend.vds, backendManifest: t.backend.manifest, backendDefter: t.backend.defter,
    },
  };
}

/** Kaynak grupta yayındaki sürüm(ler) — adresler grup bloğundan, okuma SSH ile VDS diskinden. */
export function kaynakGrupSurumleri(kaynakGrup, urun, secenek = {}) {
  return kaynakSurumleri(grupYayinBlogu(kaynakGrup, secenek), urun, secenek.oku);
}

/** Uzak dosyanın sha256'sı (ssh; yol stdin betiğine konumsal argümanla gider). */
export function uzakSha256(yol, { hedef = SSH_HEDEF_VARSAYILAN } = {}) {
  try {
    uzakDegerDenetle('yol', yol);
  } catch (e) {
    return { durum: 'olculemedi', neden: e.message };
  }
  const r = spawnSync('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', hedef, 'bash', '-s', '--', yol], {
    input: `test -f "$1" || exit ${YOK_KODU}\nsha256sum -- "$1" | cut -d' ' -f1\n`,
    encoding: 'utf8', timeout: SSH_ZAMAN_ASIMI_MS,
  });
  if (r.status === YOK_KODU) return { durum: 'yok' };
  const ozet = String(r.stdout ?? '').trim();
  if (r.status === 0 && /^[0-9a-f]{64}$/.test(ozet)) return { durum: 'var', sha256: ozet };
  return { durum: 'olculemedi', neden: `${hedef}:${yol} özeti okunamadı (ssh çıkış ${r.status ?? r.error?.code ?? '?'})` };
}

/** Cümle karşılaştırması için sadeleştirme (büyük/küçük harf ve boşluk farkı ayrı onay sayılmaz). */
const sade = (c) => c.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

/**
 * Hüküm — saf. `terfiHukmu`nun üzerine iki grup şartı ekler (kaçışta ve kök grupta eklenmez):
 *   ④ kaynak artefaktın özeti = yüklenecek artefaktın özeti (`ozet`: `{yerel, kaynak}`; null = kuru kip;
 *      `{olculmez}` = ürünün ARTEFAKT satırında beyanlı olarak yok)
 *   ⑤ K-6: kaynak grup da onay etiketli ise o etiket HEAD'de ve cümlesi bu grubunkinden FARKLI (`kaynakOnay`:
 *      `{grup, etiket}`; `{grup, olculemedi}` = kaynak grubun git olgusu ölçülemedi)
 * @returns {{sonuc: 'uyumlu'|'ihlal'|'olculemedi', gerekmez?: boolean, atlandi?: object, satirlar: string[]}}
 */
export function grupTerfiHukmu({ grup, urun, surum, kaynak, git, kaynaklar, atla, ozet = null, kaynakOnay = null }) {
  const h = terfiHukmu({ kod: grup, urun, surum, kaynak, git, kaynaklar, atla });
  if (h.gerekmez || h.atlandi || h.sonuc === 'ihlal' && !git) return h;
  const ihlal = [];
  const olculemedi = [];
  const tamam = [];
  if (ozet === null) tamam.push(`④ kaynak artefaktın özeti ÖLÇÜLMEDİ (kuru kip: ağ yok) — gerçek yayında ölçülür`);
  else if (ozet.olculmez) tamam.push(`④ ${urun}: kaynak artefakt özeti ÖLÇÜLMEDİ — ${ozet.olculmez}`);
  else if (ozet.kaynak.durum === 'var') {
    if (ozet.kaynak.sha256 === ozet.yerel) tamam.push(`④ ${kaynak} grubundaki artefakt = yüklenecek artefakt (sha256 ${ozet.yerel.slice(0, 16)}…)`);
    else ihlal.push(`④ ${kaynak} grubundaki artefaktın özeti (${ozet.kaynak.sha256.slice(0, 16)}…) yüklenecek artefaktınkinden (${ozet.yerel.slice(0, 16)}…) FARKLI — test edilen bayt bu değil; paketi ${kaynak} grubuna çıkan haliyle terfi ettir`);
  } else if (ozet.kaynak.durum === 'yok') ihlal.push(`④ ${kaynak} grubunda ${urun} ${surum} artefaktı YOK — önce ${kaynak} grubuna çıkar ve test et`);
  else olculemedi.push(`④ ${kaynak} grubundaki artefaktın özeti OKUNAMADI — ${ozet.kaynak.neden}`);

  if (kaynakOnay?.olculemedi) olculemedi.push(`⑤ K-6: ${kaynakOnay.grup} onay etiketi ÖLÇÜLEMEDİ — ${kaynakOnay.olculemedi}`);
  else if (kaynakOnay !== null) {
    const te = terfiEtiketAdi(kaynakOnay.grup, urun, surum);
    const bu = git?.terfiEtiketi;
    const buCumle = bu ? cumleDenetle(bu.mesaj) : null;
    const k = kaynakOnay.etiket;
    const kCumle = k ? cumleDenetle(k.mesaj) : null;
    if (!k) ihlal.push(`⑤ K-6: ${kaynakOnay.grup} onay etiketi (${te}) YOK — ${grup} grubuna çıkış ikinci, AYRI bir onay ister`);
    else if (k.tur !== 'tag' || k.commit !== git?.bas) ihlal.push(`⑤ K-6: ${te} HEAD'de açıklamalı etiket değil — ${kaynakOnay.grup} onayı bu kodu kapsamıyor`);
    else if (!kCumle.gecerli) ihlal.push(`⑤ K-6: ${te} mesajı onay cümlesini taşımıyor (${kCumle.sebep})`);
    else if (buCumle?.gecerli && sade(buCumle.cumle) === sade(kCumle.cumle)) ihlal.push(`⑤ K-6: ${grup} onay cümlesi ${kaynakOnay.grup} onay cümlesiyle AYNI — ikinci onay ayrı bir cümle ister`);
    else tamam.push(`⑤ K-6: ${te} HEAD'de, cümlesi ${grup} onayından ayrı`);
  }
  const satirlar = [...h.satirlar.filter((s) => s.startsWith('✓')), ...tamam.map((x) => `✓ ${x}`),
    ...h.satirlar.filter((s) => !s.startsWith('✓')), ...ihlal.map((x) => `✖ ${x}`), ...olculemedi.map((x) => `? ${x}`)];
  const sonuc = h.sonuc === 'ihlal' || ihlal.length ? 'ihlal' : h.sonuc === 'olculemedi' || olculemedi.length ? 'olculemedi' : 'uyumlu';
  return { sonuc, satirlar };
}

/**
 * Kapının tamamı (üç ürün): grup + git + kaynak grup olgularını toplar, hükmü verir. Okunamayan her şey ÖLÇÜLEMEDİ
 * (fırlatmaz); eski kanal kodu / bilinmeyen grup İHLAL.
 * @param {{grup: string, urun: 'panel'|'tablet'|'backend', surum: string, atla?: string, kuru?: boolean, dizin?: string,
 *   kok?: string, kayit?: object, eskiKodlar?: string[], oku?: Function, ozetOku?: Function,
 *   artefakt?: {yerel: string, goreli: string}, git?: object, kaynakGit?: object|null, adresKapisi?: object}} o
 *   `dizin`: ortak paket dizini (ARTEFAKT.kaynak='dizin') · `artefakt`: yerel dosya + kaynak grubun ürün dizinine göre
 *   yolu (ARTEFAKT.kaynak='cagiran', tablet: APK ya da OTA bundle) · `git`/`kaynakGit`: bekçi için enjekte git olguları
 *   (`git` verilip K-6 gereken yerde `kaynakGit` verilmezse ⑤ ÖLÇÜLEMEDİ — gerçek depoya düşülmez)
 */
export function grupTerfiKapisi({ grup, urun, surum, atla, kuru = false, dizin, kok = KOK, kayit, eskiKodlar, oku, ozetOku = uzakSha256, artefakt, git, kaynakGit, adresKapisi = YENI_ADRES_KAPISI }) {
  let zincir;
  let kaynak;
  try {
    ({ kayit, zincir, kaynak } = grupCoz(grup, { kok, kayit, eskiKodlar }));
  } catch (e) {
    if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [e.message] };
    if (e instanceof GrupIhlali) return { sonuc: 'ihlal', satirlar: [e.message, ...e.satirlar] };
    throw e;
  }
  const tablo = Object.prototype.hasOwnProperty.call(ARTEFAKT, urun) ? ARTEFAKT[urun] : null;
  if (!tablo) return { sonuc: 'olculemedi', satirlar: [`bilinmeyen ürün "${urun ?? ''}" (${Object.keys(ARTEFAKT).join(' | ')})`] };
  if (!kaynak || atla !== undefined) return grupTerfiHukmu({ grup, urun, surum, kaynak, git: null, kaynaklar: null, atla });
  if (!zincir.includes(kaynak)) return { sonuc: 'olculemedi', satirlar: [`terfi kaynağı "${kaynak}" kayıtta yok`] };
  if (!ayristir(surum)) return { sonuc: 'olculemedi', satirlar: [`sürüm "${surum ?? ''}" ayrıştırılamadı — terfi şartları hangi sürüm için ölçülecek belirsiz`] };
  const k6 = Boolean(terfiKaynagi(kayit, kaynak));
  let olgu = git;
  let kaynakOnay = null;
  try {
    if (!olgu) olgu = gitOlgulari({ kod: grup, urun, surum, kok });
    if (k6) {
      if (kaynakGit !== undefined) kaynakOnay = { grup: kaynak, etiket: kaynakGit?.terfiEtiketi ?? null };
      else if (git) kaynakOnay = { grup: kaynak, olculemedi: 'kaynak grubun git olgusu verilmedi (enjekte git yalnız hedef grup için)' };
      else kaynakOnay = { grup: kaynak, etiket: gitOlgulari({ kod: kaynak, urun, surum, kok }).terfiEtiketi };
    }
  } catch (e) {
    if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [`git: ${e.message}`] };
    throw e;
  }
  let kaynaklar = null;
  let ozet = null;
  if (!kuru) {
    try {
      kaynaklar = kaynakGrupSurumleri(kaynak, urun, { kok, kayit, eskiKodlar, oku });
      ozet = artefaktOzeti({ urun, tablo, surum, kaynak, dizin, artefakt, kok, kayit, eskiKodlar, ozetOku, adresKapisi });
    } catch (e) {
      if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [e.message] };
      throw e;
    }
  }
  return grupTerfiHukmu({ grup, urun, surum, kaynak, git: olgu, kaynaklar, atla, ozet, kaynakOnay });
}

/** ④'ün olgusu: ARTEFAKT satırına göre yerel dosyanın ve kaynak gruptaki eşinin özeti (ölçülemeyen = Olculemedi atar). */
function artefaktOzeti({ urun, tablo, surum, kaynak, dizin, artefakt, kok, kayit, eskiKodlar, ozetOku, adresKapisi }) {
  if (tablo.olculmez) {
    if (adresKapisi.acik === true) throw new Olculemedi(`${urun} artefaktının özet eşitliği tanımlı değil ve yeni adres kapısı AÇIK — ARTEFAKT.${urun} tanımlanmadan terfi ölçülemez`);
    return { olculmez: tablo.olculmez };
  }
  let yerelYol;
  let goreli;
  if (artefakt) {
    ({ yerel: yerelYol, goreli } = artefakt);
    if (!yerelYol || !goreli) throw new Olculemedi('artefakt: yerel dosya ve kaynak grup yolu birlikte verilmeli');
  } else if (tablo.kaynak === 'cagiran') {
    throw new Olculemedi(urun === 'tablet' ? 'tablet artefaktı (APK ya da OTA bundle) verilmedi (özet eşitliği ölçülemez)' : `${urun} artefaktı verilmedi (özet eşitliği ölçülemez)`);
  } else {
    goreli = tablo.goreli(surum);
    if (!dizin) throw new Olculemedi('özet eşitliği için ortak paket dizini verilmedi (--dizin=)');
    yerelYol = path.join(dizin, goreli);
  }
  const yerel = dosyaOzeti(yerelYol).sha256;
  return { yerel, kaynak: ozetOku(`${grupHedefi(kaynak, urun, { kok, kayit, eskiKodlar }).vds}/${goreli}`) };
}

/** Paketin grup künyesi için ayrı çalışma dizini: paket baytları SEMBOLİK bağ (kopya değil), `latest.yml` kopya. */
export function grupDizini(ortakDizin, grup, { surum, setupAdi = ARTEFAKT.panel.goreli(surum) } = {}) {
  if (!GRUP_KODU_DESENI.test(String(grup))) throw new GrupIhlali(`grup kodu biçimsiz: ${grup}`);
  const hedef = path.join(ortakDizin, '_grup', grup);
  fs.rmSync(hedef, { recursive: true, force: true });
  fs.mkdirSync(hedef, { recursive: true });
  for (const ad of [setupAdi, `${setupAdi}.blockmap`]) {
    const kaynak = path.resolve(ortakDizin, ad);
    if (!fs.existsSync(kaynak)) throw new Olculemedi(`paket dosyası yok: ${kaynak}`);
    fs.symlinkSync(kaynak, path.join(hedef, ad));
  }
  const yml = path.join(ortakDizin, 'latest.yml');
  if (!fs.existsSync(yml)) throw new Olculemedi(`latest.yml yok: ${yml}`);
  fs.copyFileSync(yml, path.join(hedef, 'latest.yml'));
  return hedef;
}

export { etiketAdi, terfiEtiketAdi };
