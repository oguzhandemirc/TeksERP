// =============================================================================
// KOŞUM YÜKÜ — form → backend `openSchema`/`closeSchema` (birebir) + hata kodu yorumu
// =============================================================================
// §3.4 (1): iş emri OPSİYONEL (numune koşumu meşru) · desen/renk işten ön-dolu,
// KİLİTLİ DEĞİL · hedef devir boş bırakılabilir (yedek `MachineSpec`, o da yoksa
// "P: ölçülemedi"). Parmak izi backend replay'inin karşılaştırdığı alanlar:
// makine · hat · iş emri · desen.
// =============================================================================
import type { WeavingOrderSummary } from '../../../services/weavingOrder.service';
import type { CloseRunRequest, OpenRunRequest } from '../../../services/machineRun.service';

export interface RunOpenForm {
  weavingOrderId: string | null;
  itemId: string | null;
  itemLabel: string;
  colorId: string | null;
  colorLabel: string;
  /** Numpad metni; boş = yedek. */
  targetPicksPerMin: string;
}

export const EMPTY_RUN_FORM: RunOpenForm = {
  weavingOrderId: null,
  itemId: null,
  itemLabel: '',
  colorId: null,
  colorLabel: '',
  targetPicksPerMin: '',
};

export const TARGET_PPM_MAX = 10_000;

/** İş emri seçilince desen/renk ön-dolar (kilitli değil — operatör değiştirebilir). */
export function prefillFromOrder(f: RunOpenForm, o: WeavingOrderSummary | null): RunOpenForm {
  if (!o) return { ...f, weavingOrderId: null };
  return {
    ...f,
    weavingOrderId: o.id,
    itemId: o.itemId,
    itemLabel: o.item.name,
    colorId: o.colorId,
    colorLabel: o.color?.name ?? '',
  };
}

export type RunValidation = { ok: true } | { ok: false; message: string };

export function validateRunOpen(f: RunOpenForm): RunValidation {
  const t = f.targetPicksPerMin.trim();
  if (t !== '') {
    const n = Number(t);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, message: 'Hedef devir pozitif tam sayı olmalı' };
    if (n > TARGET_PPM_MAX) return { ok: false, message: `Hedef devir en fazla ${TARGET_PPM_MAX} olabilir` };
  }
  return { ok: true };
}

export interface RunContext {
  machineId: string;
  productionLineNo: number;
  startedAtIso: string;
  clientToken: string;
}

export function buildOpenRunPayload(f: RunOpenForm, ctx: RunContext): OpenRunRequest {
  const t = f.targetPicksPerMin.trim();
  return {
    machineId: ctx.machineId,
    productionLineNo: ctx.productionLineNo,
    weavingOrderId: f.weavingOrderId,
    itemId: f.itemId,
    colorId: f.colorId,
    targetPicksPerMin: t === '' ? null : Number(t),
    startedAt: ctx.startedAtIso,
    clientToken: ctx.clientToken,
  };
}

export function runFingerprint(p: { machineId: string; productionLineNo: number; weavingOrderId: string | null; itemId: string | null }): string {
  return [p.machineId, String(p.productionLineNo), p.weavingOrderId ?? '-', p.itemId ?? '-'].join('|');
}

/** Kapanış: `picksAtClose` boş → null ("ölçülmedi", 0 DEĞİL). */
export function buildClosePayload(picks: string, endedAtIso: string): CloseRunRequest {
  const t = picks.trim();
  return { endedAt: endedAtIso, picksAtClose: t === '' ? null : Number(t) };
}

export function validateClose(picks: string): RunValidation {
  const t = picks.trim();
  if (t === '') return { ok: true };
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) return { ok: false, message: 'Atkı sayısı negatif olmayan tam sayı olmalı' };
  return { ok: true };
}

export type RunFailureAction =
  | { kind: 'refresh-runs'; message: string }
  | { kind: 'refresh-orders'; message: string }
  | { kind: 'token-collision'; message: string }
  | { kind: 'retry'; message: string }
  | { kind: 'plain'; message: string };

interface FailureLike {
  message?: string;
  details?: { code?: string } | null;
}

export function classifyRunFailure(error: unknown, fallback: string): RunFailureAction {
  const e = (error ?? {}) as FailureLike;
  const message = e.message?.trim() || fallback;
  const code = e.details?.code;
  if (code === 'PRODUCTION_LINE_OCCUPIED' || code === 'PRODUCTION_LINE_OVERLAP' || code === 'RUN_ALREADY_CLOSED' || code === 'RUN_REVOKED' || code === 'RUN_ALREADY_REVOKED') {
    return { kind: 'refresh-runs', message };
  }
  if (code === 'WEAVING_ORDER_NOT_OPEN' || code === 'WEAVING_ORDER_SUBCONTRACTED') return { kind: 'refresh-orders', message };
  if (code === 'CLIENT_TOKEN_COLLISION') return { kind: 'token-collision', message };
  if (code === 'MACHINE_RUN_RACE') return { kind: 'retry', message };
  return { kind: 'plain', message };
}
