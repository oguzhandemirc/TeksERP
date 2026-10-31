// =============================================================================
// DOKUMA İŞİ — yazma mutasyonları (kaydet · kapat · iptal)
// =============================================================================
// ⚠️ `onError`da toast YOK: `apiClient` interceptor'ı 4xx/5xx'i zaten basar ve
// backend'in cümlesi (409 açık koşumları ADIYLA söyler) oradan görünür; ikinci
// toast aynı hatayı iki kez okutur (`yerel/mutation-onerror-toast`).
// =============================================================================
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WeavingOrderFormValues } from "./schema";
import { weavingOrderService, type WeavingOrderPayload } from "./service";
import { plannedToIso, type WeavingOrder } from "./types";

export const WEAVING_ORDERS_QUERY_KEY = "weaving-orders";
/** Sağ panelin genel bakış sorgusu — mutasyon sonrası listeyle birlikte tazelenir. */
export const WEAVING_ORDER_OVERVIEW_QUERY_KEY = "weaving-order-overview";

type ConstructionKey = "weftSpecId" | "weaveDesignId" | "recipeId";

type ConstructionInitial = Pick<WeavingOrder, ConstructionKey> & { itemId?: string };

/** SY-A4: yapı seçimi — dolu alan id; boş ama kayıtta bağ VARDIYSA `null` (temizle); ikisi de yoksa anahtar
 *  GİTMEZ: sunucu atkı/desen kartını etkin yapıdan doldurur, yapısız işte gövde bayt-aynı kalır. Düzenlemede
 *  ürün DEĞİŞTİYSE boş atkı/desen anahtarsız gider (sunucu yeni ürünün kartını türetir); varyant null'lanır. */
export function constructionPayload(v: WeavingOrderFormValues, initial?: ConstructionInitial | null): Partial<Record<ConstructionKey, string | null>> {
  const out: Partial<Record<ConstructionKey, string | null>> = {};
  const retarget = Boolean(initial?.itemId) && v.itemId !== initial?.itemId;
  for (const k of ["weftSpecId", "weaveDesignId", "recipeId"] as const) {
    if (v[k]) out[k] = v[k];
    else if (initial?.[k] && (k === "recipeId" || !retarget)) out[k] = null;
  }
  return out;
}

/** Form METİN taşır; uç sayı/ISO bekler. Boş dize `null`a döner ("0" ≠ "girilmedi"). */
export function buildPayload(v: WeavingOrderFormValues, initial?: ConstructionInitial | null): WeavingOrderPayload {
  const m = (v.plannedM ?? "").trim();
  return {
    itemId: v.itemId,
    colorId: v.colorId || null,
    warpSpecId: v.warpSpecId || null,
    plannedM: m === "" ? null : Number(m),
    executionKind: v.executionKind,
    subcontractorId: v.executionKind === "SUBCONTRACTED" ? v.subcontractorId || null : null,
    plannedStartDate: plannedToIso(v.plannedStartDate),
    plannedEndDate: plannedToIso(v.plannedEndDate),
    notes: (v.notes ?? "").trim() || null,
    // Z2: küme REPLACE; boş dizi = bağsız. Tahsis metni boşsa miktarsız bağ (null), "0" bağ değil hata (şema).
    orderLines: (v.orderLines ?? []).map((l) => {
      const m = (l.allocatedM ?? "").trim();
      return { orderLineId: l.orderLineId, allocatedM: m === "" ? null : Number(m) };
    }),
    ...constructionPayload(v, initial),
  };
}

interface SaveInput {
  /** Düzenlemede kayıt id'si; oluşturmada null. */
  id: string | null;
  values: WeavingOrderFormValues;
  clientToken: string;
  /** Düzenlemede kaydın kendisi — temizlenen yapı alanı `null` gitsin diye. */
  initial?: WeavingOrder | null;
}

export function useWeavingOrderMutations(onDone: () => void) {
  const qc = useQueryClient();
  const settle = (message: string | undefined, fallback: string) => {
    toast.success(message ?? fallback);
    onDone();
    void qc.invalidateQueries({ queryKey: [WEAVING_ORDERS_QUERY_KEY] });
    void qc.invalidateQueries({ queryKey: [WEAVING_ORDER_OVERVIEW_QUERY_KEY] });
  };
  const save = useMutation({
    mutationFn: ({ id, values, clientToken, initial }: SaveInput) =>
      id ? weavingOrderService.update(id, buildPayload(values, initial)) : weavingOrderService.create(buildPayload(values), clientToken),
    onSuccess: (res) => settle(res.message, "Kaydedildi."),
  });
  const close = useMutation({
    mutationFn: (id: string) => weavingOrderService.close(id),
    onSuccess: (res) => settle(res.message, "Kapatıldı."),
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => weavingOrderService.cancel(id, reason),
    onSuccess: (res) => settle(res.message, "İptal edildi."),
  });
  return { save, close, cancel };
}
