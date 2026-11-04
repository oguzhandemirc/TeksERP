// Gülkesim demo 2026-11-04: tanıtmada dokunulan değer kelimeleri (sayı + biçim) öğrenilir, okuyucu adayı buna göre keser.
// Etiketin sağında aynı satırda dokunulmamış kelimeler ("2008-58 KOYU BEJ FULAR") değere girmesin diye. Alanlar yoksa davranış aynı.
import type { AnchorStrategy, OcrElement } from "./types";

/** Biçim öğrenmenin tavanı: daha uzun değer (serbest metin) biçimle değil yalnız kelime sayısıyla sınırlanır. */
const MAX_SHAPE_SOURCE_CHARS = 40;

const joinWords = (texts: readonly string[]): string => texts.join(" ").replace(/\s+/g, " ").trim();
// `u` kipinde yalnız sözdizimi karakterleri kaçırılabilir (`\-` orada sözdizimi hatasıdır).
const escapeRe = (c: string): string => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Dokunulan değerin biçimi: rakam koşusu `\d+`, harf koşusu `\p{L}+`, kelime arası `\s+`, ayraç olduğu gibi ve
 * çevresinde isteğe bağlı boşluk ("2008-58" → `^\d+\s*-\s*\d+$`; OCR "2008 - 58" diye bölse de tutar). Boş/uzunsa null.
 */
export function valueShapeOf(texts: readonly string[]): string | null {
  const v = joinWords(texts);
  if (!v || v.length > MAX_SHAPE_SOURCE_CHARS) return null;
  const tokens = v.match(/\d+|\p{L}+|\s+|[^\d\p{L}\s]/gu) ?? [];
  const parts: string[] = [];
  tokens.forEach((t, i) => {
    if (/^\d+$/.test(t)) parts.push("\\d+");
    else if (/^\p{L}+$/u.test(t)) parts.push("\\p{L}+");
    else if (/^\s+$/.test(t)) {
      // Ayraca bitişik boşluk ayracın kendi `\s*` payına katılır.
      const sep = (x?: string) => x !== undefined && /^[^\d\p{L}\s]$/u.test(x);
      if (!sep(tokens[i - 1]) && !sep(tokens[i + 1])) parts.push("\\s+");
    } else parts.push(`\\s*${escapeRe(t)}\\s*`);
  });
  return `^${parts.join("")}$`;
}

const compiled = new Map<string, RegExp | null>();
function shapeRe(src: string): RegExp | null {
  if (!compiled.has(src)) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(src, "u");
    } catch {
      re = null; // bozuk biçim fail-soft: kelime sayısına düşülür (doğrulayıcı kayıtta zaten reddeder)
    }
    compiled.set(src, re);
  }
  return compiled.get(src) ?? null;
}

/**
 * Aday kelimelerini öğrenilmiş sınıra keser: biçime uyan EN UZUN önek; uyan yoksa ya da biçim yoksa ilk `maxWords`
 * kelime; ikisi de yoksa dokunulmaz (bugünkü davranış). `firstOverride` adayın ilk kelimesinin okunan metnidir.
 */
export function limitValueElements(elements: OcrElement[], s: Pick<AnchorStrategy, "maxWords" | "valueShape">, firstOverride?: string): OcrElement[] {
  if (elements.length === 0) return elements;
  const texts = elements.map((e, i) => (i === 0 && firstOverride !== undefined ? firstOverride : e.text));
  const re = s.valueShape ? shapeRe(s.valueShape) : null;
  if (re) {
    for (let n = elements.length; n >= 1; n--) if (re.test(joinWords(texts.slice(0, n)))) return elements.slice(0, n);
  }
  if (typeof s.maxWords === "number" && Number.isInteger(s.maxWords) && s.maxWords >= 1) return elements.slice(0, s.maxWords);
  return elements;
}
