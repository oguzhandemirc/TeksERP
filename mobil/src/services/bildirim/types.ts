// Bildirim tel tipleri (backend `notification-inbox.service.ts` / `notification-preference.service.ts`).
// Alan adları sunucunun Türkçe tel sözleşmesidir; istemci yeni alan TÜRETMEZ.

export type InboxClass = 'ALARM' | 'BILDIRIM';
export type InboxTab = 'tumu' | 'okunmamis' | 'alarmlar' | 'ertelenen';

export interface InboxItem {
  id: string;
  tur: string;
  sinif: InboxClass;
  altTur: 'OLAY' | 'KOSUL';
  grup: string;
  baslik: string;
  govde: string;
  tabletRota: string | null;
  konu: { tip: string; id: string | null };
  sayac: number;
  sonAn: string;
  okunduAn: string | null;
  erteleBitis: string | null;
  cozulduAn: string | null;
  /** Eski backend göndermez → undefined (ses/şerit yok sayılır). */
  ozet?: boolean;
  kanalTablet?: boolean;
  sesli?: boolean;
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
  sayi: number;
}

export interface NotificationSummary {
  enabled: boolean;
  okunmamis: number;
  alarmAcik: number;
  epoch: number;
  rev: number;
  alarmRev: number;
}

export interface NotificationWaitResult {
  epoch: number;
  rev: number;
  alarmRev: number;
  degisti: boolean;
}

export type PreferenceChannel = 'UYGULAMA' | 'OZET' | 'MASAUSTU' | 'TABLET_SES' | 'PATRON_PUSH';

export interface PreferenceCell {
  kanal: PreferenceChannel;
  durum: 'ACIK' | 'KAPALI' | 'GIZLI';
  kilit: boolean;
  kaynak: string;
  kapsam: Record<string, unknown> | null;
}

export interface PreferenceKindCells {
  kind: string;
  kanallar: PreferenceCell[];
}

export interface PreferenceRow {
  id: string;
  tur: string;
  kanal: PreferenceChannel;
  acik: boolean;
  kapsam: Record<string, unknown> | null;
}

export interface PreferencesResponse {
  hucreler: PreferenceKindCells[];
  satirlar: PreferenceRow[];
}

export interface PreferenceItem {
  tur: string;
  kanal: PreferenceChannel;
  acik: boolean;
  kapsam?: Record<string, unknown>;
}

export interface CatalogKind {
  kod: string;
  ad: string;
  sinif: InboxClass;
  grup: string;
  kilit: string;
  kilitGerekcesi: string | null;
  kanallar: PreferenceChannel[];
}
