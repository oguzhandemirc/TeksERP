// =============================================================================
// GK (2026-11-10): "İşi Bitir" onayının özeti — saf yardımcı
// =============================================================================
// Adım kapanışı topları sonraki istasyona taşır; onay modalı İE no · top · metre · hata özetini ve
// kontrolü tamamlanmamış top sayısını gösterir. Top başına "Kontrol Tamamlandı"ya onay YOK.
// =============================================================================

import type { KursunStepSummary } from '../../../types/models';
import { fmtMeters } from './meterCapture';

type RollLike = Pick<KursunStepSummary['rolls'][number], 'currentQty' | 'errorCount' | 'qc2Completed'>;

export interface FinishSummary {
  cardNumber: string;
  rollCount: number;
  totalMeters: number;
  defectCount: number;
  unchecked: number;
}

export function finishSummaryOf(summary: { batchNumber: string; rolls: readonly RollLike[] }): FinishSummary {
  const rolls = summary.rolls;
  // Kayan nokta toplamı 0,1 m'ye yuvarlanır (ekranda ondalık tek hane).
  const totalMeters = Math.round(rolls.reduce((s, r) => s + (Number.isFinite(r.currentQty) ? r.currentQty : 0), 0) * 10) / 10;
  return {
    cardNumber: summary.batchNumber,
    rollCount: rolls.length,
    totalMeters,
    defectCount: rolls.reduce((s, r) => s + (r.errorCount ?? 0), 0),
    unchecked: rolls.filter((r) => !r.qc2Completed).length,
  };
}

/** "<İE no> · N top · X m · Y hata — İşi bitir?" */
export function finishQuestion(s: FinishSummary): string {
  return `${s.cardNumber} · ${s.rollCount} top · ${fmtMeters(s.totalMeters)} · ${s.defectCount} hata — İşi bitir?`;
}

/** Kontrolü tamamlanmamış top varsa sarı uyarı satırı; yoksa null. */
export function uncheckedWarning(s: FinishSummary): string | null {
  return s.unchecked > 0 ? `${s.unchecked} top kontrol edilmedi` : null;
}
