// Bağla denemesinin idempotency durumu (D4-F4): token MANTIKSAL DENEME (top + kod) başına; yalnız
// belirsiz hatada (ağ/zaman aşımı/5xx) yapışır — kesin 4xx'te düşer (`offline/entryAttempt.ts` sözleşmesi).
import {
  IDLE_ATTEMPT,
  isAmbiguousFailure,
  onAttemptFailed,
  onAttemptSucceeded,
  tokenForSubmit,
  type EntryAttemptState,
} from '../../offline/entryAttempt';

export interface BindDeps {
  bind: (rollId: string, body: { code: string; clientToken: string }) => Promise<unknown>;
  revoke: (rollId: string, reason: string) => Promise<unknown>;
  gen?: () => string;
}

function errorCode(e: unknown): unknown {
  return (e as { details?: { code?: unknown } } | null)?.details?.code;
}

export function createBindAttempt(deps: BindDeps) {
  let state: EntryAttemptState = IDLE_ATTEMPT;
  let key: string | null = null;
  return {
    /** Bağlar; `replaceReason` verilirse önce aktif kodu kaldırır (kaldırılmış kod yoksa sürer). Hata fırlatır. */
    async submit(rollId: string, code: string, replaceReason?: string): Promise<void> {
      const k = `${rollId}|${code}`;
      if (k !== key) {
        state = IDLE_ATTEMPT;
        key = k;
      }
      if (replaceReason) {
        try {
          await deps.revoke(rollId, replaceReason);
        } catch (e) {
          // Önceki denemede kaldırma yazılmış olabilir (belirsiz hata sonrası tekrar) — bağlamaya geç.
          if (errorCode(e) !== 'CUSTOMER_CODE_NOT_ACTIVE') throw e;
        }
      }
      const token = tokenForSubmit(state, deps.gen);
      try {
        await deps.bind(rollId, { code, clientToken: token });
        state = onAttemptSucceeded(state, token);
      } catch (e) {
        state = isAmbiguousFailure(e) ? onAttemptFailed(state, token) : IDLE_ATTEMPT;
        throw e;
      }
    },
  };
}
