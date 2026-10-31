// Çoklu seçimli (küme değerli) enum ayarı — taslak tek metin (seçenek sırasında virgüllü), gövde dizi.
// Taslağın metin kalması enum satırının kirli/kaydet/eşitleme yolunu olduğu gibi kullanır.

type Options = ReadonlyArray<{ value: string }>;

/** Sunucu dizisi → kanonik taslak metni; tanınmayan eleman düşer, dizi değilse `null`. */
export function encodeEnumSet(v: unknown, options: Options): string | null {
  if (!Array.isArray(v)) return null;
  return options.filter((o) => v.includes(o.value)).map((o) => o.value).join(",");
}

/** Taslak metni → PATCH dizisi (boş metin = boş küme). */
export function decodeEnumSet(s: string): string[] {
  return s === "" ? [] : s.split(",");
}

/** Bir seçeneği kümede aç/kapa; sonuç kanonik sırada. */
export function toggleEnumSet(s: string, value: string, options: Options): string {
  const cur = new Set(decodeEnumSet(s));
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  return options.filter((o) => cur.has(o.value)).map((o) => o.value).join(",");
}
