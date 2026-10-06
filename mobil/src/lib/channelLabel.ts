// =============================================================================
// GÖRÜNÜR etiket (ör. "TEST KURULUMU") — gösterimdir, davranış değil
// =============================================================================
// Tek ortak pakette derleme etiket taşımaz; etiket fabrika sunucusunun lisans SINIFINDAN gelir
// (TEST / DEMO; tasarım §2.2). Üretim lisansında null → hiçbir şey çizilmez (bugünkü görünüm).
// =============================================================================

import type { LicenseClass, LicenseStatusResponse } from './license';

/** Lisans sınıfı → etiket; yalnız gerçek veri taşımaması gereken sınıflar işaretlenir. */
const LICENSE_CLASS_LABELS: Readonly<Partial<Record<LicenseClass, string>>> = {
  TEST: 'TEST KURULUMU',
  DEMO: 'DEMO KURULUMU',
};

/** Ekrana çizilecek etiket — ChannelStrip ve LicenseBanner TEK çağrı. */
export function licenseClassLabel(status: LicenseStatusResponse | null | undefined): string | null {
  if (!status || status.ayrinti !== true || !status.sinif) return null;
  return LICENSE_CLASS_LABELS[status.sinif] ?? null;
}
