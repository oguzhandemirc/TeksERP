// =============================================================================
// "Bu sipariş bağı kaldırılabilir mi?" — istemci aynası (2026-08-19)
// =============================================================================
// Backend kuralı (`workorder-link.service.unlinkOrderLine`): SİPARİŞE ÖZEL
// (`ORDER_PRODUCTION`) bir iş emrinin SON bağı kaldırılamaz — kaldırılsaydı iş
// emri tipini yalanlar hâle gelirdi ("siparişe özel" ama siparişi yok).
//
// Bu saf yüklem o kuralın istemci aynasıdır: tuşu ÖNDEN kapatır ve sebebi yazar.
// ⚠️ İkinci bir kural kümesi DEĞİLDİR — son sözü backend söyler (yarışta 400
// gelir ve toast gösterilir). Amaç, operatörü sunucuya kadar götürüp
// reddettirmemek.
// =============================================================================

export interface UnlinkVerdict {
  allowed: boolean;
  /** Engelliyse operatöre gösterilecek sebep (backend mesajıyla aynı dil). */
  reason: string | null;
}

export function canUnlinkOrderLine(
  workOrderType: string | null | undefined,
  linkCount: number,
): UnlinkVerdict {
  if (workOrderType === 'ORDER_PRODUCTION' && linkCount <= 1) {
    return {
      allowed: false,
      reason: 'Siparişe özel iş emrinin son bağı kaldırılamaz — önce başka sipariş bağlayın.',
    };
  }
  return { allowed: true, reason: null };
}
