// =============================================================================
// StationKind → oturumlu ekran registry'si (TEK KAYNAK)
// =============================================================================
// Backend SESSIONABLE_STATION_KINDS'ın (work-session.service.ts) mobil aynası:
// makine/istasyon QR'ı okutulduğunda veya oturum açıldığında HANGİ ekranın
// açılacağını yerin TÜRÜ belirler (istasyon değil — yarın iki tambur istasyonu
// olsa ikisi de aynı Tambur ekranını açar). Gezici ekranlar (Depo, Fason,
// Kartela, İade, Sevk Çıkışı, Hızlı İş Emri) bu tabloda YOKTUR — oturum istemez.
// =============================================================================

import type { MobileScreenKey } from '../types/permissions';

export type SessionStationKind = 'RAW_QC' | 'PROCESS_QC' | 'TAMBUR' | 'SHIPPING' | 'WEAVING';

/** Yerin türü → açılacak ekran. */
export const SCREEN_BY_STATION_KIND: Record<SessionStationKind, MobileScreenKey> = {
  RAW_QC: 'KK1',
  PROCESS_QC: 'KursunQc',
  TAMBUR: 'Tambur',
  SHIPPING: 'TartiPaket', // ekran etiketi "Sevkiyat" (tartım+paket+irsaliye)
  WEAVING: 'Dokuma', // tezgah = makine; rotada adım DEĞİL, yalnız oturum istasyonu (2026-09-14)
};

/** Ekran → beklediği yer türü (SessionGate bu eşleşmeyi dayatır). */
export const STATION_KIND_BY_SCREEN: Partial<Record<MobileScreenKey, SessionStationKind>> = {
  KK1: 'RAW_QC',
  KursunQc: 'PROCESS_QC',
  Tambur: 'TAMBUR',
  TartiPaket: 'SHIPPING',
  Dokuma: 'WEAVING',
};

/** Oturum (yer onayı) gerektiren ekranlar. */
export const SESSION_SCREEN_KEYS = Object.keys(STATION_KIND_BY_SCREEN) as MobileScreenKey[];

export function isSessionScreen(key: MobileScreenKey): boolean {
  return key in STATION_KIND_BY_SCREEN;
}

export function isSessionStationKind(kind: string | null | undefined): kind is SessionStationKind {
  return !!kind && kind in SCREEN_BY_STATION_KIND;
}
