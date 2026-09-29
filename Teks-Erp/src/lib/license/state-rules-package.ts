// Lisans durumunun PAKET kuralları: imzalı dosya listesine karşı bütünlük ve imzalı derleme
// künyesine karşı bakım sonu. Her biri bulgu listesine satır ekleyen saf değerlendirici;
// birleştirme `state.ts`te.
import { DAY_MS, isoToMs, type EntitlementDoc } from "./protocol";
import {
  DEFAULT_GRACE_DAYS,
  UNMEASURED_BANNER,
  UNVERIFIED_BANNER,
  dangerBanner,
  remainingDays,
  warnBanner,
  type Finding,
  type LicenseStateInput,
} from "./state-rules";

const MAINTENANCE_WARNING_DAYS = 30;

/**
 * Bütünlük uyuşmazlığı LİSANS GİBİ işler: ilk görülüşten 30 gün ek süre, sonra (zamanın getirdiği
 * her KISITLI gibi iki anahtarla: süre geçmiş VE yoklama başarısız) kısıtlı kip. Satıcı uyuşmazlığı
 * yoklamadaki nedenlerden görür; bağlantı sürerken kararı yaptırım kataloğundadır.
 */
export function evaluateIntegrity(
  g: Pick<LicenseStateInput, "butunluk" | "butunlukIlkUyusmazlikMs" | "sonYoklamaBasarisizMi">,
  nowMs: number,
  out: Finding[],
): void {
  if (g.butunluk === "OLCULEMEDI") out.push({ code: "BUTUNLUK_OLCULEMEDI", tier: "UYARI", banner: UNMEASURED_BANNER });
  if (g.butunluk !== "GECERSIZ") return;
  const first = g.butunlukIlkUyusmazlikMs ?? null;
  if (first === null || !Number.isFinite(first)) {
    out.push({ code: "BUTUNLUK_GECERSIZ", tier: "UYARI", banner: UNVERIFIED_BANNER });
    return;
  }
  const end = first + DEFAULT_GRACE_DAYS * DAY_MS;
  const text = "Program dosyaları imzalı paketle uyuşmuyor";
  if (nowMs < end) {
    const left = remainingDays(end, nowMs);
    out.push({ code: "BUTUNLUK_GECERSIZ", tier: "EK_SURE", daysLeft: left, banner: warnBanner(`${text} — ${left} gün içinde paket yeniden kurulmazsa program kısıtlı kipe geçecek.`) });
  } else if (g.sonYoklamaBasarisizMi) {
    out.push({ code: "BUTUNLUK_GECERSIZ", tier: "KISITLI", banner: dangerBanner(`${text}: program kısıtlı kipte (okuma, rapor, yedek açık).`) });
  } else {
    out.push({ code: "BUTUNLUK_GECERSIZ", tier: "EK_SURE", daysLeft: 0, banner: warnBanner(`${text}; paketi yeniden kurun.`) });
  }
}

/** Bakım sonu: bakım içinde çıkmış sürüm durmaz (yalnız güncelleme kesilir); bakım SONRASI çıkmış sürüm ek süreye düşer. */
export function evaluateMaintenance(g: LicenseStateInput, entitlement: EntitlementDoc, nowMs: number, out: Finding[]): void {
  const maintenanceEnd = isoToMs(entitlement.bakimBitis);
  if (g.derlemeTarihiMs === null) out.push({ code: "DERLEME_TARIHI_YOK" });
  else if (g.derlemeTarihiMs > maintenanceEnd) {
    const end = g.derlemeTarihiMs + DEFAULT_GRACE_DAYS * DAY_MS;
    const text = "Bu sürüm bakım süreniz bittikten sonra çıktı";
    if (nowMs < end) {
      const left = remainingDays(end, nowMs);
      out.push({ code: "BAKIM_IHLALI", tier: "EK_SURE", daysLeft: left, banner: warnBanner(`${text}; ${left} gün içinde bakımı yenileyin ya da hak ettiğiniz sürüme dönün.`) });
    } else if (g.sonYoklamaBasarisizMi) {
      out.push({ code: "BAKIM_IHLALI", tier: "KISITLI", banner: dangerBanner(`${text}: program kısıtlı kipte.`) });
    } else {
      out.push({ code: "BAKIM_IHLALI", tier: "EK_SURE", daysLeft: 0, banner: warnBanner(`${text}; bakımı yenileyin.`) });
    }
  }
  if (nowMs > maintenanceEnd) out.push({ code: "BAKIM_BITTI" });
  else if (maintenanceEnd - nowMs <= MAINTENANCE_WARNING_DAYS * DAY_MS) out.push({ code: "BAKIM_BITIYOR", detail: String(remainingDays(maintenanceEnd, nowMs)) });
}
