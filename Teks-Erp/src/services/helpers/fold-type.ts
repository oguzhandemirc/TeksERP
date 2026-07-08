// =============================================================================
// TeksERP - Kat Tipi (foldType) tek kaynak / kanonikleştirme (D-13)
// =============================================================================
// foldType HC-06 (tambur) kanal eşleşmesini besler: seed'de yalnız iki metre
// cihazı var — role "2-KAT" ve "4-KAT". Serbest string tutarsızlığı ("4-kat",
// "4 Kat", "4KAT") bu eşleşmeyi bozar. Enum migration yerine (DB oturumu kararı)
// app-seviyesi kanonikleştirme: 2/4-KAT ailesi TEK forma ("2-KAT"/"4-KAT")
// indirgenir.
//
// ÖNEMLİ (domain): WO/reçete PLANLAMA foldType'ı yalnız 2/4-KAT DEĞİL — "TÜP"
// (tüp/tubular kumaş) ve özel değerler de meşru (mobil UI notu: "özel"). Tambur
// FINALIZE adımı ayrıca strict z.enum(FOLD_TYPES) ile 2/4-KAT'a zorlar (operatör
// makinede seçer). Bu yüzden burada tanınmayan değer REDDEDİLMEZ — yalnız 2/4-KAT
// varyantları kanonikleştirilir, gerisi (TÜP/özel) olduğu gibi geçer. Böylece
// mevcut/özel kayıtlar düzenlenirken kırılmaz; kanal-eşleşmesi ise tutarlı olur.
// =============================================================================

import { z } from "zod";

/** HC-06 kanal eşleşmeli kanonik kat tipleri (seed metre cihaz rolleri). Tambur
 *  finalize bunlara z.enum ile zorlar; planlama tarafı ek olarak TÜP/özel kabul eder. */
export const FOLD_TYPES = ["2-KAT", "4-KAT"] as const;
export type FoldType = (typeof FOLD_TYPES)[number];

/**
 * 2/4-KAT ailesini kanonikleştirir; tanınmayan değer TRİM'lenip DEĞİŞMEDEN geçer.
 * "4-kat" / "4 Kat" / "4KAT" / "4_kat" → "4-KAT". Boş/whitespace → null.
 * "TÜP" / "TUP" / özel → olduğu gibi (trim) — reddedilmez.
 */
export function normalizeFoldType(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const m = t.toUpperCase().replace(/[\s_]+/g, "-").match(/^([24])-?KAT$/);
  return m ? `${m[1]}-KAT` : t;
}

/**
 * Zod alan şeması (yeni yazım uçları). string → kanonikleştir; boş → null;
 * absent (undefined) KORUNUR (update no-op); null = temizle. Tanınmayan değer
 * geçerlidir (TÜP/özel). Tambur finalize gibi strict yol için `z.enum(FOLD_TYPES)`.
 */
export const foldTypeSchema = z
  .string()
  .max(64)
  .transform((v) => normalizeFoldType(v))
  .nullable()
  .optional();

/**
 * Servis-katmanı kanonikleştirme (BaseController/generic CRUD yolu — Zod yok).
 * data.foldType varsa 2/4-KAT ailesini kanonik forma çevirir; TÜP/özel dokunulmaz.
 * Mutasyondan ÖNCE çağır.
 */
export function canonicalizeFoldTypeInPlace(data: Record<string, unknown>): void {
  if (!("foldType" in data)) return;
  const v = data.foldType;
  if (v == null || typeof v !== "string") return;
  data.foldType = normalizeFoldType(v);
}
