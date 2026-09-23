// =============================================================================
// ELLE NUMARA KAPISI — `numberSource` ayarının ÜRETİM YOLUNDAKİ karşılığı
// =============================================================================
// Ayarı panel yazar (`series-write.helper`), ama ayarın BİR ŞEY YAPTIĞI yer
// burasıdır: çuval açılırken, iş emri kurulurken, sipariş girilirken, sevk
// partisi adlandırılırken. Dört yol da AYNI yüklemden geçer — dört kopya,
// zamanla ayrışan dört davranış demekti.
//
// ⚠️ OKUTULAN SERİDE ELLE DEĞER AYRICA SINANIR ve gerekçesi fiziksel: `sack` ve
// `workOrder` barkod olarak OKUTULUYOR. Elle yazılmış bir çuval no küçük harf
// ya da Türkçe harf taşırsa okutulduğunda tanınmaz; başka bir okutulan serinin
// ön ekiyle başlarsa (ör. `FS…`) YANLIŞ DALA düşer ve operatör başka bir kaydın
// ekranını açar. Bu yüzden elle değer KENDİ serisine çözülmek zorundadır.
//
// ⚠️ ÖLÇÜLDÜ (2026-09-23, fabrika KOPYASINDA salt okuma): bugünkü 235 çuval no
// ve 417 iş emri no'nun HEPSİ bu kurala zaten uyuyor — ASCII dışı 0, başka
// seriye çözülen 0, hiç çözülmeyen 0. Yani kapı bir geçmişi geçersiz kılmıyor;
// yine de YALNIZ YENİ kayda uygulanır, eski kodlar okunmaya devam eder.
// =============================================================================
import { NUMBER_SERIES_CATALOG, numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import { AppError } from "../../utils/app-error";
import { classifyScannedCode, resolveSeriesFormat } from "../number-series.service";

/** Okutulan kodların karakter kümesi — Code128 + istemcilerin `toUpperCase()` varsayımı. */
const SCANNABLE = /^[A-Z0-9]+$/;

/**
 * Elle verilen numara bu seride KABUL EDİLİR Mİ?
 *
 * `manual === null` "kullanıcı elle bir şey yazmadı" demektir; `MANUAL` modunda
 * bu bir hatadır, diğer modlarda normaldir (sunucu üretir).
 */
export function assertManualNumberAllowed(key: string, manual: string | null): void {
  const entry = numberSeriesCatalogEntry(key);
  const mode = resolveSeriesFormat(key).numberSource ?? "FREE";

  if (manual === null || manual === "") {
    if (mode === "MANUAL") {
      throw AppError.badRequest(
        `${entry.label} elle girilmek zorunda: bu seride otomatik numara üretimi kapalı.`,
        { code: "NUMBER_SERIES_MANUAL_REQUIRED", key },
      );
    }
    return;
  }

  if (mode === "SYSTEM") {
    throw AppError.badRequest(
      `${entry.label} elle girilemez: bu seride numarayı yalnız sistem üretir.`,
      { code: "NUMBER_SERIES_MANUAL_NOT_ALLOWED", key },
    );
  }

  // OKUTULAN seri: elle değer de okutulabilir olmalı ve KENDİ türüne çözülmeli.
  if (entry.kind) {
    const cozum = classifyScannedCode(manual);
    if (!SCANNABLE.test(manual) || cozum?.key !== key) {
      throw AppError.badRequest(
        `"${manual}" bu seride elle kullanılamaz: ${entry.label} barkod olarak okutuluyor, ` +
          "elle yazılan numara da aynı biçimde olmalı (yalnız İngiliz alfabesi büyük harfleri ve rakam)." +
          (cozum && cozum.key !== key
            ? ` Bu kod "${numberSeriesCatalogEntry(cozum.key).label}" serisine ait görünüyor.`
            : ""),
        { code: "NUMBER_SERIES_MANUAL_NOT_SCANNABLE", key, cozulen: cozum?.key ?? null },
      );
    }
  }
}

/**
 * İstemcinin FORM ÇİZMEK için ihtiyaç duyduğu tek şey: hangi seride elle alan
 * gösterilecek, zorunlu mu?
 *
 * ⚠️ YENİ UÇ AÇILMADI ve bu bilinçli: izin guard'ı olmayan uç sayısı cırcırlı
 * bir tabandır (`test_route_auth_coverage`) ve onu bir form ayrıntısı için
 * yükseltmek, kapıyı çözdüğünden büyük bir bedelle gevşetirdi. Yük zaten
 * istemcinin açılışta çektiği `GET /api/feature-flags` yanıtına EKLENİR —
 * `settingsPasswordRequired`in birebir emsali: bayrak değil DURUM, önbellekten
 * senkron okunur, DB'ye gitmez.
 */
export function manualNumberModes(): Array<{
  key: string;
  label: string;
  mode: "FREE" | "SYSTEM" | "MANUAL";
  scanned: boolean;
}> {
  return NUMBER_SERIES_CATALOG.filter((e) => e.manualEntry).map((e) => ({
    key: e.key,
    label: e.label,
    mode: resolveSeriesFormat(e.key).numberSource ?? "FREE",
    scanned: e.kind !== undefined,
  }));
}
