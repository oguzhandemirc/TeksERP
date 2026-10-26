// =============================================================================
// Kod modu — tanım gövdesi ↔ biçimli JSON metni (saf; doğrulama YOK — şema/semantik yalnız `dogrula` ucunda)
// =============================================================================
// Anahtar sırası `rapor-tanimi.schema.ts`teki alan sırasıdır: kullanıcı aynı tanımı hep aynı düzende görür,
// görsel → kod → görsel gidiş-dönüşte metin değişmezse taslak da değişmez.
// =============================================================================

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Shape = "root" | "parameter" | "block" | "query" | "rule" | "layout" | "other";

const KEY_ORDER: Record<Exclude<Shape, "other">, readonly string[]> = {
  root: ["surum", "baslik", "parametreler", "varyant", "donemKiyasi", "bloklar", "duzen"],
  parameter: ["ad", "tur", "etiket", "varsayilan", "varsayilanSaat", "boyut", "coklu", "en", "enFazla"],
  block: ["id", "tur", "baslik", "gorsel", "yontem", "sorgu", "sorgular", "pivot", "ilkN", "birim", "adet", "kurallar", "enFazla", "metin"],
  query: ["kup", "olculer", "boyutlar", "suzgec", "zaman", "tavan"],
  rule: ["field", "operator", "value"],
  layout: ["i", "x", "y", "w", "h", "sayfaKesmesi"],
};

/** Bir alt alanın biçimi: dizinin elemanları ve nesnenin anahtarları üst biçimden türer. */
function childShape(parent: Shape, key: string): Shape {
  if (parent === "root" && key === "parametreler") return "parameter";
  if (parent === "root" && key === "bloklar") return "block";
  if (parent === "root" && key === "duzen") return "layout";
  if (parent === "block" && (key === "sorgu" || key === "sorgular")) return "query";
  if (key === "rules") return "rule";
  return "other";
}

function ordered(value: Json, shape: Shape): Json {
  if (Array.isArray(value)) return value.map((v) => ordered(v, shape));
  if (value === null || typeof value !== "object") return value;
  const order = shape === "other" ? [] : KEY_ORDER[shape];
  const keys = Object.keys(value);
  const known = order.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !order.includes(k));
  const out: { [k: string]: Json } = {};
  for (const k of [...known, ...rest]) out[k] = ordered(value[k]!, childShape(shape, k));
  return out;
}

/** Gövde → kod kipinin metni (2 boşluk girinti, şema sırası). */
export function formatDefinition(body: unknown): string {
  return JSON.stringify(ordered(body as Json, "root"), null, 2);
}

export type ParsedText = { ok: true; value: unknown } | { ok: false; message: string };

/** Yerel sözdizimi denetimi — yalnız JSON; şema kuralı istemcide KOPYALANMAZ. */
export function parseDefinitionText(text: string): ParsedText {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, message: `JSON sözdizimi hatalı: ${(e as Error).message}` };
  }
}

/** İçerik eşitliği (anahtar sırasından bağımsız) — kod metni taslağı gerçekten değiştirdi mi. */
export function sameDefinition(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}
