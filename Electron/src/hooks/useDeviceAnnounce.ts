import { useEffect } from "react";
import apiClient from "@/services/apiClient";
import { getOrCreateDeviceId } from "@/lib/deviceId";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * Açılışta bu PC'yi backend Device allowlist'ine bildirir (announce). Yeni kaydın
 * doğuş durumu `devicePairingRequired` bayrağına bağlıdır (2026-09-04): bayrak
 * AÇIK ise PENDING (admin onaylar), KAPALI ise APPROVED (onay adımı yok). Her iki
 * durumda da makineye atama admin "Cihazlar" sayfasından yapılır.
 *
 * Electron GATE'lenmez (admin konsolu) — yalnız kendini tanıtır ki atanabilsin;
 * atanınca `x-device-id` → makine çözülür ve sevkiyat kantarı bulunur.
 * Best-effort: başarısızlık uygulamayı etkilemez.
 */
export function useDeviceAnnounce(): void {
  useEffect(() => {
    // ⚠️ YALNIZ MASAÜSTÜ (2026-09-04). Kayıt "bu MAKİNEYİ tanıt ki kantar/tarayıcı
    // atanabilsin" demektir; tarayıcıda `window.api` yoktur, yani atanan donanım
    // hiçbir zaman kullanılamaz — her tarayıcı profili için boşuna bir cihaz
    // satırı doğardı. Uzakta (tünel) ise `/api/devices` zaten 404 ve bu istek
    // ÖLÇÜLDÜ: her uzak girişte, kullanıcının başlatmadığı bir arka plan
    // çağrısından kırmızı **"Kaynak bulunamadı"** toast'ı çıkıyordu.
    if (!IS_ELECTRON) return;
    let cancelled = false;
    void (async () => {
      try {
        const deviceId = await getOrCreateDeviceId();
        if (cancelled || !deviceId) return;
        const platform = window.api?.appInfo?.platform?.() ?? "";
        const name = platform ? `Masaüstü (${platform})` : "Masaüstü";
        // Electron PC → tür DESKTOP (tablet/telefon değil).
        // ⚠️ `suppressErrorToast`: kullanıcının BAŞLATMADIĞI bir arka plan çağrısı
        // asla toast basmamalı — üstteki kapı düşse bile bu ikinci hat kalır.
        await apiClient.post(
          "/api/devices/announce",
          { deviceId, name, kind: "DESKTOP" },
          { suppressErrorToast: true },
        );
      } catch {
        /* announce best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
