// =============================================================================
// TAHAR PLANI — kısaltmalı yazım ayrıştırıcısı / sıkıştırıcı / tekrar birimi (T1, Seyitoğlu 2026-11-28)
// =============================================================================
// Tahar raporu = tel sırasıyla 1-tabanlı çerçeve no dizisi ("1-12 arası; normalde 8'e kadar, en çok 12").
// Yazım: "3x(1-2-3-4) 5-6" · "(1-2-3-4)x3" · "2x5" · iç içe parantez; ayraç boşluk/virgül/tire. SAF modül.
// Panel aynası `Electron/src/components/weave/drawing-in-plan.ts` (parite: aynı örnek tablo).
// =============================================================================

/** DB CHECK tavanı; ayar (`dokuma.drawingInMaxFrames`) bunun altında kalır. */
export const DRAWING_IN_FRAMES_HARD_MAX = 16;
/** Ayar kaydı yokken üst sınır (fabrika: "en yüksek 12"). */
export const DRAWING_IN_FRAMES_DEFAULT_MAX = 12;
/** Bir tahar raporunda en çok tel (kumaş görünümü tavanıyla aynı). */
export const DRAWING_IN_MAX_ENDS = 512;
export const DRAWING_IN_NOTATION_MAX = 500;

export type NotationResult = { ok: true; sequence: number[] } | { ok: false; message: string };

type Tok = { t: "num"; v: number } | { t: "x" } | { t: "(" } | { t: ")" };

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  const s = src.replace(/[×*X]/g, "x");
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/[\s,;\-–]/.test(c)) { i++; continue; }
    if (c === "x" || c === "(" || c === ")") { out.push({ t: c } as Tok); i++; continue; }
    if (/\d/.test(c)) {
      let j = i;
      while (j < s.length && /\d/.test(s[j]!)) j++;
      out.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    return `Tahar yazımında tanınmayan karakter: "${c}". Yalnız sayı, x, parantez ve ayraç (boşluk, tire, virgül) kullanın.`;
  }
  return out;
}

class NotationError extends Error {}

/** Kısaltmalı yazımı açar: "3x(1-2-3-4) 5-6" → [1,2,3,4,1,2,3,4,1,2,3,4,5,6]. */
export function parseDrawingInNotation(src: string): NotationResult {
  const text = src.trim();
  if (text === "") return { ok: false, message: "Tahar dizisi boş — en az bir çerçeve numarası yazın." };
  if (text.length > DRAWING_IN_NOTATION_MAX) return { ok: false, message: `Tahar yazımı en çok ${DRAWING_IN_NOTATION_MAX} karakter olabilir.` };
  const tokenized = tokenize(text);
  if (typeof tokenized === "string") return { ok: false, message: tokenized };
  const toks: Tok[] = tokenized;
  let p = 0;
  const repeat = (block: number[], k: number): number[] => {
    if (k < 1) throw new NotationError("Tekrar sayısı en az 1 olmalı.");
    if (block.length * k > DRAWING_IN_MAX_ENDS) throw new NotationError(`Açılmış tahar dizisi en çok ${DRAWING_IN_MAX_ENDS} tel olabilir.`);
    return Array.from({ length: block.length * k }, (_, i) => block[i % block.length]!);
  };
  const primary = (): number[] => {
    const tk = toks[p];
    if (!tk) throw new NotationError("Tahar yazımı yarım kaldı.");
    if (tk.t === "num") { p++; return [tk.v]; }
    if (tk.t === "(") {
      p++;
      const inner = seq();
      if (toks[p]?.t !== ")") throw new NotationError("Açılan parantez kapanmamış.");
      p++;
      if (inner.length === 0) throw new NotationError("Boş parantez yazılmış.");
      return inner;
    }
    throw new NotationError(tk.t === ")" ? "Fazladan kapanan parantez var." : "'x' işaretinden önce tekrar sayısı ya da grup olmalı.");
  };
  const item = (): number[] => {
    const tk = toks[p];
    // "3x(…)" / "3x5": önde sayı + x → tekrar sayısı.
    if (tk?.t === "num" && toks[p + 1]?.t === "x") {
      p += 2;
      return repeat(primary(), tk.v);
    }
    const base = primary();
    // "(…)x3": grup + x + sayı → sonda tekrar sayısı.
    if (toks[p]?.t === "x") {
      const n = toks[p + 1];
      if (n?.t !== "num") throw new NotationError("'x' işaretinden sonra tekrar sayısı olmalı.");
      p += 2;
      return repeat(base, n.v);
    }
    return base;
  };
  function seq(): number[] {
    const out: number[] = [];
    while (p < toks.length && toks[p]!.t !== ")") {
      out.push(...item());
      if (out.length > DRAWING_IN_MAX_ENDS) throw new NotationError(`Açılmış tahar dizisi en çok ${DRAWING_IN_MAX_ENDS} tel olabilir.`);
    }
    return out;
  }
  try {
    const sequence = seq();
    if (p < toks.length) throw new NotationError("Fazladan kapanan parantez var.");
    if (sequence.length === 0) return { ok: false, message: "Tahar dizisi boş — en az bir çerçeve numarası yazın." };
    return { ok: true, sequence };
  } catch (e) {
    if (e instanceof NotationError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Dizinin her elemanı 1..frameCount mı? Değilse Türkçe mesaj (servis 400, panel alan hatası). */
export function drawingInSequenceError(sequence: readonly number[], frameCount: number, label = "Tahar dizisi"): string | null {
  if (sequence.length > DRAWING_IN_MAX_ENDS) return `${label} en çok ${DRAWING_IN_MAX_ENDS} tel olabilir.`;
  for (const v of sequence) {
    if (!Number.isInteger(v) || v < 1) return `${label} yalnız 1 ve üstü tam sayı çerçeve numarası içerebilir.`;
    if (v > frameCount) return `${label}: ${v} numaralı çerçeve yok — çerçeve sayısı ${frameCount}, en çok ${frameCount} yazılabilir.`;
  }
  return null;
}

/** Diziyi kısaltmalı yazıma çevirir (düğmeyle girişte metin kutusunu doldurur): tekrar eden blok "kx(…)". */
export function compressDrawingIn(sequence: readonly number[]): string {
  const n = sequence.length;
  const parts: string[] = [];
  let singles: number[] = [];
  const flush = (): void => { if (singles.length) { parts.push(singles.join("-")); singles = []; } };
  let i = 0;
  while (i < n) {
    let best: { len: number; k: number } | null = null;
    for (let len = 1; len <= Math.floor((n - i) / 2); len++) {
      let k = 1;
      while (i + (k + 1) * len <= n && sameBlock(sequence, i, i + k * len, len)) k++;
      if (k >= 2 && (!best || len * (k - 1) > best.len * (best.k - 1))) best = { len, k };
    }
    if (best) {
      flush();
      const block = sequence.slice(i, i + best.len);
      parts.push(`${best.k}x${best.len === 1 ? String(block[0]) : `(${block.join("-")})`}`);
      i += best.len * best.k;
    } else {
      singles.push(sequence[i]!);
      i++;
    }
  }
  flush();
  return parts.join(" ");
}

function sameBlock(s: readonly number[], a: number, b: number, len: number): boolean {
  for (let j = 0; j < len; j++) if (s[a + j] !== s[b + j]) return false;
  return true;
}

/** En kısa tekrar birimi: [1,2,1,2,1,2] → [1,2]. Eşleştirme özetinin girdisi (aynı tahar = aynı birim). */
export function drawingInRepeatUnit(sequence: readonly number[]): number[] {
  const n = sequence.length;
  for (let p = 1; p <= n; p++) {
    if (n % p !== 0) continue;
    let ok = true;
    for (let i = p; i < n && ok; i++) if (sequence[i] !== sequence[i % p]) ok = false;
    if (ok) return sequence.slice(0, p);
  }
  return [...sequence];
}

/** Özetin kanonik metni (sunucu bunu sha256'lar). */
export function drawingInCanonical(sequence: readonly number[]): string {
  return drawingInRepeatUnit(sequence).join("-");
}
