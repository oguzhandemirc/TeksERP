// =============================================================================
// İş emri ↔ sipariş kalemi — kumaş/renk karışıklığı engeli (TEK KAYNAK)
// =============================================================================
// Bir iş emri tek kumaş + tek renk üretir. Bağlanan kalemlerde birden fazla
// kumaş ya da birden fazla (null olmayan) renk varsa hedef ne verilmiş olursa
// olsun 400. Oluşturma, replace ve sonradan bağlama yolları bu helper'ı çağırır.
// =============================================================================
import { AppError } from "../../utils/app-error";

export const WO_MIXED_ITEM_CODE = "WORK_ORDER_MIXED_ITEM";
export const WO_MIXED_COLOR_CODE = "WORK_ORDER_MIXED_COLOR";

export interface MixCheckLine {
  itemId: string | null;
  colorId: string | null;
}

/** Kalemler arası kumaş/renk tekliği; ihlalde `details.code` taşıyan 400. */
export function assertOrderLinesSameItemAndColor(lines: readonly MixCheckLine[]): void {
  const items = new Set(lines.map((l) => l.itemId).filter((v): v is string => v != null));
  if (items.size > 1) {
    throw AppError.badRequest(
      "Sipariş kalemleri farklı kumaşlar içeriyor; bir iş emri tek kumaş üretir. Kalemleri ayrı iş emirlerine bağlayın.",
      { code: WO_MIXED_ITEM_CODE },
    );
  }
  const colors = new Set(lines.map((l) => l.colorId).filter((v): v is string => v != null));
  if (colors.size > 1) {
    throw AppError.badRequest(
      "Sipariş kalemleri farklı renkler içeriyor; bir iş emri tek renk üretir. Kalemleri ayrı iş emirlerine bağlayın.",
      { code: WO_MIXED_COLOR_CODE },
    );
  }
}
