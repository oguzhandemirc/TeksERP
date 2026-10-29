// =============================================================================
// KURŞUN METRE SAPMASI — saf karar (TEK KAYNAK). Tablet `mobil/src/lib/kursun-meter-variance.ts`
// BAYT-EŞİT aynadır; SQL ikizi `services/helpers/kursun-meter-variance-sql.helper.ts` (bekçi
// `test_kursun_sapma`: 20 fikstürde eşit + sha256 ayna). Import YOK — iki projede aynı dosya.
// Düzeltme: önce burada, sonra `cp -p Teks-Erp/src/lib/kursun-meter-variance.ts mobil/src/lib/`.
// =============================================================================

export type MeterVarianceBasisCode = 'DECLARED_IN' | 'MEASURED_IN';
export type MeterApprovalModeCode = 'NONE' | 'OPERATOR_REASON' | 'SUPERVISOR_PIN' | 'OFFICE';

/** Okuma satırındaki politika KOPYASI — ayar sonradan değişse de işaret bununla hesaplanır. */
export interface MeterVariancePolicy {
  thresholdM: number | null;
  thresholdPct: number | null;
  basis: MeterVarianceBasisCode;
  approvalMode: MeterApprovalModeCode;
}

export interface MeterVarianceInput {
  /** Bildirilen giriş: gelen belge satırı metresi, yoksa topun ilk metresi. */
  declaredIn: number | null;
  /** Aktif giriş (IN) okuması; yoksa null. */
  measuredIn: number | null;
  /** Çıkış (OUT) okuması. */
  out: number;
}

export interface MeterVarianceResult {
  /** Karşılaştırılan taban (metre); eşik ya da taban yoksa null. */
  baseMeters: number | null;
  /** out − taban (metre, 3 ondalık). */
  diffMeters: number | null;
  /** İzin verilen fark = max(M, %P × taban). */
  allowedMeters: number | null;
  deviated: boolean;
  /** Sapma var ve kip NONE değil — imza (RollMeterAck) bekler. */
  needsAck: boolean;
}

/** Metreyi binde-bir tamsayıya çevirir (Decimal(12,3) ile aynı çözünürlük; kayan nokta artığı atılır). */
function milli(v: number): number {
  return Math.round(v * 1000);
}

/**
 * Sapma kararı. Eşik `max(M, %P × taban)`; fark eşiği AŞARSA (>) sapma. Taban: DECLARED_IN →
 * bildirilen giriş; MEASURED_IN → ölçülen giriş, yoksa bildirilen. Eşiklerin ikisi de boşsa ya da
 * taban yoksa sapma YOK (bugünkü davranış). Karşılaştırma tamsayıda: |fark|·100 > max(M·100, P·taban)
 * (binde-bir birimlerle) — SQL ikizi aynı eşitsizliği NUMERIC'te kurar.
 */
export function resolveMeterVariance(input: MeterVarianceInput, policy: MeterVariancePolicy): MeterVarianceResult {
  const none: MeterVarianceResult = { baseMeters: null, diffMeters: null, allowedMeters: null, deviated: false, needsAck: false };
  if (policy.thresholdM == null && policy.thresholdPct == null) return none;
  const base = policy.basis === 'MEASURED_IN' && input.measuredIn != null ? input.measuredIn : input.declaredIn;
  if (base == null) return none;
  const baseMilli = milli(base);
  const diffMilli = milli(input.out) - baseMilli;
  const mMilli = policy.thresholdM == null ? 0 : milli(policy.thresholdM);
  const pMilli = policy.thresholdPct == null ? 0 : milli(policy.thresholdPct);
  // Binde-bir birimde: |fark|·100000 > max(M·100000, P·taban). P ≤ 100, taban ≤ 1e6 m ⇒ < 2^53.
  const lhs = Math.abs(diffMilli) * 100000;
  const rhs = Math.max(mMilli * 100000, pMilli * baseMilli);
  const deviated = lhs > rhs;
  return {
    baseMeters: baseMilli / 1000,
    diffMeters: diffMilli / 1000,
    allowedMeters: Math.round(rhs / 100000) / 1000,
    deviated,
    needsAck: deviated && policy.approvalMode !== 'NONE',
  };
}
