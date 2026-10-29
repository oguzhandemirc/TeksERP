// =============================================================================
// ÇEVRE BİRİMİ SAYAÇ ALANLARI — H4 (`PeripheralDevice.counterMode` / `resetCommand`)
// =============================================================================
import { PeripheralKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * H4 sayaç alanları (BaseController'dan yazılabilir — doğrulama burada): `counterMode` RESETTING/CUMULATIVE,
 * `resetCommand` yazdırılabilir ASCII ≤64 (escape metni `\r` gibi düz yazılır). Yalnız METER cihazında
 * dolu olabilir — başka türde dolu değer 400 (sessiz yok saymak yanlış cihaza komut kaydı demekti); "" → null.
 */
export function assertMeterCounterFields(data: Record<string, unknown>, kind: string | null): void {
  for (const f of ["counterMode", "resetCommand"] as const) {
    if (data[f] === "") data[f] = null;
  }
  const mode = data.counterMode;
  const cmd = data.resetCommand;
  if (mode !== undefined && mode !== null && mode !== "RESETTING" && mode !== "CUMULATIVE") {
    throw AppError.badRequest("Sayaç kipi RESETTING (her topta sıfırlanır) veya CUMULATIVE (birikimli) olmalı", { code: "INVALID_COUNTER_MODE" });
  }
  if (cmd !== undefined && cmd !== null && (typeof cmd !== "string" || cmd.length > 64 || !/^[\x20-\x7E]+$/.test(cmd))) {
    throw AppError.badRequest("Sıfırlama komutu en çok 64 karakter, yalnız yazdırılabilir ASCII olmalı", { code: "INVALID_RESET_COMMAND" });
  }
  const filled = (mode !== undefined && mode !== null) || (cmd !== undefined && cmd !== null);
  if (filled && kind !== PeripheralKind.METER) {
    throw AppError.badRequest("Sayaç kipi ve sıfırlama komutu yalnız metre (METER) cihazında girilir", { code: "COUNTER_FIELDS_METER_ONLY" });
  }
  // Tür METER'den çıkarken eski istemci sayaç alanlarını göndermez — yetim değer kalmasın.
  if (kind !== PeripheralKind.METER && Object.prototype.hasOwnProperty.call(data, "kind")) {
    data.counterMode = null;
    data.resetCommand = null;
  }
}

