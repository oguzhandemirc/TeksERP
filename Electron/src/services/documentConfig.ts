// =============================================================================
// Belge içerik ayarı — Genel Ayarlar paneli + yazdırma bileşenleri ortak kaynağı.
// Backend `system-setting.service.ts` (DOCUMENTS_CONFIG / COMPANY_LETTERHEAD) ile
// aynı sözleşme — manuel senkron tutulur (FeatureFlags gibi). Ayar CANLI okunur:
// irsaliye/çeki her açıldığında güncel config'i yansıtır (snapshot DEĞİL).
// =============================================================================

/** Belge künyesi — firma adının (ayrı) altına basılan ek satırlar. */
export interface CompanyLetterhead {
  addressLine: string;
  phone: string;
  taxInfo: string;
  /** Serbest ek künye satırları (IBAN, Mersis, web...) — max 5. */
  extraLines?: string[];
}

export const DEFAULT_COMPANY_LETTERHEAD: CompanyLetterhead = {
  addressLine: "",
  phone: "",
  taxInfo: "",
  extraLines: [],
};

/** Görünüm ayarı — backend `document-render/doc-style.ts` ile aynı sözleşme. */
export interface DocStyleConfig {
  pageSize?: "A4" | "A5";
  margins?: { top?: number; right?: number; bottom?: number; left?: number };
  /** 0.7–1.4 (default 1). */
  fontScale?: number;
  fontWeight?: "light" | "normal" | "bold";
  tableDensity?: "compact" | "normal" | "relaxed";
  tableStyle?: "grid" | "zebra" | "plain";
}

/** Tek belgenin saklanan (ham, kısmi) içerik ayarı. Verilmeyen alan varsayılana çözülür. */
export interface DocumentConfig {
  titleOverride?: string;
  showLetterhead?: boolean;
  sections?: Record<string, boolean>;
  signatureLabels?: string[];
  showSignatures?: boolean;
  footerNote?: string;
  /** Görünüm (sayfa/font/tablo) — backend renderer çözer. */
  style?: DocStyleConfig;
  /** Firma logosu basılsın mı (default true — logo yüklüyse). */
  showLogo?: boolean;
  /** Logo konumu (default left). */
  logoPosition?: "left" | "right";
  /**
   * Tablo kolonu aç/kapa + sıralama: { [tabloKey]: { hidden, order, shown } }.
   * `hidden` = BLOCKLIST (normal kolonlar; listede yoksa görünür).
   * `shown`  = ALLOWLIST, yalnız `defaultHidden` kolonlar için (iç veri taşıyanlar,
   *            ör. çuval yorumu): listede YOKSA basılmaz ve o kolonda `hidden`
   *            YOK SAYILIR. Yeni kolon eklemek mevcut belgeleri kirletmesin diye.
   */
  columns?: Record<string, { hidden?: string[]; order?: string[]; shown?: string[] }>;
  /** Belge doğrulama karekodu (belge no + versiyon) — default kapalı. */
  qr?: boolean;
  /** Sayfa altı damgaları: basım zamanı / basan kullanıcı / nüsha etiketi. */
  stamps?: { printedAt?: boolean; printedBy?: boolean; copyLabel?: string };
  /** Konumlu serbest metin blokları (yasal ibare vb.) — max 4 × 500 karakter. */
  blocks?: { position: "afterHeader" | "beforeSignatures"; text: string }[];
  /** Belge dili — yalnız dil destekli belgelerde (DOC_DEF.supportsLanguage). */
  language?: "tr" | "en" | "auto";
  /** En kolonları basılsın ama BOŞ gelsin (elle doldurulacak). Default false. */
  blankWidths?: boolean;
  /** Alt notun konumu: "bottom" (default, tablolardan sonra) | "top" (tablolardan
   *  önce). Yalnız supportsNotePlacement belgelerde (sevk irsaliyesi) etkilidir. */
  footerNotePlacement?: "top" | "bottom";
  /** ALAN BAZLI yazı ayarı: { [alanKey]: { size, weight } }. `style.fontScale` /
   *  `style.fontWeight` TÜM belgeye uygulanır; bu ise tek alanı (ör. grid'deki
   *  METRE değeri) ayrı ayarlar — genel ayar bunun ÜSTÜNE biner. Alan kataloğu
   *  belgeye özeldir (`DocDef.fields`). */
  fields?: Record<string, DocFieldStyle>;
  /** Konumlandırılabilir bölümler: { [bölümKey]: "left" | "right" }. Bugün yalnız
   *  `batchInfo` (parti no — başlığın sol/sağ bloğu; default "right"). */
  placements?: Record<string, "left" | "right">;
  /** Fason çeki grid'inde satır başına grup sayısı (3|4|5; default 5 = fiziksel
   *  form). Az grup = geniş hücre → A5'te punto büyütülebilir. */
  gridGroups?: number;
  /**
   * AYARLANABİLİR BOŞ GRID (2026-08-09) — elle doldurulan kutular.
   * OPT-IN: `enabled` false/verilmedi → belgeye TEK BAYT eklenmez.
   * Backend `document-render/doc-style.BlankGridConfig` ile AYNI sözleşme;
   * ikisi birlikte değişir (dördüncü kapı).
   */
  blankGrid?: BlankGridConfig;
  /** Fason çeki grid'inde GRUP BAŞINA SATIR (1–40; default 10).
   *  Sayfa başına top = gridGroups × gridRows (varsayılan 5 × 10 = 50). */
  gridRows?: number;
}

/** Alan bazlı yazı ayarı — backend `document-render/doc-style.ts` ile aynı sözleşme. */
export type DocFieldWeight = "light" | "normal" | "medium" | "bold" | "black";

export interface BlankGridConfig {
  /** OPT-IN. false/verilmedi → hiç basılmaz. */
  enabled?: boolean;
  /** Üst başlık. Boş → başlık satırı basılmaz. */
  title?: string;
  /** Satır sayısı (1–40). */
  rows?: number;
  /** Sütun sayısı (1–12). */
  columns?: number;
  /** Sütun genişlikleri YÜZDE. Sayı sütunla uyuşmazsa TAMAMEN atılır. */
  columnWidths?: number[];
  /** İlk satır sütun başlıkları. Tamamı boşsa başlık satırı hiç basılmaz. */
  headers?: string[];
  /** Konum — serbest metin bloklarıyla aynı iki çıpa. */
  position?: "afterHeader" | "beforeSignatures";
}

export interface DocFieldStyle {
  /** Yazı boyu px. Verilmezse alanın (sayfa boyutuna bağlı) tabanı geçerlidir. */
  size?: number;
  /** Yazı kalınlığı. Verilmezse alanın taban kalınlığı geçerlidir. */
  weight?: DocFieldWeight;
}

export const DOC_FIELD_WEIGHT_LABELS: { value: DocFieldWeight; label: string }[] = [
  { value: "light", label: "İnce" },
  { value: "normal", label: "Normal" },
  { value: "medium", label: "Orta" },
  { value: "bold", label: "Kalın" },
  { value: "black", label: "Çok kalın" },
];

/** Backend `doc-style.ts` ile aynı sınırlar — panel de aynısını gösterir. */
export const DOC_FIELD_SIZE_MIN = 5;
export const DOC_FIELD_SIZE_MAX = 48;

export type DocFieldGroup = "header" | "grid" | "table" | "totals" | "boxes" | "footer";

export const DOC_FIELD_GROUP_LABELS: Record<DocFieldGroup, string> = {
  header: "Başlık bandı",
  grid: "Top / Metre / Cm gridi",
  table: "Tablolar",
  totals: "Alt toplam tablosu",
  boxes: "Kutular ve not",
  footer: "İmza ve damga",
};

/** Panelde tek tek ayarlanabilen alan. `key` backend kataloğuyla BİREBİR aynıdır. */
export interface DocFieldDef {
  key: string;
  label: string;
  group: DocFieldGroup;
}

/** { [belgeKey]: DocumentConfig } — ham saklanır. */
export type DocumentsConfig = Record<string, DocumentConfig>;

/** Çözülmüş (tam) belge config — resolveDocConfig döner; renderer bunu kullanır. */
export interface ResolvedDocConfig {
  title: string;
  /** Ham başlık override'ı — sample-html önizlemesi backend renderer'a HAM alanları
   *  gönderir (renderer titleOverride bekler); title yalnız UI gösterimi içindir. */
  titleOverride?: string;
  showLetterhead: boolean;
  /** Her tanımlı bölüm key'i için boolean (eksikse açık). */
  sections: Record<string, boolean>;
  signatureLabels: string[];
  showSignatures: boolean;
  footerNote: string;
  /** Ham görünüm ayarı — backend renderer varsayılanlarla çözer. */
  style: DocStyleConfig;
  showLogo: boolean;
  logoPosition: "left" | "right";
  /** Ham geçişler — sample-html önizlemesi backend renderer'a aynen taşır. */
  columns: NonNullable<DocumentConfig["columns"]>;
  qr: boolean;
  stamps: NonNullable<DocumentConfig["stamps"]>;
  blocks: NonNullable<DocumentConfig["blocks"]>;
  language: "tr" | "en" | "auto";
  blankWidths: boolean;
  footerNotePlacement: "top" | "bottom";
  /** Ham geçişler — sample-html önizlemesi backend renderer'a aynen taşır. */
  fields: NonNullable<DocumentConfig["fields"]>;
  placements: NonNullable<DocumentConfig["placements"]>;
  gridGroups?: number;
  gridRows?: number;
  blankGrid?: BlankGridConfig;
}

export interface DocSectionDef {
  key: string;
  label: string;
  /** OPT-IN bölüm: varsayılan KAPALI. `DocTableDef.columns[].defaultHidden` ile aynı
   *  gerekçe — `sections` bir BLOCKLIST'tir (anahtar yoksa AÇIK sayılır), yani yeni
   *  bir bölüm MÜŞTERİYE giden canlı bir belgede sormadan görünür doğar. İç/hassas
   *  veri taşıyan bölümler için. Renderer karşılığı `cfg.sections?.<key> === true`.
   *
   *  ⚠️ İki taraf BİRLİKTE değişmeli: yalnız burayı işaretlemek paneli "kapalı"
   *  gösterirken renderer'ı basmaya devam ettirir (ya da tersi — panel "açık" der,
   *  belge boş çıkar).
   *
   *  BUGÜN HİÇBİR BÖLÜM KULLANMIYOR (parti no 2026-08-05'te varsayılan AÇIK'a
   *  çevrildi). Alan yine de duruyor, çünkü asıl değeri `resolveDocConfig`'teki
   *  düzeltmede: orası bölümleri koşulsuz "kayıt yoksa AÇIK" diye çözüyordu, yani
   *  opt-in bir bölüm YAZILAMIYORDU. Kolon tarafındaki ikizi (`sackNote`) aktif
   *  kullanımda — kavram spekülatif değil. */
  defaultHidden?: boolean;
}

/** Tablo kolon kaydı — kolon aç/kapa + sıralama UI'ı bu listeden beslenir.
 *  key'ler backend renderer'daki buildDocTable kolon key'leriyle BİREBİR aynı. */
export interface DocTableDef {
  key: string;
  label: string;
  columns: {
    key: string;
    label: string;
    /** OPT-IN kolon: varsayılan KAPALI, `columns[tablo].shown` ile açılır
     *  (renderer'da `DocCol.defaultHidden`). İç veri taşıyan kolonlar için. */
    defaultHidden?: boolean;
  }[];
}

export interface DocDef {
  key: string;
  label: string;
  defaultTitle: string;
  sections: DocSectionDef[];
  defaultSignatures: string[];
  /** Kolonları yapılandırılabilir tablolar (yoksa kolon paneli gizlenir). */
  tables?: DocTableDef[];
  /** TR/EN dil seçimi destekleniyor mu (yalnız müşteriye giden belgeler). */
  supportsLanguage?: boolean;
  /** En kolonu var → "Enleri boş bırak" (elle doldur) seçeneği gösterilir. */
  supportsBlankWidths?: boolean;
  /** Alt not için üst/alt konum seçimi gösterilsin mi (renderer'ı konumu uyguluyor). */
  supportsNotePlacement?: boolean;
  /** Satır-bazlı not (çuval yorumu) kolonu var → baskı diyaloğunda "bu baskıda
   *  göster" tek-seferlik seçeneği çıkar (?rowNotes=1). */
  supportsRowNotes?: boolean;
  /** Alan bazlı punto/kalınlık kataloğu — backend renderer'ının alan kataloğunun
   *  AYNASI (Electron backend'i import edemez, `permissions.ts` ile aynı durum).
   *  Verilmezse "Alan Ayarları" paneli hiç çizilmez. */
  fields?: DocFieldDef[];
  /** Sol/sağ konumu seçilebilen bölüm key'leri (renderer `placements`'i okuyor). */
  supportsPlacements?: { key: string; label: string }[];
  /** Grid grup sayısı (3/4/5) seçilebilir mi — yalnız fason çekide. */
  supportsGridGroups?: boolean;
  /** Belgenin varsayılan kenar boşluğu (mm) — backend renderer'ındaki
   *  `resolveDocStyle(..., { marginMm })` değerinin aynası. Verilmezse 9.
   *  YALNIZ önizleme çerçevesini çizmek için kullanılır; sapma baskıyı etkilemez
   *  (baskıda gerçek değer backend'den gelir). */
  defaultMarginMm?: number;
  /**
   * TİCARET REJİMİNE AİT BELGE — `finance.enabled` kapalıyken Belge Şablonları
   * seçicisinde LİSTELENMEZ.
   *
   * ⚠️ ÖLÇÜT: belgenin KAYNAĞI fabrika kurulumunda var olabilir mi? Kaynağını
   * yazan uçlar `requireFinanceEnabled` arkasındaysa o belge fabrikada TANIM
   * GEREĞİ doğamaz; şablonunu ayarlatmak "hiç basılmayacak bir kâğıdın
   * yerleşimini kurcalatmak"tır ve "sıfır görünür fark" garantisini bozar.
   *
   * ⚠️ `depoTransfer` ve `malKabul` BİLEREK İŞARETSİZ: `warehouse-transfer
   * .routes` ve `goods-receipt.routes` rejim kapısı TAŞIMAZ (depo defterini
   * fabrika yolları da yazıyor — KK1 girişi/sevk/iade; mal kabul ise İZİNLE
   * kapılı). Kaynakları fabrikada meşru olduğu için belgeleri de meşrudur.
   * Bu alanı bir belgeye eklemeden önce sorulacak soru "ticaret gibi mi
   * duruyor" değil, "kaynağını yazan uç rejim kapılı mı" olmalıdır.
   */
  requiresFinance?: boolean;
}

/**
 * Fason sevk çeki alan kataloğu — backend `document-render/fason-ceki.fields.ts`
 * `FASON_FIELDS` dizisinin AYNASI (key + label + group). Sıra panelde göründüğü
 * sıradır. ⚠️ İki taraf birlikte değişir: burada olmayan bir key panelde
 * ayarlanamaz, backend'de olmayan bir key ise basımda sessizce yok sayılır.
 */
export const FASON_FIELD_DEFS: DocFieldDef[] = [
  { key: "company", label: "Firma adı", group: "header" },
  { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
  { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
  { key: "sayin", label: "Fason firma adı", group: "header" },
  { key: "subLine", label: "İstasyon · iş emri satırı", group: "header" },
  { key: "title", label: "Belge başlığı", group: "header" },
  { key: "docNo", label: "İrsaliye no", group: "header" },
  { key: "docDate", label: "Tarih", group: "header" },
  { key: "batchNo", label: "Parti no", group: "header" },
  { key: "lnLabel", label: "Satır etiketleri (İrsaliye No: / Tarih: / Parti No:)", group: "header" },
  { key: "vehicle", label: "Plaka / şoför satırı", group: "header" },
  { key: "fabricLine", label: "Cins / En / Renk satırları (parti no altı)", group: "header" },

  { key: "gridHead", label: "Grid başlıkları (Top / Metre / Cm)", group: "grid" },
  { key: "gridTop", label: "Grid — top sıra no", group: "grid" },
  { key: "gridMetre", label: "Grid — METRE değeri", group: "grid" },

  { key: "totalsHead", label: "Alt tablo başlıkları (CİNSİ / EN / TOP …)", group: "totals" },
  { key: "totalsCell", label: "Alt tablo değerleri", group: "totals" },
  { key: "totalsFoot", label: "TOPLAM satırı", group: "totals" },

  { key: "boxLabel", label: "Kutu etiketi (İSTENEN ÖZELLİKLER / FASON TALİMATI)", group: "boxes" },
  { key: "boxText", label: "Kutu metni", group: "boxes" },
  { key: "note", label: "Not / alt bilgi", group: "boxes" },

  { key: "signLabel", label: "İmza etiketleri", group: "footer" },
  { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
];

/**
 * PrintedDocType → DOC_DEFS key. Backend `printed-document.service.ts`
 * `DOC_CONFIG_KEYS` ile BİREBİR aynı (manuel senkron, FeatureFlags gibi).
 */
export const DOC_TYPE_TO_KEY: Record<string, string> = {
  SHIPMENT_DISPATCH: "shipmentDispatch",
  SUBCONTRACTOR_DISPATCH: "fasonSevk",
  SUBCONTRACTOR_DIRECT_SHIP: "fasonDirectShip",
  KARTELA_DISPATCH: "kartelaCeki",
  SUBCONTRACTOR_RECEIPT: "fasonKabul",
  QUALITY_CERTIFICATE: "kaliteSertifikasi",
  RETURN_DISPATCH: "iadeIrsaliyesi",
  TRANSFER_DISPATCH: "depoTransfer",
  GOODS_RECEIPT: "malKabul",
  INVOICE_INTERNAL: "fatura",
  PAYMENT_RECEIPT: "tahsilatMakbuzu",
  // Resmi ön muhasebe belgeleri (2026-08-15, J2 #18).
  RECONCILIATION_LETTER: "mutabakatMektubu",
  CHEQUE_DELIVERY_NOTE: "cekTeslimBordrosu",
  // Tam stok sayımı (2026-08-15, J2 #19) — depo belgesi ailesi.
  STOCK_COUNT: "stokSayimi",
};

/**
 * Belge kayıt defteri — yeni belge eklemek = buraya bir satır (+ renderer'da config
 * okuması). Panel ve resolver bu listeyi tek kaynak olarak kullanır.
 */
/**
 * 6 belgenin alan kataloğu — backend `document-render/doc-fields.ts`
 * `DOC_FIELD_CATALOGS` sabitinin AYNASI (key + label + group). Electron
 * backend'i import EDEMEZ (ayrı proje). Bu blok backend kaynağından ÜRETİLDİ;
 * elle düzenlerken iki tarafı BİRLİKTE değiştir — bekçi birebirliği mekanik
 * doğrular. (Fason sevk çekinin kendi kataloğu ayrı: FASON_FIELD_DEFS.)
 */
export const DOC_FIELD_CATALOGS: Record<string, DocFieldDef[]> = {
  shipmentDispatch: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
    { key: "wrapCell", label: "Açıklama hücresi (çuval yorumu)", group: "table" },
  ],
  fasonDirectShip: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "tblCap", label: "Tablo üstü başlık", group: "table" },
  ],
  fasonKabul: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "tblCap", label: "Tablo üstü başlık", group: "table" },
  ],
  kartelaCeki: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "tblCap", label: "Tablo üstü başlık", group: "table" },
  ],
  kaliteSertifikasi: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "tblCap", label: "Tablo üstü başlık", group: "table" },
    { key: "decl", label: "Beyan metni", group: "footer" },
  ],
  iadeIrsaliyesi: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
  ],
  // ── Ticaret paketi: iç depo belgeleri (2026-08-13) ────────────────────────
  // Backend'de `depoTransfer` / `malKabul` (doc-fields.ts) — bekçi ikisinin
  // birebirliğini mekanik doğrular (test_doc_density_fields).
  depoTransfer: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
  ],
  malKabul: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
  ],
  // Stok sayım tutanağı (2026-08-15, J2 #19) — transfer/mal kabul ile AYNI
  // iskelet (`warehouse-doc.html.ts` üçünü tek gövdeden basar), dolayısıyla
  // alan listesi de birebir aynı sırada.
  stokSayimi: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
  ],
  // Ön muhasebe çıktıları — backend `doc-fields.ts` ile BİREBİR (sıra dahil).
  fatura: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
  ],
  tahsilatMakbuzu: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
  ],
  // ── Resmi ön muhasebe belgeleri (2026-08-15, J2 #18) ──────────────────────
  // Aile listesinin AYNISI + `decl` (BEYAN metni). Beyan bu iki belgede süs
  // değil belgenin kendisidir: mektup mutabakat RİCA eder, bordro TESLİM beyan
  // eder. Fatura/makbuzda beyan bloğu hiç basılmadığı için onlarda YOK.
  mutabakatMektubu: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
    { key: "decl", label: "Beyan metni", group: "footer" },
  ],
  cekTeslimBordrosu: [
    { key: "company", label: "Firma adı", group: "header" },
    { key: "letterhead", label: "Künye satırları (adres/tel/vergi)", group: "header" },
    { key: "sayinLabel", label: '"SAYIN:" etiketi', group: "header" },
    { key: "sayin", label: "Müşteri / firma adı", group: "header" },
    { key: "subLine", label: "Alt bilgi satırı (kod / vergi no)", group: "header" },
    { key: "title", label: "Belge başlığı", group: "header" },
    { key: "lnLabel", label: "Sağ blok etiketleri (Belge No: / Tarih:)", group: "header" },
    { key: "lnValue", label: "Sağ blok DEĞERLERİ (belge no, tarih…)", group: "header" },
    { key: "vehicle", label: "Araç / referans satırı", group: "header" },
    { key: "secHead", label: "Tablo başlıkları", group: "table" },
    { key: "secCell", label: "Tablo hücreleri", group: "table" },
    { key: "secTot", label: "TOPLAM satırı", group: "table" },
    { key: "note", label: "Not / alt bilgi", group: "footer" },
    { key: "signLabel", label: "İmza etiketleri", group: "footer" },
    { key: "stamp", label: "Basım damgası (tarih / basan)", group: "footer" },
    { key: "boxTitle", label: "Kutu başlığı", group: "boxes" },
    { key: "boxRow", label: "Kutu satırı (etiket + değer)", group: "boxes" },
    { key: "secCaption", label: "Liste başlığı (tablo içi)", group: "table" },
    { key: "decl", label: "Beyan metni", group: "footer" },
  ],
};

export const DOC_DEFS: DocDef[] = [
  {
    key: "shipmentDispatch",
    label: "Sevk İrsaliyesi",
    defaultTitle: "Sevk İrsaliyesi",
    fields: DOC_FIELD_CATALOGS.shipmentDispatch,
    defaultSignatures: ["Sevkeden", "Sürücü", "Teslim Alan"],
    supportsLanguage: true,
    supportsBlankWidths: true,
    supportsNotePlacement: true,
    supportsRowNotes: true,
    // Bölüm key'leri renderer'ın sectionOn() anahtarlarıyla birebir aynı olmalı
    // (eski itemTable/sackBreakdown/totals anahtarları renderer'da karşılıksızdı).
    sections: [
      { key: "docNo", label: "İrsaliye no" },
      { key: "date", label: "Tarih" },
      { key: "taxNo", label: "Vergi no" },
      { key: "branchName", label: "Şube adı" },
      { key: "exportCode", label: "İhracat / şube kodu" },
      { key: "customerCode", label: "Müşteri kodu" },
      { key: "direction", label: "Yön (yurt içi / ihracat)" },
      { key: "procedureCode", label: "Gümrük/İhracat No" },
      { key: "orders", label: "Sipariş no" },
      { key: "vehicleInfo", label: "Araç / sürücü satırı" },
      { key: "urun", label: "Ürün listesi tablosu" },
      { key: "cuval", label: "Çuval listesi tablosu" },
      { key: "ceki", label: "Çeki listesi tablosu" },
    ],
    tables: [
      {
        key: "urun",
        label: "Ürün Listesi",
        columns: [
          { key: "name", label: "Stok adı" },
          { key: "rollCount", label: "Top adedi" },
          { key: "totalMeters", label: "Toplam metre" },
        ],
      },
      {
        key: "cuval",
        label: "Çuval Listesi",
        columns: [
          { key: "code", label: "Çuval no" },
          { key: "totalMeters", label: "Metre toplamı" },
          { key: "totalKg", label: "Kg toplamı" },
          { key: "packageCount", label: "Top adedi" },
          // İÇ not — varsayılan KAPALI (defaultHidden). Baskı sırasında tek seferlik
          // de açılabilir (?rowNotes=1). Yorumu olmayan çuvalda hücre boş kalır;
          // hiç yorum yoksa kolon hiç basılmaz.
          { key: "note", label: "Açıklama (çuval notu)", defaultHidden: true },
        ],
      },
      {
        key: "ceki",
        label: "Çeki Listesi",
        columns: [
          { key: "sackCode", label: "Çuval no" },
          { key: "barcode", label: "Barkod no" },
          { key: "batchNumber", label: "Parti no" },
          { key: "desen", label: "Desen" },
          { key: "varyant", label: "Varyant" },
          { key: "width", label: "En" },
          { key: "meters", label: "Metre" },
          { key: "kg", label: "Kg" },
        ],
      },
    ],
  },
  {
    key: "fasonSevk",
    label: "Fason Sevk İrsaliyesi",
    defaultTitle: "Fason Sevk İrsaliyesi",
    defaultSignatures: ["Sevkeden", "Sürücü", "Teslim Alan"],
    supportsBlankWidths: true,
    defaultMarginMm: 8,
    sections: [
      { key: "subcontractorInfo", label: "Fason firma satırı (SAYIN)" },
      { key: "workOrderInfo", label: "İş emri / istasyon satırı" },
      // OPT-IN: saha "hesap no kaldır" dedi. Anahtar taşımayan (2026-08-05 öncesi)
      // donmuş belgeler de bu satırı artık basmaz — bilinçli, bkz. renderer notu.
      { key: "accountNo", label: "Hesap no (fason firma kodu)", defaultHidden: true },
      { key: "batchInfo", label: "Parti no" },
      { key: "vehicleInfo", label: "Sevk / araç bilgisi" },
      { key: "requestedColor", label: "Renk bilgisi (üst blok + CİNSİ hücresi)" },
      // OPT-IN: yeni blok `sections` blocklist'inde varsayılan AÇIK doğsaydı,
      // sahadaki her eski çeki yeniden basıldığında sormadan yeni satır kazanırdı.
      { key: "fabricHeader", label: "Cins / En / Renk — parti no altına da yaz", defaultHidden: true },
      { key: "productionProps", label: "İstenen özellikler kutusu" },
      { key: "dyehouseNote", label: "Fason talimatı kutusu" },
      { key: "notes", label: "Not / alt bilgi" },
      // ⚠️ Bu sütun ELLE DOLDURULAN boş kutudur — top başına EN değeri BASMAZ
      // (belgenin bildiği tek EN alt toplam tablosundadır ve iş emrinden gelir,
      // o da "Alt Toplam Tablosu — kolonlar → En" ile ayrıca kapatılır).
      { key: "gridWidth", label: "Grid'de En (Cm) kolonu — elle doldurulan boş kutular" },
    ],
    fields: FASON_FIELD_DEFS,
    supportsPlacements: [{ key: "batchInfo", label: "Parti no" }],
    supportsGridGroups: true,
    tables: [
      {
        key: "totals",
        label: "Alt Toplam Tablosu",
        columns: [
          { key: "cins", label: "Cinsi" },
          { key: "en", label: "En" },
          { key: "top", label: "Top" },
          { key: "metre", label: "Metre" },
          { key: "fiyat", label: "Fiyatı" },
          { key: "tutar", label: "Tutarı" },
        ],
      },
    ],
  },
  {
    key: "fasonDirectShip",
    label: "Fasondan Sevk İrsaliyesi",
    defaultTitle: "Fasondan Sevk İrsaliyesi",
    fields: DOC_FIELD_CATALOGS.fasonDirectShip,
    defaultSignatures: ["Sevkeden", "Sürücü", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
      { key: "fasonDispatchNo", label: "Fason sevk no" },
      { key: "batchInfo", label: "Parti no" },
      { key: "branchName", label: "Şube adı" },
      { key: "taxNo", label: "Vergi no" },
      { key: "exportCode", label: "İhracat / şube kodu" },
      { key: "vehicleInfo", label: "Sevk / araç bilgisi" },
      { key: "directShipInfo", label: "Fasondan sevk sebebi / onay" },
      { key: "notes", label: "Not / alt bilgi" },
      { key: "rollTable", label: "Sevk edilen toplar tablosu" },
      { key: "allocations", label: "Karşılanan sipariş(ler)" },
    ],
    tables: [
      {
        key: "allocations",
        label: "Karşılanan Siparişler",
        columns: [
          { key: "seq", label: "#" },
          { key: "orderNumber", label: "Sipariş no" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "qty", label: "Miktar" },
        ],
      },
      {
        key: "rollTable",
        label: "Sevk Edilen Toplar",
        columns: [
          { key: "seq", label: "#" },
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
          { key: "meters", label: "Metre" },
          { key: "kg", label: "Kg" },
        ],
      },
    ],
  },
  {
    key: "kartelaCeki",
    label: "Kartela Çeki Listesi",
    defaultTitle: "Kartela Çeki Listesi",
    fields: DOC_FIELD_CATALOGS.kartelaCeki,
    defaultSignatures: ["Gönderen", "Sürücü", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Kartela firma bilgisi" },
      { key: "vehicleInfo", label: "Sevk / araç bilgisi" },
      { key: "notes", label: "Not / alt bilgi" },
      { key: "rollTable", label: "Gönderilen toplar tablosu" },
    ],
    tables: [
      {
        key: "rollTable",
        label: "Gönderilen Toplar",
        columns: [
          { key: "seq", label: "#" },
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
          { key: "meters", label: "Metre" },
          { key: "kg", label: "Kg" },
        ],
      },
    ],
  },
  {
    key: "fasonKabul",
    label: "Fason Kabul Makbuzu",
    defaultTitle: "Fason Kabul Makbuzu",
    fields: DOC_FIELD_CATALOGS.fasonKabul,
    defaultSignatures: ["Teslim Eden (Fason)", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
      { key: "batchInfo", label: "Parti no" },
      { key: "receiptNo", label: "Makbuz no" },
      { key: "date", label: "Tarih" },
      { key: "taxNo", label: "Vergi dairesi / no" },
      { key: "appliedInfo", label: "Uygulanan renk / özellik kutusu" },
      { key: "notes", label: "Not / açıklama" },
      { key: "rollTable", label: "Kabul edilen toplar tablosu" },
    ],
    tables: [
      {
        key: "rollTable",
        label: "Kabul Edilen Toplar",
        columns: [
          { key: "seq", label: "#" },
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
        ],
      },
    ],
  },
  {
    key: "kaliteSertifikasi",
    label: "Kalite Sertifikası",
    defaultTitle: "Kalite Sertifikası",
    fields: DOC_FIELD_CATALOGS.kaliteSertifikasi,
    defaultSignatures: ["Kalite Sorumlusu", "Teslim Alan"],
    sections: [
      { key: "shipmentNo", label: "Sevkiyat no" },
      { key: "date", label: "Tarih" },
      { key: "customerCode", label: "Müşteri kodu" },
      { key: "taxNo", label: "Vergi dairesi / no" },
      { key: "orderNos", label: "Sipariş no" },
      { key: "gradeSummary", label: "Kalite dağılımı tablosu" },
      { key: "rollDetail", label: "Top dökümü tablosu" },
      { key: "declaration", label: "Beyan metni kutusu" },
    ],
    tables: [
      {
        key: "gradeSummary",
        label: "Kalite Dağılımı",
        columns: [
          { key: "grade", label: "Kalite" },
          { key: "rollCount", label: "Top adedi" },
          { key: "totalMeters", label: "Toplam metre" },
        ],
      },
      {
        key: "rollDetail",
        label: "Top Dökümü",
        columns: [
          { key: "seq", label: "#" },
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
          { key: "grade", label: "Kalite" },
          { key: "meters", label: "Metre" },
        ],
      },
    ],
  },
  {
    key: "iadeIrsaliyesi",
    label: "İade İrsaliyesi",
    defaultTitle: "İade İrsaliyesi",
    fields: DOC_FIELD_CATALOGS.iadeIrsaliyesi,
    defaultSignatures: ["Teslim Eden (Müşteri)", "Teslim Alan"],
    sections: [
      { key: "documentNo", label: "İade no" },
      { key: "date", label: "Tarih" },
      { key: "customerCode", label: "Müşteri kodu" },
      { key: "taxNo", label: "Vergi dairesi / no" },
      { key: "references", label: "Referans (sevkiyat / sipariş)" },
      { key: "rollTable", label: "İade edilen top tablosu" },
      { key: "reason", label: "İade nedeni / not kutusu" },
    ],
    tables: [
      {
        key: "rollTable",
        label: "İade Edilen Top",
        columns: [
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
          { key: "grade", label: "Kalite" },
          { key: "qty", label: "Metre" },
        ],
      },
    ],
  },
  // ── Ticaret paketi: iç depo belgeleri (müşteriye gitmez) ──────────────────
  {
    key: "depoTransfer",
    label: "Depo Transfer İrsaliyesi",
    defaultTitle: "Depo Transfer İrsaliyesi",
    fields: DOC_FIELD_CATALOGS.depoTransfer,
    defaultSignatures: ["Teslim Eden", "Teslim Alan"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Tarih" },
      { key: "createdBy", label: "Düzenleyen" },
      { key: "rollTable", label: "Taşınan top tablosu" },
    ],
    tables: [
      {
        key: "rollTable",
        label: "Taşınan Toplar",
        columns: [
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
          { key: "qty", label: "Metre" },
        ],
      },
    ],
  },
  {
    key: "malKabul",
    label: "Mal Kabul Fişi",
    defaultTitle: "Mal Kabul Fişi",
    fields: DOC_FIELD_CATALOGS.malKabul,
    defaultSignatures: ["Teslim Eden (Tedarikçi)", "Teslim Alan"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Tarih" },
      { key: "deliveryNote", label: "Tedarikçi irsaliye no" },
      { key: "createdBy", label: "Teslim alan" },
      { key: "rollTable", label: "Kabul edilen top tablosu" },
    ],
    tables: [
      {
        key: "rollTable",
        label: "Kabul Edilen Toplar",
        columns: [
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "width", label: "En" },
          { key: "qty", label: "Metre" },
        ],
      },
    ],
  },
  {
    // ⚠️ Bölüm/kolon anahtarları `warehouse-doc.renderStockCountHtml`in
    // okuduklarıyla BİREBİR olmak zorunda — ayrışırsa panelde ayar görünür ama
    // belgede karşılığı olmaz ("ayar var, kapısı yok").
    key: "stokSayimi",
    // Rejim: stok sayımı `stock-count.routes` (router.use requireFinanceEnabled) → fabrikada kaynak DOĞAMAZ, şablon listelenmez.
    requiresFinance: true,
    label: "Stok Sayım Tutanağı",
    defaultTitle: "Stok Sayım Tutanağı",
    fields: DOC_FIELD_CATALOGS.stokSayimi,
    // ⚠️ ÜÇ imza, "Teslim Eden / Teslim Alan" DEĞİL: bu kâğıtla teslim edilen
    // bir şey yok. Sayan · kontrol · onay ayrımı, fark fişinin arkasındaki
    // görev ayrılığının kâğıt üzerindeki karşılığıdır (renderer ile aynı).
    defaultSignatures: ["Sayan", "Kontrol Eden", "Onaylayan"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Tarih" },
      { key: "countStatus", label: "Sayım durumu (taslak / tamamlandı)" },
      { key: "createdBy", label: "Sayımı açan / tamamlayan" },
      { key: "rollTable", label: "Sayım listesi — toplar" },
      { key: "yarnTable", label: "Sayım listesi — iplik (kg)" },
      // ⚠️ Fark özeti KAPATILABİLİR ama varsayılan AÇIK: tutanağın kanıt değeri
      // (kaç top düşüldü, kaç kg fark yazıldı) tam olarak bu bloktadır.
      { key: "countSummary", label: "Fark özeti bloğu" },
    ],
    tables: [
      {
        key: "rollTable",
        label: "Sayım Listesi — Toplar",
        columns: [
          { key: "barcode", label: "Barkod" },
          { key: "itemColor", label: "Ürün / renk" },
          { key: "expectedQty", label: "Beklenen (defter)" },
          { key: "countedQty", label: "Sayılan" },
          // "Durum" kolonu kapsam-dışı SEBEBİNİ de taşır; kapatmak, atlanan
          // satırların nedenini kâğıttan siler.
          { key: "state", label: "Durum" },
        ],
      },
    ],
  },
  {
    // ⚠️ `sections` ve `columns` anahtarları renderer'ın okuduklarıyla BİREBİR
    // olmak zorunda (`finance-doc.html.ts`) — ayrışırsa panelde ayar görünür
    // ama belgede karşılığı olmaz ("ayar var, kapısı yok").
    key: "fatura",
    // Rejim: fatura `finance.routes` (router seviyesinde requireFinanceEnabled) → fabrikada kaynak DOĞAMAZ, şablon listelenmez.
    requiresFinance: true,
    label: "Fatura (İç)",
    defaultTitle: "Satış Faturası",
    fields: DOC_FIELD_CATALOGS.fatura,
    defaultSignatures: ["Düzenleyen", "Teslim Alan"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Tarih" },
      { key: "dueDate", label: "Vade" },
      { key: "externalNo", label: "Belge / irsaliye no" },
      { key: "createdBy", label: "Düzenleyen" },
      { key: "lineTable", label: "Kalem tablosu" },
      { key: "totals", label: "Toplam bloğu" },
    ],
    tables: [
      {
        key: "lineTable",
        label: "Fatura Kalemleri",
        columns: [
          { key: "description", label: "Açıklama" },
          { key: "qty", label: "Miktar" },
          { key: "unitPrice", label: "Birim fiyat" },
          { key: "discountRate", label: "İskonto %" },
          { key: "vatRate", label: "KDV %" },
          { key: "lineNet", label: "Tutar" },
        ],
      },
    ],
  },
  {
    // ⚠️ MAKBUZDA SATIR TABLOSU YOK — makbuz TEK bir olayı belgeler. `tables: []`
    // bilinçli: boş bir tablo tanımı panelde "kolonları ayarla" vaadi verir ve
    // karşılığı olmayan bir ayar üretir.
    key: "tahsilatMakbuzu",
    // Rejim: tahsilat/ödeme `finance.routes` → fabrikada kaynak DOĞAMAZ, şablon listelenmez.
    requiresFinance: true,
    label: "Tahsilat / Ödeme Makbuzu",
    defaultTitle: "Tahsilat Makbuzu",
    fields: DOC_FIELD_CATALOGS.tahsilatMakbuzu,
    defaultSignatures: ["Ödeyen", "Tahsil Eden"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Tarih" },
      { key: "account", label: "Kasa / banka" },
      { key: "createdBy", label: "Düzenleyen" },
    ],
    tables: [],
  },
  {
    // ⚠️ `sections`/`columns` anahtarları renderer'ın okuduklarıyla BİREBİR
    // (`finance-doc.renderReconciliationLetterHtml`).
    key: "mutabakatMektubu",
    // Rejim: `reconciliation-letter.routes` kendi rejim kapısını taşır → fabrikada kaynak DOĞAMAZ, şablon listelenmez.
    requiresFinance: true,
    label: "Mutabakat Mektubu",
    defaultTitle: "Cari Mutabakat Mektubu",
    fields: DOC_FIELD_CATALOGS.mutabakatMektubu,
    // ⚠️ İmza etiketleri "Teslim Eden / Teslim Alan" DEĞİL: bu kâğıtla teslim
    // edilen bir şey yok, karşı taraftan MUTABAKAT beyanı isteniyor.
    defaultSignatures: ["Düzenleyen", "Mutabıkız — Kaşe / İmza"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Düzenleme tarihi" },
      // ⚠️ "Bakiye tarihi" düzenleme tarihinden FARKLI bir gün olabilir ve
      // mektubun ANLATTIĞI dönem odur — kapatmak kâğıdı tarihsiz bırakır.
      { key: "asOf", label: "Bakiye tarihi (kesit)" },
      { key: "createdBy", label: "Düzenleyen" },
      { key: "balanceTable", label: "Bakiye dökümü tablosu" },
      { key: "declaration", label: "Mutabakat rica metni" },
    ],
    tables: [
      {
        key: "balanceTable",
        label: "Bakiye Dökümü",
        columns: [
          { key: "currency", label: "Para birimi" },
          { key: "debit", label: "Borç" },
          { key: "credit", label: "Alacak" },
          { key: "balance", label: "Bakiye (mutlak)" },
          // Tutar MUTLAK basılır; işaretin anlamı bu kolondadır (BORÇ/ALACAK/
          // KAPALI). Kolonu kapatmak bakiyeyi YÖNSÜZ bırakır.
          { key: "side", label: "Durum (Borç / Alacak)" },
        ],
      },
    ],
  },
  {
    key: "cekTeslimBordrosu",
    // Rejim: `cheque-delivery-note.routes` kendi rejim kapısını taşır → fabrikada kaynak DOĞAMAZ, şablon listelenmez.
    requiresFinance: true,
    label: "Çek / Senet Teslim Bordrosu",
    // ⚠️ GERÇEK başlık YÖNDEN gelir ("Alınan …" / "Verilen …"); buradaki değer
    // yalnız panelin varsayılanı ve override edilmediğinde renderer kendi
    // yön etiketli başlığını basar (fatura/makbuzdaki durumun aynısı).
    defaultTitle: "Çek / Senet Teslim Bordrosu",
    fields: DOC_FIELD_CATALOGS.cekTeslimBordrosu,
    defaultSignatures: ["Teslim Eden", "Teslim Alan"],
    sections: [
      { key: "documentNo", label: "Belge no" },
      { key: "date", label: "Teslim tarihi" },
      { key: "createdBy", label: "Düzenleyen" },
      { key: "chequeTable", label: "Çek / senet tablosu" },
      { key: "declaration", label: "Teslim beyanı metni" },
    ],
    tables: [
      {
        key: "chequeTable",
        label: "Teslim Edilen Çek / Senetler",
        columns: [
          { key: "no", label: "Sıra" },
          { key: "docNo", label: "Belge no" },
          { key: "serialNo", label: "Seri no" },
          { key: "issueDate", label: "Keşide" },
          { key: "dueDate", label: "Vade" },
          { key: "drawer", label: "Keşideci" },
          { key: "bank", label: "Banka" },
          { key: "currency", label: "Para birimi" },
          { key: "amount", label: "Tutar" },
        ],
      },
    ],
  },
];

export const DOC_DEF_MAP: Record<string, DocDef> = Object.fromEntries(
  DOC_DEFS.map((d) => [d.key, d]),
);

/**
 * Ham (kısmi) belge ayarını + kayıt defteri varsayılanlarını birleştirip tam config
 * döner. Eksik bölüm → açık; başlık/imza boşsa defter varsayılanı.
 */
export function resolveDocConfig(
  documentsConfig: DocumentsConfig | undefined,
  docKey: string,
): ResolvedDocConfig {
  const def = DOC_DEF_MAP[docKey];
  const raw = documentsConfig?.[docKey] ?? {};
  const sections: Record<string, boolean> = {};
  for (const s of def?.sections ?? []) {
    // Kayıtlı değer varsa o; yoksa bölümün kendi varsayılanı. `defaultHidden`
    // taşımayan bölümlerde sonuç bugünküyle BİREBİR aynı (undefined → true).
    sections[s.key] = raw.sections?.[s.key] ?? !s.defaultHidden;
  }
  // İmza etiketi: kutu başına override (boş → o kutunun varsayılanı).
  const sig = (def?.defaultSignatures ?? []).map(
    (d, i) => raw.signatureLabels?.[i]?.trim() || d,
  );
  return {
    title: raw.titleOverride?.trim() || def?.defaultTitle || "",
    titleOverride: raw.titleOverride,
    showLetterhead: raw.showLetterhead === true,
    sections,
    signatureLabels: sig,
    showSignatures: raw.showSignatures !== false,
    footerNote: raw.footerNote ?? "",
    style: raw.style ?? {},
    showLogo: raw.showLogo !== false,
    logoPosition: raw.logoPosition === "right" ? "right" : "left",
    columns: raw.columns ?? {},
    qr: raw.qr === true,
    stamps: raw.stamps ?? {},
    blocks: raw.blocks ?? [],
    language: raw.language ?? "tr",
    blankWidths: raw.blankWidths === true,
    footerNotePlacement: raw.footerNotePlacement === "top" ? "top" : "bottom",
    // ⚠️ HAM geçirilir (çözülmez): tabanları backend'in yoğunluk profilinde
    // yaşıyor ve `sample-html` önizlemesi bu nesneleri olduğu gibi renderer'a
    // taşıyor. Burada "varsayılanı doldurmak", panelin hiç dokunmadığı alanları
    // da kalıcı ayara yazmak olurdu.
    fields: raw.fields ?? {},
    placements: raw.placements ?? {},
    gridGroups: raw.gridGroups,
    gridRows: raw.gridRows,
    // Ham geçiş — önizleme backend renderer.a aynen taşır (dördüncü kapı).
    blankGrid: raw.blankGrid,
  };
}
