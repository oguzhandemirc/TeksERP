// =============================================================================
// FİKSTÜR — varsayılan depo kimliği
// =============================================================================
// Ham `prisma.roll.create` ile top kuran bekçiler `warehouseId` atamayı kolayca
// atlar; üretimde bu mümkün değil (`resolveTargetWarehouseId` hiç `null`
// dönmüyor), yani deposuz bir STOK topu **olmayan bir dünyayı** modeller.
// 2026-09-13'te defter kapısı sertleşince o fikstürler kırmızıya düştü ve doğru
// cevap kapıyı gevşetmek değil fikstürü gerçeğe uydurmaktı.
//
// ⚠️ `ensureDefaultWarehouse` BOOT uzlaştırmasıdır ve taze bir test DB'sinde
// koşmamış olabilir — bu yüzden burada bulunamazsa ADIYLA fırlatılır, sessizce
// `null` dönülmez.
// =============================================================================
import prisma from "../src/lib/prisma";

let cached: string | null = null;

/** Varsayılan deponun id'si. Yoksa fırlatır — fikstür sessizce deposuz kalmasın. */
export async function fixtureWarehouseId(): Promise<string> {
  if (cached) return cached;
  const def = await prisma.warehouse.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  if (!def) {
    throw new Error(
      "Varsayılan depo yok — `ensureDefaultWarehouse()` bu DB'de koşmamış. " +
        "Bekçi deposuz top kuramaz (defter kapısı 2026-09-13'ten beri uçsuz satırda fırlatıyor).",
    );
  }
  cached = def.id;
  return cached;
}
