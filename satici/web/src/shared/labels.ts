// Kod değerlerinin ekran adları (tel değerleri Türkçe kod; ekranda okunur ad).
export const CLASS_LABEL: Record<string, string> = {
  URETIM: "Üretim",
  TEST: "Test / hazırlık",
  DR: "DR / soğuk yedek",
  DEMO: "Demo / deneme",
  BAYI: "Bayi / iş ortağı",
  BARINDIRILAN: "Barındırılan",
};

export const INSTALLATION_STATUS_LABEL: Record<string, string> = {
  ETKINLESMEDI: "Etkinleşmedi",
  ETKIN: "Etkin",
  DEVREDILDI: "Devredildi (DR)",
  IPTAL: "İptal",
};

export const SANCTION_LABEL: Record<string, string> = {
  K0: "K0 · Mesaj bandı",
  K1: "K1 · Güncelleme dondurma",
  K2: "K2 · Modül dondurma",
  K3: "K3 · Süreli kısıtlı kip",
  K4: "K4 · Anında kısıtlı kip",
  K5: "K5 · Anında tam durdurma",
  ZORLAMA: "Kip değişimi (gözlem/zorla)",
  GECERLILIK: "Geçerlilik bitişi",
  GERI_AL: "Geri alma",
};

export const MODULE_LABEL: Record<string, string> = {
  "production.enabled": "Üretim",
  "finance.enabled": "Finans",
  "ticaret.enabled": "Ticaret",
  "iplik.enabled": "İplik",
  "depo.multiEnabled": "Çoklu depo",
  "kumasTeknik.enabled": "Kumaş teknik",
  "tezgah.enabled": "Tezgah",
  "devere.enabled": "Devere",
  "dokuma.enabled": "Dokuma",
  "emanet.enabled": "Emanet",
  "patron-bulut": "Patron bulutu",
};

export const PRODUCTION_MODULE_KEY = "production.enabled";

export const ROLE_LABEL: Record<string, string> = {
  SATICI_YONETICI: "Satıcı yöneticisi",
  SATICI_OPERATOR: "Satıcı operatörü",
  BAYI: "Bayi",
};

export const PLANNED_STATUS_LABEL: Record<string, string> = { BEKLIYOR: "Bekliyor", UYGULANDI: "Uygulandı", IPTAL: "İptal" };
export const TRANSFER_STATUS_LABEL: Record<string, string> = { BEKLIYOR: "Onay bekliyor", ONAYLANDI: "Onaylandı", REDDEDILDI: "Reddedildi" };
export const INSTALLMENT_STATUS_LABEL: Record<string, string> = { BEKLIYOR: "Bekliyor", ODENDI: "Ödendi", GECIKTI: "Gecikti", IPTAL: "İptal" };
export const CODE_STATUS_LABEL: Record<string, string> = { AKTIF: "Aktif", KULLANILDI: "Kullanıldı", IPTAL: "İptal" };
export const COPY_ALERT_LABEL: Record<string, string> = {
  ZINCIR_CATALI: "Kira zinciri çatalı (iki makine)",
  PARMAK_IZI_UYUSMAZ: "Parmak izi uyuşmuyor",
  AYNI_PARMAK_IZI_TEKRAR: "Aynı parmak izi tekrarı (tam kopya şüphesi)",
  YABANCI_KIRA: "Yabancı kira (defterde olmayan kira sunuldu)",
  KIP_UYUSMAZ: "Kip uyuşmuyor (kira/durum silinmiş olabilir)",
  YABANCI_HAK: "Yabancı HAK (satıcı defterinde olmayan lisans belgesi)",
  YEREL_MUDAHALE: "Yerel müdahale şüphesi (lisans izleri)",
};
/** Yerel müdahale nedenleri — sunucu `LOCAL_INTERVENTION_CAUSES` aynası (mirrors.test.ts, iki yönlü). */
export const LOCAL_INTERVENTION_CAUSE_LABEL: Record<string, string> = {
  SIRA_GERILEDI: "Durum kaydı sırası geriledi",
  SIRA_SIFIRLANDI: "Durum kaydı sıfırlandı (izler silinmiş)",
  LISANS_IZI_KAYIP: "Lisans izi kayıp — kira, durum kaydı ya da DB izinden en az biri yok",
  IPTAL_BELGESI_KAYIP: "İptal belgesi kayıp — iki kopya da gereken sıranın altında",
  BELIRSIZLIK: "Süren ölçülemedi > 7 gün",
  SAAT_SAPMASI: "Saat sapması ≥ 1 saat",
  YETENEK_DUSUSU: "Yetenek düşüşü (HAK teslim edilmedi, kök imzası kuyrukta)",
};
/** Kapanış kirası nedeni — protokol `CLOSING_LEASE_REASONS` aynası. */
export const CLOSING_REASON_LABEL: Record<string, string> = {
  KOPYA: "kopya (çatal)",
  TASIMA: "taşınmış eski anahtar",
  IPTAL: "iptal edilmiş kurulum",
};
/** Ödenmiş tarihin (P) kaynağı — sunucu `PaidThroughKind` aynası. */
export const PAID_THROUGH_KIND_LABEL: Record<string, string> = {
  SOZLESME_SONU: "sözleşme sonu",
  TAKSIT: "sıradaki taksit vadesi",
  SURESIZ: "süresiz",
};
export const LEASE_DECISION_LABEL: Record<string, string> = {
  ETKINLESTIRME: "Etkinleştirme",
  NORMAL: "Normal",
  YAKALA: "Yakala (geride kalmış uç)",
  CATAL: "Çatal (kopya şüphesi)",
  TASIMA: "Taşıma",
  KAPANIS: "Kapanış kirası",
  DOSYA: "Uzatma dosyası",
};

/** Donanım talebinin türü / durumu — Prisma `DonanimTalebiTuru` / `DonanimTalebiDurumu` aynası (mirrors.test.ts, iki yönlü). */
export const HARDWARE_REQUEST_KIND_LABEL: Record<string, string> = {
  DONANIM: "Donanım değişikliği",
  ZAYIF_TANIMA: "Zayıf tanıma (etkinleştirme)",
};
export const HARDWARE_REQUEST_STATUS_LABEL: Record<string, string> = {
  BEKLIYOR: "Onay bekliyor",
  ONAYLANDI: "Onaylandı",
  REDDEDILDI: "Reddedildi",
};
/** Parmak izi etkenleri (ekran adı) ve karşılaştırma durumu — sunucu `FACTOR_STATES` aynası (fingerprint-policy.ts). */
export const FINGERPRINT_FACTOR_LABEL: Record<string, string> = {
  f1: "Makine kimliği",
  f2: "SMBIOS UUID",
  f3: "Sistem diski",
  f4: "Anakart/BIOS seri no",
  f5: "PostgreSQL kimliği",
};
export const FACTOR_STATE_LABEL: Record<string, string> = {
  AYNI: "aynı",
  FARKLI: "farklı",
  KAYIP: "kayıp (okunamıyor)",
  YENI: "yeni okundu",
  YOK: "okunamıyor",
};
/** Kök imzası talebinin durumu — Prisma `HakKokTalebiDurumu` aynası (mirrors.test.ts, iki yönlü). */
export const ROOT_REQUEST_STATUS_LABEL: Record<string, string> = {
  BEKLIYOR: "Kök imzası bekliyor",
  IMZALANDI: "İmzalandı",
  IPTAL: "İptal",
  ESKIDI: "Eskidi (HAK başka sürüme geçti)",
};
/** HAK imza planı (yetenek kapısı) — sunucu `SignerPlanKind` aynası (entitlement-policy.ts; mirrors.test.ts, iki yönlü). */
export const SIGNER_PLAN_LABEL: Record<string, string> = {
  ARA: "Ara imzacı",
  KOK: "Kök anahtar",
  KUYRUK: "Kök imzası kuyruğu",
};
/** Planın KUYRUK nedeni — sunucu `EntitlementSignerPlan` KUYRUK `reason` aynası. */
export const SIGNER_PLAN_REASON_LABEL: Record<string, string> = {
  YETENEK_YOK: "kurulumun derlemesi ara imzalı HAK'ı tanımıyor (hak-ara yeteneği bildirmedi)",
  ARA_IMZACI_YOK: "bu sınıf için geçerli ara imzacı yüklü değil",
};
/** Satıcı imza anahtarının türü / künye durumu — Prisma `AnahtarTuru` / `AnahtarDurumu` aynası. */
export const KEY_KIND_LABEL: Record<string, string> = {
  KOK: "Kök",
  ALT: "Alt (kira imzası)",
  INDIRME: "İndirme belirteci",
  BAYI: "Bayi",
  ARA: "Ara imzacı (HAK)",
};
export const KEY_STATUS_LABEL: Record<string, string> = { AKTIF: "Aktif", EMEKLI: "Emekli", IPTAL: "İptal" };
/** İptal belgesinin dağıtım engeli — sunucu `RevocationBlocker["tur"]` aynası (revocation.service.ts). */
export const REVOCATION_BLOCKER_LABEL: Record<string, string> = {
  HAK: "HAK sürümü iptal edilen anahtarla imzalı — ara imzacıyla yeniden basılmalı",
  ANAHTAR: "İptal edilen anahtar hâlâ yüklü — emekliye ayrılmalı",
};
/** Toplu yeniden basımın satır sonucu — sunucu `ReissueResult["durum"]` aynası (entitlement-issue.service.ts). */
export const REISSUE_STATUS_LABEL: Record<string, string> = { IMZALANACAK: "Yeniden basıldı", ATLANDI: "Atlandı" };
/** Bildirim olayları — sunucunun `NOTIFICATION_EVENTS` listesinin HER değeri (ayna: src/test/mirrors.test.ts). */
export const NOTIFICATION_EVENT_LABEL: Record<string, string> = {
  DESTEK_TALEBI: "Yeni destek talebi",
  KOPYA_SUPHESI: "Kopya şüphesi uyarısı",
  KOPYA_KIRA_REDDI: "Kopya şüphesi — kira verilmedi",
  TASIMA_TALEBI: "Taşıma talebi",
  DR_DEVRI: "DR devri",
  KURULUM_SESSIZ: "Kurulum ses vermiyor",
  KIRA_BITISI_YAKLASIYOR: "Kira bitişi yaklaşıyor",
  GECERLILIK_BITISI_YAKLASIYOR: "Geçerlilik bitişi yaklaşıyor",
  TAKSIT_VADESI_YAKLASIYOR: "Taksit vadesi yaklaşıyor",
  PLANLI_EYLEM_UYGULANDI: "Planlı eylem uygulandı",
  TAKSIT_GECIKTI: "Taksit gecikti",
  DENEME: "Deneme bildirimi",
  GUNCELLEME_TAMAMLANDI: "Sunucu güncellendi",
  GUNCELLEME_GERI_DONDU: "Sunucu güncellemesi geri döndü",
  GUNCELLEME_BASARISIZ: "Sunucu güncellemesi başarısız",
  YEREL_MUDAHALE_SUPHESI: "Yerel müdahale şüphesi",
  ANAHTAR_SURESI_BITIYOR: "İmza anahtarının süresi bitiyor",
  UZUN_UFUK_VERILDI: "Uzun çevrimdışı ufuk verildi",
  KOK_IMZASI_ACIL: "ACİL kök imzası gerekiyor",
  DONANIM_ONAYI_BEKLIYOR: "Donanım / zayıf tanıma onayı bekliyor",
  BAKIM_BITISI_YAKLASIYOR: "Bakım bitişi yaklaşıyor",
};
export const NOTIFICATION_CHANNEL_LABEL: Record<string, string> = { EPOSTA: "E-posta", TELEGRAM: "Telegram" };
export const NOTIFICATION_STATUS_LABEL: Record<string, string> = {
  BEKLIYOR: "Bekliyor",
  GONDERILIYOR: "Gönderiliyor",
  GONDERILDI: "Gönderildi",
  HATA: "Hata",
  KAPALI: "Kanal kapalı",
};
/** Kanal durumu (sunucu satırların sonucundan türetir). */
export const CHANNEL_HEALTH_LABEL: Record<string, string> = {
  CALISIYOR: "Çalışıyor",
  HATA: "Son gönderim hatalı",
  YAPILANDIRILMAMIS: "Kanal yapılandırılmamış",
  GONDERICI_YANITSIZ: "Gönderici yanıt vermiyor",
  SOHBET_TASINDI: "Telegram sohbeti süper gruba taşındı",
  BILINMIYOR: "Henüz bildirim yok",
};

export function label(map: Record<string, string>, v: string | null | undefined): string {
  if (!v) return "—";
  return map[v] ?? v;
}
