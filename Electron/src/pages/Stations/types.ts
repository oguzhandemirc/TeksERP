import type { StationKind, StationType } from "@/types/enums";

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
  kind: StationKind;
  department: string | null;
  isActive: boolean;
  /** Bu istasyon RENK uygulayabilir mi? (2026-08-10 — yetenek kategoriden ayrıldı) */
  appliesColor: boolean;
  /** Bu istasyon ÖZELLİK uygulayabilir mi? */
  appliesProperty: boolean;
  /**
   * Bu istasyon KALİTE KONTROL (Kurşun + KK2) yürütür mü? (2026-09-03)
   * Renk/özellikten farkı: fason kategorisinden türetilmez, atama listesi yoktur.
   */
  appliesQuality: boolean;
  /** Devere: bu istasyonun makineleri LEVENT SARAR (WOUND.machineId adayı). */
  producesWarpBeam: boolean;
  /** Devere Faz 3: bu istasyonun makinelerine LEVENT BAĞLANIR (dokuma/raşel); yuva kapısı budur. */
  consumesWarpBeam: boolean;
  defaultCategoryId: string | null;
  defaultCategory?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
