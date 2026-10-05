// Portal JSON API yanıt biçimleri (satici/sunucu src/portal/queries.ts + rota yanıtları). Tarihler
// ISO dizge, kod değerleri Türkçe. Yalnız arayüzün okuduğu alanlar yazılı.

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export interface Ref {
  readonly id: string;
  readonly ad: string;
}

export interface Customer {
  readonly id: string;
  readonly ad: string;
  readonly vergiNo: string | null;
  readonly bayiId: string | null;
  readonly aktif: boolean;
  readonly createdAt: string;
  readonly bayi?: Ref | null;
  readonly _count?: { readonly tesisler: number };
}

export interface Site {
  readonly id: string;
  readonly musteriId: string;
  readonly ad: string;
  readonly aktif: boolean;
  readonly createdAt: string;
  readonly musteri?: Ref;
  readonly _count?: { readonly kurulumlar: number };
}

export interface CustomerDetail extends Customer {
  readonly tesisler: Site[];
}

export interface EntitlementSummary {
  readonly id: string;
  readonly lisansNo: string;
  readonly guncelSurum: number;
  readonly moduller: string[];
  readonly kalici: boolean;
  readonly bakimBitis: string;
  readonly gecerlilikBitis: string | null;
  /** Lisans v2 (satıcı künyesi): çevrimdışı ufuk (gün) — null + süresiz değil = v1 HAK (alan basılmadı). */
  readonly cevrimdisiUfukGun?: number | null;
  readonly cevrimdisiUfukSuresiz?: boolean;
  /** HAK `kipAltSiniri: "zorla"` — fabrika gözlem kipine inemez. */
  readonly kipAltSiniriZorla?: boolean;
}

export interface Installation {
  readonly id: string;
  readonly tesisId: string;
  readonly kurulumId: string;
  readonly ad: string | null;
  readonly sinif: string;
  readonly kanalKodu: string;
  readonly durum: "ETKINLESMEDI" | "ETKIN" | "DEVREDILDI" | "IPTAL";
  readonly anahtarKimligi: string | null;
  readonly zorlama: boolean;
  readonly yoklamaAraligiDk: number;
  /** Patron bulutu eşitleme aralığı (dk, 1–60) — kiraya basılır. */
  readonly esitlemeAraligiDk: number;
  /** Buluttaki geçmişin saklama süresi (ay: 3 · 13 · 25); null = tüm geçmiş. */
  readonly bulutSaklamaAy: number | null;
  readonly platform: string | null;
  readonly sonOrtam: Record<string, unknown> | null;
  readonly sonSaglik: Record<string, unknown> | null;
  readonly sonYoklamaZamani: string | null;
  readonly etkinlesmeZamani: string | null;
  readonly aktif: boolean;
  readonly createdAt: string;
  readonly kabulEdilenParmakIzi?: Record<string, string | null> | null;
  /** Lisans v2: kurulumun son bildirdiği lisans yetenekleri (yoklama/etkinleştirme yazar). */
  readonly yetenekler?: readonly string[];
  /** İmzalı durum kaydının son bildirilen sırası (gerilemesi yerel müdahale şüphesi). */
  readonly sonDurumSirasi?: number | null;
  /** Parmak izi v2: zincir sahibinin son yoklamasının kayıp etkenleri (24 saattir okunamayan). */
  readonly sonKayipEtkenler?: readonly string[];
  readonly tesis: { readonly id: string; readonly ad: string; readonly musteri: { readonly id: string; readonly ad: string; readonly bayiId: string | null } };
  readonly haklar: EntitlementSummary[];
  readonly _count: { readonly kopyaUyarilari: number; readonly tasimalar: number };
}

export interface EntitlementVersion {
  readonly id: string;
  readonly surum: number;
  readonly imzalayanKid: string;
  readonly verilis: string;
  /** Uzun çevrimdışı ufuk (400 günü aşan ya da süresiz) bu sürümle verildi (yalnız satıcı künyesi). */
  readonly uzunUfuk?: boolean;
  readonly sebep: string;
  readonly yapan: string;
  readonly createdAt: string;
}

export interface ActivationCodeRow {
  readonly id: string;
  readonly kodSonu: string;
  readonly durum: string;
  readonly gecerlilikBitis: string;
  readonly kullanimZamani: string | null;
  readonly yapan: string;
  readonly createdAt: string;
}

export interface SanctionAction {
  readonly id: string;
  readonly kurulumId: string;
  readonly tur: string;
  readonly parametre: Record<string, unknown>;
  readonly sebep: string;
  readonly yapan: string;
  readonly geriAlinanEylemId: string | null;
  readonly planliEylemId: string | null;
  readonly createdAt: string;
}

export interface SanctionState {
  readonly kademe: string | null;
  readonly mesaj: string | null;
  readonly kisitlamaTarihi: string | null;
  readonly donmusModuller: string[];
  readonly guncellemeDonuk: boolean;
}

export interface Lease {
  readonly id: string;
  readonly karar: string;
  /** Yalnız kapanış kirasında (karar KAPANIS): KOPYA · TASIMA · IPTAL. */
  readonly kapanisNedeni?: string | null;
  readonly oncekiKiraId: string | null;
  readonly anahtarKimligi: string;
  readonly hakSurum: number;
  readonly verilis: string;
  readonly bitis: string;
  readonly createdAt: string;
}

export interface PollRow {
  readonly id: string;
  readonly sonuc: string;
  readonly kiraId: string | null;
  readonly durum: Record<string, unknown>;
  readonly saat: Record<string, unknown>;
  readonly gozlem: Record<string, unknown>;
  readonly createdAt: string;
}

export interface CopyAlert {
  readonly id: string;
  readonly kurulumId: string;
  readonly tur: string;
  readonly durum: "ACIK" | "KAPANDI";
  readonly ilkGorulme: string;
  readonly sonGorulme: string;
  readonly gorulmeSayisi: number;
  readonly redZamani: string | null;
  readonly kapanisZamani: string | null;
  readonly kapatan: string | null;
  /** Türe özgü ayrıntı (YEREL_MUDAHALE: `nedenler` · `sayac` · son ölçümler). */
  readonly ayrinti?: { readonly nedenler?: readonly string[]; readonly sayac?: Readonly<Record<string, number>> } | null;
  readonly kurulum?: InstallationRef;
}

export interface InstallationRef {
  readonly kurulumId: string;
  readonly ad: string | null;
  readonly tesis: { readonly ad: string; readonly musteri: { readonly ad: string } };
}

/** Bağsız (kimliksiz) taşıma talebine İPUCU: DB kimliği son yoklamasında aynı olan kurulumlar. */
export interface SuggestedInstallation {
  readonly id: string;
  readonly kurulumId: string;
  readonly ad: string | null;
  readonly durum: string;
  readonly tesis: { readonly ad: string; readonly musteri: { readonly ad: string } };
}

/** Onay yanıtı: tek kullanımlık taşıma kodu ve son 4'ü yalnız canlı yanıtta (tekrar yanıtında `kodGosterilemez`). */
export interface TransferApproved {
  readonly id: string;
  readonly tasimaKodu: { readonly id: string; readonly kod: string | null; readonly kodSonu?: string; readonly gecerlilikBitis: string; readonly kodGosterilemez?: boolean } | null;
}

export interface TransferRequest {
  readonly id: string;
  /** Satıcı kaydının id'si; kimliksiz talepte onaya dek YOK (bağı operatör kurar). */
  readonly kurulumId?: string | null;
  readonly onerilenKurulumlar?: readonly SuggestedInstallation[];
  readonly yeniAnahtarKimligi: string;
  readonly ortam: Record<string, unknown>;
  readonly gerekce: string | null;
  readonly durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  readonly kararZamani: string | null;
  readonly kararVeren: string | null;
  readonly kararSebebi: string | null;
  readonly createdAt: string;
  readonly kurulum?: InstallationRef;
}

/** Donanım değişikliği / zayıf tanıma onay talebi (`GET /donanim-talepleri`) — tuzlu özet değil etken etken karşılaştırma. */
export interface HardwareRequest {
  readonly id: string;
  readonly kurulumId: string;
  readonly kurulum: { readonly kurulumId: string; readonly ad: string | null; readonly sinif: string; readonly tesis: { readonly ad: string; readonly musteri: { readonly ad: string } } };
  readonly tur: "DONANIM" | "ZAYIF_TANIMA";
  readonly durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI";
  readonly anahtarKimligi: string;
  readonly kayip: readonly string[];
  readonly gerekce: string | null;
  readonly otomatik: boolean;
  readonly bildirimSayisi: number;
  readonly sonBildirim: string;
  readonly kararZamani: string | null;
  readonly kararVeren: string | null;
  readonly kararSebebi: string | null;
  readonly createdAt: string;
  readonly karsilastirma: {
    readonly etkenler: Readonly<Record<string, string>>;
    readonly guclu: readonly string[];
    readonly tutanGuclu: number;
    readonly kural: "standart" | "zayif";
    readonly ogrenilebilir: boolean;
    readonly zayif: boolean;
  };
}

/** Kök imzası bekleyen HAK talebi (`GET /kok-kuyrugu`). `acil`: yetenek düşüşünde fabrika kira alamadı. */
export interface RootRequest {
  readonly id: string;
  readonly hakId: string;
  readonly lisansNo: string;
  readonly kurulumId: string;
  readonly kurulum: { readonly kurulumId: string; readonly ad: string | null; readonly sinif: string };
  readonly tabanSurum: number;
  readonly surum: number;
  readonly uzunUfuk: boolean;
  readonly acil: boolean;
  readonly durum: "BEKLIYOR" | "IMZALANDI" | "IPTAL" | "ESKIDI";
  readonly sebep: string;
  readonly yapan: string;
  readonly kapanisZamani: string | null;
  readonly kapanisSebebi: string | null;
  readonly createdAt: string;
}

/** HAK imza planı (`GET /haklar/:id/imza-plani`): hangi imzacı, KUYRUK'ta neden, bekleyen kök talebi. */
export interface SigningPlan {
  readonly imzaci: "ARA" | "KOK" | "KUYRUK";
  readonly kid: string | null;
  readonly neden: string | null;
  readonly bekleyenTalep: string | null;
}

/** HAK sürüm ucunun iki başarılı yanıtı: imzalı sürüm (201) ya da kök kuyruğu talebi (202). */
export type EntitlementVersionResult =
  | { readonly kuyruk: true; readonly talepId: string; readonly hakId: string; readonly surum: number; readonly durum: string }
  | { readonly kuyruk?: undefined; readonly id: string; readonly hakId: string; readonly surum: number; readonly imzalayanKid: string; readonly uzunUfuk: boolean };

export type RevocationBlocker =
  | { readonly tur: "HAK"; readonly hakId: string; readonly lisansNo: string; readonly surum: number; readonly kid: string }
  | { readonly tur: "ANAHTAR"; readonly kid: string };

/** İptal belgesi defteri + dağıtım kapısı (`GET /iptal-belgeleri`). */
export interface RevocationStatus {
  readonly belgeler: {
    readonly id: string;
    readonly iptalId: string;
    readonly sira: number;
    readonly imzalayanKid: string;
    readonly verilis: string;
    readonly kidler: string[];
    readonly yukleyen: string;
    readonly createdAt: string;
  }[];
  readonly dagitilanSira: number | null;
  readonly bekleyen: { readonly sira: number; readonly engeller: RevocationBlocker[] } | null;
}

/** Ara imzacıyla toplu yeniden basım (`POST /haklar/toplu-yeniden-bas`). */
export interface ReissueResponse {
  readonly basilan: { readonly hakId: string; readonly surum: number; readonly imzalayanKid: string }[];
  readonly sonuclar: { readonly hakId: string; readonly durum: "IMZALANACAK" | "ATLANDI"; readonly neden: string | null }[];
}

export interface PlannedAction {
  readonly id: string;
  readonly kurulumId: string;
  readonly tur: string;
  readonly parametre: { readonly mesaj?: string | null; readonly gun?: number | null; readonly moduller?: string[] | null };
  readonly vade: string;
  readonly durum: "BEKLIYOR" | "UYGULANDI" | "IPTAL";
  readonly sebep: string;
  readonly yapan: string;
  readonly uygulamaZamani: string | null;
  readonly iptalZamani: string | null;
  readonly iptalEden: string | null;
  readonly iptalSebebi: string | null;
  readonly createdAt: string;
}

export interface InstallmentItem {
  readonly id: string;
  readonly planId: string;
  readonly sira: number;
  readonly vade: string;
  readonly tutar: string;
  readonly durum: "BEKLIYOR" | "ODENDI" | "GECIKTI" | "IPTAL";
  readonly odemeZamani: string | null;
}

export interface InstallmentPlan {
  readonly id: string;
  readonly aciklama: string;
  readonly uzatmaGun: number;
  readonly gecikmeGun: number;
  readonly kisitlamaGun: number;
  readonly aktif: boolean;
  readonly yapan: string;
  readonly kapanisZamani: string | null;
  readonly kapanisSebebi: string | null;
  readonly createdAt: string;
  readonly kalemler: InstallmentItem[];
}

export interface InstallationRecord {
  readonly id: string;
  readonly olay: string;
  readonly anahtarKimligi: string | null;
  readonly eskiAnahtarKimligi: string | null;
  readonly ayrinti: Record<string, unknown> | null;
  readonly yapan: string;
  readonly createdAt: string;
}

export interface InstallationDetail {
  readonly kurulum: Installation;
  readonly hak: EntitlementSummary | null;
  readonly hakSurumleri: EntitlementVersion[];
  readonly etkinlestirmeKodlari: ActivationCodeRow[];
  // Yalnız satıcı görünümü:
  readonly yaptirim?: SanctionState;
  readonly yaptirimDefteri?: SanctionAction[];
  readonly kiralar?: Lease[];
  readonly yoklamalar?: PollRow[];
  readonly kopyaUyarilari?: CopyAlert[];
  readonly tasimaTalepleri?: TransferRequest[];
  readonly planliEylemler?: PlannedAction[];
  readonly taksitPlanlari?: InstallmentPlan[];
  readonly kurulumKaydi?: InstallationRecord[];
  /** Lisans v2 ödenmiş tarih görünümü (satıcı künyesi; `null` = aktif HAK yok). */
  readonly odenmisTarih?: PaidThroughView | null;
}

/** P'nin kaynağı — sunucu `PaidThroughKind` aynası (mirrors.test.ts). */
export type PaidThroughKind = "SOZLESME_SONU" | "TAKSIT" | "SURESIZ";

/** Ödenmiş tarih (P) görünümü: değerler sunucunun tek kaynağından; bant ve internet satıcının TAHMİNİ. */
export interface PaidThroughView {
  readonly tarih: string | null;
  readonly tur: PaidThroughKind;
  /** Fabrika P modelini işletiyor mu (yetenek + ufuklu HAK + P'li kira); değilse eski çapa (kira bitişi + ek süre). */
  readonly pModeli: boolean;
  readonly sonAlisveris: string | null;
  readonly internetVar: boolean;
  readonly bantGorunurTahmini: boolean;
}

/** POST /kurulumlar/:id/uzatma-dosyasi yanıtı: dosya içeriği imzalı `LicenseResponse`'tur (AYNEN kaydedilir). */
export interface ExtensionFile {
  readonly dosya: Record<string, unknown>;
  readonly dosyaAdi: string;
  readonly kiraId: string;
  readonly odenmisTarih: string | null;
}

export interface Ceiling {
  readonly id: string;
  readonly surum: number;
  readonly moduller: string[];
  readonly siniflar: string[];
  readonly kurulumAdedi: number;
  /** Bayinin kurulum açabileceği kanallar (boş = açamaz). */
  readonly kanallar: string[];
  /** Bayi KALICI lisans imzalayabilir mi (varsayılan hayır). */
  readonly kaliciIzni: boolean;
  /** Bayinin imzasında bakım bitişi en çok bu kadar ay sonra. */
  readonly bakimAyTavani: number;
  readonly sebep: string;
  readonly yapan: string;
  readonly createdAt: string;
}

export type ChannelKind = "uretim" | "hazirlik";

/** Kiraya giden güncel sürümler (X.Y.Z); boş anahtar = bildirilmez. */
export interface ChannelVersions {
  readonly backend?: string;
  readonly panel?: string;
  readonly tablet?: string;
}

/** Dağıtım kanalı (GET /kanallar). `kod` kimliktir, değişmez. */
export interface Channel {
  readonly id: string;
  readonly kod: string;
  readonly ad: string;
  readonly tur: ChannelKind;
  readonly guncelSurumler: ChannelVersions;
  readonly kurulumSayisi: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PortalUserView {
  readonly id: string;
  readonly kullaniciAdi: string;
  readonly adSoyad: string;
  readonly rol: string;
  readonly bayiId: string | null;
  readonly aktif: boolean;
  readonly kilitli: boolean;
  readonly kilitBitis: string | null;
  readonly sonGiris: string | null;
  readonly parolaDegisim: string | null;
  readonly createdAt: string;
}

export interface Dealer {
  readonly id: string;
  readonly ad: string;
  readonly vergiNo: string | null;
  readonly anahtarKid: string | null;
  readonly guncelTavanSurum: number;
  readonly aktif: boolean;
  readonly createdAt: string;
  readonly tavan: Ceiling | null;
  readonly kullanim: number;
}

export interface DealerDetail extends Dealer {
  readonly tavanGecmisi: Ceiling[];
  readonly musteriSayisi: number;
  readonly kullanicilar: PortalUserView[];
}

export interface DealerSelf {
  readonly id: string;
  readonly ad: string;
  readonly anahtarBagli: boolean;
  readonly tavan: Ceiling | null;
  readonly kullanim: number;
}

export interface Catalog {
  readonly moduller: string[];
  readonly varsayilanModuller: string[];
  readonly siniflar: string[];
  readonly kademeler: string[];
  readonly kisitlamaGunSecenekleri: number[];
  readonly roller: string[];
}

export interface AuditRow {
  readonly id: string;
  readonly olay: string;
  readonly varlik: string;
  readonly varlikId: string | null;
  readonly yapan: string;
  readonly ozet: unknown;
  readonly createdAt: string;
}

export interface KeyStatus {
  readonly capa: { readonly kaynak: string; readonly kokler: { readonly kid: string; readonly x: string; readonly siniflar: string[] }[] };
  readonly anahtarlar: {
    readonly kid: string;
    readonly tur: string;
    readonly acikAnahtar: string;
    readonly siniflar: string[];
    readonly baslangic: string | null;
    readonly bitis: string | null;
    readonly durum: string;
    readonly yuklu: boolean;
    readonly suresiDoldu: boolean;
    readonly capada: boolean | null;
    /** Sertifikayı imzalayan kökün kid'i (kökler ve bayi sertifikasızsa null). */
    readonly sertifikaVeren?: string | null;
    readonly updatedAt: string;
  }[];
  readonly kiraImzalayabilir: boolean;
  readonly indirmeAnahtari: string | null;
  readonly uyarilar: string[];
}

export interface Dashboard {
  readonly kurulumlar: Record<string, number>;
  readonly acikKopyaUyarisi: number;
  readonly bekleyenTasima: number;
  readonly gecikenTaksit: number;
  readonly yediGundePlanliEylem: number;
  readonly yirmiDortSaattirSessiz: number;
}

/** GET /saglik — sunucunun `services/system-health.ts` çıktısının aynası (yalnız sayı ve durum). */
export interface SystemHealth {
  readonly zil: { readonly dinliyor: boolean; readonly abone: number; readonly teslim: number };
  readonly anahtarlar: { readonly capa: "gomulu" | "dosya"; readonly altGecerli: number; readonly indirmeVar: boolean; readonly uyariSayisi: number };
  readonly denetimYazmaHatasi: number;
  readonly erisim:
    | { readonly kip: "kapali" }
    | {
        readonly kip: "acik";
        readonly jwks: {
          readonly dolu: boolean;
          readonly anahtarSayisi: number;
          readonly dosyaYasiSn: number | null;
          readonly azamiYasSn: number;
          readonly yasDurumu: "TAZE" | "UYARI" | "ASILDI" | null;
          readonly okumaYasiSn: number | null;
          readonly sonHata: string | null;
        };
      };
}

/** Bir kez gösterilen kod yanıtı (tekrar yanıtında `kod: null`, `kodGosterilemez: true`, son 4 yok). */
export interface ActivationCodeCreated {
  readonly id: string;
  readonly kod: string | null;
  readonly kodSonu?: string;
  readonly gecerlilikBitis: string;
  readonly kodGosterilemez?: boolean;
}

export interface TotpEnrollmentResponse {
  readonly kullanici: PortalUserView;
  readonly totp: { readonly sir: string; readonly otpauthUri: string } | null;
  readonly totpGosterilemez?: boolean;
}

export function installationName(i: { ad: string | null; kurulumId: string }): string {
  return i.ad?.trim() ? i.ad : `Kurulum ${i.kurulumId.slice(0, 8)}`;
}

// ---------------------------------------------------------------- bildirimler (giden kutusu görünümü)

/** Allowlist gövde (sunucu `NOTIFICATION_BODY_KEYS`): etiketler + portal yolu; talep metni vb. YOK. */
export interface NotificationBody {
  readonly musteri: string | null;
  readonly tesis: string | null;
  readonly kurulum: string | null;
  readonly lisansNo: string | null;
  readonly sinif: string | null;
  readonly konu: string | null;
  readonly referans: string | null;
  readonly tarih: string | null;
  readonly portalYolu: string;
}

export interface NotificationRow {
  readonly id: string;
  readonly olay: string;
  readonly kanal: string;
  readonly durum: string;
  readonly deneme: number;
  readonly sonrakiDeneme: string;
  readonly sonHata: string | null;
  readonly gonderimZamani: string | null;
  /** Telegram sohbeti süper gruba taşındıysa YENİ sohbet kimliği (yalnız sayı; sır değil). */
  readonly yeniSohbetKimligi: string | null;
  readonly govde: NotificationBody;
  readonly kurulumId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChannelOverview {
  readonly kanal: string;
  readonly durum: string;
  readonly sonGonderim: string | null;
  readonly sonSonuc: { readonly durum: string; readonly kod: string | null; readonly zaman: string; readonly yeniSohbetKimligi?: string | null } | null;
  readonly bekleyen: number;
  readonly geciken: number;
}

export interface NotificationOverview {
  readonly kanallar: ChannelOverview[];
  readonly esikler: { readonly sessizSaat: number; readonly vadeGun: number; readonly taramaDk: number; readonly sessizSiniflar: string[] };
}

// ---------------------------------------------------------------- güncelleme politikası · filo (Dağıtım v2)

export type UpdateMode = "OTOMATIK" | "ONAYLI" | "DONDUR";

/** Pencere kuralı: fabrika saatiyle başlangıç–bitiş, ISO haftası (1 = Pazartesi … 7 = Pazar), artan sıralı. */
export interface UpdateWindow {
  readonly baslangic: string;
  readonly bitis: string;
  readonly gunler: readonly number[];
}

/** Kurulumun politikası (sunucu `policyOf`): pencere dilimsiz — dilim fabrikanın bildirdiğidir. */
export interface UpdatePolicy {
  readonly kip: UpdateMode;
  readonly pencere: UpdateWindow | null;
  readonly hedefSurum: string | null;
}

/** Tamamlanan güncelleme denemesi (protokol `UpdateResultSchema`). */
export interface UpdateAttempt {
  readonly kayitId: string;
  readonly hedefSurum: string;
  readonly kaynakSurum: string | null;
  readonly sonuc: string;
  readonly kod: string | null;
  readonly baslangic: string;
  readonly bitis: string;
  readonly veriGeriYuklendi: boolean;
}

/** Yoklamanın son güncelleme raporu (kurulumun durum kolonu; `saatDilimi` ayrı kolonda). */
export interface UpdateReportSummary {
  readonly guncelleyici?: { readonly durum: string; readonly surum: string | null };
  readonly bekleyen?: { readonly surum: string; readonly karar: string; readonly neden: string | null } | null;
  readonly son?: UpdateAttempt | null;
}

export interface UpdateHistoryRow {
  readonly id: string;
  readonly olay: string;
  readonly ayrinti: Record<string, unknown> | null;
  readonly yapan: string;
  readonly createdAt: string;
}

/** `GET /kurulumlar/:id/guncelleme`. */
export interface InstallationUpdateView {
  readonly politika: UpdatePolicy;
  /** Pencerenin yorumlandığı dilim: fabrikanın bildirdiği, yoksa varsayılan. */
  readonly saatDilimi: string;
  readonly saatDilimiBildirildi: boolean;
  readonly rapor: UpdateReportSummary | null;
  readonly raporZamani: string | null;
  readonly gecmis: UpdateHistoryRow[];
}

/** `GET /bakim-bitecek` satırı (K9) — aşama ve kalan gün sunucunun hükmü. */
export interface MaintenanceDueRow {
  /** Kurulum kaydı id'si (kurulum ayrıntı bağlantısı). */
  readonly id: string;
  readonly kurulumId: string;
  readonly hakId: string;
  readonly ad: string | null;
  readonly musteri: string;
  readonly tesis: string;
  readonly sinif: string;
  readonly durum: string;
  readonly lisansNo: string;
  readonly kalici: boolean;
  readonly bakimBitis: string;
  /** Negatif/0 = bitti. */
  readonly kalanGun: number;
  readonly asama: "BITTI" | "YAKLASIYOR" | "SONRAKI";
  readonly kuruluSurum: string | null;
  readonly kuruluDerleme: string | null;
  readonly surumBakimDisi: boolean | null;
}

/** `GET /filo` satırı. */
export interface FleetRow {
  readonly id: string;
  readonly kurulumId: string;
  readonly ad: string | null;
  readonly musteri: string;
  readonly tesis: string;
  readonly kanal: string;
  readonly sinif: string;
  readonly durum: string;
  readonly sonYoklama: string | null;
  readonly kuruluSurum: string | null;
  readonly kanalSurumu: { readonly surum: string | null; readonly kaynak: "YAYIN" | "KANAL_KAYDI" | "YOK" };
  /** İki sürüm de okunabildiyse; okunamayan null ("bilinmiyor"). */
  readonly geride: boolean | null;
  readonly politika: UpdatePolicy;
  readonly rapor: UpdateReportSummary | null;
  readonly raporZamani: string | null;
  readonly sonSonuc: { readonly olay: string; readonly ayrinti: Record<string, unknown> | null; readonly createdAt: string } | null;
}
