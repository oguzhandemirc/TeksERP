// =============================================================================
// Belge içerik ayarı — Electron `services/documentConfig.ts` ile aynı sözleşmenin
// mobil eşi. Mobil yalnızca Sevk İrsaliyesi'ni yazdırır (shipmentDispatch); diğer
// belgeler Electron'da. Ayar CANLI okunur (feature flag kanalı, snapshot DEĞİL).
// =============================================================================

export interface CompanyLetterhead {
  addressLine: string;
  phone: string;
  taxInfo: string;
}

export const DEFAULT_COMPANY_LETTERHEAD: CompanyLetterhead = {
  addressLine: '',
  phone: '',
  taxInfo: '',
};

export interface DocumentConfig {
  titleOverride?: string;
  showLetterhead?: boolean;
  sections?: Record<string, boolean>;
  signatureLabels?: string[];
  showSignatures?: boolean;
  footerNote?: string;
}

export type DocumentsConfig = Record<string, DocumentConfig>;

export interface ResolvedDocConfig {
  title: string;
  showLetterhead: boolean;
  sections: Record<string, boolean>;
  signatureLabels: string[];
  showSignatures: boolean;
  footerNote: string;
}

interface DocDef {
  defaultTitle: string;
  sectionKeys: string[];
  defaultSignatures: string[];
}

/** Mobilde basılan belgeler. Electron DOC_DEFS ile aynı key'ler. */
const DOC_DEFS: Record<string, DocDef> = {
  shipmentDispatch: {
    defaultTitle: 'Sevk İrsaliyesi',
    sectionKeys: ['customerInfo', 'vehicleInfo', 'itemTable', 'sackBreakdown', 'totals'],
    defaultSignatures: ['Sevkeden', 'Sürücü', 'Teslim Alan'],
  },
};

/** Ham (kısmi) ayar + varsayılanları birleştirip tam config döner. */
export function resolveDocConfig(
  documentsConfig: DocumentsConfig | undefined,
  docKey: string,
): ResolvedDocConfig {
  const def = DOC_DEFS[docKey];
  const raw = documentsConfig?.[docKey] ?? {};
  const sections: Record<string, boolean> = {};
  for (const k of def?.sectionKeys ?? []) {
    sections[k] = raw.sections?.[k] !== false; // default açık
  }
  const sig = (def?.defaultSignatures ?? []).map(
    (dft, i) => raw.signatureLabels?.[i]?.trim() || dft,
  );
  return {
    title: raw.titleOverride?.trim() || def?.defaultTitle || '',
    showLetterhead: raw.showLetterhead === true,
    sections,
    signatureLabels: sig,
    showSignatures: raw.showSignatures !== false,
    footerNote: raw.footerNote ?? '',
  };
}
