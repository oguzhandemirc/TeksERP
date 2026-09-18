import type { CompanyType } from "@/types/enums";

import type { CustomerFinanceView } from "./customerFinance";

export interface Customer {
  /** Z-A opt-in: yalnız `finance:read` taşıyan isteğin `GET /customers/:id` cevabında; listede yok. */
  cariAccountId?: string | null;
  finance?: CustomerFinanceView | null;
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  /** TÜRETİLMİŞ (rol modeli): geriye dönük — yanıtta gelir, panel okumaz da yazmaz; roller tek kaynak. */
  type?: CompanyType;
  /** İş ortağı rolleri — kartın tek kaynağı. Fason rolü profil bağından türetilir (panel yazmaz). */
  isCustomerRole: boolean;
  isSupplierRole: boolean;
  isSubcontractorRole: boolean;
  // "Her şube = ayrı müşteri" kart alanları (2026-07) — tümü opsiyonel.
  // exportCode: sevk belgelerinde şube kodu yoksa basılan ihracat kodu.
  exportCode: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  country: string | null;
  /** Sevk hedefi VARSAYILANI — sevkiyat formu buradan başlar, kilit değil; null = yok. */
  defaultDestination?: "DOMESTIC" | "EXPORT" | null;
  contactName: string | null;
  contactPhone: string | null;
  email: string | null;
  notes: string | null;
  /** Belge şablon profili — null = genel Belge Şablonları ayarı. */
  documentProfileId?: string | null;
  /** Fason = carinin rolü (2026-09-17): bağlı fason PROFİLİ (hafif); pasif profil rol değildir. */
  subcontractor?: { id: string; isActive: boolean } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
