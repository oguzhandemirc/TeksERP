// =============================================================================
// DOFF DENEME KİMLİĞİ — `clientToken` mantıksal deneme başına BİR kez
// =============================================================================
// Fason Kabul `receiveAttempt.ts`in ikizi. Parmak izi backend `resolveReplay`in
// karşılaştırdığı üç alan: makine + hat + parça sayısı; sayaç ve koşum bağı parmak
// izine GİRMEZ (aynı indirmeyi sayaç düzeltip yeniden göndermek aynı denemedir).
// Token yalnız BELİRSİZ hatada yapışır (ağ/zaman aşımı/5xx) — kesin 4xx'te yeni
// deneme; başarıdan sonra yapışkanlık biter. Pencere `entryAttempt`in 90 sn'si.
// =============================================================================
import { generateClientUuid } from '../../../offline/barcode';
import { INFLIGHT_REUSE_WINDOW_MS, isAmbiguousFailure } from '../../../offline/entryAttempt';

export interface DoffAttempt {
  token: string;
  fingerprint: string;
  at: number;
}

export interface DoffFingerprintInput {
  machineId: string;
  productionLineNo: number;
  pieceCount: number;
}

export function doffFingerprint(p: DoffFingerprintInput): string {
  return [p.machineId, String(p.productionLineNo), String(p.pieceCount)].join('|');
}

/** Düşmüş deneme aynı parmak izi + pencere içi → AYNI token; aksi hâlde taze. */
export function tokenForDoff(
  prev: DoffAttempt | null,
  fingerprint: string,
  nowMs: number = Date.now(),
  gen: () => string = generateClientUuid
): string {
  if (prev && prev.fingerprint === fingerprint && nowMs - prev.at <= INFLIGHT_REUSE_WINDOW_MS) return prev.token;
  return gen();
}

/** Belirsiz hata → token yapışır; kesin 4xx → yapışmaz. */
export function onDoffFailed(
  token: string,
  fingerprint: string,
  error: unknown,
  nowMs: number = Date.now()
): DoffAttempt | null {
  return isAmbiguousFailure(error) ? { token, fingerprint, at: nowMs } : null;
}

export function onDoffSucceeded(): DoffAttempt | null {
  return null;
}
