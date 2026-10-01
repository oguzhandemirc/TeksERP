// Fabrika lisans API'si (`/api/license/*`) yanıt tipleri — backend
// `services/license-view.service.ts` + `license.service.ts` aynası
// (docs/design/LISANS-PROTOKOLU.md §14). Ayrışırsa backend kazanır.

export type StateTier = "NORMAL" | "UYARI" | "EK_SURE" | "KISITLI" | "DURDURULMUS";
export type LicenseMode = "gozlem" | "zorla";
export type Validity = "GECERLI" | "GECERSIZ" | "OLCULEMEDI";
export type LicenseClass = "URETIM" | "TEST" | "DR" | "DEMO" | "BAYI" | "BARINDIRILAN";
export type SanctionLevel = "K0" | "K1" | "K2" | "K3" | "K4" | "K5";

export interface Banner {
  metin: string;
  ton: "bilgi" | "uyari" | "tehlike";
}

export interface LicenseStatusSummary {
  ayrinti: true;
  kip: LicenseMode;
  /** UYGULANAN kademe — gözlemde daima NORMAL. */
  kademe: StateTier;
  /** Uygulanan bant — gözlemde daima null. */
  bant: Banner | null;
  ekSureKalanGun: number | null;
  kisitlamaKalanGun: number | null;
  guncellemeIzni: boolean;
  sinif: LicenseClass | null;
  lisansNo: string | null;
  lisansSahibi: { musteri: string; tesis: string } | null;
  surum: string;
}
export type LicenseStatusResponse = LicenseStatusSummary | { ayrinti: false };

export type ModuleCeiling =
  | { applies: false }
  | { applies: true; allowed: string[] | null; denied: string[] };

export interface LicenseEffect {
  bant: Banner | null;
  guncellemeIzni: boolean;
  modulTavani: ModuleCeiling;
}

export interface LicenseProxySettings {
  kaynak: "panel" | "ortam" | "yok";
  /** Kimlik bilgisi maskeli. */
  adres: string | null;
  atla: string | null;
  destekleniyor: boolean;
}

export type FingerprintFactor = "f1" | "f2" | "f3" | "f4" | "f5";

export interface LicenseDetail {
  hazir: boolean;
  kurulum: {
    /** Lisans kimliği (D14; portalda doğar, lisans klasöründe). */
    kurulumId: string | null;
    /** DB `system.installationId`si — yalnız bilgi. Eski backend göndermez. */
    veritabaniKimligi?: string | null;
    anahtarKimligi: string | null;
    etkin: boolean;
    ilkAcilis: string | null;
  };
  depo: {
    dizin: string | null;
    sorun: "APP_ICINDE" | "YEDEK_ICINDE" | "OKUNAMADI" | "YAZILAMADI" | null;
    bozukAnahtarKenaraAlindi: boolean;
    durumKaydi: { gecerli: boolean; sira: number | null };
  };
  durum: {
    gecerlilik: Validity;
    nedenler: Array<{ kod: string; ayrinti: string | null }>;
    kip: LicenseMode;
    hesaplananKademe: StateTier;
    uygulananKademe: StateTier;
    hesaplanan: LicenseEffect;
    uygulanan: LicenseEffect;
    ekSureKalanGun: number | null;
    kisitlamaKalanGun: number | null;
    devredildi: boolean;
    yaptirimKademesi: SanctionLevel | null;
    saat: { guvenilir: string; kaynak: string; bulgu: string | null; bulguKaynagi: string | null };
    /**
     * Lisans v2 süre çapası — ödenmiş tarih (P; `tarih` null = süresiz). `null` = belgeler P taşımıyor,
     * eski çapa (kira bitişi/vade) işler. Eski backend göndermez.
     */
    odenmisTarih?: { tarih: string | null; kaynak: "ODEME" | "UFUK" | "SURESIZ"; sozlesmeSonu: boolean } | null;
    /** Son başarılı kira alışverişi (imzalı kiradan) ve "internet var" (son 24 saat). Eski backend göndermez. */
    baglanti?: { sonAlisveris: string | null; internetVar: boolean };
  };
  hak: {
    hakId: string;
    surum: number;
    lisansNo: string;
    musteri: { id: string; ad: string };
    tesis: { id: string; ad: string };
    sinif: LicenseClass;
    moduller: string[];
    kalici: boolean;
    bakimBitis: string;
    verilis: string;
    bayiId: string | null;
    /** HAK'ın çevrimdışı ufku (gün; null = süresiz). v1 HAK taşımaz. */
    cevrimdisiUfukGun?: number | null;
  } | null;
  kira: {
    kiraId: string;
    verilis: string;
    bitis: string;
    sunucuSaati: string;
    ekSureGun: number;
    zorlama: boolean;
    gecerlilikBitis: string | null;
    yaptirim: {
      kademe: SanctionLevel | null;
      mesaj: string | null;
      kisitlamaTarihi: string | null;
      donmusModuller: string[];
      guncellemeDonuk: boolean;
    };
    yoklamaAraligiDk: number;
    devredildi: boolean;
    kanal: { kod: string; guncelSurumler: { backend?: string; panel?: string; tablet?: string } };
    /** Kiradaki ödenmiş tarih beyanı (null = süresiz). v1 kira taşımaz. */
    odenmisTarih?: string | null;
  } | null;
  parmakIzi: {
    olculdu: string | null;
    /** Etken başına yalnız "ölçülebildi mi" — değer ve özet uca girmez. */
    olculen: Record<FingerprintFactor, boolean> | null;
    karar: "ESLESTI" | "ESLESMEDI" | "OLCULEMEDI" | null;
    eslesen: number | null;
    olculebilen: number | null;
    uyusmayan: string[];
    /** Etken başına çok yollu okuma raporu (K8: 24 sa önbellek). Eski backend göndermez. */
    okuma?: Record<FingerprintFactor, FingerprintFactorReport> | null;
    /** Kabul edilen kümede değeri olup 24 saattir hiçbir yoldan okunamayan etkenler. Eski backend göndermez. */
    kayip?: string[];
    onbellekBozuk?: boolean;
  };
  yoklama: {
    saticiYapilandirildi: boolean;
    saticiAdresi: string | null;
    sonDeneme: string | null;
    sonBasari: string | null;
    sonBasarisizlik: string | null;
    sonHataKodu: string | null;
    sonrakiDeneme: string | null;
    zil: {
      bagli: boolean;
      sonBaglanti: string | null;
      sonZil: string | null;
      sonKalpAtisi: string | null;
      sonHataKodu: string | null;
    };
  };
  /** `durum` ONAYLANDI: satıcı onayladı, taşıma kodu portaldan beklenir (D8). Eski backend göndermez. */
  tasima: { talepId: string; istendi: string; gerekce: string | null; durum?: "BEKLIYOR" | "ONAYLANDI" } | null;
  gozlem: { reddedilecekIstek: number; reddedilecekModul: number };
  proxy: LicenseProxySettings;
  /** Lisans çekirdeği + imzalı paket bütünlüğü (yalnız sayılar, dosya adı yok). Eski backend göndermez. */
  butunluk?: LicenseIntegrity;
  /** G4 güven zinciri (HAK imzacısı · kira ALT'ı · iptal belgesi). Eski backend göndermez. */
  zincir?: LicenseChain;
}

/** Backend `LicenseChainView` aynası (`license-chain-view.helper.ts`). */
export interface LicenseChain {
  hakImzacisi: {
    kind: "KOK" | "BAYI" | "ARA";
    kid: string;
    rootKid: string;
    sertifika: { sertifikaId: string; siniflar: string[]; baslangic: string; bitis: string } | null;
  } | null;
  kiraAlt: { kid: string; baslangic: string; bitis: string } | null;
  iptal: { sira: number | null; verilis: string | null; kayitSayisi: number | null; pin: number | null; durum: "GUNCEL" | "KAYIP" | "YOK" };
}

export type IntegrityStatus = "GECERLI" | "GECERSIZ" | "OLCULEMEDI" | "KAPSAM_DISI";

export interface LicenseIntegrity {
  cekirdek: "native" | "ts" | "yok";
  cekirdekNeden: string | null;
  zorunlu: boolean;
  durum: IntegrityStatus;
  kod: string | null;
  denetlendi: string | null;
  paketId: string | null;
  paketSurumu: string | null;
  derlemeTarihi: string | null;
  anahtar: string | null;
  sayilar: { dosya: number; eksik: number; degisik: number; fazla: number; okunamayan: number } | null;
  /** Bu paketin ilk uyuşmazlığı: ek süre buradan sayılır, yalnız yeni paket sıfırlar. */
  ilkUyusmazlik: string | null;
}

/** `donanim`: donanım değişikliği bildirimi zarfla (K8) — eski backend 400 döner (amaç tanınmaz). */
export type OfflinePurpose = "yokla" | "etkinlestir" | "donanim";

export interface LicenseOfflineRequest {
  amac: OfflinePurpose;
  zarf: string;
  gecerlilikSonu: string;
  hedefYol: string;
  hedefUrl: string | null;
  istekGovdesi: { v: 1; zarf: string };
  qrAdresi: string | null;
}

/** Etken okuma raporu — değer/özet yok: kaynak (bu ölçüm · ≤ 24 sa önbellek · yok), kazanan yol, son okuma. */
export interface FingerprintFactorReport {
  kaynak: "okundu" | "onbellek" | "yok";
  durum: "OKUNDU" | "DEGER_YOK" | "OKUNAMADI";
  yol: string | null;
  sonOkuma: string | null;
  celiski: string[];
  hatali: string[];
}

/** `POST /api/license/donanim-bildir` yanıtı (K8). */
export interface LicenseHardwareReportResult {
  talepId: string;
  durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  kayip: string[];
  lisans: LicenseDetail;
}

export interface LicenseTransferResult {
  talepId: string;
  durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  lisans: LicenseDetail;
}

export type PollOutcome = "YAPILANDIRILMAMIS" | "HAZIR_DEGIL" | "ETKIN_DEGIL" | "BASARILI" | "BASARISIZ";

export interface LicenseDataExportManifest {
  kademe: StateTier;
  yedekler: Array<{ ad: string; boyutBayt: number; zaman: string; sifreli: boolean; indirmeYolu: string }>;
  yollar: Record<"yedekAl" | "yedekListesi" | "yedekIndir" | "varliklar" | "disariAktar", string>;
}

// ── Sözleşme kabulü (Ek-7) — backend `services/license-acceptance.service.ts` aynası ──
/** Kabul metninin ekran blokları; metin backend'den gelir, panel KOPYALAMAZ. */
export type AcceptanceBlock =
  | { tur: "paragraf"; satirlar: string[] }
  | { tur: "liste"; maddeler: string[] }
  | { tur: "kutu"; no: string; metin: string }
  | { tur: "alanlar" }
  | { tur: "dugmeler" };

/** GECERLI: bu sunucu anahtarının son kabulü güncel metni kapsıyor. */
export type LicenseAcceptanceState = "GECERLI" | "YOK" | "METIN_DEGISTI" | "ANAHTAR_DEGISTI";

export interface LicenseAcceptanceRecord {
  kabulId: string;
  metinKimligi: string;
  metinOzeti: string;
  kutular: string[];
  adSoyad: string;
  unvan: string;
  kabulEden: { id: string; ad: string };
  anahtarKimligi: string;
  lisansKimligi: string | null;
  istemciSurum: string | null;
  sunucuSurum: string;
  zaman: string;
}

export interface LicenseAcceptanceView {
  metin: { kimlik: string; ozet: string; taslak: boolean; bloklar: AcceptanceBlock[]; kutular: string[] };
  durum: LicenseAcceptanceState;
  gecerli: LicenseAcceptanceRecord | null;
  kayitlar: LicenseAcceptanceRecord[];
  anahtarKimligi: string | null;
  oneri: { adSoyad: string | null };
}

export interface RecordLicenseAcceptanceInput {
  clientToken: string;
  metinKimligi: string;
  metinOzeti: string;
  kutular: string[];
  adSoyad: string;
  unvan: string;
}
