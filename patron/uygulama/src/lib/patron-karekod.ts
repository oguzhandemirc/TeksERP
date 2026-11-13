/**
 * Patron telefonu bağlantı karekodu — panel üretir, patron uygulaması okur. Karekod YALNIZ sunucu adresini taşır
 * (sır yok): kimlik yine kullanıcı adı + parolayla doğrulanır, fotoğrafı başkasına geçse de parolasız girilemez.
 * Biçim: `tekserp-patron:1:https://host[:port]` — yol yok, yalnız https, yerel/özel ağ adresi yok.
 * İKİZ: `Electron/shared/patron-karekod.ts` ↔ `patron/uygulama/src/lib/patron-karekod.ts` BAYT-EŞİT (bekçi: uygulama
 * `__tests__/patron-karekod.test.ts`); örnek vektörler `Electron/shared/patron-karekod.vectors.json`, iki uç da koşar.
 */

export const PATRON_KAREKOD_ONEKI = "tekserp-patron:";
export const PATRON_KAREKOD_SURUMU = 1;

/** Adres neden kabul edilmedi — panel neden gösterir, uygulama ileti seçer. */
export type PatronAdresRet = "bos" | "sifresiz" | "gecersiz" | "yerel";
export type PatronKarekodRet = PatronAdresRet | "yabanci" | "yeni-surum";

export type PatronAdresSonucu = { readonly tamam: true; readonly adres: string } | { readonly tamam: false; readonly neden: PatronAdresRet };
export type PatronKarekodSonucu = { readonly tamam: true; readonly adres: string } | { readonly tamam: false; readonly neden: PatronKarekodRet };

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Telefonun dışarıdan ulaşamayacağı adresler: döngü, özel IPv4, link-local, CGNAT, mDNS/yerel adlar. */
function yerelMi(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ip) return false;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Adresi karekoda girecek biçime indirger: boşluk, sondaki `/` ve `/api` atılır, ad küçük harfe iner; şema yoksa
 * https varsayılır. Yalnız `https://host[:port]` kabul — yol, kullanıcı bilgisi, sorgu reddedilir.
 */
export function patronAdresiDenetle(girdi: string): PatronAdresSonucu {
  let v = girdi.trim();
  if (v === "") return { tamam: false, neden: "bos" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  if (!/^https:\/\//i.test(v)) return { tamam: false, neden: "sifresiz" };
  v = v.slice("https://".length).replace(/\/+$/, "").replace(/\/api$/i, "").replace(/\/+$/, "");
  const m = /^([^/:?#@\s]+)(?::(\d{1,5}))?$/.exec(v);
  if (!m) return { tamam: false, neden: "gecersiz" };
  const host = m[1]!.toLowerCase();
  const port = m[2];
  if (yerelMi(host)) return { tamam: false, neden: "yerel" };
  if (!HOST.test(host) || (port !== undefined && (Number(port) < 1 || Number(port) > 65535))) return { tamam: false, neden: "gecersiz" };
  return { tamam: true, adres: `https://${host}${port !== undefined ? `:${port}` : ""}` };
}

/** Karekod metni; adres kabul edilmezse null (panel karekod çizmez). */
export function patronKarekoduYap(adres: string): string | null {
  const a = patronAdresiDenetle(adres);
  return a.tamam ? `${PATRON_KAREKOD_ONEKI}${PATRON_KAREKOD_SURUMU}:${a.adres}` : null;
}

/** Okunan metni ayrıştırır: yabancı önek, bilinmeyen sürüm, kabul edilmeyen adres ayrı nedenle döner. */
export function patronKarekoduOku(metin: string): PatronKarekodSonucu {
  const v = metin.trim();
  if (!v.startsWith(PATRON_KAREKOD_ONEKI)) return { tamam: false, neden: "yabanci" };
  const m = /^(\d{1,4}):([\s\S]*)$/.exec(v.slice(PATRON_KAREKOD_ONEKI.length));
  if (!m) return { tamam: false, neden: "yabanci" };
  if (Number(m[1]) !== PATRON_KAREKOD_SURUMU) return Number(m[1]) > PATRON_KAREKOD_SURUMU ? { tamam: false, neden: "yeni-surum" } : { tamam: false, neden: "yabanci" };
  // Karekodda şema ZORUNLU: şemasız metin elle yazım kolaylığıdır, üretilen kodda olmaz.
  if (!/^https:\/\//i.test(m[2]!)) return { tamam: false, neden: /^[a-z][a-z0-9+.-]*:\/\//i.test(m[2]!) ? "sifresiz" : "gecersiz" };
  const a = patronAdresiDenetle(m[2]!);
  return a.tamam ? { tamam: true, adres: a.adres } : { tamam: false, neden: a.neden };
}
