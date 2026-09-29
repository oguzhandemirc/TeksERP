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
  readonly platform: string | null;
  readonly sonOrtam: Record<string, unknown> | null;
  readonly sonSaglik: Record<string, unknown> | null;
  readonly sonYoklamaZamani: string | null;
  readonly etkinlesmeZamani: string | null;
  readonly aktif: boolean;
  readonly createdAt: string;
  readonly kabulEdilenParmakIzi?: Record<string, string | null> | null;
  readonly tesis: { readonly id: string; readonly ad: string; readonly musteri: { readonly id: string; readonly ad: string; readonly bayiId: string | null } };
  readonly haklar: EntitlementSummary[];
  readonly _count: { readonly kopyaUyarilari: number; readonly tasimalar: number };
}

export interface EntitlementVersion {
  readonly id: string;
  readonly surum: number;
  readonly imzalayanKid: string;
  readonly verilis: string;
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
