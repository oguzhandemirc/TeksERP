// HESAP API'si TEL TİPLERİ (`/api/*`) — tek kaynak `patron/sunucu/src/wire/api.ts`; patron
// uygulamasındaki `patron/uygulama/src/api/wire.ts` bunun BAYT-EŞİT aynasıdır (ayna bekçisi uygulamanın
// jest paketinde). Bağımlılıksız: yalnız tip + sabit; sunucu servis görünümleri bu tiplere bağlanır.

/** Başarılı yanıt zarfı; hata zarfı `ApiErrorBody`. */
export interface ApiOk<T> {
  readonly success: true;
  readonly data: T;
}

export interface ApiErrorBody {
  readonly success: false;
  readonly message: string;
  readonly details: { readonly code: string; readonly [k: string]: unknown };
}

/** İmleçli sayfa: `sonraki` null ise son sayfa (`?imlec=` ile devam). */
export interface Page<T> {
  readonly kayitlar: readonly T[];
  readonly sonraki: string | null;
}

export interface AccountSummary {
  readonly id: string;
  readonly ad: string;
  readonly eposta: string;
  readonly izinler: readonly string[];
}

/** `POST /oturum/ac` — e-posta + parola + TOTP tek istekte (TOTP'siz oturum yok). */
export interface LoginResponse {
  readonly belirtec: string;
  readonly bitis: string;
  readonly hesap: AccountSummary;
  readonly tesisId: string;
}

export interface SyncStatus {
  readonly sonEsitleme: string;
  readonly ufuk: string;
  readonly ufukTakildi: boolean;
  readonly sozlesmeUyarisi: string | null;
  readonly fabrikaSurumu: string | null;
}

/** `GET /oturum` — ekranın üst şeridi. */
export interface FacilityStatus {
  readonly tesis: { readonly id: string; readonly ad: string | null; readonly saklamaAy: number | null };
  readonly hesap: AccountSummary;
  readonly projeksiyonlar: readonly string[];
  readonly esitleme: SyncStatus | null;
}

/** `GET /veri/:projeksiyon[/:id]` — satır fabrikanın hesapladığı hâliyle; alt satır yalnız izinliyse anahtar olarak var. */
export interface ProjectionRecord {
  readonly id: string;
  readonly kayit: unknown;
  readonly finans?: unknown;
  readonly kisisel?: unknown;
  readonly surum: string;
}

// ---------------------------------------------------------------- liste araması (seçiciler)
/** Tek süzgeç seçeneği: `?suzgec=<deger>` ⇒ kayıttaki `alan` = `esit` (jsonb eşitliği). */
export interface ListFilterOption {
  readonly deger: string;
  readonly etiket: string;
  readonly alan: string;
  readonly esit: string | boolean;
}

/** Sunucuda aranabilir liste: `?ara=` `alanlar`da Türkçe katlamalı parça eşleşme; en çok BİR açılır süzgeç. */
export interface ListSearchSpec {
  readonly alanlar: readonly string[];
  readonly suzgec: { readonly etiket: string; readonly varsayilan: string | null; readonly secenekler: readonly ListFilterOption[] } | null;
}

export const ARAMA_AZAMI = 60;

/** `GET /veri/:projeksiyon?ara=&suzgec=` — yalnız burada adı geçen projeksiyonlar aranır; diğerinde 400. */
export const LIST_SEARCH: Readonly<Record<string, ListSearchSpec>> = {
  "cari-kart": {
    alanlar: ["ad", "kod"],
    suzgec: {
      etiket: "Rol",
      varsayilan: "MUSTERI",
      secenekler: [
        { deger: "MUSTERI", etiket: "Müşteri", alan: "musteriRolu", esit: true },
        { deger: "TEDARIKCI", etiket: "Tedarikçi", alan: "tedarikciRolu", esit: true },
        { deger: "FASON", etiket: "Fason", alan: "fasonRolu", esit: true },
      ],
    },
  },
  urun: {
    alanlar: ["ad", "kod"],
    suzgec: {
      etiket: "Tür",
      varsayilan: null,
      secenekler: [
        { deger: "FABRIC", etiket: "Kumaş", alan: "tur", esit: "FABRIC" },
        { deger: "YARN", etiket: "İplik", alan: "tur", esit: "YARN" },
        { deger: "CONSUMABLE", etiket: "Sarf", alan: "tur", esit: "CONSUMABLE" },
      ],
    },
  },
  renk: {
    alanlar: ["ad", "kod"],
    suzgec: {
      etiket: "Durum",
      varsayilan: "AKTIF",
      secenekler: [
        { deger: "AKTIF", etiket: "Aktif", alan: "aktif", esit: true },
        { deger: "PASIF", etiket: "Pasif", alan: "aktif", esit: false },
      ],
    },
  },
};

/** `GET /anlik/:projeksiyon`. */
export interface Snapshot {
  readonly projeksiyon: string;
  readonly veri: unknown;
  readonly surum: string;
}

/** `POST /api/tazele` (§14 S47): `ozet` zili çaldı mı; bir sonraki zile kaç ms var (tesis başına aralık). */
export interface SnapshotRefresh {
  readonly zil: boolean;
  readonly sonrakiMs: number;
}

export const INBOX_STATUSES = ["BEKLIYOR", "ISLENIYOR", "ISLENDI", "REDDEDILDI", "IPTAL"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
// Hesap API görünümü: eşitleme sözleşmesinin `InboxKind`/`InboxMessage` adları yalnız `esitleme.ts`te (test_bulut_tel_aynasi §4a).
export type InboxItemKind = "SIPARIS" | "CARI";

export interface InboxItem {
  readonly mesajId: string;
  readonly tur: InboxItemKind;
  readonly durum: InboxStatus;
  readonly govde: unknown;
  readonly hesapAdi: string;
  readonly sonuc: unknown;
  readonly olusturulma: string;
  readonly islenme: string | null;
  readonly iptal: string | null;
}

/** Sipariş mesajı gövdesi — sayılar ondalık DİZİ ("12.5"). */
export interface OrderMessageBody {
  readonly cariKartId: string;
  readonly subeId?: string;
  readonly termin?: string;
  readonly doviz: string;
  readonly aciklama?: string;
  readonly kalemler: readonly {
    readonly urunId: string;
    readonly renkId?: string;
    readonly miktar: string;
    readonly birim?: string;
    readonly birimFiyat?: string;
    readonly en?: string;
    readonly musteriUrunAdi?: string;
    readonly musteriRenkAdi?: string;
  }[];
}

export interface CustomerMessageBody {
  readonly ad: string;
  readonly roller: { readonly musteri: boolean; readonly tedarikci: boolean };
  readonly il?: string;
  readonly ilce?: string;
  readonly ulke?: string;
  readonly vergiNo?: string;
  readonly vergiDairesi?: string;
  readonly adres?: string;
  readonly yetkili?: string;
  readonly telefon?: string;
  readonly eposta?: string;
}

export const REPORT_STATUSES = ["BEKLIYOR", "HESAPLANIYOR", "HAZIR", "HATA", "IPTAL"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportRequest {
  readonly id: string;
  readonly raporAnahtari: string;
  readonly aile: string;
  readonly parametreler: unknown;
  readonly durum: ReportStatus;
  readonly hataKodu: string | null;
  readonly olusturulma: string;
  readonly tamamlanma: string | null;
}

export interface ReportRequestDetail extends ReportRequest {
  readonly sonuc: { readonly veri: unknown; readonly hesaplandi: string; readonly kaynakUfuk: string | null } | null;
}

export type AccountStatus = "DAVETLI" | "AKTIF" | "KILITLI" | "PASIF";

export interface Account {
  readonly id: string;
  readonly eposta: string;
  readonly ad: string;
  readonly durum: AccountStatus;
  readonly izinler: readonly string[];
  readonly sonGiris: string | null;
  readonly davetBitis: string | null;
  readonly olusturulma: string;
}

/** Davet/sıfırlama yanıtı: belirteç YALNIZ ilk yanıtta; tekrar yanıtında `davetGosterilemez`. */
export interface AccountInviteResult {
  readonly hesap: Account;
  readonly davet?: string;
  readonly davetGosterilemez?: true;
  readonly davetBitis: string;
}

export interface PermissionCatalog {
  readonly izinler: readonly string[];
  readonly sablonlar: Readonly<Record<string, readonly string[]>>;
}

/** `POST /davet/incele`. */
export interface InviteInfo {
  readonly eposta: string;
  readonly ad: string;
  readonly tesisAd: string | null;
  readonly bitis: string;
  readonly totpKurulumuBekliyor: boolean;
}

/** `POST /davet/kabul` — TOTP sırrı YALNIZ bu yanıtta. */
export interface InviteAccepted {
  readonly eposta: string;
  readonly totpSirri: string;
  readonly otpauth: string;
}

export interface InviteConfirmed {
  readonly eposta: string;
  readonly durum: "AKTIF";
}

export interface Device {
  readonly id: string;
  readonly platform: string;
  readonly ad: string | null;
  readonly aktif: boolean;
  readonly sonGorulme: string;
  readonly olusturulma: string;
}

// ---------------------------------------------------------------- bildirimler (B5)

/** Bildirim türleri — kurallar sunucu kataloğunda (`src/catalog/notifications.ts`: izin, finans sınıfı, kaynak). */
export const NOTIFICATION_KINDS = [
  "gelen-kutusu-sonucu",
  "stok-esigi",
  "geciken-siparis",
  "gunluk-uretim",
  "esitleme-gecikti",
  "yedek-basarisiz",
  "cek-vadesi",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Eşikler: `null` = o eşik kapalı. Sayılar fabrikanın gönderdiği özetle YALNIZ karşılaştırılır. */
export interface NotificationThresholds {
  readonly hamStokAlt: number | null;
  readonly bitmisStokAlt: number | null;
  readonly gecikenKalemUst: number | null;
  readonly gunlukUretimAlt: number | null;
  /** Günlük üretim bu saatten (İstanbul, 0–23) sonra değerlendirilir. */
  readonly gunlukUretimSaati: number;
  readonly esitlemeGecikmeDk: number;
}

/** Sessiz saatler (İstanbul, "SS:DD"); başlangıç > bitiş gece yarısını aşar. Sessizde doğan bildirim bitişte gider. */
export interface QuietHours {
  readonly acik: boolean;
  readonly baslangic: string;
  readonly bitis: string;
}

export interface NotificationSettings {
  /** false = hiç bildirim yok. */
  readonly acik: boolean;
  readonly turler: Readonly<Record<NotificationKind, boolean>>;
  readonly sessiz: QuietHours;
  readonly esikler: NotificationThresholds;
}

export interface NotificationKindInfo {
  readonly tur: NotificationKind;
  readonly ad: string;
  readonly aciklama: string;
  readonly finans: boolean;
  /** Hesabın izni bu türü almaya yetiyor mu (yetmiyorsa ayar açık olsa da gitmez). */
  readonly izinli: boolean;
}

/** `GET /bildirim/ayarlar`. */
export interface NotificationSettingsView {
  readonly etkin: NotificationSettings;
  readonly kaynak: "HESAP" | "TESIS" | "VARSAYILAN";
  readonly hesap: NotificationSettings | null;
  readonly tesis: NotificationSettings | null;
  readonly turler: readonly NotificationKindInfo[];
  /** Sunucunun gönderim kipi: `kapali` iken kuyruk birikir, hiçbir şey gönderilmez. */
  readonly gonderim: "kapali" | "sahte" | "gercek";
  /** Web push aboneliği için VAPID açık anahtarı (base64url); yapılandırılmamışsa null. */
  readonly webPushAnahtari: string | null;
}

export const NOTIFICATION_STATUSES = ["BEKLIYOR", "GONDERILIYOR", "GONDERILDI", "BASARISIZ", "ATLANDI"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface NotificationItem {
  readonly id: string;
  readonly tur: string;
  readonly baslik: string;
  readonly metin: string;
  /** Dokununca açılacak uygulama yolu (ör. `/gelen-kutusu/<mesajId>`). */
  readonly rota: string | null;
  readonly durum: NotificationStatus;
  readonly atlamaNedeni: string | null;
  readonly olusturulma: string;
  readonly gonderilme: string | null;
}
