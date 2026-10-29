// =============================================================================
// H3 kurşun sayaç okuması — saf yardımcılar (karar belgesi §3-3/4/6, §6)
// =============================================================================
// Kip ve politika adım özetinden gelir (`KursunStepSummary.meter`); alan yoksa OFF
// = bugünkü davranış. Sapma kararı `lib/kursun-meter-variance.ts` aynasından (yerel
// ön-kontrol; asıl karar sunucuda, okuma satırındaki politika kopyasıyla).
// =============================================================================

import { resolveMeterVariance, type MeterVarianceResult } from '../../../lib/kursun-meter-variance';
import type { KursunRollSummary, KursunStepSummary } from '../../../types/models';
import type { MeterReadingBody } from '../../../services/kursunQc.service';
import type { DevicePeripheral } from '../../../services/peripheral.service';

export type MeterCapture = 'OFF' | 'OUT' | 'IN_OUT';
export type MeterSource = MeterReadingBody['source'];
export type MeterPolicy = NonNullable<KursunStepSummary['meter']>['policy'];

const NO_POLICY: MeterPolicy = { thresholdM: null, thresholdPct: null, basis: 'DECLARED_IN', approvalMode: 'NONE' };

/** Adım özetinden kip + politika. Tanınmayan/eksik değer OFF (fail-closed: gövde değişmez). */
export function meterSettingsOf(summary: KursunStepSummary | null | undefined): { capture: MeterCapture; policy: MeterPolicy } {
  const m = summary?.meter;
  const capture: MeterCapture = m?.capture === 'OUT' || m?.capture === 'IN_OUT' ? m.capture : 'OFF';
  return { capture, policy: m?.policy ?? NO_POLICY };
}

export const outCaptureOn = (c: MeterCapture): boolean => c === 'OUT' || c === 'IN_OUT';
export const inCaptureOn = (c: MeterCapture): boolean => c === 'IN_OUT';

/**
 * Sayaç stratejisi: RESETTING + dolu `resetCommand` → okuma = metre, kalıcı yazımdan SONRA
 * sıfırlanır. Diğer her durum (CUMULATIVE, boş komut, bilinmeyen kip) → metre = okuma − başlangıç.
 */
export function counterStrategy(p: Pick<DevicePeripheral, 'counterMode' | 'resetCommand'>): 'RESET' | 'DIFF' {
  return p.counterMode === 'RESETTING' && !!p.resetCommand?.trim() ? 'RESET' : 'DIFF';
}

export type CounterOutcome =
  | { kind: 'OK'; meters: number }
  | { kind: 'NO_BASELINE' }
  | { kind: 'REPEAT' }
  | { kind: 'NEGATIVE' };

/** Binde-bir çözünürlükte fark (Decimal(12,3) ile aynı); kayan nokta artığı atılır. */
export function metersFromCounter(raw: number, baseline: number | null): CounterOutcome {
  if (baseline == null) return { kind: 'NO_BASELINE' };
  const diff = Math.round(raw * 1000) - Math.round(baseline * 1000);
  if (diff === 0) return { kind: 'REPEAT' };
  if (diff < 0) return { kind: 'NEGATIVE' };
  return { kind: 'OK', meters: diff / 1000 };
}

/** Fark yolunun elle girişe düşme açıklaması (operatöre). */
export function counterFallbackText(kind: Exclude<CounterOutcome['kind'], 'OK'>): string {
  switch (kind) {
    case 'NO_BASELINE':
      return 'Sayacın başlangıç değeri yok — bu top için metreyi elle girin';
    case 'REPEAT':
      return 'Sayaç değeri değişmedi — sayaç ilerlemiyor olabilir, metreyi elle girin';
    case 'NEGATIVE':
      return 'Sayaç geri gitti (sıfırlanmış olabilir) — metreyi elle girin';
  }
}

/** Şerit rengi: yeşil = bağlı sayaç, amber = elle, kırmızı = SİMÜLASYON. */
export function stripToneOf(source: MeterSource | null): 'GREEN' | 'AMBER' | 'RED' | 'NONE' {
  if (source === 'MACHINE') return 'GREEN';
  if (source === 'SIMULATED') return 'RED';
  if (source === 'OPERATOR' || source === 'SUPERVISOR') return 'AMBER';
  return 'NONE';
}

/** Tablet yerel ön-kontrol; taban yoksa sapma yok (sunucu yine karar verir). */
export function localVariance(roll: Pick<KursunRollSummary, 'meter'> | null, policy: MeterPolicy, out: number): MeterVarianceResult {
  return resolveMeterVariance(
    { declaredIn: roll?.meter?.declaredIn ?? null, measuredIn: roll?.meter?.measuredIn ?? null, out },
    policy,
  );
}

/** Gövde alan sırası sabit (kuyruk JSON'u belirlenimli). `ack` yalnız verildiyse yazılır. */
export function buildMeterBody(input: {
  meters: number;
  source: MeterSource;
  peripheralId: string | null;
  rawCounter: number | null;
  clientToken: string;
  ack?: { reasonCode: string | null; reasonText: string | null } | null;
}): MeterReadingBody {
  const body: MeterReadingBody = {
    meters: input.meters,
    source: input.source,
    peripheralId: input.peripheralId,
    rawCounter: input.rawCounter,
    clientToken: input.clientToken,
  };
  if (input.ack) body.ack = input.ack;
  return body;
}

/** Hazır sapma sebepleri — ReasonPreset'te uygun tür yok (yeni tür migration ister). */
export const METER_REASONS: readonly { code: string; label: string }[] = [
  { code: 'IRSALIYE_HATALI', label: 'İrsaliye metresi hatalı' },
  { code: 'KUMAS_CEKTI', label: 'Kumaş çekti / esnedi' },
  { code: 'KESIM_PARCA', label: 'Parça kesildi' },
  { code: 'SAYAC_KAYDI', label: 'Sayaç kaydırdı' },
];
export const METER_REASON_CODE_MAX = 64;
export const METER_REASON_TEXT_MAX = 300;

/** Sebep kodu + metni kırpılır; ikisi de boşsa null (sunucu `normalizeAckReason` ikizi). */
export function normalizeReason(code: string | null, text: string): { reasonCode: string | null; reasonText: string | null } | null {
  const c = code?.trim().slice(0, METER_REASON_CODE_MAX) || null;
  const t = text.trim().slice(0, METER_REASON_TEXT_MAX) || null;
  return c || t ? { reasonCode: c, reasonText: t } : null;
}

/** Elle girilen metre metni → sayı (virgül kabul; 0 < m < 1e9, ≤3 ondalık). Geçersizse null. */
export function parseManualMeters(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const v = Number(t);
  return v > 0 && v < 1e9 ? v : null;
}

export interface PendingMeterAck {
  readingId: string;
  rollId: string;
  approvalMode: string;
}

/** finishStep 409 METER_DEVIATION_UNACKED → bekleyen liste (yoksa null). Kod `details.code`'dan. */
export function pendingAcksFromError(err: unknown): PendingMeterAck[] | null {
  const e = err as { status?: number; details?: { code?: string; pending?: unknown } } | null;
  if (e?.status !== 409 || e.details?.code !== 'METER_DEVIATION_UNACKED') return null;
  const list = Array.isArray(e.details.pending) ? e.details.pending : [];
  return list.filter(
    (p): p is PendingMeterAck =>
      !!p && typeof (p as PendingMeterAck).readingId === 'string' && typeof (p as PendingMeterAck).rollId === 'string',
  );
}

export function approvalModeText(mode: string): string {
  switch (mode) {
    case 'SUPERVISOR_PIN':
      return 'süpervizör PIN onayı';
    case 'OFFICE':
      return 'ofis onayı';
    case 'OPERATOR_REASON':
      return 'sebep';
    default:
      return 'onay';
  }
}

/** Bekleyen onay listesinin Türkçe satırları (top kuyruğu son 4 hane). */
export function pendingAckLines(list: readonly PendingMeterAck[], rolls: readonly Pick<KursunRollSummary, 'rollId' | 'barcode'>[]): string[] {
  return list.map((p) => {
    const bc = rolls.find((r) => r.rollId === p.rollId)?.barcode;
    return `Top ${bc ? bc.slice(-4) : '—'} · ${approvalModeText(p.approvalMode)} bekliyor`;
  });
}

/** Metre gösterimi (1 ondalık; tamsa ondalıksız). */
export function fmtMeters(v: number | null | undefined): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? `${v} m` : `${v.toFixed(1)} m`;
}
