// Fason profili yazma gövdesi — Cariler diyaloğu ve cari kartındaki "Fason profilini düzenle" kullanır
// (eski Fason Firmalar sayfasından taşındı).
import type { Subcontractor } from "./types";
import type { SubcontractorFormValues } from "./schema";

interface BackendPayload {
  /** Yeni kayıtta GÖNDERİLMEZ — kodu sunucu üretir (numara serisi). */
  code?: string;
  name: string;
  taxNumber: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  isFavorite: boolean;
  documentProfileId: string | null;
  categoryIds: string[];
  customerId: string;
}

export const buildSubcontractorPayload = (v: SubcontractorFormValues, initial: Subcontractor | null): BackendPayload => ({
  // Kod GÖNDERİLMEZ: yeni kayıtta sunucu üretir (`FSN`+GGAAYY+NNNN, numara
  // serisi ayarından), düzenlemede mevcut kod korunur.
  ...(initial?.code ? { code: initial.code } : {}),
  name: v.name,
  taxNumber: v.taxNumber?.trim() || null,
  phone: v.phone?.trim() || null,
  address: v.address?.trim() || null,
  isActive: v.isActive,
  isFavorite: v.isFavorite,
  documentProfileId: v.documentProfileId ?? null,
  categoryIds: v.categoryIds,
  customerId: v.customerId,
});
