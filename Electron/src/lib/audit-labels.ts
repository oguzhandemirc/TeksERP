// =============================================================================
// Audit (denetim) etiketleri — TEK KAYNAK.
// -----------------------------------------------------------------------------
// Backend audit kayıtları ham İngilizce tutar (tableName, action, oldData/newData
// alan adları + enum değerleri). Kullanıcıya gösterirken burada Türkçeleştirilir.
// Hem "Aktivite Günlüğü" (System/Activity) hem "Denetim Raporları" (Reports/Audit)
// bu haritalardan besleniyor — iki ayrı harita drift ederdi, artık tek kaynak.
//
// Bilinmeyen anahtar/enum → ham değer geri döner (yeni tablo eklenince ekranda
// görünür, sessizce kaybolmaz; buraya eklemek yeterli).
// =============================================================================

import { format, parseISO, isValid } from "date-fns";
import { tr } from "date-fns/locale";

/** Backend `tableName` → Türkçe modül adı. */
export const TABLE_LABELS: Record<string, string> = {
  // Sistem event kategorileri (tableName = kategori string'i)
  AUTH: "Kimlik Doğrulama",
  SYSTEM: "Sistem",

  // Master data
  USER: "Kullanıcı",
  ITEM: "Ürün / Stok Kalemi",
  CUSTOMER: "Müşteri",
  CUSTOMER_BRANCH: "Müşteri Şubesi",
  CUSTOMER_ITEM_ALIAS: "Müşteri Ürün Kodu",
  CUSTOMER_COLOR_ALIAS: "Müşteri Renk Kodu",
  STATION: "İstasyon",
  STATION_CAPABILITY: "İstasyon Yeteneği",
  MACHINE: "Makine",
  ROUTE: "Rota",
  COLOR: "Renk",
  FABRIC_PROPERTY: "Kumaş Özelliği",
  QUALITY_GRADE: "Kalite Sınıfı",
  DEFECT_TYPE: "Hata Tipi",
  RETURN_REASON: "İade Sebebi",
  PRODUCT_RECIPE: "Ürün Reçetesi",
  PERIPHERAL_DEVICE: "Saha Cihazı",

  // Sipariş & İş Emri
  ORDER: "Sipariş",
  ORDER_LINE: "Sipariş Satırı",
  WORK_ORDER: "İş Emri",
  WORK_ORDER_STEP: "İş Emri Adımı",
  MANIFEST: "Çeki Listesi",

  // Top & Üretim
  ROLL: "Top",
  ROLL_MOVEMENT: "Top Hareketi",
  ROLL_OPERATION: "Top İşlemi",
  ROLL_ERROR: "Top Hatası",
  ROLL_MANUAL_OVERRIDE: "Top Manuel Düzeltme",
  ROLL_RETURN: "Top İadesi",
  ROLL_SACK_ASSIGN: "Top → Çuval Atama",
  TRAVELER_CARD: "Refakat Kartı",
  TRAVELER_CARD_SCAN: "Refakat Kartı Okutması",

  // Fason akışı
  SUBCONTRACTOR: "Fason Firma",
  SUBCONTRACTOR_CATEGORY: "Fason Kategorisi",
  SUBCONTRACTOR_DISPATCH: "Fason Sevki",
  SUBCONTRACTOR_RECEIPT: "Fason Mal Kabul",

  // Kartela
  SWATCH: "Kartela",
  SWATCH_SACK_ASSIGN: "Kartela → Çuval",
  KARTELA_DISPATCH: "Kartela Sevki",
  KARTELA_RECEIPT: "Kartela Mal Kabul",

  // Paketleme & Sevkiyat
  SACK: "Çuval",
  SACK_SHIPMENT_ASSIGN: "Çuval → Sevkiyat",
  SHIPMENT: "Sevkiyat",
  SHIPMENT_LINE: "Sevkiyat Satırı",
  SHIPMENT_PLANNED_ORDER: "Sevkiyat Planlı Sipariş",
  packaging_queue: "Paketleme Kuyruğu",

  // Etiket & Baskı
  LABEL_TEMPLATE: "Etiket Şablonu",
  LABEL_TEMPLATE_VARIANT: "Etiket Şablon Varyantı",
  LABEL_PRINT_EVENT: "Etiket Baskısı",
  LABEL_NATIVE_PRINT: "Yazıcı Baskısı",
  PRINTED_DOCUMENT: "Basılı Belge",

  // Kullanıcı & Yetki
  USER_PASSWORD: "Kullanıcı Şifresi",
  USER_PREFERENCE: "Kullanıcı Tercihi",
  USER_PERMISSION: "Kullanıcı Yetkisi",
  USER_PERMISSION_SET: "Yetki Ataması",
  USER_QUICK_PIN: "Hızlı PIN",
  USER_CARD_TOKEN: "Kart Anahtarı",
  PERMISSION: "Yetki",
  PERMISSION_TEMPLATE: "Yetki Şablonu",
  SYSTEM_SETTING: "Sistem Ayarı",

  // Cihaz (mobil eşleştirme)
  users: "Kullanıcı",
  devices: "Cihaz",
  pairing_codes: "Eşleştirme Kodu",
  latency_stats: "Gecikme İstatistiği",
  sessions: "Oturum",
};

/** Ham tableName'i Türkçe etiketle. Boş → "—", bilinmeyen → ham değer. */
export function tableLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return TABLE_LABELS[raw] ?? raw;
}

/** oldData/newData içindeki İngilizce DB alan adı → Türkçe. Bilinmeyen → ham anahtar. */
export const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  createdAt: "Oluşturulma",
  updatedAt: "Güncellenme",
  deletedAt: "Silinme",
  isActive: "Aktif",
  name: "Ad",
  code: "Kod",
  description: "Açıklama",
  note: "Not",
  notes: "Not",
  status: "Durum",
  type: "Tür",
  kind: "Tür",
  reason: "Sebep",
  sortOrder: "Sıra",
  isDefault: "Varsayılan",
  color: "Renk",
  hex: "Renk (Hex)",

  // Ürün / miktar
  itemId: "Ürün",
  itemCode: "Ürün Kodu",
  itemName: "Ürün Adı",
  unit: "Birim",
  quantity: "Miktar",
  qty: "Miktar",
  orderedQty: "Sipariş Miktarı",
  packedQty: "Paketlenen",
  shippedQty: "Sevk Edilen",
  weight: "Ağırlık",
  width: "En",
  length: "Uzunluk",
  meters: "Metraj",
  meterage: "Metraj",
  price: "Fiyat",
  unitPrice: "Birim Fiyat",
  currency: "Para Birimi",

  // Renk
  colorId: "Renk",
  colorCode: "Renk Kodu",
  colorName: "Renk Adı",

  // Müşteri / sipariş
  customerId: "Müşteri",
  customerName: "Müşteri Adı",
  branchId: "Şube",
  companyType: "Firma Tipi",
  taxNumber: "Vergi No",
  taxOffice: "Vergi Dairesi",
  contactName: "İlgili Kişi",
  address: "Adres",
  orderId: "Sipariş",
  orderNumber: "Sipariş No",
  orderLineId: "Sipariş Satırı",
  cutNote: "Kesim Notu",
  pieceLengthM: "Parça Boyu (m)",

  // İş emri / üretim
  workOrderId: "İş Emri",
  batchNumber: "Parti No",
  stepId: "Adım",
  stationId: "İstasyon",
  stationKind: "İstasyon Türü",
  machineId: "Makine",

  // Top
  rollId: "Top",
  barcode: "Barkod",
  cardNumber: "Kart No",
  parentRollId: "Ana Top",
  parentReceiptId: "Ana Makbuz",
  entrySource: "Giriş Kaynağı",
  qualityGrade: "Kalite Sınıfı",
  qualityGradeId: "Kalite Sınıfı",
  targetStatus: "Hedef Durum",
  startMeter: "Başlangıç Metre",
  endMeter: "Bitiş Metre",
  defectType: "Hata Tipi",
  severity: "Şiddet",
  actionTaken: "Alınan Aksiyon",
  isProcessed: "İşlendi",

  // Çuval / sevkiyat
  sackId: "Çuval",
  shipmentId: "Sevkiyat",
  destination: "Varış",
  plateNumber: "Plaka",
  driverName: "Sürücü",
  manifestNo: "İrsaliye No",
  subcontractorId: "Fason Firma",
  categoryId: "Kategori",

  // Kullanıcı / yetki / cihaz
  userId: "Kullanıcı",
  username: "Kullanıcı Adı",
  firstName: "Ad",
  lastName: "Soyad",
  fullName: "Ad Soyad",
  email: "E-posta",
  phone: "Telefon",
  passwordHash: "Şifre (hash)",
  role: "Rol",
  permission: "Yetki",
  permissions: "Yetkiler",
  ipAddress: "IP Adresi",
  deviceId: "Cihaz",
  clientType: "İstemci",
};

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** Enum DEĞERLERİ (durum/tür kolonlarının içeriği) → Türkçe. Bilinmeyen → ham. */
export const ENUM_LABELS: Record<string, string> = {
  // StationKind / StationType
  RAW_QC: "Ham Kalite (KK1)",
  PROCESS_QC: "Kurşun + Kalite (KK2)",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  SHIPPING: "Sevkiyat",
  OTHER: "Diğer",
  INTERNAL: "İç",
  EXTERNAL: "Dış",
  // RollStatus
  STOCK: "Stok",
  IN_PRODUCTION: "Üretimde",
  SCRAP: "Fire",
  AT_SUBCONTRACTOR: "Fasonda",
  A1_STOCK: "2. Kalite Stok",
  RETURNED_FROM_SUBCONTRACTOR: "Fasondan Döndü",
  WAREHOUSE: "Depoda",
  SHIPPED: "Sevk Edildi",
  TAMBUR_CONSUMED: "Tamburda Bölündü",
  SUBCONTRACTOR_CONSUMED: "Fasonda Kapandı",
  AT_KARTELA: "Kartelada",
  KARTELA_CONSUMED: "Kartelada Kapandı",
  // RollOperationType
  KURSUN_APPLIED: "Kurşun Geçildi",
  QC2_COMPLETED: "KK2 Tamamlandı",
  TAMBUR_PROCESSED: "Tambur Kararı",
  SUBCONTRACTOR_SENT: "Fasona Sevk",
  SUBCONTRACTOR_RETURNED: "Fasondan Döndü",
  // RollEntrySource
  SUPPLIER_RECEIPT: "Tedarikçi Mal Kabul",
  MANUAL_ENTRY: "Manuel Giriş",
  TAMBUR_SPLIT: "Tambur Ayrımı",
  SUBCONTRACTOR_RETURN: "Fason Dönüşü",
  // ItemType / ItemUnit
  YARN: "İplik",
  FABRIC: "Kumaş",
  CONSUMABLE: "Sarf",
  MT: "Metre",
  KG: "Kilogram",
  ADET: "Adet",
  // CompanyType / ClientType / DeviceKind
  CUSTOMER: "Müşteri",
  SUPPLIER: "Tedarikçi",
  ELECTRON: "Masaüstü",
  MOBILE: "Mobil",
  TABLET: "Tablet",
  PHONE: "Telefon",
  DESKTOP: "Masaüstü",
  // OrderStatus / WorkOrderStatus / StepStatus (ortak durumlar dahil)
  PENDING: "Bekliyor",
  APPROVED: "Onaylandı",
  PARTIAL_SHIPPED: "Kısmi Sevk",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  ACTIVE: "Aktif",
  SKIPPED: "Atlandı",
  // WorkOrderType
  ORDER_PRODUCTION: "Siparişe Özel",
  STOCK_PRODUCTION: "Stoğa Üretim",
  // TravelerCardStatus / PrintedDocStatus
  REPRINTED: "Yeniden Basıldı",
  VOIDED: "İptal",
  SUPERSEDED: "Eski Versiyon",
  // ScanType
  ARRIVAL: "Varış",
  DEPARTURE: "Ayrılış",
  INFO: "Bilgi",
  // LabelKind / PrinterLanguage / MediaType / Orientation
  ROLL_RAW: "Ham Top",
  ROLL_FINISHED: "Bitmiş Top",
  SWATCH: "Kartela",
  RASTER_HTML: "Raster (HTML)",
  DIRECT_THERMAL: "Direkt Termal",
  THERMAL_TRANSFER: "Termal Transfer (Ribonlu)",
  PORTRAIT: "Dikey",
  LANDSCAPE: "Yatay",
  // ConnectionType / PeripheralKind / ReadMode
  NETWORK_TCP: "Ağ (TCP)",
  BLUETOOTH_SPP: "Bluetooth (SPP)",
  BLE: "Bluetooth LE",
  USB: "USB",
  SERIAL_COM: "Seri (COM)",
  LABEL_PRINTER: "Etiket Yazıcı",
  SCALE: "Kantar",
  METER: "Metre Sayacı",
  SIGNAL_SOURCE: "Sinyal Kaynağı",
  POLL: "Sorgulama",
  STREAM: "Akış",
  // RollErrorAction / DefectSeverity
  CUT: "Kesildi",
  NO_CUT: "Kesilmedi",
  MINOR: "Küçük",
  MAJOR: "Büyük",
  CRITICAL: "Kritik",
  // Currency
  TRY: "₺ TL",
  USD: "$ USD",
  EUR: "€ EUR",
  GBP: "£ GBP",
  // WorkSessionEndReason
  LOGOUT: "Çıkış",
  NEW_LOGIN: "Yeni Oturum",
  TAKEOVER: "Devralındı",
  IDLE: "Zaman Aşımı",
  ADMIN: "Panelden Kapatıldı",
  // ShipmentStatus / Destination
  DISPATCHED: "Sevk Edildi",
  DOMESTIC: "Yurtiçi",
  EXPORT: "İhracat",
  // PrintedDocType
  SHIPMENT_DISPATCH: "Sevk İrsaliyesi",
  SUBCONTRACTOR_DISPATCH: "Fason Sevk İrsaliyesi",
  KARTELA_DISPATCH: "Kartela Çeki Listesi",
  SUBCONTRACTOR_DIRECT_SHIP: "Fasondan Sevk",
  // SystemLog / Permission kategorileri (değer olarak da geçebilir)
  DOMAIN: "Veri Değişikliği",
  web: "Web",
  admin: "Yönetim",
};

export function enumValueLabel(value: string): string {
  return ENUM_LABELS[value] ?? value;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Bir audit alan değerini kullanıcıya okunur Türkçe metne çevirir:
 * null→"—", boolean→Evet/Hayır, ISO tarih→gg.AA.yyyy SS:dd, enum→Türkçe, aksi ham.
 * Nesne/dizi burada ele alınmaz (çağıran taraf ham JSON'a düşer).
 */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) {
      const d = parseISO(value);
      if (isValid(d)) return format(d, "dd.MM.yyyy HH:mm", { locale: tr });
    }
    return ENUM_LABELS[value] ?? value;
  }
  return String(value);
}
