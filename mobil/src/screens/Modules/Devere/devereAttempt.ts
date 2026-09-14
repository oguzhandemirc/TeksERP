// =============================================================================
// LEVENT DENEME KİMLİĞİ — `clientToken` mantıksal deneme başına BİR kez
// =============================================================================
// Doff `doffAttempt.ts`in ikizi. İki token'lı uç var: PLAN (`WarpBeam.clientToken`,
// backend replay üç alanı karşılaştırır: çözgü kartı + köken + planlanan metre) ve
// SAR (`WarpBeamEvent.clientToken`, replay levent + WOUND). Parmak izi o alanlardır;
// iplik satırları/makine parmak izine GİRMEZ (aynı sarımı satır düzeltip yeniden
// göndermek aynı denemedir). Token yalnız BELİRSİZ hatada yapışır (ağ/zaman
// aşımı/5xx) — kesin 4xx'te yeni deneme; başarıdan sonra yapışkanlık biter.
// =============================================================================
import { generateClientUuid } from '../../../offline/barcode';
import { INFLIGHT_REUSE_WINDOW_MS, isAmbiguousFailure } from '../../../offline/entryAttempt';

export interface BeamAttempt {
  token: string;
  fingerprint: string;
  at: number;
}

export function planFingerprint(p: { warpSpecId: string; originKind: string; plannedLengthM: number }): string {
  return ['plan', p.warpSpecId, p.originKind, String(p.plannedLengthM)].join('|');
}

export function windFingerprint(p: { beamId: string; lengthM: number }): string {
  return ['wind', p.beamId, String(p.lengthM)].join('|');
}

/** Düşmüş deneme aynı parmak izi + pencere içi → AYNI token; aksi hâlde taze. */
export function tokenForBeam(
  prev: BeamAttempt | null,
  fingerprint: string,
  nowMs: number = Date.now(),
  gen: () => string = generateClientUuid
): string {
  if (prev && prev.fingerprint === fingerprint && nowMs - prev.at <= INFLIGHT_REUSE_WINDOW_MS) return prev.token;
  return gen();
}

/** Belirsiz hata → token yapışır; kesin 4xx → yapışmaz. */
export function onBeamFailed(token: string, fingerprint: string, error: unknown, nowMs: number = Date.now()): BeamAttempt | null {
  return isAmbiguousFailure(error) ? { token, fingerprint, at: nowMs } : null;
}

export function onBeamSucceeded(): BeamAttempt | null {
  return null;
}
