import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

/** Siparişe yazılamamış bir sevkiyat — onarım adayı. */
export interface RepairableShipment {
  shipmentId: string;
  shipmentNo: string;
  dispatchedAt: string | null;
  customer: { id: string; name: string } | null;
  orderNumbers: string[];
  /**
   * Numaranın YANINDA id — sipariş panelini açmak için. Opsiyonel: eski sunucu
   * yalnız `orderNumbers` gönderir, o zaman numara tıklanamaz metin kalır.
   * (Numaradan id'yi arayarak bulmak ikinci bir okuma yoluydu ve mükerrer
   * numarada yanlış siparişi açardı.)
   */
  orders?: { id: string; orderNumber: string }[];
  icerikMetraj: number;
  yazilanMetraj: number;
  /** Çıkan mal − deftere yazılan. */
  bosluk: number;
  /** Bugün yeniden denense yazılabilecek metraj — onarımın beklenen kazancı. */
  onarilabilirMetraj: number;
}

/** Onarım önizlemesinin TEK satırı — hangi sipariş satırına kaç metre. */
export interface RepairPreviewLine {
  orderLineId: string;
  orderNumber: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  /** Satırın ŞU ANKİ açığı. */
  acikOnce: number;
  /** Bu onarımda o satıra yazılacak metraj. */
  yazilacak: number;
  /** Onarımdan sonra kalan açık. */
  acikSonra: number;
}

export interface RepairPreview {
  shipmentId: string;
  shipmentNo: string;
  customer: { id: string; name: string } | null;
  icerikMetraj: number;
  yazilanMetraj: number;
  yazilacakMetraj: number;
  enToleransCm: number;
  fazlaSevkYazilir: boolean;
  kalemler: RepairPreviewLine[];
}

export interface RepairResult {
  shipmentNo: string;
  oncesi: number;
  sonrasi: number;
  kazanc: number;
}

export const allocationRepairService = {
  /** Onarım adayları — sunucu YAZMAZ. */
  list: (): Promise<ApiResponse<RepairableShipment[]>> =>
    apiClient.get<ApiResponse<RepairableShipment[]>>("/api/shipping/repair/allocations").then((r) => r.data),

  /**
   * ÖNİZLEME — hangi sipariş satırına kaç metre. Sunucu YAZMAZ.
   * Ölçüm onarımın kullanacağı motorun AYNISIYLA yapılır; ayrı bir tahmin
   * olsaydı önizleme ile sonuç sessizce ayrışırdı.
   */
  preview: (shipmentId: string): Promise<ApiResponse<RepairPreview>> =>
    apiClient
      .get<ApiResponse<RepairPreview>>(`/api/shipping/repair/allocations/${shipmentId}/preview`)
      .then((r) => r.data),

  /** Tek sevkiyatın defterini onar — irsaliye v+1 doğurur. */
  repair: (shipmentId: string): Promise<ApiResponse<RepairResult>> =>
    apiClient
      .post<ApiResponse<RepairResult>>(`/api/shipping/repair/allocations/${shipmentId}`)
      .then((r) => r.data),
};
