// =============================================================================
// KURŞUN İSTASYONU — "Kurşun uygular" + gramaj tablosu + gram fiyatı (oie-a, 2026-11-02)
// =============================================================================
// Saklama yeri DEĞİŞMEZ: "Kurşun uygular" = `StationProperty(KURSUN, AUTO)` satırı (özellik
// formundaki istasyon seçimiyle aynı satır, tek kaynak); gramajlar = KURSUN bayrağının ÇEŞİT
// özelliğinin `FabricPropertyValue` satırları (defter FK'leri, belge sözlüğü, tablet aynen).
// Değer yazımı `fabricPropertyService` boğazından geçer (silme yok → pasif, tek varsayılan,
// audit). Gram fiyatı istasyon kolonu; genel CRUD'da kapalı (`write-guard`), yalnız buradan.
// =============================================================================
import { Currency, StationPropertyMode } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { deriveCapabilityFlags } from "./station-capability.service";
import { KURSUN_PROPERTY_CODE } from "./helpers/quality-station.helper";
import { readKursunGramPrice } from "./helpers/kursun-gram-price.helper";
import { fabricPropertyService } from "../routes/fabric-property.routes";

export interface KursunStationValue {
  id: string;
  code: string;
  name: string;
  /** gr/m (ondalık metin) — null = sayısız (eski değer). */
  amount: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface KursunStationDto {
  stationId: string;
  /** "Kurşun uygular": istasyonda KURSUN satırı AUTO modda mı. */
  enabled: boolean;
  /** KURSUN satırının modu (AUTO dışı modda anahtar kapalı görünür, satır korunur). */
  mode: StationPropertyMode | null;
  /** Katalogda KURSUN bayrağı yoksa null → anahtar açılamaz. */
  flagPropertyId: string | null;
  variantPropertyId: string | null;
  values: KursunStationValue[];
  gramPrice: string | null;
  gramCurrency: Currency | null;
}

export interface KursunStationInput {
  enabled?: boolean;
  values?: Array<{ code?: string; name: string; amount?: string | number | null; isActive?: boolean; isDefault?: boolean }>;
  gramPrice?: string | number | null;
  gramCurrency?: Currency | null;
}

const VARIANT_NAME = "Kurşun gramajı";

/** Değer kodu: verilmediyse addan ASCII (40 gr → 40-GR); listede tekil. */
export function deriveValueCode(name: string, taken: Set<string>): string {
  const ascii = name
    .replace(/[çÇ]/g, "C").replace(/[ğĞ]/g, "G").replace(/[ıIİ]/g, "I").replace(/[öÖ]/g, "O").replace(/[şŞ]/g, "S").replace(/[üÜ]/g, "U")
    .toUpperCase().replace(/[^A-Z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "GRAMAJ";
  let code = ascii;
  for (let i = 2; taken.has(code); i++) code = `${ascii}-${i}`;
  taken.add(code);
  return code;
}

async function loadFlagAndVariant() {
  const flag = await prisma.fabricProperty.findFirst({
    where: { code: KURSUN_PROPERTY_CODE },
    select: { id: true, isActive: true, variant: { select: { id: true, isActive: true } } },
  });
  return { flag, variant: flag?.variant ?? null };
}

export async function getKursunStation(stationId: string): Promise<KursunStationDto> {
  const station = await prisma.station.findUnique({ where: { id: stationId }, select: { id: true, kursunGramPrice: true, kursunGramCurrency: true } });
  if (!station) throw AppError.notFound("İstasyon bulunamadı");
  const { flag, variant } = await loadFlagAndVariant();
  const row = flag
    ? await prisma.stationProperty.findFirst({ where: { stationId, propertyId: flag.id }, select: { mode: true } })
    : null;
  const values = variant
    ? await prisma.fabricPropertyValue.findMany({
        where: { propertyId: variant.id },
        select: { id: true, code: true, name: true, amount: true, isDefault: true, isActive: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      })
    : [];
  return {
    stationId,
    enabled: row?.mode === StationPropertyMode.AUTO,
    mode: row?.mode ?? null,
    flagPropertyId: flag?.id ?? null,
    variantPropertyId: variant?.id ?? null,
    values: values.map((v) => ({ ...v, amount: v.amount?.toString() ?? null })),
    gramPrice: station.kursunGramPrice?.toString() ?? null,
    gramCurrency: station.kursunGramCurrency,
  };
}

async function assertStationCanTakeKursun(stationId: string) {
  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: { id: true, name: true, kind: true, isActive: true, appliesColor: true, appliesProperty: true, appliesQuality: true, inspectionEnabled: true, defaultCategory: { select: { appliesColor: true, appliesProperty: true } } },
  });
  if (!station) throw AppError.notFound("İstasyon bulunamadı");
  if (!station.isActive) throw AppError.badRequest("Pasif istasyonda kurşun ayarı değiştirilemez");
  if (!deriveCapabilityFlags(station).canApplyProperty) {
    throw AppError.badRequest(`'${station.name}' istasyonu özellik kazandıramaz — önce "özellik uygular" yeteneğini açın`);
  }
}

/** Anahtar: KURSUN satırını AUTO yaz / sil; açılırken çeşit bağı da (OPTIONAL) eklenir, kapanırken ikisi kalkar. */
async function setEnabled(stationId: string, enabled: boolean, flagId: string, variantId: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (enabled) {
      await tx.stationProperty.upsert({
        where: { stationId_propertyId: { stationId, propertyId: flagId } },
        create: { stationId, propertyId: flagId, mode: StationPropertyMode.AUTO },
        update: { mode: StationPropertyMode.AUTO },
      });
      if (variantId) await tx.stationProperty.createMany({ data: [{ stationId, propertyId: variantId }], skipDuplicates: true });
    } else {
      // Saf yapılandırma pivotu (kök CLAUDE.md hard delete sınıfı 1): yetenek satırı defter değildir.
      await tx.stationProperty.deleteMany({ where: { stationId, propertyId: { in: variantId ? [flagId, variantId] : [flagId] } } });
    }
  });
}

/** Gramaj listesi replace'i: çeşit yoksa doğar (bu istasyona bağlı), varsa `values` replace (eksik kod pasife). */
async function writeValues(stationId: string, input: NonNullable<KursunStationInput["values"]>, flagId: string, variantId: string | null, userId?: string): Promise<void> {
  const existing = variantId
    ? await prisma.fabricPropertyValue.findMany({ where: { propertyId: variantId }, select: { code: true } })
    : [];
  const taken = new Set(existing.map((e) => e.code));
  for (const v of input) if (v.code) taken.add(v.code.trim().toUpperCase());
  const values = input.map((v, i) => ({
    code: v.code?.trim() ? v.code.trim().toUpperCase() : deriveValueCode(v.name, taken),
    name: v.name,
    sortOrder: (i + 1) * 10,
    isActive: v.isActive ?? true,
    ...(v.amount !== undefined ? { amount: v.amount } : {}),
    ...(v.isDefault !== undefined ? { isDefault: v.isDefault } : {}),
  }));
  if (variantId) {
    // Listede olmayan eski kod pasife düşer — gövdede KALMALI ki "sil" değil "pasif" olsun (replaceValuesTx).
    await fabricPropertyService.update(variantId, { values }, userId);
    await prisma.stationProperty.createMany({ data: [{ stationId, propertyId: variantId }], skipDuplicates: true });
    return;
  }
  if (values.length === 0) return;
  const flagRow = await prisma.stationProperty.findFirst({ where: { stationId, propertyId: flagId }, select: { id: true } });
  if (!flagRow) throw AppError.badRequest("Gramaj eklemek için önce \"Kurşun uygular\" açılmalı", { code: "KURSUN_STATION_DISABLED" });
  await fabricPropertyService.create(
    { name: VARIANT_NAME, valueType: "CHOICE", variantOfPropertyId: flagId, stationIds: [stationId], values, isActive: true },
    userId,
  );
}

export async function setKursunStation(stationId: string, input: KursunStationInput, userId?: string): Promise<KursunStationDto> {
  await assertStationCanTakeKursun(stationId);
  const before = await getKursunStation(stationId);
  const { flag, variant } = await loadFlagAndVariant();
  if ((input.enabled !== undefined || input.values !== undefined) && (!flag || !flag.isActive)) {
    throw AppError.badRequest("Katalogda aktif 'Kurşun' (KURSUN) özelliği yok — önce Özellikler ekranında tanımlayın", { code: "KURSUN_PROPERTY_MISSING" });
  }
  const price = input.gramPrice !== undefined ? readKursunGramPrice(input.gramPrice, input.gramCurrency ?? null) : undefined;

  if (flag && input.enabled === true) await setEnabled(stationId, true, flag.id, variant?.id ?? null);
  if (flag && input.values !== undefined) await writeValues(stationId, input.values, flag.id, variant?.id ?? null, userId);
  if (flag && input.enabled === false) await setEnabled(stationId, false, flag.id, variant?.id ?? null);
  if (price !== undefined) {
    await prisma.station.update({ where: { id: stationId }, data: { kursunGramPrice: price.price, kursunGramCurrency: price.currency } });
  }
  const after = await getKursunStation(stationId);
  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "STATION_KURSUN",
    recordId: stationId,
    oldData: { enabled: before.enabled, gramPrice: before.gramPrice, gramCurrency: before.gramCurrency },
    newData: { enabled: after.enabled, gramPrice: after.gramPrice, gramCurrency: after.gramCurrency, values: after.values.map((v) => ({ code: v.code, amount: v.amount, isDefault: v.isDefault, isActive: v.isActive })) },
  });
  return after;
}

