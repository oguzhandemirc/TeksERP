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

/** Kurşun gramajı gr/m (oie-a): `undefined` = dokunma, `null` = kaldır; > 0, en fazla 3 ondalık. Sayı ya da ondalık metin. */
export function readGramAmountField(raw: unknown, code: string): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const txt = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(",", ".") : "";
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(txt) || Number(txt) <= 0) {
    throw AppError.badRequest(`'${code}' değerinin gramajı (gr/m) 0'dan büyük, en fazla 3 ondalıklı sayı olmalı`);
  }
  return txt;
}

/** Varsayılan değer seçimi: ÇEŞİT başına tek varsayılan, pasif değer varsayılan olamaz (DB: kısmi unique + CHECK). */
export function assertSingleDefaultValue(values: ReadonlyArray<{ code: string; isActive?: boolean; isDefault?: boolean }>): void {
  const defs = values.filter((v) => v.isDefault === true);
  if (defs.length > 1) {
    throw AppError.badRequest(`Yalnız bir değer varsayılan olabilir (${defs.map((d) => d.code).join(", ")})`, { code: "PROPERTY_VALUE_MULTIPLE_DEFAULT" });
  }
  const passive = defs.find((d) => d.isActive === false);
  if (passive) throw AppError.badRequest(`'${passive.code}' pasif — pasif değer varsayılan olamaz`);
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

/**
 * SEÇİM tipli özellik en az bir AKTİF değer taşımalı. Değersiz bir SEÇİM
 * özelliği, `stationIds`siz doğan özelliğin ikizidir: tanımlı ama seçilemez —
 * Tambur ekranında hiç tuş çıkmaz ve sebebi hiçbir yerde yazmaz.
 */
export function assertChoiceHasValues(
  valueType: string,
  values: ReadonlyArray<{ isActive?: boolean }> | undefined,
  existingActiveCount: number,
): void {
  if (valueType !== "CHOICE") return;
  // `isActive` verilmemişse yazma yolu `?? true` ile AKTİF yazar — sayaç da aynı
  // varsayımı yapmalı, yoksa isActive'siz gönderen istemci "0 aktif değer" diye
  // sahte 400 yer (yazılacak satırlar gerçekte aktif olacakken).
  const incomingActive = values?.filter((v) => v.isActive !== false).length;
  const effective = incomingActive === undefined ? existingActiveCount : incomingActive;
  if (effective === 0) {
    throw AppError.badRequest(
      "Seçim tipli özellik en az bir AKTİF değer taşımalı — değersiz bir seçim listesi " +
        "hiçbir ekranda seçilemez.",
    );
  }
}
