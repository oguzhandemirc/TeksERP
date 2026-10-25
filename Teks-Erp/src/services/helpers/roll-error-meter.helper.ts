import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * PROCESS hata satırının metresi — TEK daraltma noktası (K4P-SEMA, 2026-10-24).
 * `startMeter` yalnız INSPECTION satırında NULL olabilir (DB CHECK `roll_errors_meter_ck`
 * ikinci hat); Tambur/KK2 yolları PROCESS okur. `Number(null)` sessizce 0 üretip
 * kesimi topun başına kaydırırdı → NULL burada 500 olur, sessiz sıfır olmaz.
 */
export function requireProcessMeter(err: { id: string; startMeter: Prisma.Decimal | null }): Prisma.Decimal {
  if (err.startMeter === null) {
    throw AppError.internal("Hata kaydının metresi yok — süreç hatası olarak işlenemez", {
      code: "ROLL_ERROR_METER_MISSING",
      rollErrorId: err.id,
    });
  }
  return err.startMeter;
}

/** `requireProcessMeter` + sayıya çevirim (istemci yanıtları `number` taşır). */
export function processMeterNumber(err: { id: string; startMeter: Prisma.Decimal | null }): number {
  return Number(requireProcessMeter(err));
}
