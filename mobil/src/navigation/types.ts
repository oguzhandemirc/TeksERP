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
  SevkiyatDetay: { shipmentId: string; shipmentNo?: string };
  // Çuval Havuzu: müşteri workspace'i (çuval aç/okut/tart). branchId opsiyonel.
  Paketleme: { customerId: string; branchId?: string | null };
  CuvalDuzelt: undefined;
  HizliSiparis: undefined;
  KartelaSevkGecmisi: undefined;
  KartelaKabulGecmisi: undefined;
  FasonSevkGecmisi: undefined;
  IadeGecmisi: undefined;
} & Record<MobileScreenKey, undefined>;
