// =============================================================================
// UÇ → İŞ EYLEMİ KATALOĞU (izlenebilirlik B2, 2026-10-25)
// -----------------------------------------------------------------------------
// İşlem görünümünün başlık cümlesi: "Ahmet sevkiyatı onayladı" / reddedilen istekte
// "Ahmet sevkiyatı onaylamaya çalıştı — reddedildi: <neden> (<kod>)". Anahtar biçimi
// `request_traces.routeKey` ile AYNI: "<YÖNTEM> <normalizeKeyPath(mount + route.path)>".
// Katalogda olmayan uç kök kaydın anlatısına düşer (fail-open); kapsama cırcırı B4'te.
// =============================================================================

export interface UcEylemi {
  /** Başarılı istekte geçmiş zaman: "sevkiyatı onayladı". */
  fiil: string;
  /** Reddedilen istekte: "sevkiyatı onaylamaya çalıştı". */
  deneme: string;
}

const e = (fiil: string, deneme: string): UcEylemi => ({ fiil, deneme });

export const ROUTE_EYLEM_KATALOGU: Readonly<Record<string, UcEylemi>> = {
  // ── Cihaz birleştirme (D4)
  "POST /api/admin/devices/merge/preview": e("cihaz birleştirme önizlemesi aldı", "cihaz birleştirme önizlemesi almaya çalıştı"),
  "POST /api/admin/devices/merge": e("cihaz kopyalarını birleştirdi", "cihaz kopyalarını birleştirmeye çalıştı"),
  "POST /api/admin/devices/merge/:sourceId/undo": e("cihaz birleştirmesini geri aldı", "cihaz birleştirmesini geri almaya çalıştı"),
  "POST /api/admin/devices/proof-reset": e("cihazları yeniden bağlamak için kanıtı sıfırladı", "cihaz kanıtını sıfırlamaya çalıştı"),
  // ── Belge tasarımcısı
  "POST /api/document-templates/sistem-onizleme/:docType": e("sistem belge tasarımını önizledi", "sistem belge tasarımını önizlemeye çalıştı"),
  // ── Sipariş
  "POST /api/orders": e("sipariş oluşturdu", "sipariş oluşturmaya çalıştı"),
  "PATCH /api/orders/:id": e("siparişi düzenledi", "siparişi düzenlemeye çalıştı"),
  "DELETE /api/orders/:id": e("siparişi sildi", "siparişi silmeye çalıştı"),
  // ── Finans: dönem sonu hizmet faturası (H8)
  "POST /api/finance/invoices/service-period-draft": e("dönem sonu hizmet faturası taslağı oluşturdu", "dönem sonu hizmet faturası taslağı oluşturmaya çalıştı"),
  // ── Terbiye iş emri
  "POST /api/work-orders": e("terbiye iş emri açtı", "terbiye iş emri açmaya çalıştı"),
  "PATCH /api/work-orders/:id": e("terbiye iş emrini düzenledi", "terbiye iş emrini düzenlemeye çalıştı"),
  "PUT /api/work-orders/:id": e("terbiye iş emrini düzenledi", "terbiye iş emrini düzenlemeye çalıştı"),
  "POST /api/work-orders/:id/complete": e("terbiye iş emrini tamamladı", "terbiye iş emrini tamamlamaya çalıştı"),
  "POST /api/work-orders/:id/cancel": e("terbiye iş emrini iptal etti", "terbiye iş emrini iptal etmeye çalıştı"),
  "POST /api/work-orders/:id/split": e("terbiye iş emrini böldü", "terbiye iş emrini bölmeye çalıştı"),
  "POST /api/work-orders/:id/manual-move": e("topları elle taşıdı", "topları elle taşımaya çalıştı"),
  "DELETE /api/work-orders/:id": e("terbiye iş emrini sildi", "terbiye iş emrini silmeye çalıştı"),
  // ── Top
  "POST /api/rolls/initial-entry": e("top girişi yaptı", "top girişi yapmaya çalıştı"),
  "POST /api/rolls/:id/scrap": e("topu hurdaya ayırdı", "topu hurdaya ayırmaya çalıştı"),
  "POST /api/rolls/:id/customer-code": e("topa müşteri barkodu bağladı", "topa müşteri barkodu bağlamaya çalıştı"),
  "POST /api/rolls/:id/customer-code/revoke": e("topun müşteri barkodunu kaldırdı", "topun müşteri barkodunu kaldırmaya çalıştı"),
  "POST /api/finance/cari/:id/holds": e("cariye kilit koydu", "cariye kilit koymaya çalıştı"),
  "POST /api/finance/cari/holds/:holdId/release": e("cari kilidini açtı", "cari kilidini açmaya çalıştı"),
  "DELETE /api/rolls/:id": e("topu sildi", "topu silmeye çalıştı"),
  // ── Çuval / paketleme
  "POST /api/shipping/sacks": e("çuval açtı", "çuval açmaya çalıştı"),
  "POST /api/shipping/sacks/:id/scan": e("çuvala top okuttu", "çuvala top okutmaya çalıştı"),
  "POST /api/shipping/sacks/:id/weigh": e("çuvalı tarttı", "çuvalı tartmaya çalıştı"),
  "POST /api/shipping/sacks/:id/remove": e("çuvalı kaldırdı", "çuvalı kaldırmaya çalıştı"),
  "POST /api/shipping/sacks/:id/split": e("çuvalı böldü", "çuvalı bölmeye çalıştı"),
  "POST /api/shipping/sacks/:id/move-rolls": e("çuvaldaki topları taşıdı", "çuvaldaki topları taşımaya çalıştı"),
  "POST /api/shipping/rolls/:rollId/remove-from-sack": e("topu çuvaldan çıkardı", "topu çuvaldan çıkarmaya çalıştı"),
  "POST /api/shipping/rolls/:rollId/move-sack": e("topu başka çuvala taşıdı", "topu başka çuvala taşımaya çalıştı"),
  // ── Sevkiyat
  "POST /api/shipping/shipments": e("sevkiyat oluşturdu", "sevkiyat oluşturmaya çalıştı"),
  "POST /api/shipping/shipments/from-rolls": e("toplardan sevkiyat oluşturdu", "toplardan sevkiyat oluşturmaya çalıştı"),
  "POST /api/shipping/shipments/:id/add-sacks": e("sevkiyata çuval ekledi", "sevkiyata çuval eklemeye çalıştı"),
  "POST /api/shipping/shipments/:id/remove-sack": e("sevkiyattan çuval çıkardı", "sevkiyattan çuval çıkarmaya çalıştı"),
  "POST /api/shipping/shipments/:id/dispatch": e("sevkiyatı onayladı", "sevkiyatı onaylamaya çalıştı"),
  "POST /api/shipping/shipments/:id/cancel": e("sevkiyatı iptal etti", "sevkiyatı iptal etmeye çalıştı"),
  "POST /api/shipping/shipments/:id/undo-dispatch": e("sevkiyat onayını geri aldı", "sevkiyat onayını geri almaya çalıştı"),
  "POST /api/shipping/shipments/:id/invoice": e("sevkiyatı faturaladı", "sevkiyatı faturalamaya çalıştı"),
  // ── Kurşun metre defteri (H1)
  "POST /api/kursun-qc/meter-readings": e("kurşun metre okuması kaydetti", "kurşun metre okuması kaydetmeye çalıştı"),
  "POST /api/kursun-qc/meter-readings/:id/pin-ack": e("metre sapmasını süpervizör PIN'iyle onayladı", "metre sapmasını süpervizör PIN'iyle onaylamaya çalıştı"),
  "POST /api/kursun-qc/meter-readings/:id/office-ack": e("metre sapmasını ofisten onayladı", "metre sapmasını ofisten onaylamaya çalıştı"),
  // ── Gelen belge taslağı (D2)
  "POST /api/gelen-belge/taramalar": e("gelen belge fotoğrafı yükledi", "gelen belge fotoğrafı yüklemeye çalıştı"),
  "POST /api/gelen-belge/taramalar/:id/oku": e("gelen belge fotoğrafını okumaya gönderdi", "gelen belge fotoğrafını okumaya göndermeye çalıştı"),
  "POST /api/gelen-belge/irsaliyeler": e("gelen belge taslağı açtı", "gelen belge taslağı açmaya çalıştı"),
  "PATCH /api/gelen-belge/irsaliyeler/:id": e("gelen belge taslağını düzenledi", "gelen belge taslağını düzenlemeye çalıştı"),
  "PUT /api/gelen-belge/ayarlar": e("gelen belge ayarlarını değiştirdi", "gelen belge ayarlarını değiştirmeye çalıştı"),
  "DELETE /api/gelen-belge/irsaliyeler/:id": e("gelen belge taslağını sildi", "gelen belge taslağını silmeye çalıştı"),
  "POST /api/gelen-belge/irsaliyeler/:id/satirlar": e("gelen belge taslağına satır ekledi", "gelen belge taslağına satır eklemeye çalıştı"),
  "PATCH /api/gelen-belge/irsaliyeler/:id/satirlar/:lineId": e("gelen belge satırını düzeltti", "gelen belge satırını düzeltmeye çalıştı"),
  "DELETE /api/gelen-belge/irsaliyeler/:id/satirlar/:lineId": e("gelen belge satırını sildi", "gelen belge satırını silmeye çalıştı"),
  "POST /api/gelen-belge/irsaliyeler/:id/onay": e("gelen belgeyi onayladı (emanet top girişi)", "gelen belgeyi onaylamaya çalıştı"),
  "PATCH /api/gelen-belge/sablonlar/:code": e("gönderen şablonunu düzenledi", "gönderen şablonunu düzenlemeye çalıştı"),
  "PUT /api/gelen-belge/varsayilan-urunler/:customerId": e("müşterinin gelen belge varsayılan ürününü yazdı", "müşterinin gelen belge varsayılan ürününü yazmaya çalıştı"),
  "DELETE /api/gelen-belge/varsayilan-urunler/:customerId": e("müşterinin gelen belge varsayılan ürününü kaldırdı", "müşterinin gelen belge varsayılan ürününü kaldırmaya çalıştı"),
};

/** Uç anahtarı: `request_traces` ile aynı biçim. */
export function ucAnahtari(method: string, routeKey: string): string {
  return `${method.toUpperCase()} ${routeKey}`;
}

export function ucEylemi(method: string, routeKey: string): UcEylemi | null {
  return ROUTE_EYLEM_KATALOGU[ucAnahtari(method, routeKey)] ?? null;
}

// ─── Hata kodu → Türkçe neden ────────────────────────────────────────────────
// `details.code` önce; yoksa durum kodu. Bilinmeyen kod → durum kodunun genel nedeni.

export const ERROR_CODE_REASONS: Readonly<Record<string, string>> = {
  PERMISSION_DENIED: "bu işlem için yetkisi yok",
  MODULE_DISABLED: "ilgili modül kapalı",
  CONFLICT: "kayıt başka biri tarafından değiştirilmiş ya da durumu uygun değil",
  VALIDATION_ERROR: "girilen bilgiler geçersiz",
  LICENSE_NOT_ACTIVE: "lisans etkin değil",
  REASON_REQUIRED: "gerekçe girilmedi",
  REASON_CODE_INVALID: "gerekçe geçersiz",
  TEMPLATE_NOT_FOUND: "şablon bulunamadı",
  WORKORDER_DEAD: "terbiye iş emri kapalı",
  DISPATCH_CANCELLED: "sevk iptal edilmiş",
  LOGIN_LOCKED: "hesap geçici olarak kilitli",
  CLIENT_TOKEN_REVOKED: "aynı istek daha önce geri alınmış",
  // Ana veri arşiv kapısı (master-data-archive.helper) 409'u eşzamanlılık değil, canlı referans reddidir.
  MASTER_DATA_HAS_LIVE_REFERENCES: "canlı referansı olduğu için pasife alınamadı",
  ITEM_HAS_LIVE_REFERENCES: "canlı referansı olduğu için pasife alınamadı",
};

export const STATUS_REASONS: Readonly<Record<number, string>> = {
  400: "girilen bilgiler geçersiz",
  401: "oturum geçersiz",
  403: "bu işlem için yetkisi yok",
  404: "kayıt bulunamadı",
  409: "kayıt başka biri tarafından değiştirilmiş ya da durumu uygun değil",
  413: "gönderilen veri çok büyük",
  422: "işlem kurallara uymuyor",
  423: "kayıt kilitli",
  429: "çok sık istek gönderildi",
};

/** Reddin Türkçe nedeni. */
export function redNedeni(status: number, errorCode: string | null | undefined): string {
  if (errorCode && ERROR_CODE_REASONS[errorCode]) return ERROR_CODE_REASONS[errorCode];
  if (STATUS_REASONS[status]) return STATUS_REASONS[status];
  return status >= 500 ? "sunucu hatası" : "istek reddedildi";
}
