import type { MobileScreenKey } from '../types/permissions';

export type RootStackParamList = {
  Pairing: undefined;
  Login: undefined;
  Main: undefined;
  NoAccess: undefined;
  // Ayarlar bir MENÜ; her başlık kendi alt sayfasını push eder (bkz.
  // screens/Common/settings/). DevicePairing de bu menünün bir satırıdır.
  Settings: undefined;
  SettingsServer: undefined;
  SettingsPlaceHardware: undefined;
  SettingsScanner: undefined;
  DevicePairing: undefined;
};

/**
 * Parametre ALAN modül ekranları. Modül ekranlarının varsayılanı parametresizdir
 * (aşağıdaki `Record<...>`), ama biri parametre alacaksa **Record'dan dışlanmalı**:
 * kesişim (`&`) alan tiplerini birleştirir, `{ workOrderId?: string } & undefined`
 * = `never` olur ve o rotaya navigate etmek derlenmez. Bu yüzden anahtar burada
 * tanımlanır, `Exclude` ile Record'dan çıkarılır.
 */
type ParameterizedScreenKey = 'FasonSevk';

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
  /**
   * Fason Sevk — ModuleSelect'ten parametresiz açılır; Fason Kabul'deki
   * NEEDS_DISPATCH aksiyon kartı ("Fason Sevk'e Git") iş emrini seçili getirir.
   * Parametre TEK SEFERLİKTİR: ekran uyguladıktan sonra temizler.
   */
  FasonSevk: { workOrderId?: string } | undefined;
} & Record<Exclude<MobileScreenKey, ParameterizedScreenKey>, undefined>;
