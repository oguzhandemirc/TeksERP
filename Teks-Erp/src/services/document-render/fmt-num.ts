// =============================================================================
// Belge sayı biçimi — TİCARİ YUVARLAMA, TEK KAYNAK
// =============================================================================
// Belgede basılan her ondalık sayı buradan geçer; Excel değeri de aynı metinden geri
// okunur (`doc-model.ts` `excelValue`) ⇒ PDF ile Excel aynı haneyi taşır.
// `toFixed` sayının İKİLİ değerini yuvarlar: 112,35 bellekte 112,3499… olduğu için
// "112,3" basılırdı. Burada sayı en kısa ondalık yazımından (`String(n)`) rakam dizisi
// olarak yarım-yukarı (sıfırdan uzağa) yuvarlanır; sunucu ICU'suna bağımlı değil.
//
// Donmuş belge HTML değil JSON tutar ve her baskıda yeniden çizilir; yeniden baskı
// aslının aynısı kalsın diye yuvarlama rejimi zarfta DAMGALANIR (`numberRounding`).
// Damgayı yalnız zarf kurucusu yazar (`printed-document.service`), yalnız `docNum`
// okur; damgasız (eski) belge `LEGACY_NUM` ile basılır. CSS ölçüsü görünen sayı
// değildir ve `cssFixed`ten geçer.
// =============================================================================

/** Zarf damgası: bu değeri taşıyan snapshot ticari yuvarlamayla basılır. */
export const NUMBER_ROUNDING_HALF_UP = "HALF_UP" as const;
export type NumberRounding = typeof NUMBER_ROUNDING_HALF_UP;

/** Yuvarlanmış sayının parçaları — `int`/`frac` gruplanmamış rakam dizileri. */
export interface RoundedParts {
  neg: boolean;
  int: string;
  frac: string;
}

/** |n|'nin en kısa ondalık yazımı → [tam, kesir] rakam dizileri (üslü yazım açılır). */
function plainDigits(abs: number): [string, string] {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(abs));
  if (!m) return ["0", ""];
  const intPart = m[1]!;
  const fracPart = m[2] ?? "";
  const exp = Number(m[3] ?? 0);
  if (exp === 0) return [intPart, fracPart];
  const digits = intPart + fracPart;
  const point = intPart.length + exp;
  if (point <= 0) return ["0", "0".repeat(-point) + digits];
  if (point >= digits.length) return [digits + "0".repeat(point - digits.length), ""];
  return [digits.slice(0, point), digits.slice(point)];
}

/** Rakam dizisine 1 ekler: "129" → "130", "99" → "100". */
function incDigits(d: string): string {
  const out = d.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== "9") {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
    out[i] = "0";
  }
  return "1" + out.join("");
}

/** Yarım-yukarı, sıfırdan uzağa (−112,35 → −112,4); sıfıra yuvarlanan negatif işaretsiz döner. */
export function roundHalfUpParts(n: number, dec: number): RoundedParts {
  const [i, f] = plainDigits(Math.abs(n));
  let keep = i + f.slice(0, dec).padEnd(dec, "0");
  if (f.length > dec && f[dec]! >= "5") keep = incDigits(keep);
  const int = keep.slice(0, keep.length - dec).replace(/^0+(?=\d)/, "") || "0";
  const frac = dec > 0 ? keep.slice(keep.length - dec) : "";
  return { neg: n < 0 && /[1-9]/.test(int + frac), int, frac };
}

const group = (int: string): string => int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** TR yazımı: binlik ".", ondalık ",", `dec` hane SABİT. Boş/geçersiz → "". */
export function fmtTrNum(n: number | null | undefined, dec: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  const p = roundHalfUpParts(n, dec);
  return (p.neg ? "-" : "") + group(p.int) + (dec > 0 ? `,${p.frac}` : "");
}

/** Belgenin sayı biçimleri — rejime göre `docNum` seçer. */
export interface DocNum {
  /** TR sabit haneli: binlik ".", ondalık ",". Boş/geçersiz → "". */
  tr: (n: number | null | undefined, dec: number) => string;
  /** Fason çeki ızgarası: 1 hane, tam sayıda kesirsiz, NOKTA ondalık; boş/0 → "". */
  metreDot: (n: number | null | undefined) => string;
  /** Mutlak değerin 2 haneli, NOKTA ondalıklı yazımı (tutar biçimleyicisine ara girdi). */
  absDec2: (n: number) => string;
}

const HALF_UP_NUM: DocNum = {
  tr: fmtTrNum,
  metreDot: (n) => {
    if (n == null || n === 0 || !Number.isFinite(n)) return "";
    const p = roundHalfUpParts(n, 1);
    return (p.neg ? "-" : "") + (p.frac === "0" ? p.int : `${p.int}.${p.frac}`);
  },
  absDec2: (n) => {
    const p = roundHalfUpParts(Math.abs(n), 2);
    return `${p.int}.${p.frac}`;
  },
};

/**
 * ⚠️ ESKİ DAL — yalnız damgasız (ticari yuvarlamadan önce donmuş) belge için: yeniden
 * baskısı aslının aynısı kalsın diye o günkü renderer kodu BAYT BAYT korunur. Yeni kod
 * çağırmaz; `test_belge_ticari_yuvarlama` belge yolunda bunun dışındaki `toFixed`i reddeder.
 */
const LEGACY_NUM: DocNum = {
  tr: (n, dec) => {
    if (n == null || Number.isNaN(n)) return "";
    const [int, frac] = Math.abs(n).toFixed(dec).split(".");
    return (n < 0 ? "-" : "") + group(int!) + (dec > 0 && frac ? `,${frac}` : "");
  },
  metreDot: (n) => {
    if (n == null || n === 0) return "";
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  },
  absDec2: (n) => Math.abs(n).toFixed(2),
};

/** Damganın TEK okuyucusu: snapshot'ın yuvarlama rejimine göre sayı biçimleri. */
export function docNum(snapshot: { numberRounding?: unknown }): DocNum {
  return snapshot.numberRounding === NUMBER_ROUNDING_HALF_UP ? HALF_UP_NUM : LEGACY_NUM;
}

/**
 * CSS ölçüsü (px/mm/%) — belgede GÖRÜNEN sayı değildir; ikili yuvarlama burada zararsızdır
 * ve CSS çıktısı bayt bayt korunur. Görünen sayı `docNum`dan geçer.
 */
export function cssFixed(n: number, dec: number): string {
  return n.toFixed(dec);
}
