// Cihaz veri deseni (Peripheral.identifyPattern) tabletin geri izlemeli regex motorunda
// her çerçevede koşar; üstel geri izleme üreten sınıflar kayıtta reddedilir (yeni paket yok,
// sözdizimsel muhafazakâr tarama — şüphede reddeder).

export const PATTERN_MAX_LENGTH = 255;

type GroupFrame = { repeats: boolean; alternates: boolean };

/** `?`/`{0,1}`/`{n}` tekrarlamaz; `*`, `+`, `{n,}`, `{n,m}` (m>1) tekrarlar. Dönen: [tekrarlar mı, tüketilen uzunluk]. */
function readQuantifier(src: string, i: number): [boolean, number] {
  const c = src[i];
  if (c === "*" || c === "+") return [true, src[i + 1] === "?" ? 2 : 1];
  if (c === "?") return [false, src[i + 1] === "?" ? 2 : 1];
  if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
    if (!m) return [false, 0];
    const upper = m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]);
    const len = m[0].length + (src[i + m[0].length] === "?" ? 1 : 0);
    return [upper > 1, len];
  }
  return [false, 0];
}

/** Güvensiz desende Türkçe sebep döner; güvenli (ve derlenebilir) desende null. */
export function unsafePatternReason(src: string): string | null {
  if (src.length > PATTERN_MAX_LENGTH) return `Veri deseni en fazla ${PATTERN_MAX_LENGTH} karakter olabilir`;
  try {
    new RegExp(src);
  } catch {
    return "Veri deseni (regex) geçersiz";
  }
  const stack: GroupFrame[] = [{ repeats: false, alternates: false }];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      if ((n >= "1" && n <= "9") || n === "k") return "Veri deseninde geri referans (\\1, \\k<ad>) kullanılamaz";
      i += 2;
    } else if (c === "[") {
      i++;
      if (src[i] === "^") i++;
      if (src[i] === "]") i++;
      while (i < src.length && src[i] !== "]") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "(") {
      stack.push({ repeats: false, alternates: false });
      i++;
      if (src[i] === "?") {
        i++;
        if (src[i] === "<" && src[i + 1] !== "=" && src[i + 1] !== "!") {
          const end = src.indexOf(">", i);
          i = end < 0 ? src.length : end + 1;
        } else {
          i += src[i] === "<" ? 2 : 1;
        }
      }
      continue;
    } else if (c === ")") {
      const frame = stack.length > 1 ? stack.pop()! : { repeats: false, alternates: false };
      i++;
      const [rep, len] = readQuantifier(src, i);
      if (rep && (frame.repeats || frame.alternates)) {
        return "Veri deseninde iç içe tekrar ya da tekrarlanan seçenek ((a+)+, (a|b)*) kullanılamaz";
      }
      i += len;
      const parent = stack[stack.length - 1];
      parent.repeats ||= frame.repeats || rep;
      parent.alternates ||= frame.alternates;
      continue;
    } else if (c === "|") {
      stack[stack.length - 1].alternates = true;
      i++;
      continue;
    } else {
      i++;
    }
    // Atom sonrası niceleyici (kaçış, karakter sınıfı ya da düz karakter).
    const [rep, len] = readQuantifier(src, i);
    if (rep) stack[stack.length - 1].repeats = true;
    i += len;
  }
  return null;
}
