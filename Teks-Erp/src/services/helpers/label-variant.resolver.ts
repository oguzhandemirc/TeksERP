// =============================================================================
// Varyant seçimi — şablonun boyut varyantları içinden cihaz medyasına uyanı bul
// =============================================================================
// Kural (kullanıcı kararı — otomatik ölçekleme YOK, elle teyitli varyantlar):
//   1. Medya (format profili) boyutuna ±1.0 mm toleransla eşleşen varyant → "exact".
//      Orientation normalizasyonu YOK: 100×148 ile 148×100 FARKLI varyanttır
//      (profil fiziksel gerçeği söyler).
//   2. Eşleşme yoksa isPrimary varyant (yoksa en eski) → "fallback". BASKI ASLA
//      BLOKLANMAZ; taşan elemanı yazıcı kırpar. Electron atama/editör ekranları
//      "bu cihaz için eşleşen varyant yok" uyarısını PROAKTİF gösterir.
//   3. Şablonun hiç varyantı yoksa → null (akış-modeli dual-mode devam eder).
// =============================================================================

import type { LabelTemplateVariant } from "@prisma/client";

export type VariantMatch = "exact" | "fallback" | null;

export interface PickedVariant {
  variant: LabelTemplateVariant | null;
  match: VariantMatch;
}

/** Boyut eşleşme toleransı (mm) — medya üretim toleransını emer. */
export const VARIANT_MATCH_TOLERANCE_MM = 1.0;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= VARIANT_MATCH_TOLERANCE_MM;
}

export function pickVariant(
  variants: LabelTemplateVariant[] | null | undefined,
  media: { widthMm: number; heightMm: number },
): PickedVariant {
  if (!variants || variants.length === 0) return { variant: null, match: null };

  const exact = variants.find(
    (v) => near(Number(v.widthMm), media.widthMm) && near(Number(v.heightMm), media.heightMm),
  );
  if (exact) return { variant: exact, match: "exact" };

  const primary =
    variants.find((v) => v.isPrimary) ??
    [...variants].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return { variant: primary, match: "fallback" };
}
