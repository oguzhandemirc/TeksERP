import type { MobileScreenKey } from '../types/permissions';

export type RootStackParamList = {
  Pairing: undefined;
  Login: undefined;
  Main: undefined;
  NoAccess: undefined;
  Settings: undefined;
  DevicePairing: undefined;
};

export type MainStackParamList = {
  ModuleSelect: undefined;
  // Modül değil — Tartı/Paket & Sevkiyat'tan push edilen alt sayfalar (yetki-bağımsız).
  SevkiyatGecmisi: undefined;
  Paketleme: { shipmentId?: string; orderIds?: string[] };
} & Record<MobileScreenKey, undefined>;
