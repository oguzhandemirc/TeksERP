// =============================================================================
// LEVENT SABİTLERİ — olay türleri (CHECK ile birebir), işaret tablosu, formül, denye TEK kaynağı
// =============================================================================
// Tasarım: docs/design/DEVERE-LEVENT-TARAMASI.md §4.4 · §4.8 · §3.9 (akıbet). 1b WOUND/WOUND_CANCEL;
// F1 fason dörtlüsü (git · storno · dön · storno). Faz 3 türleri buraya VE `warp_beam_events_kind_ck`e
// birlikte girer (bekçi iki yönlü ölçer).
// =============================================================================
import { Prisma } from "@prisma/client";

export const WARP_BEAM_EVENT_KINDS = [
  "WOUND", "WOUND_CANCEL", "SHIP_OUT", "SHIP_OUT_CANCEL", "RETURNED_IN", "RETURNED_IN_CANCEL",
  // Faz 3 — tezgah bağı / tüketim / bitiş (her ileri türün tipli tersi; §4.1)
  "MOUNTED", "MOUNT_CANCEL", "DISMOUNTED", "DISMOUNT_CANCEL", "CONSUMED", "CONSUMED_CANCEL",
  "ADJUST_IN", "ADJUST_OUT", "EXHAUSTED", "EXHAUST_CANCEL", "SCRAPPED", "SCRAP_CANCEL",
] as const;
export type WarpBeamEventKind = (typeof WARP_BEAM_EVENT_KINDS)[number];

/** Fason sevk kalemine BAĞLI türler — `dispatchItemId` zorunlu (CHECK `warp_beam_events_fason_item_ck` iki yönlü). */
export const WARP_BEAM_FASON_KINDS = ["SHIP_OUT", "SHIP_OUT_CANCEL", "RETURNED_IN", "RETURNED_IN_CANCEL"] as const satisfies readonly WarpBeamEventKind[];

export const WARP_BEAM_EVENT_KIND_LABEL: Record<WarpBeamEventKind, string> = {
  WOUND: "Sarıldı",
  WOUND_CANCEL: "Sarım iptali",
  SHIP_OUT: "Fasona verildi",
  SHIP_OUT_CANCEL: "Fason çıkışı iptali",
  RETURNED_IN: "Fasondan döndü",
  RETURNED_IN_CANCEL: "Fason dönüşü iptali",
  MOUNTED: "Tezgaha bağlandı",
  MOUNT_CANCEL: "Bağlama iptali",
  DISMOUNTED: "Tezgahtan söküldü",
  DISMOUNT_CANCEL: "Söküm iptali",
  CONSUMED: "Tüketildi",
  CONSUMED_CANCEL: "Tüketim iptali",
  ADJUST_IN: "Kalan düzeltmesi (+)",
  ADJUST_OUT: "Kalan düzeltmesi (−)",
  EXHAUSTED: "Bitti (levent dibi)",
  EXHAUST_CANCEL: "Bitiş iptali",
  SCRAPPED: "Hurdaya ayrıldı",
  SCRAP_CANCEL: "Hurda iptali",
};

/** Faz 3: DURUM DEĞİŞTİREN ileri olaylar — LIFO iptal zinciri yalnız bunları kilitler (§4.7). CONSUMED/ADJUST zinciri kilitlemez. */
export const WARP_BEAM_STATUS_EVENT_KINDS = ["WOUND", "SHIP_OUT", "RETURNED_IN", "MOUNTED", "DISMOUNTED", "EXHAUSTED", "SCRAPPED"] as const satisfies readonly WarpBeamEventKind[];

/** İleri tür → tipli tersi (Faz 3 çiftleri + eski üçlü). `*_CANCEL` yazarken `reversesEventId` ZORUNLU. */
export const WARP_BEAM_CANCEL_OF: Partial<Record<WarpBeamEventKind, WarpBeamEventKind>> = {
  WOUND: "WOUND_CANCEL",
  SHIP_OUT: "SHIP_OUT_CANCEL",
  RETURNED_IN: "RETURNED_IN_CANCEL",
  MOUNTED: "MOUNT_CANCEL",
  DISMOUNTED: "DISMOUNT_CANCEL",
  CONSUMED: "CONSUMED_CANCEL",
  EXHAUSTED: "EXHAUST_CANCEL",
  SCRAPPED: "SCRAP_CANCEL",
};

/**
 * Kalan metre işareti — tek kaynak; `yarnMovementSign` emsali (exhaustive switch).
 * Kalan = leventte FABRİKADA olan metre: çıkış düşer (fasondayken 0), dönüş ekler; haşıl/fason firesi
 * `giden − dönen` farkı olarak kendiliğinden görünür, ayrı olay istemez.
 */
export function warpBeamLengthSign(kind: WarpBeamEventKind): 1 | -1 | 0 {
  switch (kind) {
    case "WOUND":
    case "SHIP_OUT_CANCEL":
    case "RETURNED_IN":
    case "CONSUMED_CANCEL":
    case "ADJUST_IN":
    case "EXHAUST_CANCEL":
    case "SCRAP_CANCEL":
      return 1;
    case "WOUND_CANCEL":
    case "SHIP_OUT":
    case "RETURNED_IN_CANCEL":
    case "CONSUMED":
    case "ADJUST_OUT":
    case "EXHAUSTED":
    case "SCRAPPED":
      return -1;
    // Bağlama/söküm metre taşımaz (lengthM null) — kalanı değiştirmez.
    case "MOUNTED":
    case "MOUNT_CANCEL":
    case "DISMOUNTED":
    case "DISMOUNT_CANCEL":
      return 0;
  }
}

/** Nominal (teorik) kg = tel × denye × metre / 9.000.000 — Decimal 3 hane, panel ön hesabı aynı formülün aynasıdır. */
export function warpTheoreticalKg(endsCount: number, denier: Prisma.Decimal.Value, lengthM: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(endsCount).mul(denier).mul(lengthM).div(9_000_000).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * DENYE TEK KAYNAĞI — WOUND yazıcısı iplik kalemindeki denyeyi YALNIZ buradan okur.
 * Bugün `Item.linearDensityDen`; 1a′ (YarnCountSystem: Ne/Nm/tex → denye) indiğinde yalnız bu
 * fonksiyon değişir, yazıcı değişmez (1e 2026-09-14: sıralama bağımlılığı şemayla değil helper'la kalkar).
 */
export function resolveDenier(item: { linearDensityDen: Prisma.Decimal | null }): Prisma.Decimal | null {
  return item.linearDensityDen;
}
