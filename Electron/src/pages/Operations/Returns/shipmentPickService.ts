// =============================================================================
// İADE — sevkiyattan çuval bulma (barkodsuz yol)
// =============================================================================
// ⚠️ YENİ BACKEND UCU YOK: ikisi de mevcut sevkiyat uçları. Gerekçe, iadeye
// özel bir "sevkiyat listesi" ucu açmanın aynı veriyi ikinci bir yerden
// yayınlaması olurdu; sevkiyat okuma izni (`shipping:read`) zaten bu veriyi
// kapılıyor ve çağıran yüzey o izin yoksa hiç çizilmiyor.
// =============================================================================
import apiClient from "@/services/apiClient";

export interface PickShipment {
  id: string;
  shipmentNo: string;
  customerName: string;
  dispatchedAt: string | null;
}

export interface PickSack {
  id: string;
  sackNo: string;
  rollCount: number;
}

/**
 * Sevk EDİLMİŞ sevkiyatlar (iade ancak çıkmış maldan alınır — backend
 * `lookupSackForReturn` de yalnız `SHIPPED` topları döndürüyor).
 */
export async function listDispatchedShipments(search?: string): Promise<PickShipment[]> {
  const res = await apiClient.get("/api/shipping/shipments", {
    params: {
      page: 1,
      pageSize: 30,
      "filter[status]": "DISPATCHED",
      sortBy: "dispatchedAt",
      sortOrder: "desc",
      ...(search ? { search } : {}),
    },
  });
  type Row = {
    id: string;
    shipmentNo: string;
    dispatchedAt: string | null;
    customer?: { name: string } | null;
  };
  return ((res.data.data ?? []) as Row[]).map((s) => ({
    id: s.id,
    shipmentNo: s.shipmentNo,
    customerName: s.customer?.name ?? "—",
    dispatchedAt: s.dispatchedAt,
  }));
}

/** Sevkiyatın çuvalları — kullanıcı hangisinden iade geldiğini seçer. */
export async function getShipmentSacks(shipmentId: string): Promise<PickSack[]> {
  const res = await apiClient.get(`/api/shipping/shipments/${shipmentId}`);
  type Sack = { id: string; sackNo: string; rollCount?: number; rolls?: unknown[] };
  const sacks = ((res.data.data as { sacks?: Sack[] })?.sacks ?? []) as Sack[];
  return sacks.map((sk) => ({
    id: sk.id,
    sackNo: sk.sackNo,
    // `rollCount` BRÜT'tür (iade edilenler dahil) — sevkiyat detayı 2026-08-03'te
    // brüte çekildi. İade ekranında doğru olan da budur: kullanıcı "bu çuvaldan
    // 4 top gitmişti" diye hatırlar, kalanı değil.
    rollCount: sk.rollCount ?? sk.rolls?.length ?? 0,
  }));
}
