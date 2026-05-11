// =============================================================================
// TeksERP - Derived Item Helper
// =============================================================================
// Final Item kimliği = (baseItemId, colorId). Özellikler kimliği ETKİLEMEZ;
// her rulo kendi özellik setini taşır (Roll.properties M:N).
//
// Code formatı: "<BASE_CODE>[-<COLOR_CODE>]"   (örn. PATOS-MAVI)
// =============================================================================

import { Prisma } from "@prisma/client";

export type TxClient = Prisma.TransactionClient;

export interface DeriveItemInput {
  baseItemId: string;
  colorId: string | null;
}

export interface DerivedItemResult {
  itemId: string;
  itemCode: string;
  itemName: string;
}

/**
 * Türetilmiş Item için deterministic code üretir.
 * Örn: ("PATOS", "MAVI") → "PATOS-MAVI"
 */
export function buildDerivedItemCode(
  baseCode: string,
  colorCode: string | null,
): string {
  return colorCode ? `${baseCode}-${colorCode}` : baseCode;
}

/**
 * Türetilmiş Item için varsayılan görünür ad üretir (kullanıcı override edebilir).
 * Örn: ("Patos", "Mavi") → "Patos Mavi"
 */
export function buildDerivedItemName(
  baseName: string,
  colorName: string | null,
): string {
  return colorName ? `${baseName} ${colorName}` : baseName;
}

/**
 * Mevcut türetilmiş Item'ı bul. Bulamazsa hata fırlatır.
 *
 * - colorId === null → baseItem'ı geri döner (türetim gerekmiyor).
 * - Aksi halde deterministic code üretir, o code'la DB'de Item arar.
 */
export async function findDerivedItemOrThrow(
  tx: TxClient,
  input: DeriveItemInput,
): Promise<DerivedItemResult> {
  const baseItem = await tx.item.findUnique({
    where: { id: input.baseItemId },
    select: { id: true, code: true, name: true },
  });
  if (!baseItem) {
    throw new Error(`Baz Item bulunamadı: ${input.baseItemId}`);
  }

  if (!input.colorId) {
    return {
      itemId: baseItem.id,
      itemCode: baseItem.code,
      itemName: baseItem.name,
    };
  }

  const colorRow = await tx.color.findUnique({
    where: { id: input.colorId },
    select: { id: true, code: true },
  });
  if (!colorRow) {
    throw new Error(`Renk bulunamadı: ${input.colorId}`);
  }

  const derivedCode = buildDerivedItemCode(baseItem.code, colorRow.code);

  const existing = await tx.item.findUnique({
    where: { code: derivedCode },
    select: { id: true, code: true, name: true },
  });

  if (!existing) {
    throw new Error(
      `Hedef ürün tanımlanmamış: "${derivedCode}". Lütfen önce Tanımlar > Ürünler ekranından bu final ürünü oluşturun.`,
    );
  }

  return {
    itemId: existing.id,
    itemCode: existing.code,
    itemName: existing.name,
  };
}

/**
 * Bir Item'ın baz + renk bilgisini döner. Roll.itemId üzerinden hangi ham +
 * renk olduğunu öğrenmek için kullanılır.
 */
export async function getItemDerivedAttributes(
  tx: TxClient,
  itemId: string,
): Promise<{
  baseItemId: string;
  colorId: string | null;
}> {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      baseItemId: true,
      colorId: true,
      isDerived: true,
    },
  });
  if (!item) throw new Error(`Item bulunamadı: ${itemId}`);

  if (!item.isDerived) {
    return { baseItemId: item.id, colorId: null };
  }

  return {
    baseItemId: item.baseItemId ?? item.id,
    colorId: item.colorId,
  };
}
