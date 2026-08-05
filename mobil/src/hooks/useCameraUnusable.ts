import { useCameraPermissions } from 'expo-camera';

import { useDeviceSettingsStore } from '../store/deviceSettingsStore';

/**
 * "Bu cihazda kamera kullanılamıyor" — listeden seçim / elle giriş kaçış
 * yollarının TEK kaynağı.
 *
 * Birincil sinyal Ayarlar → Barkod ve Kamera → **"Kamera arızalı"** anahtarıdır
 * (`deviceSettingsStore.manualBarcodeEntry`): fiziksel arıza (bulanık lens,
 * odaklanmayan sensör) yazılımdan TESPİT EDİLEMEZ — sistem açısından öyle bir
 * kamera hâlâ "çalışıyor"dur. O yüzden karar operatörün beyanıdır.
 *
 * İkinci sinyal kalıcı izin reddi (`canAskAgain === false`): sistem diyaloğu
 * artık açılmaz, yani kamera bu cihazda gerçekten kullanılamaz durumdadır ve
 * operatörün anahtarı açması beklenemez (henüz sorunu görmemiştir). İlk
 * açılıştaki "henüz sorulmadı" hâli sayılmaz — herkese gereksiz buton çıkardı.
 */
export function useCameraUnusable(): boolean {
  const manualMode = useDeviceSettingsStore((s) => s.manualBarcodeEntry);
  const [permission] = useCameraPermissions();
  return manualMode || (!!permission && !permission.granted && !permission.canAskAgain);
}
