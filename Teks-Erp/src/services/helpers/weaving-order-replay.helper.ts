// Dokuma işi `clientToken` replay politikası — tek kayıtlı oluşturma ve üretim önerisi (SY-M1) aynı boğazı kullanır.
import { Prisma } from "@prisma/client";
import { ApiResponse } from "../../types/api.types";
import { assertWeavingOrderReplayAlive, tokenReplay } from "./token-replay.helper";
import { normalizeOrderLineLinks } from "./weaving-order-links.helper";
import { WEAVING_ORDER_SELECT, normalizeWeavingOrderFields, toWeavingOrderDto, type WeavingOrderCreateInput, type WeavingOrderDto } from "./weaving-order-input.helper";

/**
 * Dokuma işi replay'i. Kimlik: kumaş · yürütme · fasoncu · plan metresi · renk · sipariş satırı kümesi; çözgü kartı
 * YALNIZ gönderildiyse (verilmezse kartın varsayılanı türetilir — türetilen alan kimlik olmaz). 4. durum: iptal →
 * `assertWeavingOrderReplayAlive`; tamamlanmış iş canlıdır.
 */
export function weavingOrderReplay(input: WeavingOrderCreateInput) {
  type Row = Prisma.WeavingOrderGetPayload<{ select: typeof WEAVING_ORDER_SELECT }>;
  return tokenReplay<Row, ApiResponse<WeavingOrderDto>>({
    find: (db, clientToken) => db.weavingOrder.findUnique({ where: { clientToken }, select: WEAVING_ORDER_SELECT }),
    alive: (r) => assertWeavingOrderReplayAlive(r),
    identity: (r) => {
      const f = normalizeWeavingOrderFields(input);
      const lines = normalizeOrderLineLinks(input.orderLines ?? []);
      return [
        { ad: "itemId", mevcut: r.itemId, gelen: input.itemId },
        { ad: "executionKind", mevcut: r.executionKind, gelen: input.executionKind },
        { ad: "subcontractorId", mevcut: r.subcontractorId, gelen: f.subcontractorId ?? null },
        { ad: "plannedM", mevcut: r.plannedM, gelen: f.plannedM ?? null },
        { ad: "colorId", mevcut: r.colorId, gelen: f.colorId ?? null },
        { ad: "sipariş satırları", mevcut: r.orderLineLinks.map((l) => l.orderLineId).sort().join(","), gelen: lines.map((l) => l.orderLineId).sort().join(",") },
        ...(input.warpSpecId !== undefined ? [{ ad: "warpSpecId", mevcut: r.warpSpecId, gelen: f.warpSpecId ?? null }] : []),
        // SY-A4: yapı seçimi yalnız GÖNDERİLDİYSE kimliktir (gönderilmeyen atkı/desen etkin yapıdan türer).
        ...(input.weftSpecId !== undefined ? [{ ad: "weftSpecId", mevcut: r.weftSpecId, gelen: input.weftSpecId || null }] : []),
        ...(input.weaveDesignId !== undefined ? [{ ad: "weaveDesignId", mevcut: r.weaveDesignId, gelen: input.weaveDesignId || null }] : []),
        ...(input.recipeId !== undefined ? [{ ad: "recipeId", mevcut: r.recipeId, gelen: input.recipeId || null }] : []),
      ];
    },
    collision: "Bu istemci anahtarı BAŞKA bir dokuma iş emriyle kullanılmış — formu yenileyip yeniden deneyin.",
    collisionEk: (r) => ({ weavingOrderId: r.id }),
    respond: (r) => ({ success: true, data: toWeavingOrderDto(r), message: "Dokuma iş emri zaten oluşturulmuş" }),
  });
}
