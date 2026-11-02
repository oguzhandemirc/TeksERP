// oie-a: müşteriye özel kurşun gram fiyatı — cari düzenleme formunun saf katmanı (CariEditDialog.test kilitler).
import type { CariRow, CariUpdateInput, Currency } from "./service";

export type KursunGramForm = { price: string; currency: Currency };

/** Gram fiyatı: "" → null (istasyonunki) · "0,05" → "0.05" · geçersiz → undefined (en fazla 4 ondalık, binlik ayracı yok). */
export function parseKursunGramPrice(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d{1,8})(?:[.,](\d{1,4}))?$/.exec(t);
  if (!m) return undefined;
  return m[2] ? `${m[1]}.${m[2]}` : (m[1] as string);
}

/** Yalnız müşteri carisinde ve backend alanı gönderiyorsa form alanı doğar; aksi null (gövdeye girmez). */
export function kursunGramFormFromCari(c: CariRow): KursunGramForm | null {
  if (c.kind !== "CUSTOMER" || c.kursunGramPrice === undefined) return null;
  return { price: c.kursunGramPrice == null ? "" : String(c.kursunGramPrice), currency: c.kursunGramCurrency ?? c.defaultCurrency };
}

/** Form → gövde parçası; boş fiyat ikisini de null yapar. */
export function kursunGramBody(f: KursunGramForm | null | undefined): { error?: string; body: Pick<CariUpdateInput, "kursunGramPrice" | "kursunGramCurrency"> } {
  if (!f) return { body: {} };
  const price = parseKursunGramPrice(f.price);
  if (price === undefined) return { error: "Gram fiyatı en fazla 4 ondalıklı sayı olmalı — örn. 0,05. Boş = istasyon fiyatı.", body: {} };
  return { body: { kursunGramPrice: price, kursunGramCurrency: price === null ? null : f.currency } };
}
