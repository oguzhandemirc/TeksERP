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
  // Kurşun gram fiyatı yalnız `PUT /station-capabilities/:id/kursun` boğazından (para birimi + CHECK doğrulaması orada).
  station: ["kursunGramPrice", "kursunGramCurrency"],
  // İdempotency anahtarı yalnız hızlı kayıt boğazından (`customer-quick-create.service.ts` `quickCreate`, tokenReplay); genel gövde yazamaz.
  // Çoklu etiket seti: "herkes için seti göster" yalnız `PUT /customers/:id/label-template-options` boğazından.
  customer: ["clientToken", "labelShowGlobalTemplates"],
  // Hizmet kartı: genel gövde yalnız ad + birim yazar (servis allowlist'iyle aynı); kod doğuşta, durum yaşam döngüsü ucundan, birleştirme kendi boğazından.
  serviceItem: [
    "code", "isActive", "lifecycleStatus", "lifecycleChangedAt", "lifecycleChangedById", "lifecycleReason",
    "mergedIntoId", "mergedAt", "mergedById", "createdById", "updatedById",
  ],
};

export function baseWriteClosedFields(modelName: string): readonly string[] {
  return BASE_WRITE_CLOSED_FIELDS[modelName] ?? [];
}
