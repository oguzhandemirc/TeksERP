/**
 * Bu PC'nin kalıcı cihaz kimliği (deviceId).
 *
 * Backend bunu `x-device-id` header'ından okuyup Device → Machine'e çözer
 * (mobil tabletle aynı model). Sevkiyat PC'si atandığı makinenin kantarını
 * (PeripheralDevice/SCALE) bu sayede `getForDevice` ile bulur.
 *
 * Makineye özgü → secure-store'a (apiBaseUrl gibi) yazılır, backend
 * UserPreference'a değil. İlk açılışta üretilir, sonra sabit kalır.
 */
import { secureStore } from "@/lib/secure-store";

const STORE_KEY = "config.deviceId";
let cached: string | null = null;

/** Web Crypto varsa randomUUID, yoksa elle v4 (her ortamda çalışsın). */
function genUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fallthrough */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Yerel kalıcı deviceId — yoksa üretip secure-store'a yazar. IPC hatalarında
 *  bu oturum için taze bir id döner (header yine de gönderilir). */
export async function getOrCreateDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    const existing = await secureStore.get(STORE_KEY);
    if (existing && existing.length >= 8) {
      cached = existing;
      return existing;
    }
  } catch {
    /* secure-store erişilemezse taze üret */
  }
  const fresh = genUuid();
  try {
    await secureStore.set(STORE_KEY, fresh);
  } catch {
    /* yazılamazsa bu oturum için yine de kullan */
  }
  cached = fresh;
  return fresh;
}
