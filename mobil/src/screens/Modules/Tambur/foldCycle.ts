// Kat tek düğme (2026-11-11): dokunuş sıradaki kat değerine geçer (2 Kat ↔ 4 Kat; daha fazlası varsa sırayla döner).

/** Sıradaki kat kodu; seçim yoksa/katalogda değilse ilk değer; katalog boşsa null. */
export function nextFoldCode(options: readonly { code: string }[], current: string | null | undefined): string | null {
  if (options.length === 0) return null;
  const i = options.findIndex((o) => o.code === current);
  return options[(i + 1) % options.length].code;
}
