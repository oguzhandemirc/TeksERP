// Genel CRUD gövdesinden (BaseService.create/update) YAZILAMAYAN skaler kolonlar.
// DMMF her skaleri yazılabilir sayar; burada kapatılan kolonun kendi boğazı vardır
// (ör. varsayılan depo `POST /warehouses/:id/default`, silinme damgası hardDelete).
// Eski panel tam form gönderdiği için düşürme SESSİZDİR (400 değil).
// Yeni kolon kararı `test_yazilabilir_alan_beyani` ile ölçülür.

export const BASE_WRITE_CLOSED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  warehouse: ["isDefault"],
  // B5 kalibrasyonu: tür kapısı (yalnız METER) + tarih doğrulaması D4-B5k'de gelene dek kapalı.
  peripheralDevice: ["lastSeenAt", "deletedAt", "calibratedAt", "calibrationDueAt", "calibrationNote"],
  // Künye yalnız oturumdan (`withActor`); gövde ayrıca Zod `.strict()` allowlist'inden geçer.
  machineStopCodeMap: ["createdById", "updatedById"],
  // SEYİTOĞLU MİG-1: kendi doğrulayıcısı (tarife kodu çözümü) E1 diliminde doğana dek genel CRUD'a
  // KAPALI. `Item.weaveDesignId` + `ProductRecipe.variantCode` SY-A2'de, `warpSpec.wastePct` C1'de açıldı.
  productRecipe: ["finishingRateCode"],
};

export function baseWriteClosedFields(modelName: string): readonly string[] {
  return BASE_WRITE_CLOSED_FIELDS[modelName] ?? [];
}
