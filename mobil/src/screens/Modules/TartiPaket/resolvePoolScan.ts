// =============================================================================
// PAKETLEME — okutulan kod havuzdaki bir ÇUVAL mı, yoksa çuvala eklenecek bir
// TOP mu? (saf karar, 2026-09-22)
// =============================================================================
// ⚠️ SIRA ÖNEMLİ: önce HAVUZDA ARANIR, sonra sınıflandırmaya bakılır.
// Sebep `manualSackNo`: fabrika çuvala ELLE kod verebiliyor (`A-17` gibi) ve
// elle verilen kod seri biçiminin DIŞINDADIR — hiçbir sınıflandırıcı onu
// "çuval" diye tanıyamaz. Arama önce koşarsa elle kodlu çuval yine bulunur;
// sınıflandırma önce koşsaydı o çuval TOP sanılır ve "Top bulunamadı" derdi.
//
// ⇒ Kural: TANINMAYAN KOD YANLIŞ DALA DÜŞMEZ, ARAMAYA DÜŞER.
// =============================================================================
import { upperTr } from '../../../utils/trCase';

export interface PoolSack {
  id: string;
  sackNo: string;
}

export type PoolScanDecision =
  /** Havuzda bu kodla bir çuval var → aktif yap. */
  | { action: 'select-sack'; sack: PoolSack }
  /** Kod çuval biçiminde ama havuzda yok (sevk edilmiş olabilir). */
  | { action: 'sack-not-in-pool' }
  /** Kalan her şey: çuvala eklenecek top/kartela — kararı backend verir. */
  | { action: 'scan-into-sack' };

export function resolvePoolScan(
  code: string,
  sacks: readonly PoolSack[],
  isSackKind: (code: string) => boolean,
): PoolScanDecision {
  // Okutulan kod baştaki/sondaki boşlukla gelebilir (wedge klavye kuyruğu);
  // sınıflandırıcı zaten trim'liyor, karşılaştırma da trim'lemeli.
  const aranan = upperTr(code.trim());
  const target = sacks.find((s) => upperTr(s.sackNo.trim()) === aranan);
  if (target) return { action: 'select-sack', sack: target };
  if (isSackKind(code)) return { action: 'sack-not-in-pool' };
  return { action: 'scan-into-sack' };
}
