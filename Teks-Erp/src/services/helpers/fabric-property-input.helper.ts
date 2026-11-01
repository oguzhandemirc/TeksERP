// Özellik gövdesinin saf alan okuyucuları (`fabric-property.service`ten ayrıldı; DB'ye dokunmaz).
import { AppError } from "../../utils/app-error";

/** Desen vuruş sayısı: atlanmış = dokunma, null = kaldır, yoksa pozitif tam sayı (bilinmeyen biçim 400). */
export function readStitchCountField(raw: unknown, code: string): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0 || raw > 10_000_000) {
    throw AppError.badRequest(`'${code}' değerinin vuruş sayısı 1 ile 10.000.000 arasında tam sayı olmalı`);
  }
  return raw;
}

/**
 * Gövdeden `stationIds`'i ayıklar (tekrarları eler) ve payload'dan siler.
 * `undefined` = alan hiç gönderilmedi (update'te "dokunma" demek).
 */
export function extractStationIds(data: Record<string, unknown>): string[] | undefined {
  if (!("stationIds" in data)) return undefined;
  const raw = data.stationIds;
  delete data.stationIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw AppError.badRequest("stationIds bir istasyon id listesi olmalı");
  }
  return [...new Set(raw as string[])];
}
