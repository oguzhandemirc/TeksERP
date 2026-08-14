// =============================================================================
// HIZLI SEVK — servis katmanı
// =============================================================================
// ⚠️ YOL TAM YAZILIR (`/api/shipping/...`): `apiClient.baseURL` `/api` İÇERMEZ.
// Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekranda "sonuç yok" görünür —
// filtre boş değil, istek yanlış kapıya gitmiştir (2026-08-12 saha bulgusu).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

/**
 * "Seçilenleri Sevk Et" görünür mü — SAF YÜKLEM (bekçi: `quickShip.test.ts`).
 *
 * Bileşenin içindeki bir `if`te kalsaydı tersine çevrilmesi hiçbir testi
 * kırmazdı; burada iki koşul da mekanik olarak kilitli:
 *  ① `FINISHED_STOCK` — sevk edilebilir topların yaşadığı tek sekme.
 *  ② `financeEnabled` — TİCARET REJİMİ. Fabrikada bu yüzey HİÇ ÇIKMAZ:
 *     oradaki sevk akışı fiziksel çuval üzerinden yürür (ihracatta çuval
 *     tartısı zorunlu) ve "tartısız çuvalı otomatik açan" bir kestirme,
 *     mevcut yolu hızlandırmak değil YENİ bir yol açmak olurdu.
 */
export function canQuickShip(tab: string, financeEnabled: boolean): boolean {
  return tab === "FINISHED_STOCK" && financeEnabled;
}

/** Sevk listesindeki bir satır — barkod OPSİYONEL (etiket basmayan kullanıcı). */
export interface QuickShipRoll {
  id: string;
  barcode: string | null;
  qty: number;
  width: number | null;
  itemName: string;
  colorName: string | null;
  warehouseId: string | null;
}

/**
 * FIFO önerisi — "3 top patos sattım, hangileri umurumda değil".
 *
 * Sıra SUNUCUDA kurulur (en eski raf beklemesi önce) ve istemci onu YENİDEN
 * SIRALAMAZ: iki yerde iki sıra, aynı isteğe iki farklı cevap demektir.
 */
export async function findRollsForQuickShip(params: {
  itemId: string;
  colorId?: string | null;
  warehouseId?: string | null;
  limit: number;
}): Promise<QuickShipRoll[]> {
  const q = new URLSearchParams({ itemId: params.itemId, limit: String(params.limit) });
  if (params.colorId) q.set("colorId", params.colorId);
  if (params.warehouseId) q.set("warehouseId", params.warehouseId);
  const res = await apiClient.get<ApiResponse<QuickShipRoll[]>>(
    `/api/shipping/shippable-rolls?${q.toString()}`,
  );
  return res.data.data ?? [];
}

/**
 * Topları doğrudan sevk et — çuval sunucuda tek transaction içinde açılır.
 *
 * `clientToken` çağıran tarafından **mantıksal deneme başına bir kez** üretilir;
 * "Sevk Et"e ikinci kez basmak yeni bir denemedir ve yeni token ister.
 */
export async function quickShip(payload: {
  rollIds: string[];
  customerId: string;
  branchId?: string | null;
  orderIds?: string[];
  clientToken?: string;
}): Promise<ApiResponse<{ id: string; shipmentNo: string; dispatched?: boolean }>> {
  const res = await apiClient.post<ApiResponse<{ id: string; shipmentNo: string; dispatched?: boolean }>>(
    "/api/shipping/shipments/from-rolls",
    payload,
  );
  return res.data;
}
