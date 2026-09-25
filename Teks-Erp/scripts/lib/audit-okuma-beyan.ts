// =============================================================================
// AUDIT OKUMA BEYANI — "audit yalnız ayak izidir" kuralının allowlist'i ve borcu
// Bekçi: scripts/test_audit_okuma_kaynagi.ts · kural: docs/kurallar/defter.md
// =============================================================================
// Çalışan programda `SystemLog`/`SystemLogArchive`i yalnız ayak izini bir İNSANA
// GÖSTEREN yüzeyler okur. Audit'ten karar, hesaplanan iş sayısı, durum, geri alma
// ya da join türetilmez; böyle bir ihtiyaç defter eksikliğidir → BORÇ satırı.
//
// ⚠️ YENİ SATIR YALNIZ YÖNETİCİ ONAYIYLA (1e). Satır eklemek kapıyı gevşetmektir;
// gerekçe "neden bu okuma ayak izini insana gösteriyor" sorusunu cevaplamalıdır.
// Kimlik `dosya#işlev` (sınıf.metot ya da üst düzey işlev adı); `adet` o işlevdeki
// okuma noktası sayısıdır ve bekçi EŞİTLİK ister — fazlası beyansız, eksiği ölü beyan.
// =============================================================================

/** Kapalı küme — ayak izini insana gösteren yüzey sınıfları. */
export const AYAK_IZI_SINIFLARI = [
  "DENETIM_EKRANI",     // denetim/aktivite ekranı, arşiv araması, son aktivite akışı
  "DENETIM_RAPORU",     // Raporlar › Denetim
  "KAYIT_GECMISI",      // ⓘ künye (kim oluşturdu/son değiştirdi) · kayıt geçmişi penceresi
  "YEDEK_ETKI_TANISI",  // geri yüklemede kaybolacak ayak izinin dökümü
  // Audit'in KENDİ yaşam döngüsü (arşive taşıma · sağlıktaki boyut göstergesi): satırı
  // taşır ya da sayar, hiçbir iş bilgisi türetmez (1e onayı 2026-09-25).
  "AUDIT_ALTYAPISI",
  // İstemci: uç adresini yalnız katalogda taşır (rapor kataloğu), çağırmaz ve veri
  // okumaz (1e onayı 2026-09-25).
  "KATALOG_BEYANI",
] as const;
export type AyakIziSinifi = (typeof AYAK_IZI_SINIFLARI)[number];

export interface AyakIziBeyani {
  /** Backend: `src/…/x.ts#Sinif.metot` · istemci: depo köküne göre dosya yolu. */
  yer: string;
  /** Backend: işlevdeki okuma noktası sayısı. İstemcide 1 (dosya düzeyi). */
  adet: number;
  sinif: AyakIziSinifi;
  gerekce: string;
}

export interface AuditOkumaBorcu {
  yer: string;
  adet: number;
  /** Borcu kapatacak dilim — `K-A<n>`. */
  dilim: string;
  /** Okunan bilgi hangi deftere/kalıcı kolona taşınacak. */
  hedef: string;
}

// ── BACKEND (Teks-Erp/src) ────────────────────────────────────────────────────
export const AYAK_IZI_OKUYUCULARI: readonly AyakIziBeyani[] = [
  { yer: "src/services/system-log.service.ts#SystemLogService.list", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "Sistem › Aktivite listesi ve son aktivite zili: satırı olduğu gibi gösterir" },
  { yer: "src/services/system-log.service.ts#SystemLogService.findById", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "aktivite ayrıntı paneli: tek satırın eski/yeni verisi" },
  { yer: "src/services/system-log.service.ts#SystemLogService.listArchive", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "arşiv araması: arşive taşınmış satırları gösterir" },
  { yer: "src/services/system-log.service.ts#SystemLogService.findArchiveById", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "arşiv ayrıntı paneli" },
  { yer: "src/services/system-log.service.ts#SystemLogService.listActiveUsers", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "aktivite süzgecinin kullanıcı seçenekleri — süzgeç doldurur, karar vermez" },
  { yer: "src/services/system-log.service.ts#SystemLogService.listActiveTables", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "aktivite süzgecinin tablo seçenekleri" },
  { yer: "src/services/reports/audit.report.service.ts#getSystemLogSummary", adet: 3, sinif: "DENETIM_RAPORU",
    gerekce: "Raporlar › Denetim › sistem kaydı özeti: ayak izinin kendisini sayar, iş sayısı değil" },
  { yer: "src/services/reports/audit.report.service.ts#getUserActivity", adet: 1, sinif: "DENETIM_RAPORU",
    gerekce: "Raporlar › Denetim › kullanıcı aktivitesi: kim kaç işlem yaptı (ayak izi hacmi)" },
  { yer: "src/services/record-info.service.ts#RecordInfoService.fromAudit", adet: 4, sinif: "KAYIT_GECMISI",
    gerekce: "ⓘ künyesi: kendi künye kolonu OLMAYAN tabloda kim oluşturdu/son değiştirdi (sıcak + arşiv); yanıt kaynağını `source` ile söyler" },
  { yer: "src/services/backup-impact.service.ts#COUNT_SPECS.run", adet: 1, sinif: "YEDEK_ETKI_TANISI",
    gerekce: "geri yüklemede kaybolacak audit satırı sayısı — insana gösterilir, geri yüklemeyi durdurmaz" },
  { yer: "src/services/backup-impact.service.ts#auditRollup", adet: 2, sinif: "YEDEK_ETKI_TANISI",
    gerekce: "kaybolacak ayak izinin tablo/işlem kırılımı (RestoreAuditDelta) + kapsamın alt sınırı (en eski satır; yoksa 'ölçülemedi')" },
  { yer: "src/services/audit.service.ts#AuditService.archiveOlderThan", adet: 1, sinif: "AUDIT_ALTYAPISI",
    gerekce: "6 aydan eski satırı arşive TAŞIR; audit'in kendi yaşam döngüsü, iş verisi türetmez" },
  { yer: "src/services/audit.service.ts#AuditService.getLogStats", adet: 1, sinif: "AUDIT_ALTYAPISI",
    gerekce: "sağlık ekranındaki audit boyutu ve en eski satır — audit'in kendi göstergesi" },
];

/**
 * Allowlist DIŞI iş okumaları — BORÇ. Her satır bir defter eksikliğidir; hedef 0.
 * Borç kapatıldığında satır düşer ve `AUDIT_OKUMA_BORC_TABANI` iner (tabanı 1e yazar).
 */
export const AUDIT_OKUMA_BORCU: readonly AuditOkumaBorcu[] = [
  { yer: "src/services/inventory.service.ts#InventoryService.isUndoSourcedByAudit", adet: 2, dilim: "K-A2",
    hedef: "iptalin geri alma kaynağı topun kalıcı damgasından (`cancelReasonCode`); damgasız eski kayıtlar dry-run backfill" },
];

/** Borç okuma noktası sayısı (Σ adet) — yalnız 1e düşürür. */
export const AUDIT_OKUMA_BORC_TABANI = 2;

// ── GÖÇ İSTİSNASI (scripts/) ──────────────────────────────────────────────────
/**
 * Kuralın TEK istisnası: geçmişi yeni bir deftere/kalıcı kolona BİR KEZ aktaran,
 * beyanlı ve tarihli göç script'i (çalışan program değil). Yeni satır yalnız 1e
 * onayıyla; bekçi dosyanın var olduğunu ve GERÇEKTEN audit okuduğunu ölçer.
 */
export interface GocIstisnasi {
  dosya: string;
  tarih: string;
  durum: "ONAYLI" | "KARAR_BEKLIYOR";
  hedef: string;
  gerekce: string;
}
export const AUDIT_GOC_ISTISNALARI: readonly GocIstisnasi[] = [
  { dosya: "scripts/backfill_roll_fold_and_reason.ts", tarih: "2026-09-25", durum: "ONAYLI",
    hedef: "Roll.entryReason (K-A1)",
    gerekce: "kolondan (2026-08-04) önce elle doğan topların sebebi yalnız audit'te; yayın günü kuru → onay → --apply, sonra servis kolondan okur" },
  { dosya: "scripts/backfill_roll_status_events.ts", tarih: "2026-09-25", durum: "ONAYLI",
    hedef: "RollStatusEvent iptal satırları, ② geçiş (K-A3b)",
    gerekce: "kolonda aktörü olmayan eski iptallerin aktör + anı yalnız audit'te (eski dökümün yüklemi); preEpochSource=AUDIT ile ayrışır, yayın günü bir kez" },
  { dosya: "scripts/fix_tambur_undo_cancel_marker.ts", tarih: "2026-09-25", durum: "KARAR_BEKLIYOR",
    hedef: "Roll.cancelReasonCode = TAMBUR_GERI_ALMA (K-A2)",
    gerekce: "damgasız eski tambur geri alma parçaları yalnız audit'ten tanınıyor; 2026-08-29 kullanıcı kararı 'uygulanmayacak' — K-A2 kararı kullanıcıda" },
];

// ── İSTEMCİ (Electron/src · mobil/src) ────────────────────────────────────────
/**
 * Audit verisi dönen uçlar — istemci literalinde aranır. Her desen canlı bir
 * backend yoluna karşılık gelir (bekçi §6 ölçer).
 */
export const AUDIT_UCLARI: readonly { desen: RegExp; backendDosya: string; backendYol: string }[] = [
  { desen: /\/api\/admin\/system-logs\b/, backendDosya: "src/routes/admin.routes.ts", backendYol: "\"/system-logs\"" },
  { desen: /\/api\/record-info\b/, backendDosya: "src/routes/record-info.routes.ts", backendYol: "\"/:table/:id\"" },
  { desen: /^audit\/[a-z-]+$|\/api\/reports\/audit\//, backendDosya: "src/routes/reports/audit.routes.ts", backendYol: "\"/system-log-summary\"" },
  { desen: /\/restore-impact\b/, backendDosya: "src/routes/admin.routes.ts", backendYol: "\"/backups/:name/restore-impact\"" },
];

/** Yalnız audit ucu saran istemci modülleri — onları içe aktaran dosya da okuyucudur. */
export const AUDIT_ISTEMCI_MODULLERI: readonly string[] = [
  "Electron/src/services/systemLogService",
  "Electron/src/pages/Reports/Audit/service",
];

export const ISTEMCI_AYAK_IZI: readonly AyakIziBeyani[] = [
  { yer: "Electron/src/services/systemLogService.ts", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "/api/admin/system-logs istemcisi" },
  { yer: "Electron/src/pages/System/Activity/ActivityPage.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "Sistem › Aktivite" },
  { yer: "Electron/src/pages/System/Activity/ActivityFilters.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "aktivite süzgeç seçenekleri" },
  { yer: "Electron/src/pages/System/Activity/ActivityDetailSheet.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "aktivite ayrıntısı" },
  { yer: "Electron/src/pages/System/Archive/ArchiveSearchPage.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "arşiv araması" },
  { yer: "Electron/src/pages/System/Archive/ActivityArchivePage.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "arşive taşıma ekranı" },
  { yer: "Electron/src/pages/System/Events/SystemEventsPage.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "sistem olayları listesi" },
  { yer: "Electron/src/pages/System/Events/SystemEventDetailSheet.tsx", adet: 1, sinif: "DENETIM_EKRANI", gerekce: "sistem olayı ayrıntısı" },
  { yer: "Electron/src/components/layout/NotificationBell.tsx", adet: 1, sinif: "DENETIM_EKRANI",
    gerekce: "son aktivite zili: son satırları listeler; rozet yalnız 'görülmemiş satır' sayısıdır, iş sayısı değil" },
  { yer: "Electron/src/components/RecordHistoryDialog.tsx", adet: 1, sinif: "KAYIT_GECMISI", gerekce: "kaydın değişiklik geçmişi penceresi" },
  { yer: "Electron/src/components/RecordInfoButton.tsx", adet: 1, sinif: "KAYIT_GECMISI", gerekce: "ⓘ künye düğmesi" },
  { yer: "Electron/src/pages/Reports/Audit/service.ts", adet: 1, sinif: "DENETIM_RAPORU", gerekce: "denetim raporları istemcisi" },
  { yer: "Electron/src/pages/Reports/Audit/SystemLogSummaryPage.tsx", adet: 1, sinif: "DENETIM_RAPORU", gerekce: "sistem kaydı özeti raporu" },
  { yer: "Electron/src/pages/Reports/Audit/UserActivityPage.tsx", adet: 1, sinif: "DENETIM_RAPORU", gerekce: "kullanıcı aktivitesi raporu" },
  { yer: "Electron/src/pages/Reports/Audit/systemLogSummaryExport.ts", adet: 1, sinif: "DENETIM_RAPORU", gerekce: "sistem kaydı özeti Excel çıktısı" },
  { yer: "Electron/src/pages/Reports/Audit/userActivityExport.ts", adet: 1, sinif: "DENETIM_RAPORU", gerekce: "kullanıcı aktivitesi Excel çıktısı" },
  { yer: "Electron/src/pages/System/Backups/service.ts", adet: 1, sinif: "YEDEK_ETKI_TANISI", gerekce: "geri yükleme etki ucu (karma modül: yedek listesi + etki)" },
  { yer: "Electron/src/lib/report-catalog.ts", adet: 1, sinif: "KATALOG_BEYANI", gerekce: "rapor kataloğu uç adresini taşır, çağırmaz" },
];
