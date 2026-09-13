import type { CompanyType } from "@/types/enums";

export interface Customer {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  type: CompanyType;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
