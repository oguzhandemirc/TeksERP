// `dagitim.mjs`in TypeScript tüketicilerine (Electron derleme kimliği) açılan yüzü — yalnız kullanılan dışa aktarımlar.

export interface PanelKimligi {
  /** Dinlenme grubu = terfi zincirinin kökü; grup akışı (O6) gelene dek gömülü adresin grubu. */
  grup: string;
  appId: string;
  urunAdi: string;
  paketAdi: string;
  aciklama: string;
  /** `<indirmeKoku><grup>/electron/` */
  feed: string;
  /** `release/ortak/${version}` */
  cikti: string;
}

export const PANEL_CIKTI_DESENI: string;
export function panelKimligi(kayit: unknown): PanelKimligi;
export function kayitHatalari(kayit: unknown): string[];
