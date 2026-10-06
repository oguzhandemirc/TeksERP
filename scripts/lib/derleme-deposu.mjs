// =============================================================================
// SATICININ İLK KURULUM DERLEME DEPOSU — ad kuralı (tek kaynak satıcının kendi kodu)
// =============================================================================
// Portal yalnız adı `BUILD_NAME`e uyan ve uzantısı `BUILD_EXTENSIONS`ta olan dosyayı listeler ve bağlantıya
// bağlar (`satici/sunucu/src/distribution/storage.ts`). Kural buraya KOPYALANMAZ: kaynak metinden okunur
// (dagitim.mjs `backendPaketKimligi`nin vendor-url okuması kalıbı); yeri/biçimi değişirse `Olculemedi` — çağıran DURUR.
// Kullananlar: `deploy/kurulum/kurulum-arsivi.mjs` (çıktı adı) · `deploy/satici/derleme-koy.mjs` (yüklenecek ad).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEPO_REL = 'satici/sunucu/src/distribution/storage.ts';

export class Olculemedi extends Error {}

/** Kaynak metinden ad deseni + uzantı listesi; bulunamazsa ÖLÇÜLEMEDİ (sessiz yedek yok). */
export function derlemeAdiKuraliMetinden(metin) {
  const d = /^const BUILD_NAME = \/(\^[^\n]*\$)\/;$/m.exec(typeof metin === 'string' ? metin : '');
  const u = /^export const BUILD_EXTENSIONS: readonly string\[\] = \[([^\]\n]*)\];$/m.exec(typeof metin === 'string' ? metin : '');
  if (!d || !u) throw new Olculemedi(`${DEPO_REL}: BUILD_NAME / BUILD_EXTENSIONS bulunamadı (yeri ya da biçimi değişti — derleme-deposu.mjs'i güncelle)`);
  const uzantilar = u[1].split(',').map((s) => s.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean);
  if (!uzantilar.length || uzantilar.some((x) => !/^[a-z0-9]+$/.test(x))) throw new Olculemedi(`${DEPO_REL}: BUILD_EXTENSIONS çözülemedi: [${u[1]}]`);
  let desen;
  try {
    desen = new RegExp(d[1]);
  } catch (e) {
    throw new Olculemedi(`${DEPO_REL}: BUILD_NAME derlenemedi: ${e.message}`);
  }
  return { desen, uzantilar };
}

export function derlemeAdiKurali(kok = KOK) {
  let metin;
  try {
    metin = fs.readFileSync(path.join(kok, DEPO_REL), 'utf8');
  } catch (e) {
    throw new Olculemedi(`${DEPO_REL} okunamadı: ${e.message}`);
  }
  return derlemeAdiKuraliMetinden(metin);
}

/** storage.ts `extensionOf` ile aynı anlam: son noktadan sonrası, küçük harf; baştaki nokta uzantı sayılmaz. */
const uzantisi = (ad) => (ad.lastIndexOf('.') > 0 ? ad.slice(ad.lastIndexOf('.') + 1).toLowerCase() : '');

/** Portalın listeleyeceği ad mı? Uymuyorsa sebep, uyuyorsa null. */
export function derlemeAdiHatasi(ad, kural) {
  if (!kural.desen.test(ad)) return `"${ad}" satıcının derleme adı desenine uymuyor (${kural.desen.source})`;
  if (!kural.uzantilar.includes(uzantisi(ad))) return `"${ad}" uzantısı derleme deposunda izinli değil (izinli: ${kural.uzantilar.join(', ')})`;
  return null;
}
