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

/** Kimliğin erişebildiği tesis (yalnız AKTİF üyelik; KİLİTLİ görünmez). */
export interface FacilityChoice {
  readonly id: string;
  readonly ad: string;
  readonly hizmet: ServicePhase;
}

/** `POST /oturum/ac` — e-posta + parola + TOTP tek istekte (TOTP'siz oturum yok); `tesisId` ipucu opsiyonel. */
export interface LoginResponse {
  readonly belirtec: string;
  readonly bitis: string;
  readonly hesap: AccountSummary;
  readonly tesisId: string;
  /** Eski sunucu göndermez; yoksa tek tesis varsayılır. */
  readonly tesisler?: readonly FacilityChoice[];
}

export interface SyncStatus {
  readonly sonEsitleme: string;
  readonly ufuk: string;
  readonly ufukTakildi: boolean;
  readonly sozlesmeUyarisi: string | null;
  readonly fabrikaSurumu: string | null;
}

/** Hizmet aşaması (Ek-6/A §4): hizmet bitince 90 gün SALT_OKUNUR (okuma + dışa aktarma açık, yazma kapalı); sonra KAPALI (giriş yok). */
export type ServicePhase = "ACIK" | "SALT_OKUNUR" | "KAPALI";

export interface ServiceStatus {
  readonly asama: ServicePhase;
  /** Hizmetin bittiği an (ACIK'ta null). */
  readonly bitis: string | null;
  /** Salt okuma ve dışa aktarmanın son anı (ACIK'ta null). */
  readonly saltOkunurBitis: string | null;
}

/** `GET /oturum` — ekranın üst şeridi. */
export interface FacilityStatus {
  readonly tesis: { readonly id: string; readonly ad: string | null; readonly saklamaAy: number | null };
  readonly hesap: AccountSummary;
  readonly projeksiyonlar: readonly string[];
  readonly esitleme: SyncStatus | null;
  readonly hizmet: ServiceStatus;
  /** Eski sunucu göndermez: yoksa kimlik süzgeci ve yeni aramalar YOK sayılır (eski sunucu tanımadığı parametreyi yok sayar). */
  readonly liste?: ListCapabilities;
  /** D8: `POST /esitleme/simdi` ucu var (yalnız bulut; ERP kipinde veri zaten canlı). Eski sunucu göndermez ⇒ düğme gizli. */
  readonly simdiEsitle?: boolean;
}

// ---------------------------------------------------------------- dışa aktarma (Ek-6/A §4.2)
export const EXPORT_FORMATS = ["json", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Dışa aktarılabilir küme: KAYIT (projeksiyon satırları) · ANLIK (özet; yalnız JSON) · BULUT (bulutta doğan veri). */
export interface ExportDataset {
  readonly ad: string;
  readonly tur: "KAYIT" | "ANLIK" | "BULUT";
  readonly adet: number;
  readonly bicimler: readonly ExportFormat[];
}

/** `GET /disa-aktar` (yalnız hesap yöneticisi) — küme listesi; dosya `GET /disa-aktar/:kume?bicim=json|csv`. */
export interface ExportManifest {
  readonly hizmet: ServiceStatus;
  readonly kumeler: readonly ExportDataset[];
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
  // `musteriAdi` fabrika 2.15.13+ satırında; eski satır yalnız no ile bulunur. Zaman kovası ("bu hafta") yok:
  // bulut tarih karşılaştırmaz. `gecikmis`i fabrika türetir, termin geçişi (`crossings`) satırı yeniden gönderir.
  siparis: {
    alanlar: ["siparisNo", "musteriAdi"],
    suzgec: {
      etiket: "Görünüm",
      varsayilan: null,
      secenekler: [
        { deger: "GECIKMIS", etiket: "Gecikmiş", alan: "gecikmis", esit: true },
        // Etiket sevk dilinde (panel `orderStatusLabels`); `deger` kodları sözleşmedir, değişmez.
        { deger: "BEKLEMEDE", etiket: "Henüz onaylanmadı", alan: "durum", esit: "PENDING" },
        { deger: "ONAYLANDI", etiket: "Henüz gönderilmedi", alan: "durum", esit: "APPROVED" },
        { deger: "KISMI_SEVK", etiket: "Bir kısmı gönderildi", alan: "durum", esit: "PARTIAL_SHIPPED" },
        { deger: "TAMAMLANDI", etiket: "Hepsi gönderildi ya da elle kapatıldı", alan: "durum", esit: "COMPLETED" },
        { deger: "IPTAL", etiket: "Sipariş iptal edildi", alan: "durum", esit: "CANCELLED" },
      ],
    },
  },
  // İE v3 (fabrika 2026-11-19): müşteri/sipariş no fabrikanın türettiği adlardan; açık = PLANNED · IN_PROGRESS.
  "is-emri": {
    alanlar: ["isEmriNo", "musteriAdi", "siparisNolari"],
    suzgec: {
      etiket: "Durum",
      varsayilan: "ACIK",
      secenekler: [
        { deger: "ACIK", etiket: "Açık", alan: "acik", esit: true },
        { deger: "KAPALI", etiket: "Kapalı", alan: "acik", esit: false },
      ],
    },
  },
  // Taslak teklif buluta gelmez. `suresiDoldu`yu fabrika türetir; geçerlilik günü dönünce satırı yeniden gönderir.
  teklif: {
    alanlar: ["no", "musteriAdi"],
    suzgec: {
      etiket: "Durum",
      varsayilan: null,
      secenekler: [
        { deger: "GONDERILDI", etiket: "Gönderildi", alan: "durum", esit: "SENT" },
        { deger: "SURESI_DOLDU", etiket: "Süresi doldu", alan: "suresiDoldu", esit: true },
        { deger: "KABUL", etiket: "Kabul edildi", alan: "durum", esit: "ACCEPTED" },
        { deger: "SIPARIS", etiket: "Siparişe döndü", alan: "durum", esit: "CONVERTED" },
        { deger: "RED", etiket: "Reddedildi", alan: "durum", esit: "REJECTED" },
        { deger: "IPTAL", etiket: "İptal", alan: "durum", esit: "CANCELLED" },
      ],
    },
  },
};

// ---------------------------------------------------------------- liste kimlik süzgeçleri
export const LIST_ID_FILTER_KEYS = ["cariKartId", "cariHesapId", "siparisId", "teklifId", "urunId", "hizmetId"] as const;
export type ListIdFilterKey = (typeof LIST_ID_FILTER_KEYS)[number];

/**
 * `GET /veri/:projeksiyon?<anahtar>=<uuid>` ⇒ kayıttaki AYNI ADLI alanın eşitliği. TEK beyan: anahtar yalnız alanı
 * TAŞIYAN projeksiyonlarda (fabrika kataloğu kolonları) kabul edilir, diğerinde 400.
 */
export const LIST_ID_FILTERS: Readonly<Record<ListIdFilterKey, readonly string[]>> = {
  cariKartId: ["sube", "fason-firma", "siparis", "sevkiyat", "dogrudan-sevk", "cuval", "cari-hesap", "fiyat", "teklif"],
  cariHesapId: ["cari-hareket", "cek-senet", "fatura", "tahsilat-odeme"],
  siparisId: ["siparis-kalemi", "teklif"],
  teklifId: ["teklif-kalemi"],
  urunId: ["siparis-kalemi", "is-emri", "fatura-kalemi", "fiyat", "teklif-kalemi", "standart-maliyet"],
  hizmetId: ["fatura-kalemi", "fiyat"],
};

// ---------------------------------------------------------------- liste anahtar süzgeçleri (D4-KUC3c)
export const LIST_KEY_FILTER_KEYS = ["kategoriAnahtari"] as const;
export type ListKeyFilterKey = (typeof LIST_KEY_FILTER_KEYS)[number];
export const ANAHTAR_SUZGEC_AZAMI = 200;

/**
 * `GET /veri/:projeksiyon?<anahtar>=<metin>` ⇒ kayıttaki AYNI ADLI, FABRİKANIN ürettiği anahtarın birebir eşitliği
 * (bulut kırpmaz, katlamaz, hesaplamaz). Beyansız projeksiyonda ya da uzun değerde 400.
 */
export const LIST_KEY_FILTERS: Readonly<Record<ListKeyFilterKey, readonly string[]>> = {
  kategoriAnahtari: ["kasa-hareketi"],
};

// ---------------------------------------------------------------- liste üyelik süzgeçleri (patron İE ekranı)
export const LIST_MEMBER_FILTER_KEYS = ["cariKartId", "siparisId", "fasonFirmaId", "asama"] as const;
export type ListMemberFilterKey = (typeof LIST_MEMBER_FILTER_KEYS)[number];
/** `asama` üyelik değerleri (fabrika `work-order-facts` aşama anahtarları; `diger` süzülmez). */
export const ASAMA_DEGERLERI = ["fason", "kursun", "tambur", "depo", "sevkEdildi"] as const;
export type AsamaDegeri = (typeof ASAMA_DEGERLERI)[number];

/**
 * `GET /veri/:projeksiyon?<anahtar>=<değer>` ⇒ kayıttaki fabrikanın ürettiği DİZİ alanı değeri İÇERİR. Projeksiyon →
 * anahtar → dizi alanı. Bir projeksiyonda üyelik beyanı olan anahtar kimlik eşitliği olarak OKUNMAZ; beyansız 400.
 */
export const LIST_MEMBER_FILTERS: Readonly<Record<string, Readonly<Partial<Record<ListMemberFilterKey, string>>>>> = {
  "is-emri": { cariKartId: "cariKartIdleri", siparisId: "siparisIdleri", fasonFirmaId: "fasonFirmaIdleri", asama: "asamalar" },
};

/** `GET /oturum` `liste` — bu sunucunun liste yetenekleri; eski sunucu göndermez (istemci süzgeçli görünümü gizler). */
export interface ListCapabilities {
  readonly kimlikSuzgecleri: Readonly<Partial<Record<ListIdFilterKey, readonly string[]>>>;
  readonly aranabilir: readonly string[];
  /** D4-KUC3c; eski sunucu göndermez ⇒ istemci anahtar süzgecini (kasa kategori çipleri) gizler. */
  readonly anahtarSuzgecleri?: Readonly<Partial<Record<ListKeyFilterKey, readonly string[]>>>;
  /** Projeksiyon → üyelik süzgeci anahtarları; eski sunucu göndermez ⇒ istemci İE süzgeçlerini (konum, firma, sipariş) gizler. */
  readonly uyelikSuzgecleri?: Readonly<Record<string, readonly ListMemberFilterKey[]>>;
  /**
   * Projeksiyon → bu sunucunun sıralayabildiği alanlar (`LIST_SORT` ⊇ bu). Eski sunucu göndermez ⇒ istemci sıralama
   * seçimini gizler (eski sıra: en yeni önce). ERP kipi yalnız SAKLI kolonu olan alanları beyan eder.
   */
  readonly siralama?: Readonly<Record<string, readonly string[]>>;
}

// ---------------------------------------------------------------- liste sıralaması (veri tablosu, D7)
/** Sıralama anahtarının türü: metin Türkçe katlamalı (arama ile aynı katlama), sayı sayısal, tarih ISO metni. */
export type ListSortKind = "metin" | "sayi" | "tarih";
export type ListSortDir = "artan" | "azalan";
export const LIST_SORT_DIRS: readonly ListSortDir[] = ["artan", "azalan"];

/**
 * `GET /veri/:projeksiyon?sirala=<alan>&yon=artan|azalan` — yalnız burada beyanlı alan sıralanır (diğerinde 400);
 * boş değer her iki yönde SONDA; eşitlik kayıt kimliğiyle bozulur, imleç sıralamayla devam eder. Bulut hesap yapmaz:
 * alan fabrikanın gönderdiği hâliyle karşılaştırılır. `sirala` yoksa eski sıra (en yeni önce) korunur.
 */
export const LIST_SORT: Readonly<Record<string, Readonly<Record<string, ListSortKind>>>> = {
  siparis: { siparisNo: "metin", musteriAdi: "metin", siparisTarihi: "tarih", termin: "tarih", acikMiktar: "sayi", sevkMiktari: "sayi" },
  "is-emri": { isEmriNo: "metin", musteriAdi: "metin", topSayisi: "sayi", metre: "sayi", planBitis: "tarih", olusturulma: "tarih" },
  sevkiyat: { sevkNo: "metin", musteriAdi: "metin", cikisTarihi: "tarih", toplamMetre: "sayi", topSayisi: "sayi" },
  "cari-kart": { ad: "metin", kod: "metin", il: "metin" },
};

// ---------------------------------------------------------------- görünüm tercihleri (veri tablosu, D7)
/** `GET|POST /oturum/tercihler/:anahtar` — hesabın KENDİ görünüm tercihi; beyaz listeli anahtar, değer boyut sınırlı JSON. */
export const VIEW_PREF_KEYS = ["tablo.siparis", "tablo.is-emri", "tablo.sevkiyat", "tablo.cari-kart"] as const;
export type ViewPrefKey = (typeof VIEW_PREF_KEYS)[number];
/** Değerin JSON metni en çok bu kadar bayt (UTF-8); DB CHECK'i iki katıyla son seddir. */
export const VIEW_PREF_MAX_BYTES = 4096;

/** `GET` yanıtı (hiç yazılmadıysa `deger` null) ve `POST` (`{ deger: nesne }`, tam yerine koyma) yanıtı. */
export interface ViewPreference {
  readonly anahtar: ViewPrefKey;
  readonly deger: unknown;
  readonly guncelleme: string | null;
}

// ---------------------------------------------------------------- şimdi eşitle (D8)
export const SYNC_NOW_SCOPES = ["KISMI", "TAM"] as const;
/** KISMI: artımlı tur + bütün anlıklar · TAM: ek olarak uzlaştırma (sayısı tutmayan küme baştan gönderilir). */
export type SyncNowScope = (typeof SYNC_NOW_SCOPES)[number];
/** Tesis başına iki kabul edilen istek arası en az (her kapsam). */
export const SYNC_NOW_MIN_GAP_MS = 60_000;
/** Tesis başına iki TAM istek arası en az. */
export const SYNC_NOW_FULL_GAP_MS = 15 * 60_000;

/**
 * `POST /api/esitleme/simdi` `{ kapsam? }` — BEKLIYOR: işaret açık, fabrika bir sonraki yoklamada alır ·
 * YAKIN_ZAMANDA: aralık dolmadı, işaret açılmadı. `sonrakiMumkun` bir sonraki kabul edilebilir an (ISO).
 */
export interface SyncNowResponse {
  readonly durum: "BEKLIYOR" | "YAKIN_ZAMANDA";
  readonly kapsam: SyncNowScope;
  readonly sonrakiMumkun: string;
}

// ---------------------------------------------------------------- cari kilidi (D4-I6)

/**
 * `cari-hesap` kaydının `kilit` alanı (fabrika türetir): aktif kilit, yoksa en son açılan; hiç kilit yoksa `null`.
 * Eski fabrika alanı GÖNDERMEZ (`undefined`) → "fabrika güncellenince gelir". Serbest sebep metni ve kişi buluta gelmez.
 */
export interface CariLock {
  readonly durum: "AKTIF" | "ACILDI";
  readonly kilitId: string;
  readonly kapsam: readonly string[];
  readonly sebepKodu: string;
  readonly baslangic: string;
  readonly acilis: string | null;
}

/** Kapsam kodu → görünen ad (bilinmeyen kod olduğu gibi gösterilir). */
export const CARI_LOCK_SCOPE_LABELS: Readonly<Record<string, string>> = { KABUL: "yeni iş kabulü", SEVK: "sevk", FATURA: "fatura onayı" };
/** Sebep kodu → görünen ad (fabrika `CARI_HOLD_REASON_LABELS` ile aynı). */
export const CARI_LOCK_REASON_LABELS: Readonly<Record<string, string>> = { BORC: "Borç", RISK: "Risk", ANLASMAZLIK: "Anlaşmazlık", DIGER: "Diğer" };

// ---------------------------------------------------------------- standart maliyet varyantı (SY-N3)

/**
 * `standart-maliyet` kaydının varyant alanları (fabrika kolonu + türetir). Aynı ürünün desen geneli ve varyant sürümleri
 * ayrı zincirdir: anahtar `urunId` + `varyantId`; desen geneli sürümde üçü `null`. Eski fabrika alanları GÖNDERMEZ
 * (`undefined`) → desen geneli sayılır.
 */
export interface StandardCostVariantFields {
  readonly varyantId?: string | null;
  readonly varyantAdi?: string | null;
  readonly varyantKodu?: string | null;
}

// ---------------------------------------------------------------- iş emri sevke hazırlığı (D4-J5)

/**
 * `is-emri` kaydının `sevkeHazir` alanı (fabrika `ship-readiness` ile türetir; bulut ve uygulama hesap YAPMAZ).
 * Canlı topu olmayan iş emrinde `null`; eski fabrika alanı GÖNDERMEZ (`undefined`) → rozet yok.
 * Metreler tel ondalığıdır (string ya da sayı); yalnız biçimlenir.
 */
export interface WorkOrderShipReadiness {
  readonly durum: "HAZIR" | "KISMEN" | "YOK";
  readonly hazirTop: number;
  readonly hazirMetre: string | number;
}

/** Durum kodu → rozet metni; `YOK` ve bilinmeyen kod rozet çizmez. */
export const SHIP_READINESS_LABELS: Readonly<Record<string, string>> = { HAZIR: "Sevke hazır", KISMEN: "Kısmen hazır" };

// ---------------------------------------------------------------- masraf özeti (D4-H2)

/** `ozet-masraf` ay hücresi: fabrika ayı `YYYY-MM` + net TL (tel ondalığı). */
export interface ExpenseMonthCell {
  readonly ay: string;
  readonly tutar: string;
}

/**
 * `ozet-masraf` kategori satırı (kategori METNİ fabrikadaki gibi; kişi adı yazılmaması panelde istenir). İlk 15 kategori
 * adıyla, kalanlar tek "Diğer" satırında (`digerMi`, `kategoriSayisi`). Toplam, fark ve pay FABRİKANINDIR — bulut ve
 * uygulama toplamaz, çıkarmaz; yalnız basar.
 */
export interface ExpenseCategoryRow {
  readonly etiket: string;
  /** Kasa hareketi `kategoriAnahtari` ile aynı (fabrika üretir); "Diğer"de null; eski fabrika göndermez (D4-KUC3c). */
  readonly kategoriAnahtari?: string | null;
  readonly digerMi: boolean;
  readonly kategoriSayisi: number;
  readonly toplam: string;
  readonly buAy: string;
  readonly gecenAy: string;
  readonly fark: string;
  /** Bu ayki masraf içindeki pay, yüzde (0–100). */
  readonly buAyPay: number;
  readonly aylik: readonly ExpenseMonthCell[];
}

/** `GET /anlik/ozet-masraf` verisi (izin `bulut:kasa:oku`): son 12 fabrika ayı; eski fabrika anlığı GÖNDERMEZ (404). */
export interface ExpenseSummarySnapshot {
  readonly aylar: readonly string[];
  readonly buAy: string;
  readonly gecenAy: string;
  readonly toplam: string;
  readonly buAyToplam: string;
  readonly gecenAyToplam: string;
  readonly fark: string;
  readonly aylikToplam: readonly ExpenseMonthCell[];
  readonly kategoriler: readonly ExpenseCategoryRow[];
}

// ---------------------------------------------------------------- kârlılık özeti (D4-G4)

/**
 * `karlilik-ozet` tutar kümesi (TL, tel ondalığı). Eksik girdili kalem 0 yazılmaz: `katki`/`net` `null` ve `rozet`
 * fabrikanın metni ("eksik: sarf normu, döviz kuru" · "tahmini" · ""). Bulut ve uygulama hesaplamaz, yalnız basar.
 */
export interface ProfitMoney {
  readonly gelir: string;
  readonly katki: string | null;
  readonly net: string | null;
  readonly rozet: string;
}

/** `karlilik-ozet` ay satırı: fabrika ayı `YYYY-MM`. */
export interface ProfitMonthRow extends ProfitMoney {
  readonly ay: string;
}

/** `karlilik-ozet` adlı satır (bu ayın işlemi ya da müşteri); müşteri sıralaması FABRİKADA. */
export interface ProfitNamedRow extends ProfitMoney {
  readonly etiket: string;
}

/** `GET /anlik/karlilik-ozet` verisi (izin `bulut:maliyet:oku`): son 12 fabrika ayı; eski fabrika anlığı GÖNDERMEZ (404). */
export interface ProfitSummarySnapshot {
  readonly buAy: string;
  /** Hesap ayarlarının okuma anındaki özeti (panel raporu başlığıyla aynı metin). */
  readonly hesap: string;
  readonly donem: ProfitMoney & { readonly sarf: string | null; readonly makine: string | null; readonly disFason: string | null };
  readonly aylar: readonly ProfitMonthRow[];
  readonly buAyIslemler: readonly (ProfitNamedRow & { readonly metre: string })[];
  /** Katkısı en yüksek ilk 10 müşteri (katkı > 0, azalan). */
  readonly enKarli: readonly ProfitNamedRow[];
  /** Katkısı en düşük ilk 10 müşteri (katkı < 0, artan). */
  readonly enZararli: readonly ProfitNamedRow[];
  /** Katkısı eksik girdi yüzünden hesaplanamayan müşteri sayısı. */
  readonly hesaplanamayanMusteri: number;
}

// ---------------------------------------------------------------- fason · emanet (genel fason PB1)

/**
 * `ozet.stok.emanet` (isteğe bağlı): müşteri malı (emanet) — fabrikanın emanet modülü açıkken; o zaman `ozet.stok`un ham/
 * yarı mamul/bitmiş rakamları BİZİM stoktur ve emanet bu ayrı satırdadır. Eski fabrika ya da kapalı modül alanı GÖNDERMEZ.
 */
export interface StockConsignedLine {
  readonly adet: number;
  readonly miktar: number;
}

/** Emanet bakiyesi: top (adet · metre) + iplik kg + levent. `null` = o modül fabrikada kapalı (ölçülmedi; 0 değil). */
export interface ConsignedBalance {
  readonly topAdet: number;
  readonly topMiktar: number;
  readonly iplikKg: string | null;
  readonly leventAdet: number | null;
}

/** `GET /anlik/emanet-bakiye` (izin `bulut:stok:oku`): müşteri başına içerideki emanet; sıra fabrikada. Eski fabrika 404. */
export interface ConsignedBalanceSnapshot {
  readonly toplam: ConsignedBalance;
  readonly cariler: readonly (ConsignedBalance & { readonly cariKartId: string; readonly etiket: string })[];
}

/** `fason-acik` firma satırı (sıra fabrikada: geciken azalan, açık azalan, ad). */
export interface SubcontractOpenFirm {
  readonly fasonFirmaId: string;
  readonly etiket: string;
  readonly acikSevk: number;
  readonly geciken: number;
  readonly kalanMiktar: string;
  readonly iplikKg: string;
  readonly leventAdet: number;
  /** Firmada duran top kırılımı (fabrika 2026-11-19+; İE firma süzgeciyle aynı küme). Eski fabrika göndermez. */
  readonly acikTop?: number;
  readonly enEskiGonderim?: string | null;
  readonly isEmriSayisi?: number;
  readonly musteriler?: readonly { readonly cariKartId: string | null; readonly ad: string | null; readonly top: number; readonly metre: string }[];
  readonly urunler?: readonly { readonly urunId: string; readonly urunAdi: string | null; readonly renkId: string | null; readonly renkAdi: string | null; readonly top: number; readonly metre: string }[];
}

/**
 * `GET /anlik/fason-acik` (izin `bulut:uretim:oku`): fasondaki açık işler — fabrikanın Fason Kokpiti özeti. Gecikme
 * fabrika gününden ve fabrikada hesaplanır (saatlik). `kirpildi` = firma şeridi ilk N sevkten. Eski fabrika 404.
 */
export interface SubcontractOpenSnapshot {
  readonly acikSevk: number;
  readonly geciken: number;
  readonly yaklasan: number;
  readonly kalanMiktar: string;
  readonly kirpildi: boolean;
  /** Fasonda duran top · farklı İE · farklı müşteri (fabrika 2026-11-19+); eski fabrika göndermez. */
  readonly acikTop?: number;
  readonly isEmriSayisi?: number;
  readonly musteriSayisi?: number;
  readonly firmalar: readonly SubcontractOpenFirm[];
}

/** `hizmet-geliri` dönem bloğu: onaylı satış faturasının hizmet satırları, hizmet kartı (süreç) başına; TL fabrikada. */
export interface ServiceRevenuePeriod {
  readonly toplamTl: string;
  readonly kalemler: readonly { readonly hizmetId: string; readonly etiket: string; readonly miktar: string; readonly birim: string; readonly tutarTl: string }[];
}

/** `GET /anlik/hizmet-geliri` (izin `bulut:fatura:oku`): fabrikanın dört standart dönemi. Eski fabrika 404. */
export interface ServiceRevenueSnapshot {
  readonly bugun: ServiceRevenuePeriod;
  readonly buAy: ServiceRevenuePeriod;
  readonly gecenAy: ServiceRevenuePeriod;
  readonly son30Gun: ServiceRevenuePeriod;
}

/** `stok-kalem` kalem satırı (ham: kumaş · bitmiş: kumaş + en + renk + kat); sıra fabrikada. */
export interface StockKalemRow {
  readonly anahtar: string;
  readonly urunId: string;
  readonly urun: string;
  readonly en: number | null;
  readonly renk: string | null;
  readonly kat: string | null;
  readonly top: number;
  readonly metre: number;
  /** Kalemin en eski topunun rafta fabrika takvim günü. */
  readonly enEskiGun: number | null;
}

/** `stok-kalem` raf topu; `kalem` = kalem satırının `anahtar`ı; `gun` rafa girişten bu yana fabrika takvim günü. */
export interface StockKalemRoll {
  readonly id: string;
  readonly topNo: string | null;
  readonly kalem: string;
  readonly metre: number;
  readonly kg: number | null;
  readonly parti: string | null;
  readonly depo: string | null;
  readonly gun: number | null;
}

/** `stok-kalem` bölümü: toplamlar ve kalemler TÜM kümeden; `toplar` en yaşlı önce, tavanlı (`toplarKirpildi`). */
export interface StockKalemSection {
  readonly toplamTop: number;
  readonly toplamMetre: number;
  readonly kalemler: readonly StockKalemRow[];
  readonly toplar: readonly StockKalemRoll[];
  readonly toplarKirpildi: boolean;
}

/**
 * `GET /anlik/stok-kalem` (izin `bulut:stok:oku`): rafın kalem listesi + topları, ham ve bitmiş ayrı (saatlik).
 * `emanet` yalnız fabrikanın emanet modülü açıkken (o zaman bölümler BİZİM stok). Eski fabrika 404.
 */
export interface StockKalemSnapshot {
  readonly ham: StockKalemSection;
  readonly bitmis: StockKalemSection;
  readonly emanet?: { readonly hamTop: number; readonly hamMetre: number; readonly bitmisTop: number; readonly bitmisMetre: number };
}

/** `cuval-deposu` çuvaldaki top (hayalet hariç). */
export interface SackDepotRoll {
  readonly id: string;
  readonly topNo: string | null;
  readonly urun: string;
  readonly renk: string | null;
  readonly en: number | null;
  readonly kat: string | null;
  readonly kalite: string | null;
  readonly metre: number;
}

/** `cuval-deposu` birimi (çuval · araba · dökme); `durum` SEVKE_ATANDI = onay bekleyen sevkiyata atanmış. */
export interface SackDepotUnit {
  readonly id: string;
  readonly cuvalNo: string;
  readonly tur: "SACK" | "CART" | "BULK";
  readonly etiket: string | null;
  readonly cariKartId: string | null;
  readonly cari: string | null;
  readonly sube: string | null;
  readonly durum: "DEPODA" | "SEVKE_ATANDI";
  readonly sevkiyatId: string | null;
  readonly sevkiyatNo: string | null;
  readonly kg: number | null;
  readonly top: number;
  readonly metre: number;
  /** Fabrika günü `YYYY-MM-DD`. */
  readonly olusturulma: string;
  readonly toplar: readonly SackDepotRoll[];
}

/** Çuval sayıları; `kg` = tartılı birimlerin toplamı (`null` = hiç tartılı yok). */
export interface SackDepotCounts {
  readonly cuval: number;
  readonly top: number;
  readonly metre: number;
  readonly kg: number | null;
}

/**
 * `GET /anlik/cuval-deposu` (izin `bulut:sevkiyat:oku`): sevk edilmemiş birimler (havuz + onay bekleyen sevkiyat), saatlik.
 * Özet ve cari kovası fabrikada; `cuvallar` yeni önce, tavanlı (`kirpildi`). Eski fabrika 404.
 */
export interface SackDepotSnapshot {
  readonly ozet: SackDepotCounts & { readonly tartiliCuval: number; readonly sevkeAtanan: number };
  readonly cariler: readonly (SackDepotCounts & { readonly cariKartId: string | null; readonly ad: string })[];
  readonly cuvallar: readonly SackDepotUnit[];
  readonly kirpildi: boolean;
}

/** `sevkiyat-icerigi` top satırı: `iade` = sevkten sonra iade alındı (BRÜT içerikte kalır); `yok` = çuvalda kayıtlı, binada değil. */
export interface ShipmentContentRoll {
  readonly id: string;
  readonly topNo: string | null;
  readonly urun: string | null;
  readonly renk: string | null;
  readonly en: string | null;
  readonly metre: string;
  readonly iade: boolean;
  readonly iadeTarihi: string | null;
  readonly yok: boolean;
}

/** `sevkiyat-icerigi` çuvalı (sıra fabrikada); sayılar BRÜT (iade dahil). */
export interface ShipmentContentSack {
  readonly id: string;
  readonly cuvalNo: string;
  readonly sira: string | null;
  readonly tur: string;
  readonly etiket: string | null;
  readonly kg: string | null;
  readonly top: number;
  readonly metre: string;
  readonly iadeTop: number;
  readonly iadeMetre: string;
  readonly toplar: readonly ShipmentContentRoll[];
}

/**
 * `GET /veri/sevkiyat-icerigi/:sevkiyatId` kayıt alanı (izin `bulut:sevkiyat:oku`): sevkiyatın çuval → top dökümü,
 * fabrikanın sevkiyat ayrıntısıyla aynı (BRÜT). Eski fabrika/bulut 404 → uygulama bölümü gizler.
 */
export interface ShipmentContent {
  readonly sevkNo: string;
  readonly durum: string;
  readonly cikisTarihi: string | null;
  readonly olusturulma: string;
  readonly ozet: { readonly cuval: number; readonly top: number; readonly metre: string; readonly kg: string; readonly tartiliCuval: number; readonly iadeTop: number; readonly iadeMetre: string };
  readonly cuvallar: readonly ShipmentContentSack[];
  readonly cuvalsizToplar: readonly ShipmentContentRoll[];
}

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

/**
 * `GET /api/degisim?since=<n>&bekle=<0..25>` uzun yoklama: `sayac > since` olunca ya da süre dolunca döner.
 * İçerik taşımaz; `degisenler` hesabın okuyabildiği projeksiyon adlarıdır (halka eskiyse hepsi);
 * `fabrikaDamgasi` son paketin ufku (fabrika veri anı, ISO). Uç yoksa (eski sunucu) 404 → yoklama kipi.
 */
export interface ChangeFeed { readonly sayac: number; readonly degisenler: readonly string[]; readonly fabrikaDamgasi: string | null }

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

/**
 * `POST /oturum/hesap-sil` (parola + TOTP) — kendi hesabını silme: kimlik ve bütün tesis üyelikleri HEMEN kapanır, bütün
 * oturumlar düşer; kişisel veri `silinme` anında silinir. Son aktif yöneticisi olunan tesis varsa 409 `SON_YONETICI`
 * (`details.tesisler`: `{id, ad}[]`); yanlış faktör 400 `GIRIS_BASARISIZ`.
 */
export interface AccountDeletion {
  readonly kapanis: string;
  readonly silinme: string;
  readonly tesisSayisi: number;
}

export interface Device {
  readonly id: string;
  readonly platform: string;
  readonly ad: string | null;
  readonly aktif: boolean;
  readonly sonGorulme: string;
  readonly olusturulma: string;
}

/** `POST /cihazlar/birak` — çıkışta bu telefonun bildirim bağı bırakılır (kimliğin bütün tesislerinde kendi satırları). */
export interface DeviceRelease {
  readonly birakilan: number;
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
  "cari-kilit",
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

/** `POST /bildirim/deneme` — kendi etkin cihazlarına tek deneme (hız sınırlı; geçmişe yazılmaz). */
export interface TestNotificationResult {
  readonly gonderilen: number;
  readonly cihazlar: readonly { readonly id: string; readonly ad: string | null; readonly platform: string; readonly sonuc: "OK" | "GECERSIZ_CIHAZ" | "GECICI" | "KALICI" }[];
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

// ---------------------------------------------------------------- rapor sunumu (Raporlar v2, R1-BULUT)
// Fabrikanın `Teks-Erp/src/services/reports/sunum/sunum.types.ts` gövdesi AYNEN (bekçi `test_rapor_sunum_aynasi` §4
// gövdeyi bayt-eşit ölçer). v2 rapor sonucunun `veri`si bu zarftır; bulut saklar, uygulama basar — hesap yok.
/** Ölçü birimi — kapalı küme; görünen metni `BIRIM_METNI`nden okunur. */
export type Birim =
  | "m"
  | "kg"
  | "top"
  | "adet"
  | "siparis"
  | "levent"
  | "parti"
  | "yuzde"
  | "puan"
  | "gun"
  | "dakika"
  | "saat"
  | "TRY"
  | "USD"
  | "EUR";

/** Birimin cümlede ve kartta görünen metni. `yuzde` sayının ÖNÜNE yazılır ("%12"). */
export const BIRIM_METNI: Readonly<Record<Birim, string>> = {
  m: "m",
  kg: "kg",
  top: "top",
  adet: "adet",
  siparis: "sipariş",
  levent: "levent",
  parti: "parti",
  yuzde: "%",
  puan: "puan",
  gun: "gün",
  dakika: "dk",
  saat: "saat",
  TRY: "TL",
  USD: "USD",
  EUR: "EUR",
};

/** Para birimleri 0 ondalıkla basılır; diğerleri en çok 1 ondalık. */
export const PARA_BIRIMLERI: readonly Birim[] = ["TRY", "USD", "EUR"];

/** Ölçünün hangi yöne gitmesi iyi — kıyas okunun rengi buradan. */
export type IyiYon = "yukari" | "asagi" | "notr";

export type KiyasYonu = "artti" | "azaldi" | "degismedi";

/** Kıyasın renk yorumu (iyiYon × yön). Ölçülemeyen kıyas "notr"dur. */
export type ComparisonTone = "iyi" | "kotu" | "notr";

export interface AnaSayiKiyas {
  /** Kıyas döneminin değeri; ölçülemediyse `null` (0 DEĞİL). */
  deger: number | null;
  /** simdi − once; iki taraftan biri ölçülemediyse `null`. */
  fark: number | null;
  /** Göreli değişim %; önceki değer 0 ya da ölçülemediyse `null`. */
  yuzde: number | null;
  /** Eşik altı değişim "degismedi"; fark ölçülemediyse `null`. */
  yon: KiyasYonu | null;
  durum: ComparisonTone;
}

export interface AnaSayi {
  /** Ölçü kimliği (semantik sözlük anahtarı). */
  olcu: string;
  /** Günlük dilde ad ("Zamanında teslim"). */
  ad: string;
  deger: number | null;
  birim: Birim;
  /** `deger` null ise NEDEN (Türkçe, kullanıcıya gösterilir). */
  olculemedi?: string;
  kiyas?: AnaSayiKiyas;
}

/** Anlatı motorunun ürettiği tek cümle; `kanit` cümlenin dayandığı sayılardır (JSON-güvenli). */
export interface AnlatiCumlesi {
  kural: string;
  /** 0–1; mutlak etki × güven. Sıralama bu puanla, eşitlikte kural sırasıyla. */
  onem: number;
  metin: string;
  kanit: Record<string, unknown>;
  /** Cümle para birimli bir ölçüden doğdu (fabrika işaretler) — fiyat izni olmayan patron hesabında bulut atlar. */
  paraIcerir?: true;
}

export const GRAFIK_TURLERI = [
  "cizgi",
  "cubuk",
  "yiginCubuk",
  "pasta",
  "isiHaritasi",
  "sacilim",
  "kutu",
  "kucukCoklu",
] as const;
export type GrafikTuru = (typeof GRAFIK_TURLERI)[number];

export interface GrafikSerisi {
  ad: string;
  veri: (number | null)[];
  /** Önceki dönem serisi soluk çizilir. */
  soluk?: boolean;
}

export interface GrafikBlok {
  tur: GrafikTuru;
  eksen: {
    x: { ad: string; tur: "zaman" | "kategori" | "sayi" };
    y: { ad: string; birim: Birim };
  };
  seriler: GrafikSerisi[];
  kategoriler: string[];
}

export interface TabloKolonu {
  anahtar: string;
  baslik: string;
  birim?: Birim;
  hiza?: "sol" | "sag" | "orta";
}

export type TabloHucresi = string | number | null;

export interface TabloBlok {
  kolonlar: TabloKolonu[];
  satirlar: Record<string, TabloHucresi>[];
  toplam?: Record<string, TabloHucresi>;
  /** Satır tavanı kestiyse kaç satır gösterildi / kaç vardı. */
  kesildi?: { gosterilen: number; toplam: number };
}

export interface ParametreSecenegi {
  deger: string;
  etiket: string;
}

export interface ParametreBeyani {
  ad: string;
  etiket: string;
  tur: "tarih" | "secim" | "cokluSecim" | "sayi" | "metin" | "bayrak";
  /** Seçim yokluğu ("Tümü") `null`dır; boş dizi YAZILMAZ. */
  deger: string | number | boolean | string[] | null;
  secenekler?: ParametreSecenegi[];
}

/** Küçük çoklunun tek hücresi: o değerle SÜZÜLMÜŞ ana koşunun ana sayısı (kıyası dahil). */
export interface VaryantHucresi {
  deger: string;
  ad: string;
  anaSayi: AnaSayi;
}

/** Varyant görünümü: hangi boyutun hangi değerine bakılıyor, tek tıkla diğerleri. */
export interface VaryantBlok {
  boyut: string;
  boyutEtiketi: string;
  secili: ParametreSecenegi | null;
  digerleri: ParametreSecenegi[];
  /** Hücreye tıklanınca yazılacak süzgeç anahtarı (ucun kendi sorgu anahtarı). */
  suzgecAnahtari?: string;
  /** Küçük çoklular — en büyük ≤ 6 değer, büyükten küçüğe. */
  hucreler?: VaryantHucresi[];
}

export interface DonemAraligi {
  from: string;
  to: string;
  etiket: string;
}

/** Çok dönemli kıyasın tek sütunu. */
export interface DonemBlok extends DonemAraligi {
  anaSayi: AnaSayi;
}

export interface RaporTanimi {
  ad: string;
  aciklama: string;
}

export interface RaporSunumu {
  anahtar: string;
  baslik: string;
  /** Raporun cevapladığı soru ("Sözümüzü tuttuk mu?"). */
  soru: string;
  donem: DonemAraligi;
  kiyasDonemi?: DonemAraligi;
  anaSayi: AnaSayi;
  /** En çok 3. */
  yanSayilar: AnaSayi[];
  /** Önem sırasıyla; ekran ilk 3'ü, PDF ilk 5'i basar (çağıran keser). */
  anlati: AnlatiCumlesi[];
  grafik: GrafikBlok | null;
  tablo: TabloBlok | null;
  tanimlar: RaporTanimi[];
  parametreler: ParametreBeyani[];
  varyant?: VaryantBlok;
  donemler?: DonemBlok[];
  uyarilar: string[];
  /** Kişi adı taşır (ör. operatör kırılımı) — patron bulutu sunumu okuyup bu raporu dışlar (K-KISI). */
  kisiAdi?: true;
}

export const SIDE_FIGURE_LIMIT = 3;
export const ANLATI_EKRAN_SAYISI = 3;
export const ANLATI_PDF_SAYISI = 5;
