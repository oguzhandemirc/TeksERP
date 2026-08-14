// =============================================================================
// EKSTREDE AKTİF DEVİR TESPİTİ — saf katman
// =============================================================================
// "Devri İptal Et" düğmesinin bağlanacağı satır: görünen pencerede AKTİF
// (terslenmemiş) devir olduğuna dair en iyi tahmin. Ekran-içi useMemo'dan
// buraya çıkarıldı (2026-08-14): saf katman dersi — ekranda yaşayan yüklemin
// tersine çevrilmesi hiçbir testi kırmaz; bekçisi `statementDevir.test.ts`.
//
// Backend'in kuralı: cari+para birimi başına EN FAZLA BİR aktif ADJUSTMENT;
// iptal ucu satır kimliği almaz, aktif olanı kendisi bulur. Ekstre satırı ise
// `reversedBy` bilgisini TAŞIMAZ ve tarih penceresi geçmişi kesebilir — yani
// istemci tarafında kesin bilgi yapısal olarak yok. Yüklem iki parçalı:
//   • ADJUSTMENT sayısı > ADJUSTMENT_CANCEL sayısı → pencerede terslenmemiş
//     bir devir kesin var (iptal + yeniden giriş akışında yeni devir GEÇMİŞ
//     tarihle girilebildiği için "iptal satırından sonra mı" sorusu tek başına
//     YETMEZ — sayım o durumu da yakalar), YA DA
//   • son ADJUSTMENT listede son ADJUSTMENT_CANCEL'dan SONRA → pencere eski
//     devri kesmiş olsa bile görünen son devir aktiftir.
// Yanlış-pozitif kalırsa (nadir pencere kombinasyonları) düğme ÇALIŞIR ama
// backend 404/409 mesajı AYNEN gösterilir — sesli hata. Yanlış-negatif makul
// akışların hiçbirinde doğmaz; pencereyi genişletmek düğmeyi getirir.
// =============================================================================

/** Yüklemin ihtiyaç duyduğu asgari satır şekli (StatementRow'un alt kümesi). */
export interface DevirScanRow {
  id: string;
  sourceType: string;
}

/**
 * Görünen pencerede "Devri İptal Et" düğmesinin bağlanacağı satırın id'si —
 * aktif devir tespit edilemezse `null` (düğme çizilmez).
 */
export function findActiveDevirRowId(rows: ReadonlyArray<DevirScanRow>): string | null {
  let lastAdjIdx = -1;
  let lastCancelIdx = -1;
  let adjCount = 0;
  let cancelCount = 0;
  rows.forEach((r, i) => {
    if (r.sourceType === "ADJUSTMENT") {
      lastAdjIdx = i;
      adjCount += 1;
    } else if (r.sourceType === "ADJUSTMENT_CANCEL") {
      lastCancelIdx = i;
      cancelCount += 1;
    }
  });
  if (lastAdjIdx < 0) return null;
  const hasActive = adjCount > cancelCount || lastAdjIdx > lastCancelIdx;
  return hasActive ? (rows[lastAdjIdx]?.id ?? null) : null;
}
