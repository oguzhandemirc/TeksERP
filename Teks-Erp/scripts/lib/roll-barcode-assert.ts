// =============================================================================
// BEKÇİ YARDIMCISI — "bu kod bir TOP barkodu mu (ve hangi fazda)?"
// =============================================================================
// ⚠️ NEDEN VAR: bekçiler bu soruyu `/^T\d{6}[HF]\d{4}$/` gibi ELLE YAZILMIŞ
// desenlerle soruyordu (ölçüldü 2026-09-23: dokuz yer). Biçim 2026-09-23'te
// `roll` serisine — yani VERİYE — taşınınca o desenler serinin TOHUMUNU
// sabitleyen gizli kopyalara dönüştü: fabrika hane ya da ön ek değiştirdiğinde
// ürün doğru çalışır, bekçi kırmızı verir ve kırmızı ürünü değil bekçinin
// varsayımını gösterir.
//
// ⚠️ FAZ HARFİ AYRI SORULUR: `matchesSeries` infix'i zaten biliyor (`[HF]`), ama
// çağıranların çoğu "H mi F mi" diye SEÇİCİ soruyor (ham mı final mi üretildi).
// O yüzden faz ayrı parametre; verilmezse yalnız "top barkodu mu" sorulur.
import { resolveSeriesFormat } from "../../src/services/number-series.service";
import { matchesSeries, seriesPrefix } from "../../src/services/helpers/series-format.helper";

/** Kod, yürürlükteki `roll` serisine uyuyor mu? `faz` verilirse harf de doğrulanır. */
export function rollBarkoduMu(kod: string | null | undefined, faz?: "H" | "F"): boolean {
  if (!kod) return false;
  const fmt = resolveSeriesFormat("roll");
  if (!matchesSeries(fmt, kod)) return false;
  if (faz === undefined) return true;
  // Faz harfi ön ek + tarihten HEMEN sonra gelir; yerini biçim belirler.
  const bas = seriesPrefix(fmt, new Date()).length;
  return kod.trim().toUpperCase()[bas] === faz;
}
