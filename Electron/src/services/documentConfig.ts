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
}

export const DEFAULT_COMPANY_LETTERHEAD: CompanyLetterhead = {
  addressLine: "",
  phone: "",
  taxInfo: "",
};

/** Tek belgenin saklanan (ham, kısmi) içerik ayarı. Verilmeyen alan varsayılana çözülür. */
export interface DocumentConfig {
  titleOverride?: string;
  showLetterhead?: boolean;
  sections?: Record<string, boolean>;
  signatureLabels?: string[];
  showSignatures?: boolean;
  footerNote?: string;
}

/** { [belgeKey]: DocumentConfig } — ham saklanır. */
export type DocumentsConfig = Record<string, DocumentConfig>;

/** Çözülmüş (tam) belge config — resolveDocConfig döner; renderer bunu kullanır. */
export interface ResolvedDocConfig {
  title: string;
  showLetterhead: boolean;
  /** Her tanımlı bölüm key'i için boolean (eksikse açık). */
  sections: Record<string, boolean>;
  signatureLabels: string[];
  showSignatures: boolean;
  footerNote: string;
}

export interface DocSectionDef {
  key: string;
  label: string;
}

export interface DocDef {
  key: string;
  label: string;
  defaultTitle: string;
  sections: DocSectionDef[];
  defaultSignatures: string[];
}

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
    sections: [
      { key: "customerInfo", label: "Müşteri / şube bilgisi" },
      { key: "branchCode", label: "Şube kodu (ihracat)" },
      { key: "vehicleInfo", label: "Araç / sürücü bilgisi" },
      { key: "itemTable", label: "Gönderilen kalemler tablosu" },
      { key: "sackBreakdown", label: "Çuval dökümü (çuval içeriği)" },
      { key: "totals", label: "Top sayısı / toplam metraj satırı" },
    ],
  },
  {
    key: "fasonSevk",
    label: "Fason Sevk İrsaliyesi",
    defaultTitle: "Fason Sevk İrsaliyesi",
    defaultSignatures: ["Sevkeden", "Sürücü", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
      { key: "vehicleInfo", label: "Sevk / araç bilgisi" },
      { key: "requestedColor", label: "İstenen renk kutusu" },
      { key: "dyehouseNote", label: "Fason talimatı kutusu" },
      { key: "rollTable", label: "Sevk edilen toplar tablosu" },
    ],
  },
  {
    key: "fasonDirectShip",
    label: "Fasondan Sevk İrsaliyesi",
    defaultTitle: "Fasondan Sevk İrsaliyesi",
    defaultSignatures: ["Sevkeden", "Sürücü", "Teslim Alan"],
    sections: [
      { key: "subcontractorInfo", label: "Fason firma bilgisi" },
      { key: "branchCode", label: "Müşteri şube kodu (ihracat)" },
      { key: "vehicleInfo", label: "Sevk / araç bilgisi" },
      { key: "directShipInfo", label: "Fasondan sevk sebebi / onay" },
      { key: "rollTable", label: "Sevk edilen toplar tablosu" },
      { key: "allocations", label: "Karşılanan sipariş(ler)" },
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
      { key: "rollTable", label: "Gönderilen toplar tablosu" },
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
    showLetterhead: raw.showLetterhead === true,
    sections,
    signatureLabels: sig,
    showSignatures: raw.showSignatures !== false,
    footerNote: raw.footerNote ?? "",
  };
}
