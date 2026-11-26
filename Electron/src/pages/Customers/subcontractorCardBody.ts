// YENİ cari kartının fason gövdesi — iki giriş noktası (Cariler diyaloğu `buildCustomerPayload`, seçicinin
// `quickCreateCustomerPayload`) ortak: kart + profil + kategori bağları sunucuda TEK tx'te doğar (2026-11-26).
import type { CustomerFormValues } from "./schema";

export function newCardSubcontractorBody(v: Pick<CustomerFormValues, "isSubcontractorRole" | "subcontractorCategoryIds">): { subcontractorRole?: true; subcontractorCategoryIds?: string[] } {
  if (!v.isSubcontractorRole) return {};
  const cats = v.subcontractorCategoryIds ?? [];
  return { subcontractorRole: true, ...(cats.length > 0 ? { subcontractorCategoryIds: cats } : {}) };
}
