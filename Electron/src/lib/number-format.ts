// =============================================================================
// SAYI BİÇİMİ — PDF metni ile Excel görünümünün TEK kaynağı
// =============================================================================
// Aynı belgenin PDF'i ile Excel'i aynı değeri AYNI METİNLE göstermeli (kullanıcı
// kuralı 2026-09-25). PDF metni tr-TR `toLocaleString` ile basılır ve DEĞİŞMEZ; Excel
// sayı biçimi bu kuraldan TÜRETİLİR. Excel'in "#,##0.#" gibi isteğe bağlı haneli
// biçimi tam sayıda sonda ayırıcı gösterir ("12,") — PDF'te olmayan bir metin.
// =============================================================================

/**
 * Raporlarda kullanılabilen sayı biçimleri — kapalı küme. Eşitlik bekçisi bu kümenin
 * HER elemanını ölçer; rapor spec'lerini tarayan bekçi kümede olmayan biçimi reddeder.
 */
export const REPORT_NUM_FMTS = ["#,##0", "#,##0.#", "#,##0.0", "#,##0.00", "0.0", "#,##0.0000"] as const;

/** Excel sayı biçimi — sabit ya da hücre değerine göre seçilen. */
export type ExcelNumFmt = string | ((value: unknown) => string | undefined);

/** Rapor biçiminin ondalık hane sayısı ("#,##0.00" → 2, "#,##0" → 0, "#,##0.#" → 1). */
export function fixedDecimalsOf(numFmt: string): number {
  return /\.([0#]+)/.exec(numFmt)?.[1]?.length ?? 0;
}

/**
 * Rapor hücresinin PDF metni: biçimdeki hane sayısı SABİT basılır, binlik gruplanır.
 * Sayı olmayan değer (boş, metin, "—") aynen geçer.
 */
export function reportCellText(v: unknown, numFmt?: string): string {
  if (numFmt === undefined || v === null || v === undefined || v === "") return String(v ?? "");
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const decimals = fixedDecimalsOf(numFmt);
  return n.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Rapor kolonunun Excel biçimi — PDF'in kuralı: binlik grup + SABİT hane. */
export function reportExcelNumFmt(numFmt: string): string {
  const d = fixedDecimalsOf(numFmt);
  return d > 0 ? `#,##0.${"0".repeat(d)}` : "#,##0";
}

/** Serbest ondalıklı sayının PDF metni (liste/döküm): binlik grup, en çok 3 hane. */
export function upTo3Text(n: number): string {
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
}

/**
 * `upTo3Text`in Excel karşılığı — hücre başına: tam sayıda ondalık ayırıcı görünmez,
 * kesirde en çok 3 hane. `suffix` birim eki (ör. `" cm"`).
 */
export function upTo3ExcelNumFmt(suffix = ""): ExcelNumFmt {
  const ek = suffix ? `"${suffix}"` : "";
  return (v: unknown) => (typeof v === "number" ? `${Number.isInteger(v) ? "#,##0" : "#,##0.0##"}${ek}` : undefined);
}
