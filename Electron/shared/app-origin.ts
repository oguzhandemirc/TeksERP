// Uygulama belgesinin kimliği — gezinme kapısı, IPC gönderen denetimi ve preload köprü
// kapısı AYNI yüklemi kullanır (üç ayrı "uygulama mı" cevabı ayrışırsa açık doğar).
// Saf modül: electron import etmez (preload paketine ve testlere girer).

/** Ana süreç giriş adresini preload'a bu bayrakla geçirir (`webPreferences.additionalArguments`). */
export const APP_ENTRY_ARG_PREFIX = "--tekserp-app-entry=";

export function appEntryArgument(entryUrl: string): string {
  return APP_ENTRY_ARG_PREFIX + entryUrl;
}

export function readAppEntryArgument(argv: readonly string[]): string | null {
  const hit = argv.find((a) => a.startsWith(APP_ENTRY_ARG_PREFIX));
  const value = hit?.slice(APP_ENTRY_ARG_PREFIX.length) ?? "";
  return value === "" ? null : value;
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Yüzde kodu çözülmüş yol; Windows'ta büyük-küçük harf duyarsız karşılaştırma için küçültülür. */
function comparablePath(url: URL, caseInsensitive: boolean): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  const slashed = decoded.replace(/\\/g, "/");
  return caseInsensitive ? slashed.toLowerCase() : slashed;
}

/**
 * `candidate` uygulamanın KENDİ belgesi mi?
 * - file: → ana makinesi BOŞ (UNC/ağ paylaşımı değil) ve giriş dosyasıyla AYNI yol; hash/sorgu serbest.
 * - http(s): (yalnız geliştirme sunucusu) → aynı köken.
 * Başka her şey (giriş tanımsız dahil) HAYIR.
 */
export function isAppDocumentUrl(candidate: string, entry: string | null, platform: string): boolean {
  if (!entry) return false;
  const c = parseUrl(candidate);
  const e = parseUrl(entry);
  if (!c || !e || c.protocol !== e.protocol) return false;
  if (e.protocol === "file:") {
    if (c.host !== "" || e.host !== "") return false;
    const caseInsensitive = platform === "win32";
    const cp = comparablePath(c, caseInsensitive);
    return cp !== null && cp === comparablePath(e, caseInsensitive);
  }
  if (e.protocol === "http:" || e.protocol === "https:") return c.origin === e.origin;
  return false;
}

/**
 * Ana penceredeki ALT çerçevelerin (önizleme/baskı iframe'leri) gidebileceği adresler:
 * yalnız srcdoc ve boş belge — iframe'ler içeriği bu ikisiyle alır. Ağ, dosya, blob ve
 * diğer şemalar HAYIR (bir önizlemedeki bağlantı çerçeveyi başka bir yere taşıyamaz).
 */
export function isAllowedSubframeUrl(candidate: string): boolean {
  return candidate === "about:srcdoc" || candidate === "about:blank" || candidate.startsWith("about:blank#");
}
