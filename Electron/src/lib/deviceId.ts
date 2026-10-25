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
import type { LocalIdRead } from "@shared/ipc-contract";

const STORE_KEY = "config.deviceId";
let cached: string | null = null;
/** "stored" kalıcı · "created" bu açılışta üretilip yazıldı · "ephemeral" okunamadı/yazılamadı → yalnız bu oturum. */
export type DeviceIdState = "stored" | "created" | "ephemeral";
let cachedState: DeviceIdState | null = null;

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

/** Masaüstünde ana süreç üç durumlu okur; köprü yoksa (web/eski) `get`: null = yok, istisna = okunamadı. */
async function readLocal(): Promise<LocalIdRead> {
  const bridge = typeof window !== "undefined" ? window.api?.deviceIdentity : undefined;
  try {
    if (bridge) return await bridge.readLocalId();
    const v = await secureStore.get(STORE_KEY);
    return v ? { status: "OK", value: v } : { status: "ABSENT" };
  } catch {
    return { status: "UNREADABLE" };
  }
}

async function writeIfAbsent(value: string): Promise<boolean> {
  const bridge = typeof window !== "undefined" ? window.api?.deviceIdentity : undefined;
  try {
    if (bridge) return await bridge.createLocalId(value);
    await secureStore.set(STORE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Yerel kalıcı deviceId. "Değer YOK" ile "OKUNAMADI" ayrıdır (plan §5.5 md. 5):
 * okunamayan kimliğin üstüne YAZILMAZ (anahtar halkası geri gelince eski kimlik döner);
 * oturum bellekteki geçici kimlikle sürer, sunucu donanım özetiyle tanır.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  if (cached) return cached;
  const r = await readLocal();
  if (r.status === "OK" && r.value.length >= 8) {
    cached = r.value;
    cachedState = "stored";
    return r.value;
  }
  const fresh = genUuid();
  // Bozuk kısa değer (<8) bizim yazdığımız olamaz → "yok" sayılır; okunamayan değere dokunulmaz.
  const absent = r.status === "ABSENT" || (r.status === "OK" && r.value.length < 8);
  cachedState = absent && (await writeIfAbsent(fresh)) ? "created" : "ephemeral";
  cached = fresh;
  return fresh;
}

export function deviceIdState(): DeviceIdState | null {
  return cachedState;
}

/** Yalnız test: modül önbelleğini sıfırlar. */
export function resetDeviceIdForTest(): void {
  cached = null;
  cachedState = null;
}
