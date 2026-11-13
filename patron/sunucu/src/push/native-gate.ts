// TELEFON PUSH KAPISI — tek kaynak: bulut kipi bildirim gönderimi (`notification-scheduler.ts`) ve ERP kipi push köprüsü
// (`services/push-bridge.ts`) aynı yüklemi okur; biri açıkken öteki kapalı kalamaz.
import type { CloudConfig } from "../config";

/** Telefon push kapısı: istenmiş ∧ gerçek kip ∧ Expo erişim belirteci (enhanced push security) var. Eksikse fail-closed
 *  KAPALI + neden (sırrın kendisi değil, yalnız adı günlüğe). */
export function nativePushState(config: Pick<CloudConfig, "BILDIRIM_KIPI" | "BILDIRIM_NATIVE_PUSH" | "EXPO_ERISIM_BELIRTECI">): { acik: boolean; neden: string | null } {
  if (config.BILDIRIM_NATIVE_PUSH !== "acik") return { acik: false, neden: null };
  if (config.BILDIRIM_KIPI !== "gercek") return { acik: false, neden: "BILDIRIM_KIPI gercek degil" };
  if (!config.EXPO_ERISIM_BELIRTECI) return { acik: false, neden: "EXPO_ERISIM_BELIRTECI yok" };
  return { acik: true, neden: null };
}
