// =============================================================================
// LEVENT GÖVDESİ — olay türü evreni ve durum/sahip etiketleri (devere ek B1)
// =============================================================================
// Tür kümesi DB CHECK `beam_body_events_kind_ck` ile iki yönlü eşittir (`test_levent_govde`). İleri türün tersi
// `<TÜR>_CANCEL`; B1 REGISTER, B2 elle geçişler/iade, B3 sarım türleri (`BEAM_BODY_WARP_KINDS`, kanca `beam-body-warp.helper`).
// =============================================================================
import { BeamBodyOwnerRole, BeamBodyStatus } from "@prisma/client";

export const BEAM_BODY_FORWARD_KINDS = [
  "REGISTER",
  "SHIP_EMPTY",
  "RETURN_EMPTY",
  "FILLED",
  "MOUNTED",
  "DISMOUNTED",
  "EMPTIED",
  "SHIPPED_FULL",
  "RETURNED_FULL",
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
  DISMOUNTED: "Tezgâhtan söküldü",
  EMPTIED: "Boşaldı",
  SHIPPED_FULL: "Dolu gönderildi",
  RETURNED_FULL: "Dolu geri döndü",
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

/**
 * Elle geçişler (B2, `POST /api/beam-bodies/:id/transition`): tür → izinli kaynak durumlar + hedef. Dolu/takma/boşalma
 * (B3) ve sahibine iade (belgeyle) burada YOK. Geri alma yalnız son hareket ve yalnız bu türler (belgesiz olay).
 */
export const BEAM_BODY_MANUAL_TRANSITIONS = {
  SHIP_EMPTY: { from: [BeamBodyStatus.EMPTY_STOCK], to: BeamBodyStatus.AT_SUBCONTRACTOR },
  // Devere ek P: FULL_OUT (sarımla fason dokumacıya/sahibine gitmiş) gövde boş döner — sarım orada tükendi; olay
  // sarımı taşır (geri alma gövdeyi aynı sarımla "Dolu dışarıda"ya döndürür), sebep zorunlu.
  RETURN_EMPTY: { from: [BeamBodyStatus.AT_SUBCONTRACTOR, BeamBodyStatus.FULL_OUT], to: BeamBodyStatus.EMPTY_STOCK },
  MAINTENANCE_IN: { from: [BeamBodyStatus.EMPTY_STOCK], to: BeamBodyStatus.MAINTENANCE },
  MAINTENANCE_OUT: { from: [BeamBodyStatus.MAINTENANCE], to: BeamBodyStatus.EMPTY_STOCK },
  SCRAP: { from: [BeamBodyStatus.EMPTY_STOCK, BeamBodyStatus.MAINTENANCE], to: BeamBodyStatus.SCRAPPED },
} as const satisfies Partial<Record<BeamBodyForwardKind, { from: readonly BeamBodyStatus[]; to: BeamBodyStatus }>>;
export type BeamBodyManualKind = keyof typeof BEAM_BODY_MANUAL_TRANSITIONS;
export const BEAM_BODY_MANUAL_KINDS = Object.keys(BEAM_BODY_MANUAL_TRANSITIONS) as BeamBodyManualKind[];

/** İade belgesinde en çok gövde (tek tx, gövde id sırasıyla claim). */
export const BEAM_BODY_RETURN_MAX_ITEMS = 200;
/** İplik sevkinde en çok boş gövde. */
export const BEAM_BODY_DISPATCH_MAX = 50;

/** Sarım türlü olaylar (B3): olay satırı `warpBeamId` taşır — CHECK `beam_body_events_warp_ck` ile aynı küme (tersleri dahil). */
export const BEAM_BODY_WARP_KINDS = ["FILLED", "MOUNTED", "DISMOUNTED", "EMPTIED", "SHIPPED_FULL", "RETURNED_FULL"] as const satisfies readonly BeamBodyForwardKind[];
export type BeamBodyWarpKind = (typeof BEAM_BODY_WARP_KINDS)[number];

/** Sarımı İSTEĞE BAĞLI taşıyan elle türler (devere ek P: FULL_OUT'tan boş dönüş) — CHECK `beam_body_events_warp_allowed_ck`. */
export const BEAM_BODY_WARP_OPTIONAL_KINDS = ["RETURN_EMPTY"] as const satisfies readonly BeamBodyForwardKind[];

/** Üstünde sarım olan gövde durumları — CHECK `beam_bodies_current_warp_ck` (currentWarpBeamId dolu ⇔ bu küme). */
export const BEAM_BODY_FULL_STATUSES: readonly BeamBodyStatus[] = [BeamBodyStatus.FULL_STOCK, BeamBodyStatus.MOUNTED, BeamBodyStatus.FULL_OUT];
