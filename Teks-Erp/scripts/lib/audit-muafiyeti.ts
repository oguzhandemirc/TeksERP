// =============================================================================
// AUDIT MUAFİYET BEYANI — "her CUD → AuditService.log()" kuralının İSTİSNALARI
// =============================================================================
// NEDEN BEYAN: kök kural "tek istisna UserPreference" diyordu ve bu cümle ÖLÇÜLDÜĞÜNDE
// YANLIŞ ÇIKTI (2026-09-14): CUD yapan 136 modelin 127'si audit yazıyor, DOKUZU sessiz.
// Sekizi meşru ama BEYANSIZDI — beyansız bir sessizlik, unutulmuş bir audit'ten ayırt
// edilemez. Liste bu yüzden var: sessizliğin GEREKÇESİNİ görünür kılar.
//
// ⚠️ AYRI TABLO, `DEFTER_BEYANI`ye eklenmez: o tablonun evreni append-only defter
// modelleridir ve oraya başka bir evrenin satırını koymak ölçümü kirletir (ölçüldü
// 2026-09-14: `Session` oraya yazılınca test script'lerinin oturum temizlikleri
// `test_defter_ters_yol §10b2`nin borcuna girdi — bir BEYAN başka bir kapının sayısını
// artırdı). Bir beyan tablosunun EVRENİ onun sözleşmesidir.
// =============================================================================

/**
 * Sessizliğin sınıfı — KAPALI küme, fail-closed: tanınmayan değer kırmızıdır.
 *
 *   KULLANICI_TERCIHI — kullanıcının kendi ekran tercihi; iş kararı değil, denetim konusu değil.
 *   TELEMETRI         — telemetri satırı (`defter.md` § Telemetri ≠ defter); budanır,
 *                       raporlanan hiçbir sayı ona bağlı değildir.
 *   KIMLIK_AKISI      — oturum/kimlik kaydı; "ne oldu" audit'in AUTH kategorisinde akar,
 *                       satırın kendi CUD'u ikinci bir iz üretmez.
 *   EBEVEYN_EYLEMDE   — satırı bir YARDIMCI yazar, audit ÇAĞIRAN eylemdedir (sevk · depo
 *                       hareketi · cari bakiye · içe aktarım). ⚠️ Bu sınıfın iddiası
 *                       ÖLÇÜLÜR: yazan dosyanın çağıranlarından en az biri audit taşımalı.
 *   SISTEM_ISI        — kullanıcı eylemi olmayan sistem işi (takvim üretimi); audit'in
 *                       öznesi olacak bir kullanıcı yoktur.
 */
export const AUDIT_MUAF_SINIFLARI = [
  "KULLANICI_TERCIHI", "TELEMETRI", "KIMLIK_AKISI", "EBEVEYN_EYLEMDE", "SISTEM_ISI",
] as const;
export type AuditMuafSinifi = (typeof AUDIT_MUAF_SINIFLARI)[number];

export interface AuditMuafiyeti {
  model: string;
  sinif: AuditMuafSinifi;
  /** Neden sessiz — ÖLÇÜMLE, yargıyla değil. */
  gerekce: string;
}

export const AUDIT_EXEMPT_MODELS: AuditMuafiyeti[] = [
  { model: "UserPreference", sinif: "KULLANICI_TERCIHI",
    gerekce: "kullanıcının kendi panel tercihi (kolon düzeni, filtre); hiçbir iş kararına ve hiçbir rapora girmez — kökün TEK beyanlı istisnası buydu" },
  { model: "ErrorReportEntry", sinif: "TELEMETRI",
    gerekce: "hata raporu kuyruğu (budanır); onayın kendisi SystemSetting üzerinden audit'li, kuyruk satırları hiçbir sayıya girmez" },
  { model: "EndpointLatencyDaily", sinif: "TELEMETRI",
    gerekce: "uç gecikme özeti; `defter.md` § Telemetri ≠ defter sınıfı, yaşa göre budanır ve TEK okuyucusu kendi servisidir" },
  { model: "LoginLockoutBucket", sinif: "KIMLIK_AKISI",
    gerekce: "giriş deneme kilidi kovasının kalıcı kopyası (anahtar SHA-256); deneme ve kilidin kendisi audit'in AUTH kategorisinde LOGIN_FAILED/LOGIN_LOCKED olarak yazılır, satırın CUD'u ikinci bir iz üretmez" },
  { model: "Session", sinif: "KIMLIK_AKISI",
    gerekce: "oturum kaydı; giriş/çıkış/iptal audit'in AUTH kategorisinde zaten yazılır, satırın kendi CUD'u ikinci bir iz üretmez" },
  { model: "DeviceBindingEvent", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "cihaz bağlama DEFTERİ — tek yazar `helpers/device-identity.helper.ts#writeBindingEventTx`; audit'i çağıran eylem basar (announce doğuşu · yeniden bağlama · talep · red · revoke · kalıcı silme, `device.service`/`device-rebind.service`)" },
  { model: "ServiceBillingLink", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "H7 hizmet işi ↔ fatura bağını `helpers/service-billing.helper` yazar/damgalar (fatura tx'i içinde); audit fatura eyleminde (`invoice.service` CREATE `serviceLinkCount` · iptal `serviceLinksRevoked`; fiyat yükte yok)" },
  { model: "ShipmentEvent", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "sevkiyat olay defteri satırını `helpers/shipment-event.helper` yazar; audit sevk eyleminde (`shipping.service`)" },
  { model: "EIrsaliyeEvent", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "e-İrsaliye olay defteri satırını `e-irsaliye/e-irsaliye-event.helper` yazar (durum claim'iyle aynı tx); audit geçişi başlatan eylemde (`e-irsaliye.service`, tableName `E_IRSALIYE`)" },
  { model: "WorkOrderCloseSnapshot", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "kapanış künyesini `helpers/workorder-close-snapshot.helper` COMPLETED claim'iyle aynı tx'te yazar; audit kapanışı yapan eylemde (elle Kapat · tambur/fason/kurşun son adım)" },
  { model: "WorkOrderEvent", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "iş emri hareket satırını `helpers/workorder-event.helper` yazar; audit değişikliği yapan eylemde (workorder · workorder-link · tambur · fason · kurşun); otomatik geçişlerin audit'i yoktu, defter onların TEK izidir" },
  { model: "SwatchEvent", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "kartela olay satırını `helpers/swatch-event.helper` durum claim'iyle aynı tx'te yazar; audit geçişi başlatan eylemde (kartela kabul/iptal/düşüm · çuval · sevkiyat)" },
  { model: "WarehouseMovement", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "stok defteri satırını `helpers/warehouse-ledger.helper` yazar; audit hareketi başlatan eylemde (envanter · iş emri · tambur · transfer)" },
  { model: "CariBalance", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "cari bakiye `helpers/finance.helper` ile türetilir; audit bakiyeyi değiştiren eylemde (tahsilat · ödeme · dönem kapanış)" },
  { model: "ImportRunLine", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "içe aktarım satırını `import/import-revert.branches` damgalar; audit geri sarma eyleminde (`import-revert.service`)" },
  { model: "FabricPropertyValue", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "özellik DEĞERİ ebeveyn özellikle birlikte yazılır; audit ebeveynin ucunda `tableName: \"FABRIC_PROPERTY\"` ile (route katmanı)" },
  { model: "PrintJob", sinif: "TELEMETRI",
    gerekce: "yazdırma geçmişi satırı (izlenebilirlik A1) — kendisi basımın izidir; iş ucunun audit'i (LABEL_PRINT_EVENT · TRAVELER_CARD) ayrıca yazılır, satırın CUD'u ikinci bir iz üretmez; yaşa göre budanır — `defter.md` § Telemetri ≠ defter" },
  { model: "RequestTrace", sinif: "TELEMETRI",
    gerekce: "istek başlığı (izlenebilirlik B1) — kendisi isteğin izidir; iş ucunun audit'i ayrıca yazılır ve `requestId` ile bağlanır, satırın CUD'u ikinci bir iz üretmez; yaşa göre budanır — `defter.md` § Telemetri ≠ defter" },
  { model: "SyncMark", sinif: "TELEMETRI",
    gerekce: "patron bulutu eşitleme işareti; satırı DB tetikleyicileri yazar (uygulama CUD'u değil), uygulamanın tek yazımı yaşa göre budamadır (src/cloud-sync/marks-pruning.ts) — `defter.md` § Telemetri ≠ defter" },
  { model: "SyncWatermark", sinif: "SISTEM_ISI",
    gerekce: "eşitleme filigranı (durum tablosu) — yazan eşitleme işidir (bulut onayından sonra), audit'in öznesi olacak bir kullanıcı yoktur; iş kaydı değildir" },
  { model: "ReportRun", sinif: "TELEMETRI",
    gerekce: "semantik rapor koşu ölçümü + iptal kimliği (durum/süre/satır sayısı; budanır, R1-ZAMAN) — tek yazıcısı semantik çalıştırıcı, hiçbir rapor sayısı ona bağlı değil; silinince raporlanan sayı değişmez — `defter.md` § Telemetri ≠ defter" },
  { model: "ReportSnapshot", sinif: "TELEMETRI",
    gerekce: "kayıtlı raporun \"bu hâlini sakla\" kopyası (R1-KAYIT, tek yazıcısı `rapor-snapshot.service.ts`): sayılar semantik katmanda yeniden hesaplanır, görüntü yalnız o anki sonucun kopyasıdır; silinince raporlanan hiçbir sayı değişmez, budanır (R1-ZAMAN) — `defter.md` § Telemetri ≠ defter" },
  { model: "ShiftInstance", sinif: "SISTEM_ISI",
    gerekce: "vardiya takvimi `jobs/shift-calendar.job` tarafından üretilir; kullanıcı eylemi yok, audit'in öznesi olacak kullanıcı da yok" },
  // bildirim: çekirdek tablolar (plan §3.4) — yazarları N1-MOTOR'da doğdu.
  { model: "NotificationOutbox", sinif: "TELEMETRI",
    gerekce: "bildirim kuyruğu satırını iş tx'inde `helpers/notification-emit.helper` yazar, dağıtıcı damgalar, 7 günde budanır; \"ne oldu\" iş kaydının kendi audit'indedir, hiçbir rapor sayısı bu satırdan türemez" },
  { model: "NotificationInbox", sinif: "TELEMETRI",
    gerekce: "kişisel gelen kutusu (dağıtıcı birleştirir, okundu/ertele kişinin kendi işaretidir); okunmuş 90 / okunmamış 180 günde budanır, raporlanan hiçbir sayı ona bağlı değildir" },
  { model: "NotificationDailyStats", sinif: "TELEMETRI",
    gerekce: "tercih önizlemesinin günlük sayacı (Karar Y3); yalnız \"haftada ~N\" tahmini besler, 35 günde budanır" },
  { model: "NotificationCondition", sinif: "SISTEM_ISI",
    gerekce: "koşul tarayıcısının (`jobs/notification-condition.job`) açık/çözülmüş durum satırı; kullanıcı eylemi yok, audit'in öznesi olacak kullanıcı da yok" },  // bildirim: F4 tercih katmanı (plan §3.3) — yazarları N4-MOTOR'da doğdu.
  { model: "NotificationPreference", sinif: "KULLANICI_TERCIHI",
    gerekce: "kişinin kendi bildirim tercihi (tür × kanal açık/kapalı, kapsam); yalnız kendi gelen kutusunu etkiler, hiçbir rapor sayısı türemez" },
  { model: "NotificationUserSetting", sinif: "KULLANICI_TERCIHI",
    gerekce: "kişinin sessiz saati, gün özeti saati ve ses tercihi; iş kararı değil" },
  { model: "RecordFollow", sinif: "KULLANICI_TERCIHI",
    gerekce: "kişinin kayıt takibi (oluşturan otomatik + elle takip/bırak); yalnız kime bildirim gideceğini daraltır/genişletir, iş kaydı değildir" },
];
