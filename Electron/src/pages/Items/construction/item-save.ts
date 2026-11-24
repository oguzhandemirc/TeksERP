// Ürün penceresi kaydı — atkı planını ürün gövdesine/çağrılarına çevirir (B19).
// Yeni ürün: atkı taslağı `weftSpecDraft` ile ürünün KENDİ isteğinde gider (sunucuda tek tx), deneme kimliği `clientToken`.
// Düzenleme: atkı çağrısı ürün PATCH'inden ÖNCE; her çağrı kendi içinde tutarlı ve tekrarlanabilir (attach replay, PATCH aynı içerik).
import { weftSpecApi } from "@/pages/WeaveDesigns/service";
import type { ItemCreatePayload } from "../types";
import type { WeftSavePlan } from "./useItemWeftDraft";

export type ItemSavePayload = ItemCreatePayload & { weftSpecDraft?: Record<string, unknown>; clientToken?: string };

export interface WeftSaveApi {
  attach: typeof weftSpecApi.attachToItem;
  patch: typeof weftSpecApi.update;
  fork: typeof weftSpecApi.fork;
}

const defaultApi: WeftSaveApi = { attach: weftSpecApi.attachToItem, patch: weftSpecApi.update, fork: weftSpecApi.fork };

/**
 * `payload` atkı anahtarı taşımadan gelir (`weftSpecId` yok). Görünmeyen atkıda (`visible=false`) dokunulmaz.
 * Dönen gövde ürün isteğine gider; düzenlemede gereken atkı çağrısı burada önce yapılır.
 */
export async function applyWeftPlan(
  plan: WeftSavePlan,
  payload: ItemSavePayload,
  ctx: { visible: boolean; itemId: string | null; savedWeftSpecId: string | null; clientToken?: string },
  api: WeftSaveApi = defaultApi,
): Promise<ItemSavePayload> {
  const out: ItemSavePayload = { ...payload };
  if (!ctx.itemId && ctx.clientToken) out.clientToken = ctx.clientToken;
  if (!ctx.visible) return out;
  switch (plan.kind) {
    case "invalid":
      throw new Error(plan.message);
    case "create-with-item":
      out.weftSpecDraft = plan.body;
      return out;
    case "attach":
      await api.attach({ itemId: ctx.itemId!, expectedWeftSpecId: ctx.savedWeftSpecId, weft: plan.body });
      return out; // bağ sunucuda kuruldu; ürün gövdesi atkıya dokunmaz
    case "patch-card":
      await api.patch(plan.weftSpecId, plan.body);
      return out;
    case "fork-patch": {
      // Önce kopya (kumaşın bağı sunucuda kopyaya geçer, öteki kumaşlar eski kartta kalır), sonra değişiklik kopyaya.
      const forked = await api.fork(plan.sourceId, { itemId: ctx.itemId!, code: plan.code, name: plan.name });
      await api.patch(forked.weftSpec.id, plan.body);
      return out;
    }
    case "link":
      if (plan.weftSpecId) out.weftSpecId = plan.weftSpecId;
      else if (ctx.savedWeftSpecId) out.weftSpecId = null;
      return out;
    case "none":
      return out;
  }
}
