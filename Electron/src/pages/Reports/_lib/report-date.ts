// =============================================================================
// RAPOR TARİHİ — sözleşme → backend parametresi (K7) — SAF fonksiyonlar, React yok
// =============================================================================
// Tarih sözleşmesi ADLA değil KATALOGLA birleşir: hangi raporun hangi parametreyi
// alacağını `REPORT_CATALOG.tarih` söyler, bu dosya o sözleşmeyi backend'in
// BUGÜNKÜ parametre adına çevirir. Adlar DEĞİŞMEZ — takvim günü (`from`/`to`,
// `factoryDay`) ile mutlak an (`dateFrom`/`dateTo`, `asOf`) ayrımı semantiktir,
// adı birleştirmek onu silerdi.
//
// URL anahtarları da burada: `ileri-pencere` bilerek AYRI anahtar taşır (`dueFrom`/
// `dueTo`) — başka bir rapordan gelen GERİYE bakan `dateFrom/dateTo` vade takviminde
// sessizce uygulanır ve ekran "vade yok" derdi.
// =============================================================================
import type { ReportTarih } from "@/lib/report-catalog";
import { addDaysToKey, factoryBackWindowIso, factoryDayEndIso, factoryDayKey, factoryDayStartIso } from "@/lib/factory-time";

/** Sözleşme → backend parametre ADLARI. Bileşen testi bu tabloyu ölçer; K7'nin tek evi. */
export const REPORT_DATE_PARAM_KEYS: Record<ReportTarih, readonly string[]> = {
  "aralik-iso": ["dateFrom", "dateTo"],
  "aralik-gun": ["from", "to"],
  "tek-gun": ["factoryDay"],
  kesit: ["asOf"],
  "ileri-pencere": ["dateFrom", "dateTo"],
  yok: [],
};

/** Sözleşme → URL anahtarları (panel durumu). `yok` hiç yazmaz. */
export const REPORT_DATE_URL_KEYS: Record<ReportTarih, readonly string[]> = {
  "aralik-iso": ["dateFrom", "dateTo"],
  "aralik-gun": ["dateFrom", "dateTo"],
  "tek-gun": ["factoryDay"],
  kesit: ["asOf"],
  "ileri-pencere": ["dueFrom", "dueTo"],
  yok: [],
};

/** Geriye bakan ön ayarlar (aralık sözleşmeleri). */
export const BACK_PRESETS = [
  { days: 7, label: "Son 7g" },
  { days: 30, label: "Son 30g" },
  { days: 90, label: "Son 90g" },
] as const;

/** İleri bakan ön ayarlar (`ileri-pencere`). Çıpa backend'in "bugün"üdür. */
export const FORWARD_PRESETS = [7, 30, 90] as const;

/** An → fabrika günü `YYYY-MM-DD` (`lib/factory-time`; istemcinin bilgisayar dilimi değil). Boş/geçersiz → "". */
export function toYmd(value: string | Date | undefined): string {
  if (value === undefined || value === "") return "";
  return factoryDayKey(value);
}

/** ISO an → fabrika günü `YYYY-MM-DD`; boşsa BUGÜN. */
export function toFactoryYmd(iso: string | undefined): string {
  return factoryDayKey(iso ? iso : new Date());
}

export const startOfDayIso = factoryDayStartIso;
export const endOfDayIso = factoryDayEndIso;

/** Takvim gününü `days` kadar kaydırır (UTC aritmetiği: yerel DST sıçraması günü kaydırmasın). */
export const shiftYmd = addDaysToKey;

/** "Son N gün" penceresi: N gün önce gün başı → bugün gün sonu (ISO), fabrika gününe göre. */
export const backWindowIso = factoryBackWindowIso;

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Sözleşme başına parametre üretimi ─────────────────────────────────────────
export type ReportDateParams =
  | { tarih: "aralik-iso"; dateFrom?: string; dateTo?: string }
  | { tarih: "aralik-gun"; from: string; to: string }
  | { tarih: "tek-gun"; factoryDay: string }
  | { tarih: "kesit"; asOf: string }
  | { tarih: "ileri-pencere"; dateFrom?: string; dateTo?: string }
  | { tarih: "yok" };

/** `aralik-iso`: URL'deki ISO çift aynen gider (boş → undefined; backend `.strict()`e boş anahtar gitmez). */
export function rangeIsoParams(dateFrom: string, dateTo: string): { dateFrom?: string; dateTo?: string } {
  return { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
}

/** `aralik-gun`: ISO çift → fabrika günü çifti. */
export function rangeDayParams(dateFrom: string | undefined, dateTo: string | undefined): { from: string; to: string } {
  return { from: toFactoryYmd(dateFrom), to: toFactoryYmd(dateTo) };
}

/** `kesit`: "31 Temmuz itibarıyla" o günün SONU demektir — gün başına çekilseydi o gün kesilen faturalar rapora hiç girmezdi. */
export function asOfParams(asOfYmd: string): { asOf: string } {
  return { asOf: endOfDayIso(asOfYmd) };
}

/**
 * `ileri-pencere`: URL boşsa HİÇ parametre gitmez — varsayılan pencerenin tek kaynağı
 * backend'dir (`window` ile geri söyler). İstemcide ikinci bir "30" yazılsaydı biri
 * değiştiğinde ekran ile veri sessizce ayrışırdı.
 */
export function forwardWindowParams(fromYmd: string, untilYmd: string): { dateFrom?: string; dateTo?: string } {
  if (!fromYmd || !untilYmd) return {};
  return { dateFrom: startOfDayIso(fromYmd), dateTo: endOfDayIso(untilYmd) };
}
