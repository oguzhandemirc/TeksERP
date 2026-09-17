// =============================================================================
// GLOBAL ARAMA KATALOĞU — hangi varlık, hangi izinle, hangi alanlarda (2026-08-19)
// =============================================================================
// Tek arama kutusu (Ctrl+K) birden çok varlıkta birden arar. Bu dosya o kovaların
// TEK KAYNAĞIDIR — servis bu diziyi gezer, `if/else` zinciri YOKTUR. Yeni varlık
// eklemek tek satır olmalı.
//
// ⚠️ ALAN ADLARI SÖZLEŞMEDİR, keyfi değil. `scripts/test_search_field_config.ts`
// obje literallerinde `{ modelName, searchFields, codeSearchFields }` şeklini
// TARIYOR ve her metin yolunun `<son>Fold` gölgesini + her yolun Prisma DMMF
// üzerinden ilişki ilişki çözülebilirliğini doğruluyor. Bu adları kullanmak, yeni
// katalogu tek satır test değişikliği olmadan o kapıdan geçirir; farklı ad seçmek
// kapıyı SESSİZCE kapatır.
//
// ⚠️ İZİN = O VARLIĞIN PANEL ROUTE'UNUN İZNİ (liste ucunun mobil izinleri DEĞİL).
// Gerekçe `command-entries.ts` başlığında yazılı: "girişe route'un istediğinden
// farklı bir izin yazmak, kullanıcıya görünen ama tıklayınca /forbidden'a düşen
// bir satır üretir." Arama sonucu da bir palet satırıdır; aynı kural geçerli.
// Bekçi bu ilişkiyi (kova izni ⊆ liste route izni) mekanik doğrular.
// =============================================================================

/** Kova kimliği — panel `search-targets.ts` bu anahtarla hedefi çözer. */
export type SearchEntityKey =
  | "customer"
  | "item"
  | "color"
  | "order"
  | "workOrder"
  | "shipment"
  | "sack"
  | "subcontractor"
  | "batch";

export interface SearchEntity {
  key: SearchEntityKey;
  /** Palet grubu başlığı. */
  label: string;
  /** Prisma model adı (delegate erişimi + DMMF doğrulaması). */
  modelName: string;
  /** Bu kovayı görebilmek için gereken izin(ler) — herhangi biri yeter. */
  permissions: readonly string[];
  /** KATLANMIŞ metin yolları (motor `Fold` ekini kendisi koyar). */
  searchFields: string[];
  /** KOD yolları — katlanmaz, yalnız kod-biçimli terimde koşar. */
  codeSearchFields: string[];
  /** Palet satırı için gereken en dar select. */
  select: Record<string, unknown>;
  orderBy: Record<string, "asc" | "desc">;
  /**
   * Terim KOD BİÇİMİNDE değilse bu kovayı hiç koşturma.
   * Sevkiyat/çuval/parti gibi yalnız numarayla anılan kayıtlar için: bir müşteri
   * adı araması bu tablolarda asla eşleşmez, trigram taraması boşa gider.
   */
  codeOnly?: boolean;
  /** Yalnız aktif kayıtlar (ana veri kovaları). */
  activeOnly?: boolean;
}

export const SEARCH_ENTITIES: readonly SearchEntity[] = [
  {
    key: "customer",
    label: "Müşteriler",
    modelName: "customer",
    permissions: ["customer:read"],
    searchFields: ["name"],
    codeSearchFields: ["code", "taxNumber", "exportCode"],
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { name: "asc" },
    activeOnly: true,
  },
  {
    key: "item",
    label: "Ürünler",
    modelName: "item",
    // Müşteri alias'ı da aranır: müşteri "BELLE" der, bizim adımız "18152".
    permissions: ["item:read"],
    searchFields: ["name", "customerAliases.some.alias"],
    codeSearchFields: ["code"],
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { name: "asc" },
    activeOnly: true,
  },
  {
    key: "color",
    label: "Renkler",
    modelName: "color",
    // ⚠️ Renk `property:*` altında yönetiliyor — `color:read` diye bir kod YOK.
    permissions: ["property:read"],
    searchFields: ["name", "customerAliases.some.alias"],
    codeSearchFields: ["code"],
    select: { id: true, code: true, name: true, isActive: true },
    orderBy: { name: "asc" },
    activeOnly: true,
  },
  {
    key: "order",
    label: "Siparişler",
    modelName: "order",
    permissions: ["order:read"],
    searchFields: ["customer.name", "lines.some.item.name", "lines.some.customerItemName"],
    codeSearchFields: ["orderNumber"],
    select: {
      id: true,
      orderNumber: true,
      status: true,
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  {
    key: "workOrder",
    label: "İş Emirleri",
    modelName: "workOrder",
    permissions: ["workorder:read"],
    searchFields: ["targetItem.name", "targetColor.name"],
    codeSearchFields: ["workOrderNumber"],
    select: {
      id: true,
      workOrderNumber: true,
      status: true,
      targetItem: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  {
    key: "shipment",
    label: "Sevkiyatlar",
    modelName: "shipment",
    permissions: ["shipping:read", "shipping:write"],
    searchFields: ["customer.name", "plateNumber", "driverName", "carrier"],
    codeSearchFields: ["shipmentNo"],
    select: {
      id: true,
      shipmentNo: true,
      status: true,
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  {
    key: "sack",
    label: "Çuvallar",
    modelName: "sack",
    permissions: ["shipping:read", "shipping:write"],
    // ⚠️ METİN YOLU BİLEREK BOŞ. Çuval yalnız NUMARASIYLA anılır; müşteri adıyla
    // arayan zaten "Sevkiyatlar" kovasında cevabını alıyor. Buraya
    // `customer.name` koymak aynı soruya ikinci bir grup daha üretiyordu
    // (ölçüldü: "sahin" araması hem sevkiyatı hem çuvalı listeliyordu).
    searchFields: [],
    codeSearchFields: ["sackNo"],
    codeOnly: true,
    select: {
      id: true,
      sackNo: true,
      customer: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  },
  {
    key: "subcontractor",
    label: "Fason Firmalar",
    modelName: "subcontractor",
    permissions: ["subcontractor:read"],
    searchFields: ["name"],
    codeSearchFields: ["code", "taxNumber"],
    // Bağlı cari (fason = carinin rolü) alt satırda görünsün — kartın hangi cariye ait olduğu
    // paletten okunur; ayrı arama yolu AÇILMAZ (aynı ad iki grup üretirdi, çuval emsali).
    select: { id: true, code: true, name: true, isActive: true, customer: { select: { code: true, name: true } } },
    orderBy: { name: "asc" },
    activeOnly: true,
  },
  {
    key: "batch",
    label: "Partiler",
    modelName: "batch",
    // ⚠️ İZNİ DEĞİŞTİRME. Parti araması bugün `report:production` arkasında
    // (`reports/production.routes.ts`). Gevşetmek cazip ama YASAK: izin
    // uzlaştırması yalnız EKLER, mevcut kullanıcı atamalarını değiştirmez —
    // yani kodu gevşetmek `report:production` taşımayan herkese parti verisini
    // SESSİZCE açar. Değişecekse bilinçli bir veri migration'ı ister.
    permissions: ["report:production"],
    searchFields: [],
    codeSearchFields: ["batchNumber"],
    // Parti no `P01…P99` arasında DÖNER ve benzersiz DEĞİL — ad araması burada
    // anlamsız; yalnız kod-biçimli terimde koşar.
    codeOnly: true,
    select: {
      id: true,
      batchNumber: true,
      workOrder: { select: { workOrderNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  },
] as const;
