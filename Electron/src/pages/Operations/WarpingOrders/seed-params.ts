// Yeni sipariş formunun URL ön dolumu: Çözgü Hesabı (D6a) ve ihtiyaç önerisi (D8) `?new=1&…` ile gelir.
import type { WarpingOrderFormState } from "./order-model";

/** Form kapanınca URL'den silinen anahtarlar — `seedFromParams`in okuduklarıyla AYNI liste. */
export const SEED_PARAM_KEYS = ["new", "warpSpecId", "subcontractorId", "beamCount", "beamLengthM", "salesOrderId", "salesOrderLabel"] as const;

export function seedFromParams(sp: URLSearchParams): Partial<WarpingOrderFormState> {
  const beamCount = sp.get("beamCount");
  const beamLengthM = sp.get("beamLengthM");
  const salesOrderId = sp.get("salesOrderId");
  return {
    warpSpecId: sp.get("warpSpecId"),
    subcontractorId: sp.get("subcontractorId"),
    ...(beamCount || beamLengthM ? { beamLines: [{ beamCount: beamCount ?? "1", beamLengthM: beamLengthM ?? "" }] } : {}),
    ...(salesOrderId ? { salesOrders: [{ id: salesOrderId, label: sp.get("salesOrderLabel") || "Müşteri siparişi" }] } : {}),
  };
}
