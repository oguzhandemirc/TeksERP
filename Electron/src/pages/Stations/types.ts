import type { StationKind, StationType } from "@/types/enums";

export interface Station {
  id: string;
  code: string;
  name: string;
  type: StationType;
  kind: StationKind;
  department: string | null;
  isActive: boolean;
  /** İş emri rota adımı olabilir mi (false: KK1 girişi, Sevkiyat gibi giriş/çıkış istasyonları). */
  allowAsWorkOrderStep?: boolean;
  /** Bu istasyon RENK uygulayabilir mi? (2026-08-10 — yetenek kategoriden ayrıldı) */
  appliesColor: boolean;
  /** Bu istasyon ÖZELLİK uygulayabilir mi? */
  appliesProperty: boolean;
  /**
   * Bu istasyon KALİTE KONTROL (Kurşun + KK2) yürütür mü? (2026-09-03)
   * Renk/özellikten farkı: fason kategorisinden türetilmez, atama listesi yoktur.
   */
  appliesQuality: boolean;
  /**
   * Kalite MUAYENESİ (hata girişi) bu istasyonda açık mı? (KQ-D1, 2026-10-24)
   * `appliesQuality` artık yalnız ara istasyon kart akışıdır; muayene bu alandır.
   */
  inspectionEnabled: boolean;
  /** Devere: bu istasyonun makineleri LEVENT SARAR (WOUND.machineId adayı). */
  producesWarpBeam: boolean;
  /** Devere Faz 3: bu istasyonun makinelerine LEVENT BAĞLANIR (dokuma/raşel); yuva kapısı budur. */
  consumesWarpBeam: boolean;
  /** D4-E2: bu istasyon topun gerçek ENİNİ ölçer (etek kesim); tablette isteğe bağlı "Ölçülen en". Eski backend göndermez. */
  capturesWidth?: boolean;
  /** Akış etiketinin istasyon varsayılan adedi (1–5); null = genel adet. Yalnız etiket adedi kaynağı "İstasyon" iken okunur. */
  defaultLabelCopies: number | null;
  defaultCategoryId: string | null;
  defaultCategory?: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}
