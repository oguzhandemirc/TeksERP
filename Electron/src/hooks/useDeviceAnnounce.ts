import { useEffect } from "react";
import apiClient from "@/services/apiClient";
import { getOrCreateDeviceId } from "@/lib/deviceId";

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
    let cancelled = false;
    void (async () => {
      try {
        const deviceId = await getOrCreateDeviceId();
        if (cancelled || !deviceId) return;
        const platform = window.api?.appInfo?.platform?.() ?? "";
        const name = platform ? `Masaüstü (${platform})` : "Masaüstü";
        // Electron PC → tür DESKTOP (tablet/telefon değil).
        await apiClient.post("/api/devices/announce", { deviceId, name, kind: "DESKTOP" });
      } catch {
        /* announce best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
