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
  ITEM: "Kumaş / Stok Kalemi",
  CUSTOMER: "Müşteri",
  CUSTOMER_BRANCH: "Müşteri Şubesi",
  CUSTOMER_ITEM_ALIAS: "Müşteri Kumaş Kodu",
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
  PRODUCT_RECIPE: "İş Emri Şablonu",
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

  // ---------------------------------------------------------------------------
  // TİCARET (ön muhasebe + satın alma + depo) — 2026-08-15
  // ---------------------------------------------------------------------------
  // ⚠️ `WAREHOUSE` BURADA "Depo" (tablo), `ENUM_LABELS`te "Depoda" (RollStatus).
  // İki AYRI harita, iki AYRI soru — "zaten var" sanıp atlama.
  INVOICE: "Fatura",
  PAYMENT: "Tahsilat / Ödeme",
  PAYMENT_ALLOCATION: "Fatura Kapama (Mahsup)",
  CHEQUE: "Çek / Senet",
  CHEQUE_DELIVERY_NOTE: "Çek Teslim Bordrosu",
  CARI_ACCOUNT: "Cari Hesap",
  CARI_PERIOD_CLOSE: "Cari Dönem Kapanışı",
  CASH_TRANSACTION: "Kasa Hareketi",
  CASH_PERIOD_CLOSE: "Kasa Dönem Kapanışı",
  CASH_BOX: "Kasa",
  BANK_ACCOUNT: "Banka Hesabı",
  EXCHANGE_RATE: "Döviz Kuru",
  RECONCILIATION_LETTER: "Mutabakat Mektubu",
  GOODS_RECEIPT: "Mal Kabul Fişi",
  PURCHASE_ORDER: "Alış Siparişi",
  ITEM_PRICE: "Ürün Fiyatı",
  STOCK_COUNT: "Stok Sayımı",
  STOCK_COUNT_LINE: "Stok Sayım Satırı",
  WAREHOUSE: "Depo",
  WAREHOUSE_TRANSFER: "Depo Transferi",
  YARN_MOVEMENT: "İplik Hareketi",

  // Fabrika tarafında da etiketsiz kalmış olanlar (aynı tarama).
  BATCH: "Parti",
  DIRECT_SHIPMENT: "Fasondan Doğrudan Sevk",
  ROLL_QTY_ADJUST: "Top Metraj Düzeltmesi",
  KURSUN_BYPASS_ASSIGNMENT: "Kurşun Makine Ataması",
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

  // Kumaş / miktar
  itemId: "Kumaş",
  itemCode: "Kumaş Kodu",
  itemName: "Kumaş Adı",
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

  // ---------------------------------------------------------------------------
  // TİCARET ALANLARI — 2026-08-15
  // ---------------------------------------------------------------------------
  docNo: "Belge No",
  issueDate: "Belge Tarihi",
  dueDate: "Vade Tarihi",
  receiptNo: "Fiş No",
  transferNo: "Transfer No",
  countNo: "Sayım No",
  orderNo: "Sipariş No",
  cariId: "Cari Hesap",
  supplierId: "Tedarikçi",
  warehouseId: "Depo",
  exchangeRate: "Kur",
  vatRate: "KDV Oranı",
  netAmount: "Net Tutar",
  allocatedTotal: "Kapatılan Tutar",
  balanceKg: "Bakiye (kg)",
  qtyKg: "Miktar (kg)",
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
  SACK: "Çuval",
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

  // ---------------------------------------------------------------------------
  // TİCARET ENUM DEĞERLERİ — 2026-08-15
  // ---------------------------------------------------------------------------
  // ⚠️ BU HARİTA DEĞER-KAPSAMLIDIR, alan-kapsamlı DEĞİL: aynı değer iki enum'da
  // birden geçebilir ve etiket HER İKİSİ İÇİN DE doğru olmak zorundadır. Bağlamı
  // satırın alan adı verir (`fieldLabel` → "Yön" / "Tür" / "Durum"):
  //   • IN/OUT   → PaymentDirection **ve** YarnMovementKind → "Giriş"/"Çıkış"
  //     (yön-nötr; "Tahsilat" yazmak iplik hareketinde düpedüz yanlış olurdu)
  //   • ISSUED   → ChequeStatus (verildi) **ve** ChequeKind (kendi çekimiz)
  //   • DRAFT    → InvoiceStatus **ve** StockCountStatus
  // İki değer farklı enum'larda ÇELİŞİRSE alan-kapsamlı ikinci bir katman
  // gerekir; bugün gerekmiyor ve gereksiz katman iki sözlüğü drift ettirir.
  // ⚠️ Zaten var olanları TEKRAR EKLEME: CANCELLED · COMPLETED · ACTIVE ·
  // CUSTOMER · SUBCONTRACTOR · OTHER · TRY/USD/EUR/GBP yukarıda tanımlı.

  // InvoiceStatus / StockCountStatus
  DRAFT: "Taslak",
  CONFIRMED: "Onaylandı",
  // InvoiceType
  SALES: "Satış Faturası",
  PURCHASE: "Alış Faturası",
  // PriceKind.SALE — `PURCHASE` ile ÇİFT DEĞİL: `SALE` yalnız PriceKind'da
  // geçer, dolayısıyla global etiketi çelişmez. Kardeşi `PURCHASE` ise
  // InvoiceType ile ÇAKIŞIR ve `FIELD_ENUM_OVERRIDES` ile ayrılır. Bu satır
  // olmadan bir SATIŞ fiyatı düzenlemesi denetimde ham "SALE" basıyordu.
  SALE: "Satış",
  SALES_RETURN: "Satış İadesi",
  PURCHASE_RETURN: "Alış İadesi",
  // PaymentDirection (Payment + CashTransaction) / YarnMovementKind
  IN: "Giriş",
  OUT: "Çıkış",
  // PaymentMethod
  CASH: "Nakit",
  BANK_TRANSFER: "Havale / EFT",
  CREDIT_CARD: "Kredi Kartı",
  // CashTxnKind
  EXPENSE: "Gider",
  INCOME: "Gelir",
  TRANSFER_IN: "Virman (gelen)",
  TRANSFER_OUT: "Virman (giden)",
  OPENING: "Açılış / Devir",
  // ChequeStatus (metinler `Cheques/labels.STATUS_LABEL` ile aynı anlamda)
  PORTFOLIO: "Elimizde (portföy)",
  AT_BANK: "Bankada (tahsilde)",
  ENDORSED: "Ciro edildi",
  COLLECTED: "Tahsil edildi",
  BOUNCED: "Karşılıksız",
  RETURNED: "İade edildi",
  PAID: "Ödendi",
  // ChequeKind — `ISSUED` ChequeStatus ile ORTAK; etiket ikisinde de doğru.
  RECEIVED: "Aldığımız",
  ISSUED: "Verdiğimiz (kendi çekimiz)",
  // PurchaseOrderStatus — `PO_STATUS_LABEL` ile aynı anlam; "Bekliyor"/"Tamamlandı"
  // burada PENDING/COMPLETED ile çakışacağı için ayırt edici yazıldı.
  OPEN: "Açık (mal bekleniyor)",
  PARTIAL: "Kısmen geldi",
  CLOSED: "Kapandı (tamamlandı)",
  // YarnMovementKind (düzeltme kayıtları)
  ADJUST_IN: "Düzeltme (giriş)",
  ADJUST_OUT: "Düzeltme (çıkış)",
};

// =============================================================================
// ALAN-KAPSAMLI İKİNCİ KATMAN — SADECE GERÇEK ÇELİŞKİLER İÇİN
// =============================================================================
// `ENUM_LABELS` DEĞER-kapsamlıdır ve paylaşılan değerlerin çoğunda bu doğrudur
// (IN/OUT hem PaymentDirection hem YarnMovementKind için "Giriş"/"Çıkış"tır).
// Ama iki değer farklı enum'larda GERÇEKTEN ÇELİŞİYORSA tek harita yalan söyler
// ve dosyanın kendi uyarısı bunu zaten öngörüyordu. 2026-08-15'te iki gerçek
// çelişki ölçüldü:
//
//   • `PURCHASE` → InvoiceType'ta "Alış Faturası" · PriceKind'da bir FATURA
//     DEĞİL bir fiyat türüdür. `ITEM_PRICE` audit'i `kind: PURCHASE|SALE`
//     yazıyor (`item-price.service`), yani bir fiyat düzenlemesinin diff'i
//     "Tür: Alış Faturası" basıyordu; kardeşi `SALE` ise haritada HİÇ yoktu →
//     aynı alanın iki değeri, biri yanlış Türkçe, diğeri ham İngilizce.
//   • `ISSUED` → ChequeKind'da "Verdiğimiz (kendi çekimiz)" · ChequeStatus'ta
//     "Verildi" (çek ekranının kendi sözlüğü: `Cheques/labels.STATUS_LABEL`).
//     İkisi AYNI tabloda yaşadığı için tablo-kapsamlı bir katman YETMEZ.
//
// ⚠️ ANAHTAR `TABLO.alan` — yalnız tablo yeterli değildir (CHEQUE hem `kind`
// hem `status` taşır), yalnız alan da yeterli değildir (`kind` bir düzine
// tabloda geçer). Bağlam `AuditDataBlock`a `tableName` prop'uyla girer.
// ⚠️ BU KATMAN KÜÇÜK KALMALI: her paylaşılan değer için satır eklemek iki
// sözlüğü kaçınılmaz olarak drift ettirir. Kural — yalnız ANLAMLARI ÇELİŞEN
// değerler buraya girer; anlamı ortak olan (IN/OUT, DRAFT) global haritada
// kalır. Bekçi: `audit-labels.trade.test.ts` (aile bazında, bağlamıyla ölçer).
const FIELD_ENUM_OVERRIDES: Record<string, Record<string, string>> = {
  // PriceKind.PURCHASE — fiyat KARTI türü; "fatura" kelimesi buraya girmez.
  // ⚠️ Kardeşi `SALE` burada YOK ve olmamalı: o değer yalnız PriceKind'da geçer,
  // yani global "Satış" etiketi zaten doğrudur. Global cevapla AYNI olan bir
  // override iki sözlüğü gereksizce drift ettirir (bekçi bunu reddeder).
  "ITEM_PRICE.kind": { PURCHASE: "Alış" },
  // ChequeStatus.ISSUED — çekin DURUMU ("verildi"), türü değil.
  // ⚠️ `CHEQUE.kind` bilerek override ALMAZ: global "Verdiğimiz (kendi
  // çekimiz)" onun için zaten doğrudur.
  "CHEQUE.status": { ISSUED: "Verildi" },
};

/** Audit değeri bağlamı — `tableName` yoksa yalnız global harita kullanılır. */
export interface EnumLabelContext {
  tableName?: string | null;
  field?: string | null;
}

export function enumValueLabel(value: string, ctx?: EnumLabelContext): string {
  if (ctx?.tableName && ctx.field) {
    const scoped = FIELD_ENUM_OVERRIDES[`${ctx.tableName}.${ctx.field}`]?.[value];
    if (scoped) return scoped;
  }
  return ENUM_LABELS[value] ?? value;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Bir audit alan değerini kullanıcıya okunur Türkçe metne çevirir:
 * null→"—", boolean→Evet/Hayır, ISO tarih→gg.AA.yyyy SS:dd, enum→Türkçe, aksi ham.
 * Nesne/dizi burada ele alınmaz (çağıran taraf ham JSON'a düşer).
 */
export function formatAuditValue(value: unknown, ctx?: EnumLabelContext): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) {
      const d = parseISO(value);
      if (isValid(d)) return format(d, "dd.MM.yyyy HH:mm", { locale: tr });
    }
    // ⚠️ Bağlam VARSA alan-kapsamlı katmandan geçer (çelişen enum değerleri);
    // yoksa bugünkü davranış birebir korunur.
    return enumValueLabel(value, ctx);
  }
  return String(value);
}
