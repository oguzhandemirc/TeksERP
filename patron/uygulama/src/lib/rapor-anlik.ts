// İstek üzerine rapor (V5b) metinleri: "Son: …", "Oluşturuldu: …", süre, hata iletisi, form varsayılanı. Saatler
// fabrika diliminden (`factory-time`); uygulama hesap yapmaz, yalnız biçimler.
import { ApiError, errorMessage } from "../api/client";
import type { RaporKosumu } from "../api/rapor";
import { fmtDayKey, formatFactory } from "./factory-time";

/** Liste satırı: "Son: 12.11 14:05" (fabrika saati); hiç oluşturulmadıysa "Henüz oluşturulmadı". */
export function sonMetni(k: Pick<RaporKosumu, "olusturulma"> | null | undefined): string {
  if (!k) return "Henüz oluşturulmadı";
  const t = formatFactory(k.olusturulma, "dd.MM HH:mm", "");
  return t ? `Son: ${t}` : "Henüz oluşturulmadı";
}

/** Koşum tarihi (geçmiş satırı, sonuç üstü): "12.11.2026 14:05". */
export function kosumTarihi(k: Pick<RaporKosumu, "olusturulma">): string {
  return formatFactory(k.olusturulma, "dd.MM.yyyy HH:mm");
}

/** Süre: "<1 sn" · "12 sn" · "1 dk 5 sn"; yoksa boş. */
export function sureMetni(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "<1 sn";
  const sn = Math.round(ms / 1000);
  return sn < 60 ? `${sn} sn` : `${Math.floor(sn / 60)} dk${sn % 60 ? ` ${sn % 60} sn` : ""}`;
}

/** Parametre özeti: sunucunun metni; eski sunucuda yoksa "Varsayılan dönem" yerine boş bırakılmaz. */
export function ozetMetni(k: Pick<RaporKosumu, "parametreOzeti">): string {
  return typeof k.parametreOzeti === "string" && k.parametreOzeti !== "" ? k.parametreOzeti : "Varsayılan dönem";
}

/** Kod → kısa Türkçe ileti (istek hatası `details.code` ya da koşumun `hataKodu`). */
export const RAPOR_ANLIK_HATA: Readonly<Record<string, string>> = {
  RAPOR_SIRADA: "Başka bir rapor hazırlanıyor, bitince tekrar deneyin.",
  RAPOR_TAVAN: "Saatlik rapor sınırına ulaşıldı.",
  ZAMAN_ASIMI: "Rapor 60 saniyede hazırlanamadı; aralığı daraltıp tekrar deneyin.",
  SONUC_BUYUK: "Sonuç çok büyük; aralığı daraltın.",
  YARIM_KALDI: "Rapor yarım kaldı; yeniden oluşturun.",
  PARAMETRE_GECERSIZ: "Seçilen dönem bu rapor için geçerli değil.",
  RAPOR_IZNI_YOK: "Bu rapor için yetkiniz yok.",
  MODULE_DISABLED: "Bu rapor fabrikada kapalı.",
  REPORT_DISABLED: "Bu rapor fabrikada kapalı.",
  RAPOR_KAPALI: "Bu rapor fabrikada kapalı.",
  MODUL_KAPALI: "Bu rapor fabrikada kapalı.",
  RAPOR_BILINMIYOR: "Bu rapor artık istenemiyor.",
  RAPOR_KOSUMU_YOK: "Rapor bulunamadı.",
  RAPOR_KOSUMU_SILINMIS: "Bu rapor silinmiş; yeniden oluşturun.",
};

/** Bu kodlar raporu kullanıcının listesinden düşürür (izin/modül/rapor kapısı): katalog yeniden çekilir. */
export const LISTEDEN_DUSUREN: ReadonlySet<string> = new Set(["RAPOR_IZNI_YOK", "MODULE_DISABLED", "REPORT_DISABLED", "RAPOR_BILINMIYOR"]);

export function raporHataIletisi(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === "AG") return "Sunucuya ulaşılamıyor.";
    return RAPOR_ANLIK_HATA[err.code] ?? errorMessage(err);
  }
  return errorMessage(err);
}

export function kosumHataIletisi(kod: string | null | undefined): string {
  return (kod ? RAPOR_ANLIK_HATA[kod] : undefined) ?? "Rapor hazırlanamadı; yeniden oluşturun.";
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface FormVarsayilani {
  readonly from: string;
  readonly to: string;
  /** `asOf` ISO anı (kesit); yoksa boş. */
  readonly asOf: string;
}

/** Son koşumun parametreleri → form metinleri (GG.AA.YYYY); aralık adları raporun (`dateFrom/dateTo` ya da `from/to`). */
export function formVarsayilani(params: unknown, names: readonly [string, string] | null): FormVarsayilani {
  const p = typeof params === "object" && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? fmtDayKey(v, "") : "");
  return {
    from: names ? day(p[names[0]]) : "",
    to: names ? day(p[names[1]]) : "",
    asOf: typeof p.asOf === "string" ? p.asOf : "",
  };
}
