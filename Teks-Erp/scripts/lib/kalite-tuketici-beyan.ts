// =============================================================================
// KALİTE İKİZİ TÜKETİCİ BEYANI (KQ-D1, 2026-10-24)
// =============================================================================
// NEDEN BEYAN: KQ-D1'e kadar `stepCanApplyQuality`/`QUALITY_STATION_WHERE` adları
// AKIŞ sorusunu cevaplıyordu; D1 bu adlara MUAYENE anlamı verdi. Unutulan ya da
// sonradan kopyalanan bir akış çağrısı bu adlarla yazılırsa sessizce "muayene"
// sorusuna döner (Tambur dağıtım listesine düşer, KK2 kuyruğu boşalır…).
// Bu yüzden her kalite tüketicisi dosya + fonksiyon olarak beyan edilir;
// bekçi `test_station_quality_capability §11` iki yönlü ölçer: beyansız kullanım
// kırmızı, karşılığı kalmamış (ölü) beyan kırmızı.
//
// Fonksiyon adı = kullanımı saran en yakın adlandırılmış fonksiyon/metot
// (ok fonksiyonu ise atandığı değişken). `src/` göreli yol.
// =============================================================================

export interface KaliteTuketici {
  dosya: string;
  fonksiyon: string;
  /** Neden AKIŞ değil MUAYENE sorusu — tek cümle. */
  gerekce: string;
}

export const KALITE_TUKETICI_BEYANI: readonly KaliteTuketici[] = [
  {
    dosya: "services/quality-inspection.service.ts",
    fonksiyon: "evaluateInspection",
    gerekce: "K4P muayene yazımı/önizlemesi `stationId` verildiyse o istasyonda muayene açık olmalı (`stationCanInspect`); akış sorulmaz.",
  },
  {
    dosya: "services/kursun-qc.service.ts",
    fonksiyon: "reportError",
    gerekce: "KK2 hata YAZMA: akış adımında olmak yetmez, istasyonda muayene açık olmalı (kapalıysa eski APK yazması 400).",
  },
  {
    dosya: "services/kursun-qc.service.ts",
    fonksiyon: "assertDeleteStationInspects",
    gerekce: "Hata SİLME (KK2 + Tambur ortak ucu): silmenin yapıldığı istasyonda muayene açık olmalı; akış sorulmaz çünkü Tambur akışta değil.",
  },
  {
    dosya: "services/inventory.service.ts",
    fonksiyon: "kursunFinish",
    gerekce: "Panel kurşun bitirişinin hata LİSTESİ: liste doluysa adım istasyonunda muayene açık olmalı (bilinçli fark K2).",
  },
  {
    dosya: "services/tambur.service.ts",
    fonksiyon: "reportError",
    gerekce: "Tambur hata YAZMA: tür kontrolü ekran ailesini söyler, muayene yeteneği ayrıca sorulur.",
  },
  {
    dosya: "services/station-capability.service.ts",
    fonksiyon: "deriveCapabilityFlags",
    gerekce: "Panel/tablet yetenek DTO'sunun `inspectionEnabled` alanı; `canApplyQuality` akış ikizinde kalır.",
  },
  {
    dosya: "services/work-session.service.ts",
    fonksiyon: "withSessionCanInspect",
    gerekce: "K4P-KK1: oturum yanıtının `station.canInspect` alanı tabletin muayene düğmesini gösterir; akış sorulmaz.",
  },
];
