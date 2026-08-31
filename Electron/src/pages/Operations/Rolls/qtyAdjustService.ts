// =============================================================================
// SAYIM METRAJ DÜZELTMESİ (G4, ticaret paketi) — servis katmanı + görünürlük yüklemi
// =============================================================================
// ⚠️ YOL TAM YAZILIR (`/api/rolls/...`): `apiClient.baseURL` `/api` İÇERMEZ.
// Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekranda hiçbir şey olmaz
// (2026-08-12 saha bulgusu, FilterBar vakası).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

/** Görünürlük yükleminin ihtiyaç duyduğu asgari satır şekli. */
export interface QtyAdjustableRoll {
  status: string;
  sackId?: string | null;
  shipmentId?: string | null;
  /** Topun bağlı olduğu iş emri adımı — doluysa metraj istasyon akışının işi. */
  currentStep?: unknown | null;
}

/** Backend kapsamının AYNASI — `adjustRollQty` FREE_STOCK kümesi. */
export const QTY_ADJUST_STATUSES: readonly string[] = ["STOCK", "WAREHOUSE", "A1_STOCK"];

/**
 * "Metraj Düzelt" görünür mü — SAF YÜKLEM (bekçi: `qtyAdjust.test.ts`).
 *
 * Bileşen içindeki bir `if`te kalsaydı tersine çevrilmesi hiçbir testi
 * kırmazdı (`canQuickShip` emsali); burada iki katman da mekanik kilitli:
 *  ① `financeEnabled` — TİCARET REJİMİ. Fabrikada bu yüzey HİÇ ÇIKMAZ
 *     ("fabrika sıfır-fark"): orada metraj istasyon akışının (kurşun/tambur
 *     ölçümü) işidir; ticarette ise sayım gerçeğidir (rafta 480 çıkan 500 m).
 *  ② Topun durumu backend kapsamının aynası — serbest stok + çuvalsız/sevksiz/
 *     adımsız. Aynası olmasaydı menü, sürekli 409 üreten ölü bir yol vaat ederdi.
 */
export function canAdjustRollQty(roll: QtyAdjustableRoll, financeEnabled: boolean): boolean {
  return (
    financeEnabled &&
    QTY_ADJUST_STATUSES.includes(roll.status) &&
    roll.sackId == null &&
    roll.shipmentId == null &&
    roll.currentStep == null
  );
}

/** Backend yanıtının veri gövdesi (`adjustRollQty`). */
export interface QtyAdjustResult {
  rollId: string;
  barcode: string | null;
  oldQty: number;
  newQty: number;
  diffQty: number;
  direction: "SHORT" | "OVER";
  kind: "RECORD_CORRECTION" | "OVERAGE";
  varianceId: string | null;
}

export const qtyAdjustService = {
  /** Sayım metraj düzeltmesi — yalnız currentQty; sebep zorunlu (min 3). */
  adjust: (
    rollId: string,
    body: { newQty: number; reason: string },
  ): Promise<ApiResponse<QtyAdjustResult>> =>
    apiClient
      .patch<ApiResponse<QtyAdjustResult>>(`/api/rolls/${rollId}/qty`, body)
      .then((r) => r.data),
};
