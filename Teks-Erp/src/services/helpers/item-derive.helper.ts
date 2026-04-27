// =============================================================================
// TeksERP - Derived Item Helper
// =============================================================================
// Fason dönüşünde rulonun yeni kimliği (Ham Patos → Patos Mavi Yanmaz) için
// türetilmiş Item bul / oluştur.
//
// Kimlik Anahtarı: (baseItemId, colorId, sortedPropertyIds[])
//   - Aynı kombinasyon için tek Item — Item.code üzerinden deterministic
//     naming ile uniqueness sağlanır.
//   - Property ID'leri alfabetik sıralanır → her zaman aynı code üretilir.
//   - Code formatı: "<BASE_CODE>[-<COLOR_CODE>][-<PROP_CODE>...]"
//
// Aynı Item'ı bulamazsa CREATE eder; ItemProperty kayıtlarını da yazar.
// =============================================================================

import { Prisma } from "@prisma/client";

export type TxClient = Prisma.TransactionClient;

export interface DeriveItemInput {
  baseItemId: string;
  colorId: string | null;
  propertyIds: string[]; // sıra önemsiz; helper sıralar
}

export interface DerivedItemResult {
  itemId: string;
  itemCode: string;
  itemName: string;
  isNew: boolean; // Yeni mi oluşturuldu yoksa mevcut mu kullanıldı
}

/**
 * Türetilmiş Item için deterministic code üretir.
 * Örn: ("PATOS", "MAVI", ["YANMAZLIK", "KAYGAN"]) → "PATOS-MAVI-KAYGAN-YANMAZLIK"
 * (özellik kodları alfabetik sıralanır.)
 */
function buildDerivedCode(
  baseCode: string,
  colorCode: string | null,
  propertyCodes: string[],
): string {
  const parts: string[] = [baseCode];
  if (colorCode) parts.push(colorCode);
  const sortedProps = [...propertyCodes].sort((a, b) => a.localeCompare(b));
  parts.push(...sortedProps);
  return parts.join("-");
}

/**
 * Türetilmiş Item için görünen ad üretir.
 * Örn: ("Patos", "Mavi", ["Yanmazlık", "Kayganlık"]) → "Patos Mavi Kayganlık Yanmazlık"
 */
function buildDerivedName(
  baseName: string,
  colorName: string | null,
  propertyNames: string[],
): string {
  const parts: string[] = [baseName];
  if (colorName) parts.push(colorName);
  const sortedProps = [...propertyNames].sort((a, b) => a.localeCompare(b));
  parts.push(...sortedProps);
  return parts.join(" ");
}

/**
 * Türetilmiş Item bul veya oluştur.
 *
 * - Eğer colorId === null && propertyIds.length === 0 → baseItem'ın kendisini döner
 *   (yani değişiklik yok; Roll.itemId'si zaten baseItem'a işaret etmeli).
 * - Aksi halde (baseItem, color, properties) kombinasyonu için unique code üretir,
 *   o code'la mevcut Item varsa onu döner; yoksa yeni Item + ItemProperty kayıtlarını
 *   oluşturur.
 */
export async function findOrCreateDerivedItem(
  tx: TxClient,
  input: DeriveItemInput,
): Promise<DerivedItemResult> {
  const baseItem = await tx.item.findUnique({
    where: { id: input.baseItemId },
    select: { id: true, code: true, name: true, itemType: true, unit: true },
  });
  if (!baseItem) {
    throw new Error(`Baz Item bulunamadı: ${input.baseItemId}`);
  }

  const colorRow = input.colorId
    ? await tx.color.findUnique({
        where: { id: input.colorId },
        select: { id: true, code: true, name: true },
      })
    : null;
  if (input.colorId && !colorRow) {
    throw new Error(`Renk bulunamadı: ${input.colorId}`);
  }

  const dedupedPropertyIds = [...new Set(input.propertyIds)];
  const propertyRows =
    dedupedPropertyIds.length > 0
      ? await tx.fabricProperty.findMany({
          where: { id: { in: dedupedPropertyIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
  if (propertyRows.length !== dedupedPropertyIds.length) {
    throw new Error("Bazı özellikler bulunamadı");
  }

  // Hiç renk + özellik yoksa baz item'ı geri ver — derived gerekmiyor.
  if (!colorRow && propertyRows.length === 0) {
    return {
      itemId: baseItem.id,
      itemCode: baseItem.code,
      itemName: baseItem.name,
      isNew: false,
    };
  }

  const propertyCodes = propertyRows.map((p) => p.code);
  const propertyNames = propertyRows.map((p) => p.name);

  const derivedCode = buildDerivedCode(
    baseItem.code,
    colorRow?.code ?? null,
    propertyCodes,
  );

  // Mevcut türetilmiş item'ı code üzerinden ara — code uniqueness garantili.
  const existing = await tx.item.findUnique({
    where: { code: derivedCode },
    select: { id: true, code: true, name: true },
  });

  if (existing) {
    return {
      itemId: existing.id,
      itemCode: existing.code,
      itemName: existing.name,
      isNew: false,
    };
  }

  const derivedName = buildDerivedName(
    baseItem.name,
    colorRow?.name ?? null,
    propertyNames,
  );

  const created = await tx.item.create({
    data: {
      code: derivedCode,
      name: derivedName,
      itemType: baseItem.itemType,
      unit: baseItem.unit,
      isDerived: true,
      baseItemId: baseItem.id,
      colorId: colorRow?.id ?? null,
      properties:
        propertyRows.length > 0
          ? {
              create: propertyRows.map((p) => ({ propertyId: p.id })),
            }
          : undefined,
    },
    select: { id: true, code: true, name: true },
  });

  return {
    itemId: created.id,
    itemCode: created.code,
    itemName: created.name,
    isNew: true,
  };
}

/**
 * Bir Item'ın türetilmiş özelliklerini (color + properties) döner.
 * Roll'un mevcut kimliğine yeni renk/özellik eklemek için kullanılır
 * (örn. ham → mavi → mavi+yanmaz → mavi+yanmaz+kaygan).
 */
export async function getItemDerivedAttributes(
  tx: TxClient,
  itemId: string,
): Promise<{
  baseItemId: string;
  colorId: string | null;
  propertyIds: string[];
}> {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      baseItemId: true,
      colorId: true,
      isDerived: true,
      properties: { select: { propertyId: true } },
    },
  });
  if (!item) throw new Error(`Item bulunamadı: ${itemId}`);

  // Türetilmiş değilse: baseItemId = kendisi, color/property yok.
  if (!item.isDerived) {
    return {
      baseItemId: item.id,
      colorId: null,
      propertyIds: [],
    };
  }

  return {
    baseItemId: item.baseItemId ?? item.id,
    colorId: item.colorId,
    propertyIds: item.properties.map((p) => p.propertyId),
  };
}
