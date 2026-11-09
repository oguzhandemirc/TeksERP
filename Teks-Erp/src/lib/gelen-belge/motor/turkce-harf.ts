// Türkçe dışı aksanlı Latin harf → en yakın Türkçe harf (saf, 2026-11-09): OCR "GÜLEÇSOY"u "GÙLEÇSOY" okuyabiliyor.
// TEK boğaz: OCR sonucu motora girerken (`OcrResultSchema` dönüşümü + `clientOcrToResult`) ve şablon metinleri (kayıt + yükleme).
// Şapkalı â î û (Türkçede geçerli) KORUNUR. Yerel ayara bağlı büyük/küçük harf çağrısı YOK: sabit tablo.
import type { DocumentTemplate, OcrResult } from "./types";

/** Kaynak harfler → hedef harf (büyük ve küçük ayrı satır). Tablo tek kaynaktır; bekçi `test_gelen_belge_turkce_harf` ölçer. */
const GROUPS: ReadonlyArray<readonly [string, string]> = [
  ["ÙÚŪŨŬŮŰŲ", "Ü"], ["ùúūũŭůűų", "ü"],
  ["ÒÓÔÕŌØŎŐ", "Ö"], ["òóôõōøŏő", "ö"],
  ["ÌÍÏĪĨĬĮ", "İ"], ["ìíïīĩĭį", "i"],
  ["ȘŠŚŜ", "Ş"], ["șšśŝ", "ş"],
  ["ŢȚŤ", "T"], ["ţțť", "t"],
  ["ĜǦĠ", "Ğ"], ["ĝǧġ", "ğ"],
  ["ĆČĈĊ", "Ç"], ["ćčĉċ", "ç"],
  ["ÀÁÃÄÅĀĂĄ", "A"], ["àáãäåāăą", "a"],
  ["ÈÉÊËĒĖĘĚ", "E"], ["èéêëēėęě", "e"],
  ["ÑŃŇ", "N"], ["ñńň", "n"],
  ["ÝŸ", "Y"], ["ýÿ", "y"],
  ["ŽŹŻ", "Z"], ["žźż", "z"],
];

/** Harf → Türkçe karşılığı (dışa açık: bekçi tablo kapsamını ölçer). */
export const TURKCE_HARF_ESLEME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(GROUPS.flatMap(([from, to]) => [...from].map((c) => [c, to]))),
);

const NEEDS_WORK = /[^\t\n\r -~çğıöşüÇĞİÖŞÜâîûÂÎÛ]/u;
const COMBINING = /[\u0300-\u036f]/gu;

/** Saf: NFC → tablo eşlemesi → kalan birleşik aksan işaretleri düşer ("U"+U+0300 → "Ü"). ASCII/Türkçe metin aynen döner. */
export function fixTurkishLetters(s: string): string {
  if (!NEEDS_WORK.test(s)) return s;
  let out = "";
  for (const ch of s.normalize("NFC")) out += TURKCE_HARF_ESLEME[ch] ?? ch;
  return out.replace(COMBINING, "");
}

/** Saf: OCR sonucunun bütün metinleri (sayfa, blok, satır, kelime) aynı eşlemeden geçer; kutular/barkodlar dokunulmaz. */
export function normalizeOcrLetters<T extends OcrResult>(ocr: T): T {
  return {
    ...ocr,
    text: fixTurkishLetters(ocr.text),
    blocks: ocr.blocks.map((b) => ({
      ...b,
      text: fixTurkishLetters(b.text),
      lines: b.lines.map((l) => ({ ...l, text: fixTurkishLetters(l.text), elements: l.elements.map((e) => ({ ...e, text: fixTurkishLetters(e.text) })) })),
    })),
  };
}

/** Şablonda OCR metniyle karşılaştırılan dizi alanları (etiket, anahtar kelime, bölüm başlangıcı, tablo başlığı). */
const TEMPLATE_TEXT_KEYS = new Set(["labels", "keywords", "startLabels"]);

function walk(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(walk);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] = TEMPLATE_TEXT_KEYS.has(k) && Array.isArray(x) ? x.map((s) => (typeof s === "string" ? fixTurkishLetters(s) : walk(s))) : walk(x);
  }
  return out;
}

/** Saf: şablonun etiket/anahtar kelime metinleri aynı eşlemeden geçer (kayıtta saklanır, yüklemede eski kayıt için yinelenir). */
export function normalizeTemplateLetters<T extends DocumentTemplate | Record<string, unknown>>(tpl: T): T {
  return walk(tpl) as T;
}
