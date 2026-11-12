// =============================================================================
// Etiket metni kilidi — topun etiket ad/renk/parti/şablon düzeltmesinin TEK engel yüklemi
// =============================================================================
// `inventory/label-texts` ailesinden ayrıldı: etiket yüzeyleri (roll-label-edit, alıcı kataloğu) kilidi
// envanter servis ailesini (ve onun alış siparişi zincirini) içe çekmeden okusun. Davranış aynı.
// =============================================================================
import { RollStatus } from "@prisma/client";
import { K18_DEAD_STATUSES } from "../batch.service";
import { SHIP_READY_GONE_STATUSES } from "./ship-readiness.helper";
/** Fiziksel olarak fabrikadan çıkmış top: müşteriye sevk (tek kaynak `SHIP_READY_GONE_STATUSES`) + fason/kartela sevki. */
const LABEL_TEXT_SHIPPED: readonly RollStatus[] = [
  ...SHIP_READY_GONE_STATUSES,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.AT_KARTELA,
];
/** Etiketi artık anlamsız top: K18 ölü kümesi + fire + fason dönüşünde kapanmış eski barkod. */
const LABEL_TEXT_DEAD: readonly RollStatus[] = [
  ...K18_DEAD_STATUSES,
  RollStatus.SCRAP,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];
/** Atomik claim'in WHERE'i ve önizleme yüklemi aynı kümeden (boş değil → `notIn: []` tuzağı yok). */
export const LABEL_TEXT_LOCKED_STATUSES: readonly RollStatus[] = [...LABEL_TEXT_SHIPPED, ...LABEL_TEXT_DEAD];

export type LabelTextFixBlock = { code: "ROLL_SHIPPED" | "ROLL_DEAD"; reason: string };

/** Etiket ad/renk/parti düzeltmesinin TEK engel yüklemi (null = düzeltilebilir). */
export function labelTextFixBlock(status: RollStatus): LabelTextFixBlock | null {
  if (LABEL_TEXT_SHIPPED.includes(status)) {
    return {
      code: "ROLL_SHIPPED",
      reason: status === RollStatus.SHIPPED
        ? "Bu top sevk edilmiş — etiket bilgisi artık düzeltilemez."
        : "Bu top fason/kartela sevkiyle dışarıda — etiket bilgisi düzeltilemez.",
    };
  }
  if (LABEL_TEXT_DEAD.includes(status)) {
    return { code: "ROLL_DEAD", reason: "Bu top tüketilmiş, iptal ya da fire edilmiş — etiketi yok, düzeltilemez." };
  }
  return null;
}
