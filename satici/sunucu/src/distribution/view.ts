// Yanıt biçimi: BigInt (dosya boyutu) JSON'a sayı olarak çıkar — işlem kimliğinin saklanan yanıtı da
// aynı biçimde olsun diye yanıt verisi buradan geçer. Boyut tavanı (DOSYA_AZAMI_MB) güvenli tamsayı içinde.
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

export const MIB = 1024 * 1024;
