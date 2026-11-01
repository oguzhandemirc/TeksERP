import { z } from "zod";

/** Sunucu Prisma Decimal'i JSON'da SAYI döndürür (installDecimalNumberSerializer); formlar
 *  metin taşır. Düzenle formu açılırken değer buradan geçer — aksi halde Zod "expected string" der. */
export function decimalToFormText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
}

/** Şema girişinde aynı dönüşüm: sayı gelirse metne çevrilir, sonra asıl metin şeması uygulanır. */
export function acceptNumberAsText<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (typeof v === "number" ? decimalToFormText(v) : v), schema);
}
