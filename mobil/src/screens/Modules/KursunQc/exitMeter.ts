// =============================================================================
// GK (2026-11-10): düğmeli kipte çıkış metresi + tamamlanmış topa hata = yeniden açma — saf yardımcılar
// =============================================================================
// Metre yalnız ölçen HİZMET istasyonunda (KURŞUN/BRODE yeteneği) sorulur; yalnız kalite yürüten istasyon
// (DETAYLI KK) sormaz. Okuma tek dokunuş kipiyle AYNI yoldan gider (`meter.captureOut` → completeQc2 `meterOut`).
// =============================================================================

import type { CompleteQc2Request, MeterReadingBody } from '../../../services/kursunQc.service';
import type { KursunStepSummary } from '../../../types/models';
import type { BrodePieceState } from './useBrodePieceCount';
import type { MeterRoll } from './useMeterCapture';
import { meterSettingsOf, outCaptureOn } from './meterCapture';

/** Çıkış metresini ölçen hizmet yetenekleri — backend `KURSUN_PROPERTY_CODE` / `BRODE_PROPERTY_CODE`. */
export const EXIT_METER_PROPERTY_CODES: readonly string[] = ['KURSUN', 'BRODE'];

type SummaryLike = Pick<KursunStepSummary, 'appliesKursun' | 'properties' | 'meter'> | null | undefined;

/** İstasyon kurşun ya da brode veriyor mu (yalnız kalite istasyonu → false). */
export function stationMeasuresService(summary: SummaryLike): boolean {
  if (!summary) return false;
  if (summary.appliesKursun === true) return true;
  return (summary.properties ?? []).some((p) => EXIT_METER_PROPERTY_CODES.includes(p.code));
}

/** Düğmeli kipte "Tamamla" çıkış metresi istesin mi: sayaç kipi OUT/IN_OUT ∧ hizmet istasyonu. */
export function exitMeterRequired(summary: SummaryLike): boolean {
  return outCaptureOn(meterSettingsOf(summary as KursunStepSummary | null | undefined).capture) && stationMeasuresService(summary);
}

/**
 * Düğmeli kipin tamamlaması. Metre gerekmiyorsa gövde bugünkü gibi hemen gider; gerekiyorsa önce brode adedi
 * denetlenir, sonra sayaç okunur (cihaz yoksa elle metre modalı, sapmada sebep) ve gövde `meterOut` ile kuyruğa
 * girer. Vazgeçte hiçbir istek gitmez.
 */
export function completeWithExitMeter(args: {
  required: boolean;
  meter: { captureOut: (roll: MeterRoll, stepId: string, enqueue: (m: MeterReadingBody) => void, abort: () => void) => void };
  piece: Pick<BrodePieceState, 'precheck' | 'attach'>;
  roll: MeterRoll;
  vars: CompleteQc2Request;
  complete: (vars: CompleteQc2Request) => void;
}): void {
  const { required, meter, piece, roll, vars, complete } = args;
  if (!required) {
    complete(vars);
    return;
  }
  if (!piece.precheck(roll.rollId)) return;
  meter.captureOut(
    roll,
    vars.stepId,
    (meterOut) => complete(piece.attach({ ...vars, meterOut })),
    () => undefined,
  );
}

/** Hata girişi önce yeniden açma onayı istesin mi: kontrolü tamamlanmış barkodlu top. */
export function defectNeedsReopen(roll: { qc2Completed: boolean; barcode: string | null } | null | undefined): boolean {
  return !!roll && roll.qc2Completed && !!roll.barcode;
}

/** reopen-roll 409 `KURSUN_ROLL_NOT_COMPLETED`: top zaten açık (yarış/yeniden deneme) → hata yine yazılır. */
export function isRollAlreadyOpen(err: unknown): boolean {
  const e = err as { status?: number; details?: { code?: unknown } } | null;
  return e?.status === 409 && e.details?.code === 'KURSUN_ROLL_NOT_COMPLETED';
}

export const REOPEN_ROLL_QUESTION = 'Bu topun kontrolü tamamlandı. Yeniden açıp hata eklemek istiyor musunuz?';
