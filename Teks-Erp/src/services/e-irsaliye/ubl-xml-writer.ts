// =============================================================================
// Küçük XML yazıcısı — ağaç → string. Paket YOK (plan §3.4, V4): UBL üretimi düz
// ağaçtır, kaçış + sıra + bildirim dışında iş yoktur. Çıktı deterministiktir:
// girinti yok, öznitelik ve öğe sırası çağıranın verdiği sıradır (UBL sıra duyarlı).
// =============================================================================

export interface XmlElement {
  name: string;
  attrs?: ReadonlyArray<readonly [string, string]>;
  /** `text` ile `children` birlikte verilemez (UBL karışık içerik kullanmaz). */
  text?: string;
  children?: ReadonlyArray<XmlElement>;
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

// XML 1.0 §2.2 Char: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF].
// `u` bayrağıyla eşli olmayan vekil (surrogate) de bu kümenin DIŞINDA kalır.
const INVALID_XML_CHAR = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;

/** XML 1.0'da yazılamayan karakter içeriyor mu (kaçışla da kurtarılamaz). */
export function hasInvalidXmlChar(value: string): boolean {
  return INVALID_XML_CHAR.test(value);
}

/** Metin ve öznitelik değeri kaçışı — beş öntanımlı varlık. */
export function escapeXml(value: string): string {
  if (hasInvalidXmlChar(value)) {
    throw new Error("XML 1.0'da geçersiz karakter (kontrol karakteri ya da eşsiz vekil)");
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function assertName(name: string): void {
  if (!XML_NAME.test(name)) throw new Error(`Geçersiz XML adı: ${JSON.stringify(name)}`);
}

function writeElement(el: XmlElement, out: string[]): void {
  assertName(el.name);
  out.push("<", el.name);
  for (const [key, value] of el.attrs ?? []) {
    assertName(key);
    out.push(" ", key, '="', escapeXml(value), '"');
  }
  const children = el.children ?? [];
  if (el.text !== undefined && children.length > 0) {
    throw new Error(`Karışık içerik desteklenmez: ${el.name}`);
  }
  if (el.text === undefined && children.length === 0) {
    out.push("/>");
    return;
  }
  out.push(">");
  if (el.text !== undefined) out.push(escapeXml(el.text));
  for (const child of children) writeElement(child, out);
  out.push("</", el.name, ">");
}

/** Bildirim + kök öğe; sonda satır sonu YOK (bayt-eşit altın örnek). */
export function serializeXml(root: XmlElement): string {
  const out: string[] = [XML_DECLARATION];
  writeElement(root, out);
  return out.join("");
}

/** Öğe kurucu. */
export function el(name: string, children: ReadonlyArray<XmlElement | null | undefined> = [], attrs?: XmlElement["attrs"]): XmlElement {
  return { name, attrs, children: children.filter((c): c is XmlElement => c != null) };
}

/**
 * Sıralı kap: çocuklar `order` dizisindeki sırayla basılır, dizide olmayan ad
 * hata verir — öğe sırası TEK yerde (sıra tablosu) yaşar, çağıranın yazım sırası önemsizdir.
 */
export function ordered(
  name: string,
  order: readonly string[],
  parts: Readonly<Record<string, XmlElement | ReadonlyArray<XmlElement | null> | null | undefined>>,
  attrs?: XmlElement["attrs"],
): XmlElement {
  for (const key of Object.keys(parts)) {
    if (!order.includes(key)) throw new Error(`${name} sıra tablosunda yok: ${key}`);
  }
  const children: XmlElement[] = [];
  for (const key of order) {
    const part = parts[key];
    if (part == null) continue;
    const list = Array.isArray(part) ? (part as ReadonlyArray<XmlElement | null>) : [part as XmlElement];
    for (const child of list) {
      if (child == null) continue;
      if (child.name !== key) throw new Error(`${name}: ${key} yuvasına ${child.name} kondu`);
      children.push(child);
    }
  }
  return { name, attrs, children };
}

/** Metinli yaprak öğe. */
export function leaf(name: string, text: string, attrs?: XmlElement["attrs"]): XmlElement {
  return { name, attrs, text };
}

/** Değer boş/yoksa öğeyi hiç basma — UBL'de boş zorunlu olmayan öğe gürültüdür. */
export function optLeaf(name: string, text: string | null | undefined, attrs?: XmlElement["attrs"]): XmlElement | null {
  const v = text?.trim();
  return v ? leaf(name, v, attrs) : null;
}
