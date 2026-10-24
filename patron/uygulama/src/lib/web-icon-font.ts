// Web ikon fontu: expo-font `@font-face`'i `<style>`a METİN düğümü olarak ekler; patron sunucusunun özet-tabanlı
// CSP'si (`unsafe-inline` yok) bunu engeller ve ikonlar çizilmez. Kural ilk çizimden ÖNCE expo-font'un kendi
// `<style id="expo-generated-fonts">` sayfasına CSSOM `insertRule` ile yazılır; expo-font bunu "yüklü" sayar, metin eklemez.

/** expo-font'un (ExpoFontLoader.web) yalnız bu öğenin sayfasında aradığı kimlik; başka sayfaya yazılan kuralı görmez. */
export const EXPO_FONT_STYLE_ID = "expo-generated-fonts";

export interface FontRuleLike {
  readonly style?: { readonly fontFamily?: string };
}

export interface FontSheetLike {
  readonly cssRules: ArrayLike<FontRuleLike>;
  insertRule(rule: string, index?: number): number;
}

export interface FontStyleElementLike {
  id: string;
  readonly sheet: FontSheetLike | null;
  readonly isConnected?: boolean;
}

export interface FontDocumentLike {
  readonly head: { appendChild(node: unknown): unknown } | null;
  getElementById(id: string): unknown;
  createElement(tag: "style"): FontStyleElementLike;
}

/** Ikon setinin `font` alanı (`{ ionicons: <varlık> }`); web'de metro varlığı dizge URL'dir, `{ uri }` de kabul. */
export type IconFontMap = Readonly<Record<string, unknown>>;

/** expo-font `uriFromFontSource` ile aynı çözüm (dizge / `{ uri: dizge }`); çözülemeyen kaynak atlanır ve expo-font'a kalır. */
export function fontUri(src: unknown): string | null {
  if (typeof src === "string") return src || null;
  if (src && typeof src === "object" && typeof (src as { uri?: unknown }).uri === "string") {
    return (src as { uri: string }).uri || null;
  }
  return null;
}

/** expo-font `_createWebFontTemplate` ile bayt-eşit kural (font-display: auto). */
export function fontFaceRule(family: string, uri: string): string {
  return `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(uri)});font-display:auto}`;
}

const unquote = (s: string | undefined): string => (s ?? "").replace(/^["']|["']$/g, "");

function styleSheetOf(doc: FontDocumentLike): FontSheetLike | null {
  const mevcut = doc.getElementById(EXPO_FONT_STYLE_ID) as FontStyleElementLike | null;
  if (mevcut?.sheet) return mevcut.sheet;
  if (!doc.head) return null;
  // Boş `<style>` CSP'ye takılmaz (metin yok); sayfası ancak belgeye bağlanınca oluşur.
  const el = mevcut ?? doc.createElement("style");
  if (!mevcut) el.id = EXPO_FONT_STYLE_ID;
  if (!el.isConnected) doc.head.appendChild(el);
  return el.sheet;
}

/** Yalnız web'de; kaydedilen aileleri döner. Aynı aile zaten kayıtlıysa yeniden eklenmez (Fast Refresh / çift çağrı). */
export function preregisterIconFonts(os: string, doc: FontDocumentLike | undefined, fonts: readonly IconFontMap[]): string[] {
  if (os !== "web" || !doc) return [];
  const sheet = styleSheetOf(doc);
  if (!sheet) return [];
  const kayitli: string[] = [];
  for (const map of fonts) {
    for (const [family, src] of Object.entries(map)) {
      const uri = fontUri(src);
      if (!uri) continue;
      const zatenVar = Array.from(sheet.cssRules).some((r) => unquote(r.style?.fontFamily) === family);
      if (zatenVar) continue;
      sheet.insertRule(fontFaceRule(family, uri), sheet.cssRules.length);
      kayitli.push(family);
    }
  }
  return kayitli;
}
