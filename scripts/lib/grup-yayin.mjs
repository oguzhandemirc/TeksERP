// =============================================================================
// GRUP YAYINI — backend (ve sonraki ürünler) güncelleme grubuna çıkışın TEK kaynağı (TEK-ORTAK-PAKET §3.3, §3.5)
// =============================================================================
// Kayıt `deploy/dagitim.json` (adres/yol `turet`ten); eski `deploy/kanallar.json` BURADA OKUNMAZ.
// Yayıncı (`deploy/backend-yayinla.mjs --grup=`) ve bekçi (`scripts/test_grup_yayin_backend.mjs`) aynı yükleri çağırır.
//
// ⚠️ YENİ ADRES KAPISI (fail-closed): yeni adrese (indir.etkiliyazilim.com) GERÇEK yükleme, 3.9 D5 (zincirli `pkt-*`
//    imzalı listenin kökle doğrulanması + üretim imzası araçları) ve D8 (ilk PAKET sertifikası, kullanıcıyla) YAPILMADAN
//    çıkmaz: ortak paket bugün yalnız test çapasıyla doğrulanabilir, gerçek üretim çapası zincirli kid'i kök almadan
//    reddeder. `--kuru` (ağsız) ve `--dogrula` (salt okuma) bu kapıdan etkilenmez. Kapıyı AÇMAK = D5 + D8 işini
//    bitiren dilimin `YENI_ADRES_KAPISI.acik`ı bir kararla `true` yapması; bekçi kapalıyken yüklemenin DURDUĞUNU ölçer.
// =============================================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { KAYIT_REL, KOK, Olculemedi, grupZinciri, kayitAyristir, terfiKaynagi, turet } from './dagitim.mjs';
import { gitOlgulari, kaynakSurumleri, terfiHukmu } from './terfi.mjs';
import { ayristir } from './surum.mjs';

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

/** Dağıtım kaydı + grup; kayıt/grup geçersizse atar (Olculemedi = okunamadı, Error = bilinmeyen grup). */
export function grupKaydi(grup, { kok = KOK, kayit } = {}) {
  let k = kayit;
  if (!k) {
    try {
      k = kayitAyristir(readFileSync(path.join(kok, KAYIT_REL), 'utf8'));
    } catch (e) {
      throw new Olculemedi(`${KAYIT_REL} okunamadı: ${e.message}`);
    }
  }
  const t = turet(k); // geçersiz kayıtta atar
  if (!grup || !Object.prototype.hasOwnProperty.call(t.gruplar, grup)) {
    const e = new Error(`BİLİNMEYEN GRUP: "${grup ?? ''}"`);
    e.satirlar = [`Kayıtlı gruplar: ${grupZinciri(k.gruplar).zincir.join(' → ')}`, `${KAYIT_REL} dışında grup yoktur; yazım hatası hiçbir dosya yazılmadan durur.`];
    throw e;
  }
  return { kayit: k, hedef: t.gruplar[grup], kaynak: terfiKaynagi(k, grup), tum: t.gruplar };
}

/** Backend yayın hedefi: ağ adresi · VDS dizini · defter — kayıttan türer, `yayinOku` için kanal biçimi taşır. */
export function backendHedefi(g) {
  const b = g.backend;
  return { feed: b.feed.replace(/\/+$/, ''), manifest: b.manifest, vds: b.vds, defter: b.defter };
}

/** `yayinOku`/`kaynakSurumleri`'nin beklediği kanal biçimi (yalnız backend alanları; adres → VDS yolu eşlemesi). */
export function kanalBicimi(g) {
  const b = backendHedefi(g);
  return { yayin: { backendFeed: `${b.feed}/`, backendManifest: b.manifest, vdsBackend: b.vds, backendDefter: b.defter } };
}

/**
 * Grup terfi kapısı (§3.5). Kök grup terfi/etiket istemez; diğerinde `terfiHukmu` AYNEN (HEAD == backend-vX ·
 * terfi/<grup>/backend-vX açıklamalı etiket · kaynak grupta yayındaki sürüm ≥ X). K-6: `genel` kendi etiketini ister
 * (oncu etiketi genel'e SAYILMAZ — etiket adı grubu taşır).
 * @returns {{sonuc: string, satirlar: string[], gerekmez?: boolean, atlandi?: {cumle: string}}}
 */
export function grupTerfiKapisi({ grup, surum, atla, kuru = false, kok = KOK, kayit, oku, git }) {
  let k;
  try {
    k = grupKaydi(grup, { kok, kayit });
  } catch (e) {
    if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [e.message] };
    return { sonuc: 'ihlal', satirlar: [e.message, ...(e.satirlar ?? [])] };
  }
  const kaynak = k.kaynak;
  if (!kaynak || atla !== undefined) return terfiHukmu({ kod: grup, urun: 'backend', surum, kaynak, git: null, kaynaklar: null, atla });
  if (!ayristir(surum)) return { sonuc: 'olculemedi', satirlar: [`sürüm "${surum ?? ''}" ayrıştırılamadı — terfi şartları hangi sürüm için ölçülecek belirsiz`] };
  let olgu = git;
  if (!olgu) {
    try {
      olgu = gitOlgulari({ kod: grup, urun: 'backend', surum, kok });
    } catch (e) {
      if (e instanceof Olculemedi) return { sonuc: 'olculemedi', satirlar: [`git: ${e.message}`] };
      throw e;
    }
  }
  const kaynaklar = kuru ? null : kaynakSurumleri(kanalBicimi(k.tum[kaynak]), 'backend', oku);
  return terfiHukmu({ kod: grup, urun: 'backend', surum, kaynak, git: olgu, kaynaklar, atla });
}
