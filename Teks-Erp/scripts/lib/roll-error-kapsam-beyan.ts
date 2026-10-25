// =============================================================================
// RollError KAPSAM BEYANI (K4P-KAPSAM, 2026-10-25)
// =============================================================================
// NEDEN: muayene hatası (`origin=INSPECTION`) karar yoluna sızarsa Tambur'a
// metresiz hata düşer. Her `rollError.<okuma|güncelleme>` çağrısı ve RollError
// ilişki okuması ya `ACTIONABLE_ROLL_ERROR_WHERE`e başvurur ya da burada beyanlıdır;
// her ham SQL `roll_errors` ya `ACTIONABLE_ROLL_ERROR_SQL` taşır ya da beyanlıdır.
// Bekçi `scripts/test_roll_error_kapsam.ts` iki yönlü ölçer (beyansız erişim de,
// karşılığı kalmamış beyan da kırmızı).
//
// `dosya` src/ göreli; `sembol` = erişimi saran en yakın adlandırılmış
// fonksiyon/metot/değişken; `erisim` = `rollError.<op>` · `iliski.<ad>` · `sql`.
// =============================================================================

export type RollErrorKapsamSinifi = "TARIHCE" | "YAZAR" | "GUARD";

export interface RollErrorKapsamBeyani {
  dosya: string;
  sembol: string;
  erisim: string;
  sinif: RollErrorKapsamSinifi;
  /** Neden iki kökeni de görmeli — tek cümle. */
  gerekce: string;
}

export const ROLL_ERROR_KAPSAM_BEYANI: readonly RollErrorKapsamBeyani[] = [
  {
    dosya: "services/quality-inspection-query.service.ts",
    sembol: "getInspection",
    erisim: "iliski.rollErrors",
    sinif: "TARIHCE",
    gerekce: "muayene detayı yalnız kendi `inspectionId` ilişkisindeki INSPECTION satırlarını gösterir; karar yolu değildir",
  },
  {
    dosya: "services/backup-impact.service.ts",
    sembol: "run",
    erisim: "rollError.count",
    sinif: "TARIHCE",
    gerekce: "Yedekten dönüşte kaybolacak hata satırı sayısı: muayene satırı da kaybolur, sayılmalı.",
  },
  {
    dosya: "services/helpers/guarded-hard-remove.ts",
    sembol: "count",
    erisim: "rollError.count",
    sinif: "GUARD",
    gerekce: "Hata tipini kalıcı silme koruması: FK her iki kökende de var; muayene satırı da silmeyi engeller.",
  },
  {
    dosya: "services/helpers/workorder-clone.helper.ts",
    sembol: "repointRollsTx",
    erisim: "rollError.updateMany",
    sinif: "YAZAR",
    gerekce: "Klon adım referansı taşıması aynı topta kalır; kökenden bağımsız taşınmazsa eski adıma FK kalır ve rapor kaynak iş emrine atfeder.",
  },
  {
    dosya: "services/workorder.service.ts",
    sembol: "replace",
    erisim: "iliski.detectedErrors",
    sinif: "GUARD",
    gerekce: "Adım silme koruması `_count`u: muayene satırı da adıma FK ile bağlıdır, sayılmazsa ham P2003 sızar.",
  },
  {
    dosya: "services/workorder.service.ts",
    sembol: "replace",
    erisim: "iliski.processedErrors",
    sinif: "GUARD",
    gerekce: "Adım silme koruması `_count`u: FK kökenden bağımsızdır.",
  },
];
