// Patron bulutu TEL katmanının fabrika girişi. Sözleşme (uçlar, zarf, şemalar, kodlar) YALNIZ `./esitleme`
// dosyasındadır — o dosya `patron/sunucu/src/wire/esitleme.ts`in bayt-eşit aynasıdır (bekçi `test_bulut_tel_aynasi`)
// ve burada elle kopyalanmaz. Bu dosya yalnız fabrikaya özgü dönüşümü (DB değeri → tel değeri) taşır.
import { Prisma } from "@prisma/client";

export * from "./esitleme";

export type WireScalar = string | number | boolean | null;
export type WireValue = WireScalar | WireValue[] | { [k: string]: WireValue };
/** Anlık/rapor verisinin kabı — sözleşme skaler kabul etmez. */
export type WireContainer = WireValue[] | { [k: string]: WireValue };

/**
 * DB değeri → tel değeri. Decimal DİZİ olarak (float'a düşmez), tarih ISO `Z`, bigint dizi.
 * Tanınmayan nesne tipi FIRLATIR: sessiz `[object Object]` bir sözleşme sızıntısıdır.
 */
export function toWireValue(v: unknown): WireValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Tel değeri sonlu olmayan sayı");
    return v;
  }
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
  if (Array.isArray(v)) return v.map(toWireValue);
  if (typeof v === "object") {
    const out: { [k: string]: WireValue } = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = toWireValue(x);
    return out;
  }
  throw new Error(`Tel değerine çevrilemeyen tip: ${typeof v}`);
}
