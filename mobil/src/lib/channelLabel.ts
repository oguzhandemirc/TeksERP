// =============================================================================
// GÖRÜNÜR etiket (ör. "TEST FABRİKA", "TEST KURULUMU") — gösterimdir, davranış değil
// =============================================================================
// İki kaynak, sırayla: ① eski kanal derlemesi (`deploy/kanallar.json` → `gorunurEtiket` →
// `extra.gorunurEtiket`, `mobil/scripts/lib/kanal.cjs`); ② tek ortak pakette derleme etiket taşımaz,
// etiket fabrika sunucusunun lisans SINIFINDAN gelir (TEST / DEMO; tasarım §2.2). Üretim kanalında
// ve üretim lisansında ikisi de yok → null → hiçbir şey çizilmez (bugünkü görünüm).
// =============================================================================

import type { LicenseClass, LicenseStatusResponse } from './license';

type ConfigLike = { extra?: unknown } | null | undefined;

/** Lisans sınıfı → etiket; yalnız gerçek veri taşımaması gereken sınıflar işaretlenir. */
const LICENSE_CLASS_LABELS: Readonly<Partial<Record<LicenseClass, string>>> = {
  TEST: 'TEST KURULUMU',
  DEMO: 'DEMO KURULUMU',
};

export function resolveChannelLabel(config: ConfigLike): string | null {
  const extra = config?.extra;
  if (!extra || typeof extra !== 'object') return null;
  const raw = (extra as { gorunurEtiket?: unknown }).gorunurEtiket;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function licenseClassLabel(status: LicenseStatusResponse | null | undefined): string | null {
  if (!status || status.ayrinti !== true || !status.sinif) return null;
  return LICENSE_CLASS_LABELS[status.sinif] ?? null;
}

/** Ekrana çizilecek etiket: derleme etiketi varsa o, yoksa lisans sınıfı. ChannelStrip ve LicenseBanner TEK çağrı. */
export function resolveVisibleLabel(config: ConfigLike, status: LicenseStatusResponse | null | undefined): string | null {
  return resolveChannelLabel(config) ?? licenseClassLabel(status);
}
