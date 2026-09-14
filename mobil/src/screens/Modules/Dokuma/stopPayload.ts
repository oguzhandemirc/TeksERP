// =============================================================================
// DURUŞ YÜKÜ — saf (React'sız): backend `openSchema`/`classifySchema` ile birebir
// =============================================================================
// Sebep açılışta İSTEĞE BAĞLI (verilmezse sunucu `requiresReason` borcu yazar ve
// ekran "sebep ata" çizer); sebep atamada ZORUNLU. Kod UYDURULMAZ: chip yoksa
// `code` null. `beamSlot` bu dilimde HİÇ gönderilmez — `Machine.warpBeamSlots`
// kolonu yok, yuva sorulamaz; NULL = "atanmamış" kovası (tahminle yazılmaz).
// =============================================================================
import type { ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import type { ClassifyStopRequest, OpenStopRequest } from '../../../services/machineStop.service';

export const EMPTY_REASON: ReasonPresetValue = { code: null, text: '' };
export const REASON_NOTE_MAX = 300;

function note(text: string): string | null {
  const t = text.trim();
  return t.length > 0 ? t.slice(0, REASON_NOTE_MAX) : null;
}

export function buildOpenStopPayload(reason: ReasonPresetValue, ctx: { machineId: string; startedAtIso: string; clientToken: string }): OpenStopRequest {
  return { machineId: ctx.machineId, startedAt: ctx.startedAtIso, reasonCode: reason.code, reasonNote: note(reason.text), clientToken: ctx.clientToken };
}

export function validateClassify(reason: ReasonPresetValue): { ok: true } | { ok: false; message: string } {
  if (!reason.code) return { ok: false, message: 'Sebep seçin — sınıflandırma sebepsiz kaydedilmez.' };
  return { ok: true };
}

export function buildClassifyPayload(reason: ReasonPresetValue): ClassifyStopRequest {
  return { reasonCode: reason.code ?? '', reasonNote: note(reason.text) };
}

/** Parmak izi: aynı makine + aynı sebep = aynı mantıksal deneme (saat GİRMEZ — kimlik token'dır). */
export function stopFingerprint(p: { machineId: string; reasonCode: string | null }): string {
  return `${p.machineId}|${p.reasonCode ?? ''}`;
}

/** "1 sa 05 dk" / "12 dk" / "<1 dk" — geçmiş süre; ileri damga (saat kayması) 0'a kırpılır. */
export function formatElapsed(startedAtIso: string, nowMs: number): string {
  const start = Date.parse(startedAtIso);
  if (Number.isNaN(start)) return '—';
  const min = Math.max(0, Math.floor((nowMs - start) / 60_000));
  if (min < 1) return '<1 dk';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} sa ${String(m).padStart(2, '0')} dk` : `${m} dk`;
}

export type StopFailureAction =
  | { kind: 'refresh-stops'; message: string }
  | { kind: 'refresh-presets'; message: string }
  | { kind: 'shift-cancelled'; message: string }
  | { kind: 'token-collision'; message: string }
  | { kind: 'plain'; message: string };

interface FailureLike {
  message?: string;
  details?: { code?: string } | null;
}

const REFRESH_STOPS = new Set(['STOP_ALREADY_OPEN', 'STOP_ALREADY_CLOSED', 'STOP_REVOKED', 'STOP_ALREADY_REVOKED', 'STOP_ALREADY_CLASSIFIED', 'STOP_RECLASS_STALE']);
const REFRESH_PRESETS = new Set(['REASON_CODE_INVALID', 'STOP_LOSS_CLASS_MISSING']);

export function classifyStopFailure(error: unknown, fallback: string): StopFailureAction {
  const e = (error ?? {}) as FailureLike;
  const message = e.message?.trim() || fallback;
  const code = e.details?.code ?? '';
  if (REFRESH_STOPS.has(code)) return { kind: 'refresh-stops', message };
  if (REFRESH_PRESETS.has(code)) return { kind: 'refresh-presets', message };
  // İkisi ADIYLA gösterilir, genel 409 değil (1e 2026-09-14): iptal vardiyaya yazılamaz · aynı token farklı yük.
  if (code === 'SHIFT_CANCELLED' || code === 'SHIFT_SEALED') return { kind: 'shift-cancelled', message };
  if (code === 'CLIENT_TOKEN_COLLISION') return { kind: 'token-collision', message };
  return { kind: 'plain', message };
}
