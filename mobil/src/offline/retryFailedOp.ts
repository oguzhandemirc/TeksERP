// =============================================================================
// retryFailedOp — ölü mektup kutusundan yeniden gönderim
// =============================================================================
// Kutu HER ekrandan açılabilir, dolayısıyla yeniden gönderimin bir component
// observer'ı YOKTUR. Mutation'ı doğrudan cache'ten kuruyoruz: `build()`
// `defaultMutationOptions`'ı uygular → registry `mutationFn` + `OFFLINE_AWARE`
// (retry + `networkMode: 'online'`, yani cihaz offline'sa yine kuyruğa girer).
// Hydration'ın restore edilmiş mutation'ları kurduğu yolun aynısı.
//
// Kuyruğa imperative müdahale emsali: `KursunQcScreen` kuyruktan bekleyen
// mutation'ı `cache.remove()` ile iptal ediyor.
// =============================================================================

import { queryClient } from './queryClient';
import { opIdFor, useFailedOps, type FailedOp } from './failedOps';

/**
 * @param extra payload'a EKLENECEK alanlar (ör. `{ confirmDuplicate: true }`).
 *   Verilmezse payload BİREBİR gider — `clientToken` ve `clientEnteredAt`
 *   korunur, yani backend bunu yeni bir top değil aynı denemenin tekrarı sayar.
 */
export function retryFailedOp(row: FailedOp, extra?: Record<string, unknown>): void {
  const variables = extra
    ? { ...(row.variables as Record<string, unknown>), ...extra }
    : row.variables;
  // Payload değiştiyse satırın kimliği de değişir; başarı geldiğinde
  // `clearStationFailure` YENİ id'yi hesaplayacağı için satırı önceden taşırız —
  // yoksa eski satır kutuda ölü olarak kalırdı.
  useFailedOps.getState().markRetrying(row.id, opIdFor(row.key, variables));
  void queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey: row.key as unknown[] })
    .execute(variables)
    // Hata zaten MutationCache.onError üzerinden kutuya geri yazılıyor.
    .catch(() => {});
}
