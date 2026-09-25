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
  { model: "EndpointLatencyDaily", sinif: "TELEMETRI",
    gerekce: "uç gecikme özeti; `defter.md` § Telemetri ≠ defter sınıfı, yaşa göre budanır ve TEK okuyucusu kendi servisidir" },
  { model: "Session", sinif: "KIMLIK_AKISI",
    gerekce: "oturum kaydı; giriş/çıkış/iptal audit'in AUTH kategorisinde zaten yazılır, satırın kendi CUD'u ikinci bir iz üretmez" },
  { model: "ShipmentEvent", sinif: "EBEVEYN_EYLEMDE",
    gerekce: "sevkiyat olay defteri satırını `helpers/shipment-event.helper` yazar; audit sevk eyleminde (`shipping.service`)" },
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
  { model: "ShiftInstance", sinif: "SISTEM_ISI",
    gerekce: "vardiya takvimi `jobs/shift-calendar.job` tarafından üretilir; kullanıcı eylemi yok, audit'in öznesi olacak kullanıcı da yok" },
];
