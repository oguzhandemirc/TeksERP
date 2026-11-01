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

/** Kuşak değeri → sarf kalemi (top başına 1 düşüm). `undefined` = dokunma, `null` = kaldır. */
export interface ConsumableItemField {
  consumableItemId?: string | null;
}

/** Gövdedeki `consumableItemId`: undefined = dokunma, ""/null = kaldır; başka tip 400. */
export function readConsumableItemIdField(raw: unknown, code: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  // Uuid kolonuna biçimsiz değer giderse Prisma 500 verir; fail-closed 400.
  if (typeof raw !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    throw AppError.badRequest(`'${code}' değerinin sarf kalemi geçersiz`, { code: "CONSUMABLE_ITEM_INVALID" });
  }
  return raw;
}

/** Değer satırına eklenecek parça: alan atlanmışsa boş (dokunma), yoksa `{ consumableItemId }`. */
export function consumableItemPatch(raw: unknown, code: string): { consumableItemId?: string | null } {
  const id = readConsumableItemIdField(raw, code);
  return id === undefined ? {} : { consumableItemId: id };
}
