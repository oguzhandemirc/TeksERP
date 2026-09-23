// =============================================================================
// ESKİ İSTEMCİNİN KIRILDIĞI EKSENLER — kilit seri düzeyinde değil ALAN düzeyinde
// =============================================================================
// `series-write.helper.ts`ten AYRILDI (boyut tavanı). Bölme ekseni SORU: orada
// "bu seriye dokunulabilir mi" (değerden bağımsız), burada "hangi ALANI
// değiştiriyorsun" (değerden doğan). İkisi farklı gün de kalkar: biri sahadaki
// sürüm yükselince, öteki o eksenin kırılmadığı ölçülünce.
//
// ⚠️ TABLO BİR ÖLÇÜMÜN SONUCUDUR (`SCANNED_CLIENT_BREAKING_AXES`), tahminin
// değil; `test_eski_istemci_okutma` ikisini iki yönlü eşler.
// =============================================================================
import {
  FAZ_B_ONCESI,
  FAZ_D_ONCESI,
  SCANNED_CLIENT_BREAKING_AXES,
  firstVersionAbove,
  scanningClientsMissingPhases,
  type SeriesFormatAxis,
} from "../../config/client-version-policy";
import { numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { AppError } from "../../utils/app-error";
import type { NumberSeriesFormat } from "./series-format.helper";

/**
 * KİLİTLİ EKSEN DEĞİŞTİ Mİ? — eski istemcinin kırıldığı ALANLAR (K-E4).
 *
 * ⚠️ DEĞER GEREKTİRİR, bu yüzden `assertSeriesFormatWritable`ten AYRI: "bu seriye
 * dokunulabilir mi" sorusu değerden bağımsız, "hangi ALANI değiştiriyorsun"
 * sorusu değerden doğar. Kilitli eksene DOKUNMAYAN bir değişiklik serbesttir —
 * eski kapı bunu da reddediyordu ve fabrikanın hane/ayraç ayarını gereksiz yere
 * kilitliyordu (ölçüldü: 8 okutulan serinin 6'sında yalnız ÖN EK kırıyor).
 */
export function assertAxesAllowed(
  key: string,
  current: NumberSeriesFormat,
  next: Omit<NumberSeriesFormat, "retiredPrefixes" | "infix" | "formatChangedAt">,
): void {
  const katalog = numberSeriesCatalogEntry(key);
  if (!katalog.kind) return;
  const missingPhases = scanningClientsMissingPhases();
  if (missingPhases.length === 0) return;
  const kiran = SCANNED_CLIENT_BREAKING_AXES[key] ?? [];
  if (kiran.length === 0) return;
  const degisen: SeriesFormatAxis[] = [];
  if (next.prefix !== current.prefix) degisen.push("prefix");
  if (next.dateSegment !== current.dateSegment) degisen.push("dateSegment");
  if (next.digits !== current.digits) degisen.push("digits");
  if (next.separator !== current.separator) degisen.push("separator");
  if ((next.separator2 ?? null) !== (current.separator2 ?? null)) degisen.push("separator2");
  const engellenen = degisen.filter((a) => kiran.includes(a));
  if (engellenen.length === 0) return;
  const esik = missingPhases.includes("B") ? FAZ_B_ONCESI : FAZ_D_ONCESI;
  throw AppError.badRequest(
    `"${katalog.label}" serisinde ${eksenAdlariTr(engellenen)} değişimini sahadaki eski panel ve ` +
      `tabletler okutamaz. Panel ${firstVersionAbove(esik.electron)} ve tablet ` +
      `${firstVersionAbove(esik.mobil)} ya da üstü kurulunca bu alan da değiştirilebilir; ` +
      "biçimin diğer alanları şimdi de değiştirilebilir.",
    { code: "NUMBER_SERIES_CLIENT_TOO_OLD", key, missingPhases, lockedAxes: engellenen },
  );
}

/** Eksen adlarının kullanıcı dili — kilit cümlesiyle AYNI sözcükler. */
function eksenAdlariTr(eksenler: SeriesFormatAxis[]): string {
  const ad: Record<SeriesFormatAxis, string> = {
    prefix: "ön ek",
    dateSegment: "tarih",
    digits: "hane",
    separator: "ayraç",
    separator2: "ikinci ayraç",
  };
  return eksenler.map((a) => ad[a]).join(" ve ");
}
