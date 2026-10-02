// =============================================================================
// TeksERP — KULLANICI CÜMLESİ — kaçış/onay cümlesinin TEK yüklemi
// =============================================================================
// Kullanıcının kendi cümlesiyle açılan her kapı aynı asgariyi ölçer: terfi kaçışı
// (`--terfi-atla`, onay etiketi mesajı — `scripts/lib/terfi.mjs`) ve CI dışı üretim
// PAKET imzası (`--ci-atla` — `Teks-Erp/scripts/lib/ci-kokeni.ts`). Cümle defterlere
// ve imzalı künyeye yazılır; boşluklar tekilleşir ki TSV'ye sekme/satır sızmasın.
// =============================================================================

/** Kullanıcı cümlesi — onay (etiket mesajı) ve kaçış için aynı asgari. */
export const CUMLE_ASGARI_KARAKTER = 20;
export const CUMLE_ASGARI_KELIME = 3;

const kelimeler = (cumle) => (cumle ? cumle.split(' ').filter((k) => /[\p{L}\p{N}]/u.test(k)) : []);

/** Kaçış/onay cümlesi: boş ya da kısa ise RED. */
export function cumleDenetle(ham) {
  const cumle = String(ham ?? '').replace(/\s+/g, ' ').trim();
  const kelime = kelimeler(cumle).length;
  if (!cumle) return { gecerli: false, cumle, sebep: 'cümle BOŞ' };
  if (cumle.length < CUMLE_ASGARI_KARAKTER || kelime < CUMLE_ASGARI_KELIME) {
    return {
      gecerli: false,
      cumle,
      sebep: `cümle KISA ("${cumle}": ${cumle.length} karakter, ${kelime} kelime — en az ${CUMLE_ASGARI_KARAKTER} karakter ve ${CUMLE_ASGARI_KELIME} kelime)`,
    };
  }
  return { gecerli: true, cumle, sebep: null };
}

/**
 * Kaçış cümlesi (yeni kapılar için sıkı biçim): `cumleDenetle` + KALIP — kopyalanmış yer tutucu
 * (`<…>`), bayrak gibi başlayan değer (`-…`, yutulmuş argüman) ve tekrarlanan kelime RED.
 */
export function kacisCumlesiDenetle(ham) {
  const c = cumleDenetle(ham);
  if (!c.gecerli) return c;
  const kalip = (neden) => ({ gecerli: false, cumle: c.cumle, sebep: `cümle KALIP DIŞI ("${c.cumle}": ${neden})` });
  if (/<[^>]*>/.test(c.cumle)) return kalip('yer tutucu "<…>" — kullanıcının kendi cümlesi yazılır');
  if (c.cumle.startsWith('-')) return kalip('bayrak gibi başlıyor — argüman yutulmuş olabilir');
  const farkli = new Set(kelimeler(c.cumle).map((k) => k.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()));
  if (farkli.size < CUMLE_ASGARI_KELIME) return kalip(`${farkli.size} farklı kelime — en az ${CUMLE_ASGARI_KELIME}`);
  return c;
}

/** Europe/Istanbul yerel saati, ofsetli ISO (fabrika günü tek kaynak: Istanbul). */
export function istanbulSaati(t = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(t).map((x) => [x.type, x.value]));
  const yerel = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const dk = Math.round((yerel - Math.floor(t.getTime() / 1000) * 1000) / 60000);
  const isaret = dk >= 0 ? '+' : '-';
  const o = Math.abs(dk);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${isaret}${String(Math.floor(o / 60)).padStart(2, '0')}:${String(o % 60).padStart(2, '0')}`;
}
