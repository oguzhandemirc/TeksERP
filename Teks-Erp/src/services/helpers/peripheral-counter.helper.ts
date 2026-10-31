// =============================================================================
// ÇEVRE BİRİMİ SAYAÇ ALANLARI — H4 (`PeripheralDevice.counterMode` / `resetCommand`)
// =============================================================================
import { PeripheralKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { factoryDayStartOfKey, factoryYmd } from "../../constants/time";

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


const CALIBRATION_DATE_FIELDS = ["calibratedAt", "calibrationDueAt"] as const;

/** "YYYY-AA-GG" ya da ISO anı → o FABRİKA gününün başı (vade gün bazlı; an dilim sınırında kaymasın); başka biçim 400. */
function parseCalibrationDate(field: string, v: unknown): Date | null {
  if (v === null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return factoryDayStartOfKey(factoryYmd(v));
  if (typeof v === "string") {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? factoryDayStartOfKey(v) : new Date(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(d.getTime())) return factoryDayStartOfKey(factoryYmd(d));
  }
  throw AppError.badRequest(
    field === "calibratedAt" ? "Kalibrasyon tarihi geçersiz (YYYY-AA-GG)" : "Kalibrasyon geçerlilik sonu geçersiz (YYYY-AA-GG)",
    { code: "INVALID_CALIBRATION_DATE", field },
  );
}

/**
 * D4-B5k kalibrasyon kaydı (İSTEĞE BAĞLI; BaseController'dan yazılabilir — doğrulama burada). Yalnız METER
 * cihazında dolu olabilir (başka türde 400); vade < kalibrasyon 400 (DB CHECK'in okunur ikizi; PATCH'te
 * gönderilmeyen taraf mevcut kayıttan alınır). Tür METER'den çıkarken alanlar temizlenir.
 */
export function assertMeterCalibrationFields(
  data: Record<string, unknown>,
  kind: string | null,
  existing: { calibratedAt: Date | null; calibrationDueAt: Date | null } | null = null,
): void {
  for (const f of CALIBRATION_DATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, f)) data[f] = parseCalibrationDate(f, data[f]);
  }
  if (Object.prototype.hasOwnProperty.call(data, "calibrationNote")) {
    const n = data.calibrationNote;
    if (n !== null && typeof n !== "string") throw AppError.badRequest("Kalibrasyon notu metin olmalı", { code: "INVALID_CALIBRATION_NOTE" });
    const t = typeof n === "string" ? n.trim() : "";
    if (t.length > 200) throw AppError.badRequest("Kalibrasyon notu en çok 200 karakter olmalı", { code: "INVALID_CALIBRATION_NOTE" });
    data.calibrationNote = t === "" ? null : t;
  }
  const filled = [...CALIBRATION_DATE_FIELDS, "calibrationNote"].some((f) => data[f] !== undefined && data[f] !== null);
  if (filled && kind !== PeripheralKind.METER) {
    throw AppError.badRequest("Kalibrasyon kaydı yalnız metre (METER) cihazında girilir", { code: "CALIBRATION_FIELDS_METER_ONLY" });
  }
  if (kind !== PeripheralKind.METER && Object.prototype.hasOwnProperty.call(data, "kind")) {
    data.calibratedAt = null;
    data.calibrationDueAt = null;
    data.calibrationNote = null;
    return;
  }
  const at = (data.calibratedAt !== undefined ? data.calibratedAt : existing?.calibratedAt) as Date | null | undefined;
  const due = (data.calibrationDueAt !== undefined ? data.calibrationDueAt : existing?.calibrationDueAt) as Date | null | undefined;
  if (at && due && due.getTime() < at.getTime()) {
    throw AppError.badRequest("Kalibrasyon geçerlilik sonu kalibrasyon tarihinden önce olamaz", { code: "CALIBRATION_DUE_BEFORE_DATE" });
  }
}
