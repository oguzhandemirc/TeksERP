// =============================================================================
// SAYI BİÇİMİ — PDF metni ile Excel görünümünün TEK kaynağı
// =============================================================================
// Aynı belgenin PDF'i ile Excel'i aynı değeri AYNI METİNLE göstermeli (kullanıcı
// kuralı 2026-09-25); Excel sayı biçimi PDF kuralından TÜRETİLİR. Excel'in "#,##0.#"
// gibi isteğe bağlı haneli biçimi tam sayıda sonda ayırıcı gösterir ("12,").
// Birim sınıfı (kullanıcı kuralı 2026-11-12, `lib/format.ts` başlığı): biçim dizesindeki
// virgül PARA sınıfıdır ve binlik gruplar ("#,##0.00" → "325.684,90"); virgülsüz biçim
// ölçü/sayım/yüzdedir ve gruplamaz ("0.0" → "14700,5").
// =============================================================================
import { formatClassed } from "./format";

/**
 * Raporlarda kullanılabilen sayı biçimleri — kapalı küme. Eşitlik bekçisi bu kümenin
 * HER elemanını ölçer; rapor spec'lerini tarayan bekçi kümede olmayan biçimi reddeder.
 */
// Para: "#,##0.00" (tutar) · "#,##0.0000" (kur). Ölçü/sayım/yüzde: "0" · "0.0" · "0.00" (emanet kg).
export const REPORT_NUM_FMTS = ["0", "0.0", "0.00", "#,##0.00", "#,##0.0000"] as const;

/** Excel sayı biçimi — sabit ya da hücre değerine göre seçilen. */
export type ExcelNumFmt = string | ((value: unknown) => string | undefined);

/** Rapor biçiminin ondalık hane sayısı ("#,##0.00" → 2, "0" → 0, "0.#" → 1). */
export function fixedDecimalsOf(numFmt: string): number {
  return /\.([0#]+)/.exec(numFmt)?.[1]?.length ?? 0;
}

/** Biçim para sınıfı mı — binlik grup işareti (virgül) taşıyor mu. */
export function isGroupedNumFmt(numFmt: string): boolean {
  return numFmt.includes(",");
}

/**
 * Rapor hücresinin PDF metni: biçimdeki hane sayısı SABİT basılır; para biçimi binlik gruplanır,
 * ölçü biçimi gruplanmaz. Sayı olmayan değer (boş, metin, "—") aynen geçer.
 */
export function reportCellText(v: unknown, numFmt?: string): string {
  if (numFmt === undefined || v === null || v === undefined || v === "") return String(v ?? "");
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  const decimals = fixedDecimalsOf(numFmt);
  return formatClassed(n, decimals, decimals, isGroupedNumFmt(numFmt));
}

/** Rapor kolonunun Excel biçimi — PDF'in kuralı: SABİT hane; para biçiminde binlik grup, ölçüde grupsuz. */
export function reportExcelNumFmt(numFmt: string): string {
  const d = fixedDecimalsOf(numFmt);
  const base = isGroupedNumFmt(numFmt) ? "#,##0" : "0";
  return d > 0 ? `${base}.${"0".repeat(d)}` : base;
}

/** Serbest ondalıklı ölçü/sayım sayısının PDF metni (liste/döküm, grafik ekseni): grupsuz, en çok 3 hane. */
export function upTo3Text(n: number): string {
  return Number.isFinite(n) ? formatClassed(n, 0, 3, false) : String(n);
}

/**
 * `upTo3Text`in Excel karşılığı — hücre başına: tam sayıda ondalık ayırıcı görünmez,
 * kesirde en çok 3 hane. `suffix` birim eki (ör. `" cm"`).
 */
export function upTo3ExcelNumFmt(suffix = ""): ExcelNumFmt {
  const ek = suffix ? `"${suffix}"` : "";
  return (v: unknown) => (typeof v === "number" ? `${Number.isInteger(v) ? "0" : "0.0##"}${ek}` : undefined);
}
