// =============================================================================
// LEVENT GÖVDESİ — olay türü evreni ve durum/sahip etiketleri (devere ek B1)
// =============================================================================
// Tür kümesi DB CHECK `beam_body_events_kind_ck` ile iki yönlü eşittir (`test_levent_govde`). İleri türün tersi
// `<TÜR>_CANCEL`; B1 yalnız REGISTER/REGISTER_CANCEL yazar, öteki türlerin yazıcısı B2/B3.
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus } from "@prisma/client";

export const BEAM_BODY_FORWARD_KINDS = [
  "REGISTER",
  "SHIP_EMPTY",
  "RETURN_EMPTY",
  "FILLED",
  "MOUNTED",
  "EMPTIED",
  "SHIPPED_FULL",
  "MAINTENANCE_IN",
  "MAINTENANCE_OUT",
  "SCRAP",
  "RETURN_TO_OWNER",
] as const;
export type BeamBodyForwardKind = (typeof BEAM_BODY_FORWARD_KINDS)[number];
export type BeamBodyCancelKind = `${BeamBodyForwardKind}_CANCEL`;
export type BeamBodyEventKind = BeamBodyForwardKind | BeamBodyCancelKind;

export const BEAM_BODY_EVENT_KINDS: readonly BeamBodyEventKind[] = BEAM_BODY_FORWARD_KINDS.flatMap((k) => [k, `${k}_CANCEL` as const]);

export const cancelKindOf = (k: BeamBodyForwardKind): BeamBodyCancelKind => `${k}_CANCEL`;

/** Türkçe olay adı — gövde geçmişi (B12) ve audit metni. */
export const BEAM_BODY_EVENT_LABELS: Record<BeamBodyForwardKind, string> = {
  REGISTER: "Kayıt",
  SHIP_EMPTY: "Boş gönderildi",
  RETURN_EMPTY: "Boş döndü",
  FILLED: "Dolu döndü",
  MOUNTED: "Tezgâha takıldı",
  EMPTIED: "Boşaldı",
  SHIPPED_FULL: "Dolu gönderildi",
  MAINTENANCE_IN: "Bakıma alındı",
  MAINTENANCE_OUT: "Bakımdan çıktı",
  SCRAP: "Hurdaya ayrıldı",
  RETURN_TO_OWNER: "Sahibine iade edildi",
};

export const BEAM_BODY_STATUS_LABELS: Record<BeamBodyStatus, string> = {
  EMPTY_STOCK: "Depoda boş",
  AT_SUBCONTRACTOR: "Deverecide",
  FULL_STOCK: "Dolu bekliyor",
  MOUNTED: "Tezgâhta",
  FULL_OUT: "Dolu dışarıda",
  MAINTENANCE: "Bakımda",
  SCRAPPED: "Hurda",
  RETURNED_TO_OWNER: "Sahibine iade edildi",
};

/** Sahip rolü; `OURS` yalnız API/süzgeç değeridir (DB'de NULL). */
export type BeamBodyOwnerKind = "OURS" | BeamBodyOwnerRole;
export const BEAM_BODY_OWNER_KINDS: readonly BeamBodyOwnerKind[] = ["OURS", ...Object.values(BeamBodyOwnerRole)];
export const BEAM_BODY_OWNER_LABELS: Record<BeamBodyOwnerKind, string> = {
  OURS: "Bizim",
  WARPER: "Devereci",
  CUSTOMER: "Müşteri (emanet)",
  OTHER: "Başka firma",
};

/** Kayıtta seçilebilen başlangıç durumları — dolu/takılı/terminal durumlar yalnız olaydan doğar (B2/B3). */
export const BEAM_BODY_REGISTER_STATUSES: readonly BeamBodyStatus[] = [BeamBodyStatus.EMPTY_STOCK, BeamBodyStatus.AT_SUBCONTRACTOR];

/** Pasife alınabilen durumlar: gövde boş ve bizde ya da terminal (canlı referanslı ana veri pasife alınamaz). */
export const BEAM_BODY_DEACTIVATABLE_STATUSES: readonly BeamBodyStatus[] = [BeamBodyStatus.EMPTY_STOCK, BeamBodyStatus.SCRAPPED, BeamBodyStatus.RETURNED_TO_OWNER];

/** Sahibine iade edilecek = bizim olmayan, boş ve bizde duran gövde (özet şeridi + B2 aday listesi aynı yüklem). */
export const BEAM_BODY_OWNER_RETURN_DUE_WHERE = {
  ownerCustomerId: { not: null },
  status: BeamBodyStatus.EMPTY_STOCK,
  isActive: true,
} as const;
