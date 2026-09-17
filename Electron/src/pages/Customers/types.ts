import type { CompanyType } from "@/types/enums";

export interface Customer {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  /** TÜRETİLMİŞ (rol modeli 2026-09-17): yalnız eski okuyucular için; panel YAZMAZ, yeni yüzey bayrakları okur. */
  type: CompanyType;
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
