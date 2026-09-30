// =============================================================================
// TeksERP — BACKEND KANAL YAYINI: saf yardımcılar (Dağıtım v2 · docs/design/GUNCELLEYICI.md §1)
// =============================================================================
// `deploy/backend-yayinla.mjs` (yayıncı) ve bekçisi `scripts/test_backend_yayin.mjs` aynı fonksiyonları çağırır.
// Zero-dep: TS protokolünü import edemez; sürüm önceliği ve biçim desenleri protokolün (`protocol/guncelleme.ts`
// `compareVersions` · `belgeler.ts` `ReleaseVersionSchema`) AYNASIDIR — bekçi ortak vektör dosyasıyla ölçer.
// Uzak komuta giren her değer (yol · sürüm · dosya adı) önce desenden geçer; geçmeyen DUR (kabuk enjeksiyonu yok).
// =============================================================================

/** Yayınlanan backend sürümü — protokol `ReleaseVersionSchema` ile birebir. */
export const SURUM_DESENI = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z]{1,20}(\.[0-9A-Za-z]{1,20}){0,3})?$/;
/** Sürüm dizinindeki paket adı — protokol `ArtifactNameSchema` ile birebir. */
export const PAKET_ADI_DESENI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.zip$/;
/** VDS mutlak yolu (kanal kaydından gelir; yine de uzak komuta girmeden ölçülür). */
export const UZAK_YOL_DESENI = /^\/[A-Za-z0-9._/-]+$/;
/** Sürüm dizininin tam kopyası yüklenene dek taşıdığı ad (yayın dışı, nokta önekli). */
export const GECICI_ONEKI = '.yukleniyor-';
export const OZET_TAVANI = 2000;

const SURUM_PARCALARI = /^([0-9]{1,4})\.([0-9]{1,4})\.([0-9]{1,6})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function ayir(s) {
  const m = SURUM_PARCALARI.exec(String(s ?? ''));
  return m ? { cekirdek: [Number(m[1]), Number(m[2]), Number(m[3])], on: m[4] ? m[4].split('.') : [] } : null;
}

function kimlikKiyasla(a, b) {
  const an = /^[0-9]+$/.test(a);
  const bn = /^[0-9]+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an !== bn) return an ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver önceliği (−1 · 0 · 1; biçimsiz taraf `null`) — protokol `compareVersions` aynası. */
export function surumKiyasla(a, b) {
  const x = ayir(a);
  const y = ayir(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x.cekirdek[i] !== y.cekirdek[i]) return x.cekirdek[i] < y.cekirdek[i] ? -1 : 1;
  if (x.on.length === 0 || y.on.length === 0) return x.on.length === y.on.length ? 0 : x.on.length === 0 ? 1 : -1;
  for (let i = 0; i < Math.min(x.on.length, y.on.length); i += 1) {
    const c = kimlikKiyasla(x.on[i], y.on[i]);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return x.on.length === y.on.length ? 0 : x.on.length < y.on.length ? -1 : 1;
}

/** Ön sürüm eki olmayan çekirdek (`2.12.1-prova.abc` → `2.12.1`); biçimsizse null. */
export function cekirdekSurum(s) {
  const x = ayir(s);
  return x ? x.cekirdek.join('.') : null;
}

/**
 * Sürüm belgesinin (`docs/surumler/backend-<sürüm>.md`) "Özet" bölümü: başlığı "Özet" içeren ilk `## `
 * başlığından sonraki metin, sıradaki `## ` başlığına dek; boşluklar tekilleşir, tavanı aşarsa kelime
 * sınırında kesilir. Bölüm yoksa ya da boşsa null (sürüm notu kapısı DURUR).
 */
export function ozetCikar(md) {
  const satirlar = String(md ?? '').split(/\r?\n/);
  const bas = satirlar.findIndex((s) => /^##\s+.*Özet/i.test(s));
  if (bas < 0) return null;
  const govde = [];
  for (const s of satirlar.slice(bas + 1)) {
    if (/^##\s/.test(s)) break;
    govde.push(s);
  }
  const metin = govde.join(' ').replace(/\s+/g, ' ').trim();
  if (!metin) return null;
  if (metin.length <= OZET_TAVANI) return metin;
  const kesik = metin.slice(0, OZET_TAVANI - 1);
  const son = kesik.lastIndexOf(' ');
  return `${kesik.slice(0, son > OZET_TAVANI / 2 ? son : kesik.length)}…`;
}

/** `son.json` gövdesinden bildirimin sürümü (imzasız okuma — yalnız monotonluk ve terfi için). */
export function isaretciSurumu(govde) {
  try {
    const isaretci = JSON.parse(govde);
    const yuk = String(isaretci?.bildirim ?? '').split('.')[1];
    const surum = JSON.parse(Buffer.from(yuk ?? '', 'base64url').toString('utf8'))?.surum;
    return typeof surum === 'string' && SURUM_DESENI.test(surum) ? surum : null;
  } catch {
    return null;
  }
}

const tirnak = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * Uzak yayın planı — yollar kanal kaydından, adlar bildirimden. Her değer desenden geçer; geçmeyen FIRLATIR.
 * Sıra (pazarlık dışı): geçici dizine yükle → uzakta ölç → dizini yeniden adla → `son.json` EN SON.
 */
export function yayinPlani({ vdsBackend, backendDefter, surum, paketAd, pgAd = null, damga }) {
  for (const [ne, v, d] of [['vdsBackend', vdsBackend, UZAK_YOL_DESENI], ['backendDefter', backendDefter, UZAK_YOL_DESENI],
    ['sürüm', surum, SURUM_DESENI], ['paket adı', paketAd, PAKET_ADI_DESENI], ['damga', damga, /^[0-9A-Za-z]{6,40}$/]]) {
    if (typeof v !== 'string' || !d.test(v) || v.split('/').includes('..')) throw new Error(`yayın planı: güvensiz ${ne}: ${v}`);
  }
  if (pgAd !== null && !PAKET_ADI_DESENI.test(pgAd)) throw new Error(`yayın planı: güvensiz PG paket adı: ${pgAd}`);
  const kok = vdsBackend.replace(/\/+$/, '');
  const surumDizini = `${kok}/${surum}`;
  const gecici = `${kok}/${GECICI_ONEKI}${surum}-${damga}`;
  const sonJson = `${kok}/son.json`;
  const sonJsonGecici = `${kok}/.son.json.${damga}`;
  return {
    kok,
    surumDizini,
    gecici,
    sonJson,
    sonJsonGecici,
    defter: backendDefter,
    komut: {
      varMi: `test -e ${tirnak(surumDizini)}`,
      geciciAc: `mkdir -p ${tirnak(gecici)}`,
      olc: `sha256sum ${tirnak(`${gecici}/${paketAd}`)} | cut -d' ' -f1 && stat -c %s ${tirnak(`${gecici}/${paketAd}`)}` +
        (pgAd ? ` && sha256sum ${tirnak(`${gecici}/${pgAd}`)} | cut -d' ' -f1 && stat -c %s ${tirnak(`${gecici}/${pgAd}`)}` : ''),
      yayinla: `test ! -e ${tirnak(surumDizini)} && mv ${tirnak(gecici)} ${tirnak(surumDizini)}`,
      sonJsonYaz: `mv ${tirnak(sonJsonGecici)} ${tirnak(sonJson)}`,
      geciciSil: `rm -rf ${tirnak(gecici)} ${tirnak(sonJsonGecici)}`,
    },
  };
}

/**
 * PG paketi planı (sözleşme sürümü 2): `<vdsBackend>/pg/<sürüm>-<derleme>/` DEĞİŞMEZ dizinine paket + `pg.json`;
 * `son.json`a dokunulmaz (PG paketi ancak onu hedefleyen backend bildirimi yayınlanınca kullanılır).
 */
export function pgYayinPlani({ vdsBackend, surum, derleme, paketAd, damga }) {
  if (!/^[0-9]{2}\.[0-9]{1,3}$/.test(String(surum)) || !Number.isInteger(derleme) || derleme < 1 || derleme > 999) {
    throw new Error(`PG planı: güvensiz sürüm/derleme: ${surum}-${derleme}`);
  }
  for (const [ne, v, d] of [['vdsBackend', vdsBackend, UZAK_YOL_DESENI], ['paket adı', paketAd, PAKET_ADI_DESENI], ['damga', damga, /^[0-9A-Za-z]{6,40}$/]]) {
    if (typeof v !== 'string' || !d.test(v) || v.split('/').includes('..')) throw new Error(`PG planı: güvensiz ${ne}: ${v}`);
  }
  const pgKok = `${vdsBackend.replace(/\/+$/, '')}/pg`;
  const dizin = `${pgKok}/${surum}-${derleme}`;
  const gecici = `${pgKok}/${GECICI_ONEKI}${surum}-${derleme}-${damga}`;
  return {
    dizin,
    gecici,
    komut: {
      varMi: `test -e ${tirnak(dizin)}`,
      hazirMi: `test -f ${tirnak(`${dizin}/${paketAd}`)} && test -f ${tirnak(`${dizin}/pg.json`)}`,
      geciciAc: `mkdir -p ${tirnak(gecici)}`,
      olc: `sha256sum ${tirnak(`${gecici}/${paketAd}`)} | cut -d' ' -f1 && stat -c %s ${tirnak(`${gecici}/${paketAd}`)}`,
      yayinla: `test ! -e ${tirnak(dizin)} && mv ${tirnak(gecici)} ${tirnak(dizin)}`,
      geciciSil: `rm -rf ${tirnak(gecici)}`,
    },
  };
}

/** İşaretçi dosyasındaki imzalı yükün alanları (imzasız okuma — yalnız yol hesabı; imza TS aracında doğrulanır). */
export function isaretciYuku(govde) {
  try {
    const yuk = String(JSON.parse(govde)?.bildirim ?? '').split('.')[1];
    const y = JSON.parse(Buffer.from(yuk ?? '', 'base64url').toString('utf8'));
    return y && typeof y === 'object' ? y : null;
  } catch {
    return null;
  }
}

/** Yayın defteri satırı (TSV): zaman · sürüm · yayıncı · sha16 · boyut [· terfi kaçışı]. Sekme/satır sızmaz. */
export function defterSatiri({ zaman, surum, kim, sha16, boyut, terfiAtla, urun = 'backend' }) {
  const temiz = (x) => String(x ?? '-').replace(/[\t\r\n]/g, ' ');
  const alanlar = [zaman, `${urun}-${surum}`, kim, sha16, boyut];
  if (terfiAtla) alanlar.push(`terfi-atlandi: ${terfiAtla}`);
  return alanlar.map(temiz).join('\t');
}

/** Defter satırını uzakta ekleyen komut (printf %s — içerik biçim dizesine girmez). */
export function defterKomutu(defter, satir) {
  if (!UZAK_YOL_DESENI.test(defter) || defter.split('/').includes('..')) throw new Error(`güvensiz defter yolu: ${defter}`);
  const dizin = defter.slice(0, defter.lastIndexOf('/'));
  return `mkdir -p ${tirnak(dizin)} && printf '%s\\n' ${tirnak(satir)} >> ${tirnak(defter)}`;
}
