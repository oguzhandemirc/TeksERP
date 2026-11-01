// =============================================================================
// KART → HESAP WHERE (K3a) — saf Prisma parçası, model erişimi YOK
// =============================================================================
// `finance.helper` (yazma/okuma çözücüsü) ve `cari-hold.helper` (çekirdek kapı) AYNI where'i kullanır.
// Ayrı dosyada: kapı helper'ı finans grafına (number-series, cari hesap erişimi) bağlanmasın —
// `test_finance_regime_gate` §4 helper'ın ticaret modeline transitif dokunmadığını ölçer.
// =============================================================================
import type { Prisma } from "@prisma/client";

/** Bir kartın (ya da bağsız fason profilinin) hesap sorgusu — okuma ve yazma AYNI where'den (K3a). */
export type CardRef = { customerId: string | null; subcontractorId: string | null };

export function cariAccountWhereForCard(card: CardRef): Prisma.CariAccountWhereInput {
  // Kart hesabı YA DA kartın fason profiline eski bacaktan bağlı hesap: ikisi de AYNI kimliğin hesabıdır.
  // Virmanla birleşmiş hesap (K3d, `mergedIntoId` dolu) hiçbir çözücüye görünmez — yazım asıl hesaba gider.
  if (card.customerId) return { mergedIntoId: null, OR: [{ customerId: card.customerId }, { subcontractor: { customerId: card.customerId } }] };
  return { mergedIntoId: null, subcontractorId: card.subcontractorId as string };
}
