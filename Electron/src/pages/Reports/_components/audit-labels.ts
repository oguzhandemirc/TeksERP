// Audit log tableName/category değerleri için Türkçe etiket eşleştirmesi.
// Backend audit kayıtlarında `tableName` ham (örn. "AUTH", "ROLL_SACK_ASSIGN")
// olarak tutulur — UI'da kullanıcıya gösterirken bu helper kullanılır.
//
// Bilinmeyen anahtar geldiğinde fallback olarak orijinal değer döner —
// gelecekte eklenen tabloların etiketlenmemiş hali ekranda görünür, bug raporu
// yerine bilgi olur.

const TABLE_LABEL: Record<string, string> = {
  // Sistem event'leri (category=AUTH/SYSTEM, tableName aynı string)
  AUTH: "Kimlik Doğrulama",
  SYSTEM: "Sistem",

  // Master Data
  ITEM: "Ürün",
  CUSTOMER: "Müşteri",
  COLOR: "Renk",
  DEFECT_TYPE: "Hata Tipi",
  FABRIC_PROPERTY: "Kumaş Özelliği",
  MACHINE: "Makine",
  QUALITY_GRADE: "Kalite Sınıfı",
  ROUTE: "Rota",
  STATION: "İstasyon",
  STATION_CAPABILITY: "İstasyon Yeteneği",
  SUBCONTRACTOR: "Fason Firma",
  SUBCONTRACTOR_CATEGORY: "Fason Kategorisi",

  // Sipariş & İş Emri
  ORDER: "Sipariş",
  ORDER_ALLOCATION: "Sipariş Tahsisi",
  OrderAllocation: "Sipariş Tahsisi",
  WORK_ORDER: "İş Emri",
  WORK_ORDER_STEP: "İş Emri Adımı",

  // Top & Üretim
  ROLL: "Top",
  ROLL_ERROR: "Top Hatası",
  ROLL_MANUAL_OVERRIDE: "Top Manuel Düzeltme",
  ROLL_OPERATION: "Top İşlemi",
  ROLL_SACK_ASSIGN: "Top → Çuval Atama",
  MANIFEST: "Çeki Listesi",

  // Fason Akışı
  SUBCONTRACTOR_DISPATCH: "Fason Sevki",
  SUBCONTRACTOR_RECEIPT: "Fason Mal Kabul",

  // Paketleme & Sevkiyat
  SACK: "Çuval",
  SACK_SHIPMENT_ASSIGN: "Çuval → Sevkiyat",
  SHIPMENT: "Sevkiyat",
  SHIPMENT_PLANNED_ORDER: "Sevkiyat Planlı Sipariş",
  packaging_queue: "Paketleme Kuyruğu",

  // Kartela
  SWATCH: "Kartela",
  SWATCH_SACK_ASSIGN: "Kartela → Çuval",

  // Refakat Kartı
  TRAVELER_CARD: "Refakat Kartı",
  TRAVELER_CARD_SCAN: "Refakat Kartı Okutması",

  // Kullanıcı & Yetki
  USER: "Kullanıcı",
  users: "Kullanıcı",
  USER_PASSWORD: "Kullanıcı Şifresi",
  USER_PERMISSION: "Kullanıcı Yetkisi",
  USER_PERMISSION_SET: "Kullanıcı Yetki Kümesi",
  PERMISSION_TEMPLATE: "Yetki Şablonu",

  // Cihaz (Mobil)
  devices: "Cihaz",
  pairing_codes: "Cihaz Eşleştirme Kodu",

  // Etiket
  LABEL_TEMPLATE: "Etiket Şablonu",
};

/** Ham tableName'i Türkçe etiketle. Bilinmeyen anahtar → ham değer geri döner. */
export function tableLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return TABLE_LABEL[raw] ?? raw;
}

/** Audit log action kodu (CREATE/UPDATE/DELETE) için Türkçe etiket. */
const ACTION_LABEL: Record<string, string> = {
  CREATE: "Oluştur",
  UPDATE: "Güncelle",
  DELETE: "Sil",
  LOGIN_SUCCESS: "Giriş Başarılı",
  LOGIN_FAILED: "Giriş Başarısız",
  LOGOUT: "Çıkış",
  STARTUP: "Sistem Başlangıcı",
  ERROR: "Sistem Hatası",
};

export function actionLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  return ACTION_LABEL[raw] ?? raw;
}
