// Makine adlarının kelime düzeyinde ortak öneki: çipte yalnız ayırt edici kısım kalsın (1e kararı).
// Karşılaştırma HAM — büyük/küçük harf dönüşümü yok (tr yerel tuzağı).

export function splitCommonPrefix(names: readonly string[]): { prefix: string | null; labels: string[] } {
  const full = names.map((n) => n.trim());
  if (full.length < 2) return { prefix: null, labels: full };
  const words = full.map((n) => n.split(/\s+/));
  let k = 0;
  // Her addan en az bir kelime sonekte kalmalı → önek uzunluğu en kısa adın kelime sayısından az.
  const max = Math.min(...words.map((w) => w.length)) - 1;
  while (k < max && words.every((w) => w[k] === words[0][k])) k += 1;
  if (k === 0) return { prefix: null, labels: full };
  return { prefix: words[0].slice(0, k).join(' '), labels: words.map((w) => w.slice(k).join(' ')) };
}
