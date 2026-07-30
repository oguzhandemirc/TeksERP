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
}

export interface DocSectionDef {
  key: string;
  label: string;
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
}

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
};

/**
 * Belge kayıt defteri — yeni belge eklemek = buraya bir satır (+ renderer'da config
 * okuması). Panel ve resolver bu listeyi tek kaynak olarak kullanır.
 */
export const DOC_DEFS: DocDef[] = [
  {
    key: "shipmentDispatch",
    label: "Sevk İrsaliyesi",
    defaultTitle: "Sevk İrsaliyesi",
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
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
      { key: "workOrderInfo", label: "İş emri / istasyon satırı" },
      { key: "vehicleInfo", label: "Sevk / araç bilgisi" },
      { key: "requestedColor", label: "İstenen renk kutusu" },
      { key: "productionProps", label: "İstenen özellikler kutusu" },
      { key: "dyehouseNote", label: "Fason talimatı kutusu" },
      { key: "notes", label: "Not / alt bilgi" },
      { key: "gridWidth", label: "Grid'de En (Cm) kolonu" },
    ],
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
    defaultSignatures: ["Sevkeden", "Sürücü", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
      { key: "fasonDispatchNo", label: "Fason sevk no" },
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
    defaultSignatures: ["Teslim Eden (Fason)", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
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
    sections[s.key] = raw.sections?.[s.key] !== false; // default açık
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
  };
}
