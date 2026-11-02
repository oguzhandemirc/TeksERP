// Toplu gönderimde deneme token'ı (kk1.md): satır başına `attempt.keyed(anahtar)`; parti bitince TEK karar —
// belirsiz hata varsa o bildirilir (token'lar yapışır, yeniden gönderim satırı ikilemez), yalnız kesin hatada yenilenir.
import { isAmbiguousFailure } from "@/lib/attemptToken";

/** `undefined` = hatasız parti (onSuccess); değilse onFailure'a verilecek hata. */
export function batchFailure(errors: readonly unknown[]): unknown {
  return errors.find((e) => isAmbiguousFailure(e)) ?? errors[0];
}
