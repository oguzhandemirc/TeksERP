// =============================================================================
// DOFF YÜKÜ — form durumu → backend `openSchema` (birebir) + hata kodu yorumu
// =============================================================================
// Saf mantık: ekran-hook bunu çağırır, bileşen içinde `&&` zinciri kurulmaz.
// Doğrulama mesajları Türkçe; sayaç okumadıysa `counterAtDoff: null` ve kaynak
// operatörün beyanı (`OPERATOR`), okunduysa `METER`→`MACHINE`, simüle cihazda
// `SIMULATED` — kararı backend verir (§3.9 B).
// =============================================================================
import type { MachineDataSource } from '../../../types/models';
import type { OpenDoffRequest } from '../../../services/doff.service';

export interface DoffFormState {
  /** Numpad metni — boş olabilir. */
  pieceCount: string;
  /** Sayaç metni — boş = okunmadı/girilmedi. */
  counter: string;
  /** Sayaç değerinin kaynağı; elle girildiyse OPERATOR, cihazdan MACHINE, simülasyon SIMULATED. */
  counterSource: MachineDataSource;
  machineRunId: string | null;
  notes: string;
}

export const EMPTY_DOFF_FORM: DoffFormState = {
  // Parça sayısı VARSAYILAN 1: indirmelerin ezici çoğunluğu tek parçadır; operatör dokunmadan
  // İndir'e basabilir, çok parçalı vardiyada değiştirir (+0/−1 dokunuş, davranış değişmez).
  pieceCount: '1',
  counter: '',
  counterSource: 'OPERATOR',
  machineRunId: null,
  notes: '',
};

/** Tek açık koşum varsa onun id'si (doff formunda ön-seçim); 0 ya da >1 → null (operatör seçer / Koşumsuz). */
export function preselectMachineRunId(openRuns: readonly { id: string }[]): string | null {
  return openRuns.length === 1 ? openRuns[0]!.id : null;
}

export const PIECE_COUNT_MAX = 1000;
export const NOTES_MAX = 300;

export type DoffValidation = { ok: true } | { ok: false; message: string };

export function validateDoffForm(f: DoffFormState): DoffValidation {
  const n = Number(f.pieceCount);
  if (f.pieceCount.trim() === '' || !Number.isInteger(n) || n < 1) return { ok: false, message: 'İndirilen parça sayısı en az 1 olmalı' };
  if (n > PIECE_COUNT_MAX) return { ok: false, message: `Parça sayısı en fazla ${PIECE_COUNT_MAX} olabilir` };
  if (f.counter.trim() !== '') {
    const c = Number(f.counter);
    if (!Number.isInteger(c) || c < 0) return { ok: false, message: 'Sayaç değeri negatif olmayan tam sayı olmalı' };
  }
  if (f.notes.length > NOTES_MAX) return { ok: false, message: `Not en fazla ${NOTES_MAX} karakter olabilir` };
  return { ok: true };
}

export interface DoffContext {
  machineId: string;
  productionLineNo: number;
  /** Operatörün "İndir"e BASTIĞI an — `clientEnteredAt` kalıbı; backend makul aralık dışında sunucu saatine düşer. */
  pressedAtIso: string;
  clientToken: string;
}

/** `validateDoffForm` ok değilse ÇAĞRILMAZ (hook sırayı korur). */
export function buildDoffPayload(f: DoffFormState, ctx: DoffContext): OpenDoffRequest {
  const counterEmpty = f.counter.trim() === '';
  return {
    machineId: ctx.machineId,
    productionLineNo: ctx.productionLineNo,
    machineRunId: f.machineRunId,
    doffedAt: ctx.pressedAtIso,
    pieceCount: Number(f.pieceCount),
    counterAtDoff: counterEmpty ? null : Number(f.counter),
    // Sayaç yoksa kaynak yine BEYAN edilir (OPERATOR = "ölçülmedi/operatör"); @default yok.
    counterSource: counterEmpty ? 'OPERATOR' : f.counterSource,
    notes: f.notes.trim() === '' ? null : f.notes.trim(),
    clientToken: ctx.clientToken,
  };
}

/** Sunucunun 409/400'ünü ekran eylemine çevirir. */
export type DoffFailureAction =
  | { kind: 'refresh-runs'; message: string }
  | { kind: 'token-collision'; message: string }
  | { kind: 'has-rolls'; message: string; barcodes: string[]; total: number }
  | { kind: 'already-revoked'; message: string }
  | { kind: 'plain'; message: string };

interface FailureLike {
  status?: number;
  message?: string;
  details?: { code?: string; barcodes?: string[]; total?: number } | null;
}

export function classifyDoffFailure(error: unknown, fallback: string): DoffFailureAction {
  const e = (error ?? {}) as FailureLike;
  const message = e.message?.trim() || fallback;
  const code = e.details?.code;
  if (code === 'DOFF_RUN_MISMATCH' || code === 'RUN_REVOKED') return { kind: 'refresh-runs', message };
  if (code === 'CLIENT_TOKEN_COLLISION') return { kind: 'token-collision', message };
  if (code === 'DOFF_HAS_ROLLS') {
    const barcodes = (e.details?.barcodes ?? []).filter((b): b is string => typeof b === 'string');
    return { kind: 'has-rolls', message, barcodes, total: e.details?.total ?? barcodes.length };
  }
  if (code === 'DOFF_ALREADY_REVOKED') return { kind: 'already-revoked', message };
  return { kind: 'plain', message };
}

/** Sonuç toast'ı: koda BÜYÜK yer (etiket koddan basılır); replay BAYRAKTAN (`idempotent`), metinden değil. */
export function doffResultFeedback(code: string, replay: boolean): { title: string; subtitle: string } {
  return {
    title: code,
    subtitle: replay ? 'İndirme zaten kayıtlı (yeniden gönderim)' : 'İndirme kaydedildi',
  };
}
