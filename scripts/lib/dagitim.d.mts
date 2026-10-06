// `dagitim.mjs`in TypeScript tüketicilerine (Electron derleme kimliği) açılan yüzü — yalnız kullanılan dışa aktarımlar.

export interface PanelKimligi {
  /** Dinlenme grubu = terfi zincirinin kökü; gömülü taban adresin grubu (çalışan panel kiradaki grubu izler). */
  grup: string;
  appId: string;
  urunAdi: string;
  paketAdi: string;
  aciklama: string;
  /** `<indirmeKoku><grup>/electron/` */
  feed: string;
  /** Grup → `<indirmeKoku><grup>/electron/`, terfi zinciri sırasıyla (grup akışı, O6). */
  grupFeedleri: Record<string, string>;
  /** `release/ortak/${version}` */
  cikti: string;
}

export const PANEL_CIKTI_DESENI: string;
export function panelKimligi(kayit: unknown): PanelKimligi;
export function kayitHatalari(kayit: unknown): string[];
