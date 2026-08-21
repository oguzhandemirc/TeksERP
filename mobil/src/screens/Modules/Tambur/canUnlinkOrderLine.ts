// =============================================================================
// "Bu sipariş bağı kaldırılabilir mi?" — istemci aynası (2026-08-19 · 2026-08-21)
// =============================================================================
// Backend kuralı (`workorder-link.service.unlinkOrderLine`) 2026-08-21'de değişti:
// TİP = BAĞIN AYNASI. Siparişe özel (`ORDER_PRODUCTION`) iş emrinin SON bağı
// kalkınca iş emri artık REDDEDİLMEZ, STOK üretimine DÖNER. Tek engel STOK'un
// kendi değişmezi: hedef kumaş tanımlı olmalı (pratikte hep dolu — `create`
// ORDER iş emrinde kumaşı siparişten türetir).
//
// Bu saf yüklem o kuralın istemci aynasıdır: tuşu ÖNDEN kapatır ve sebebi yazar;
// engel yoksa ama bağ SON bağsa `becomesStock` ile operatöre sonucu söyler
// (satır notu + onay metni). ⚠️ İkinci bir kural kümesi DEĞİLDİR — son sözü
// backend söyler (yarışta 400 gelir ve toast gösterilir).
// =============================================================================

export interface UnlinkVerdict {
  allowed: boolean;
  /** Engelliyse operatöre gösterilecek sebep (backend mesajıyla aynı dil). */
  reason: string | null;
  /** Bu bağ kaldırılınca iş emri STOK üretimine döner (siparişe özel + son bağ). */
  becomesStock: boolean;
}

export function canUnlinkOrderLine(
  workOrderType: string | null | undefined,
  linkCount: number,
  /** İş emrinin hedef kumaşı var mı. Bilinmiyorsa `true` ver — son sözü backend söyler. */
  hasTargetItem: boolean = true,
): UnlinkVerdict {
  const lastLinkOfOrderWo = workOrderType === 'ORDER_PRODUCTION' && linkCount <= 1;
  if (lastLinkOfOrderWo && !hasTargetItem) {
    return {
      allowed: false,
      reason:
        'Son sipariş bağı kaldırılınca iş emri stok üretimine döner; bunun için hedef kumaş tanımlı olmalı.',
      becomesStock: false,
    };
  }
  return { allowed: true, reason: null, becomesStock: lastLinkOfOrderWo };
}
