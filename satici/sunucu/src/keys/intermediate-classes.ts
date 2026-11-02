// HAK ARA İMZACISININ VARSAYILAN SINIFLARI — tek kaynak (`anahtar.ts ara-uret`, dönem töreni, bekçi). Küme protokolün
// sınıf listesinden TÜRER: yeni sınıf eklenince ara imzacı onu kendiliğinden kapsar, kapsamazsa kuyruk sessizce dolardı
// (2026-11-02: BARINDIRILAN eksikti, her HAK değişikliği kök kuyruğuna düştü). Kökün yetkisini hiçbir zaman aşmaz.
import { LICENSE_CLASSES, type LicenseClass } from "../lisans-protokol";

/** Ara imzacının KAPSAMADIĞI sınıflar: BAYI HAK'ını bayi anahtarı (kendi kök imzalı sertifikası ve tavanıyla) imzalar. */
export const INTERMEDIATE_EXCLUDED_CLASSES: readonly LicenseClass[] = Object.freeze(["BAYI"]);

/** Ara imzacının varsayılan sınıfları: protokolün bütün sınıfları − dışlananlar. */
export const INTERMEDIATE_DEFAULT_CLASSES: readonly LicenseClass[] = Object.freeze(LICENSE_CLASSES.filter((c) => !INTERMEDIATE_EXCLUDED_CLASSES.includes(c)));

/** Kökün yetkili olduğu sınıflarla kesişim (`--siniflar` verilmezse ara imzacının kümesi). */
export function intermediateDefaultClasses(rootClasses: readonly LicenseClass[]): LicenseClass[] {
  return INTERMEDIATE_DEFAULT_CLASSES.filter((c) => rootClasses.includes(c));
}
