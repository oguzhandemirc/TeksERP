import { useEffect } from "react";
import apiClient from "@/services/apiClient";
import { getOrCreateDeviceId } from "@/lib/deviceId";
import { IS_ELECTRON } from "@/lib/runtime-env";
import { toast } from "sonner";
import type { DeviceIdentityDescription } from "@shared/ipc-contract";

/** Makine özeti + model (ana süreç); köprü yoksa ya da düşerse boş — `hw`siz announce bugünkü davranış. */
async function describeMachine(): Promise<DeviceIdentityDescription> {
  try {
    return (await window.api?.deviceIdentity?.describe?.()) ?? { hw: null, model: null };
  } catch {
    return { hw: null, model: null };
  }
}

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
    // satırı doğardı.
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
        const { hw, model } = await describeMachine();
        if (cancelled) return;
        const res = await apiClient.post<{ data?: { status?: string; targetName?: string } }>(
          "/api/devices/announce",
          { deviceId, name, kind: "DESKTOP", ...(hw ? { hw } : {}), ...(model ? { model } : {}) },
          { suppressErrorToast: true },
        );
        // Bilinen donanım + eşleştirme zorunlu → yönetici onayı bekleniyor. Panel girişi
        // ENGELLENMEZ (masaüstü satırı yalnız kantar ataması/ad içindir); yalnız bilgi.
        const data = res.data?.data;
        if (!cancelled && data?.status === "REBIND_PENDING") {
          toast.info("Bu bilgisayar yeniden bağlanmayı bekliyor", {
            description: `Kayıtlı "${data.targetName ?? "cihaz"}" ile aynı donanım. Yetkilendirme → Tabletler sayfasındaki "Yeniden bağlama talepleri" bölümünden onaylanabilir.`,
          });
        }
      } catch {
        /* announce best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
