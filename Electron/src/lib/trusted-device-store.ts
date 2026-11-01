import { TRUSTED_DEVICE_STORE_KEY } from "@shared/trusted-device";
import { secureStore } from "@/lib/secure-store";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * Barındırılan sunucunun "bu cihazı hatırla" belirteci — SUNUCU + KULLANICI başına (yuva anahtarı), yalnız
 * Electron'da safeStorage'lı depoda. Tarayıcı hedefi çerez yolunu kullanır → burada hiç yazılmaz.
 * Belirteç log'a/konsola basılmaz; bozuk kayıt sessizce boş sayılır (sunucu kodu yeniden sorar).
 */
async function readAll(): Promise<Record<string, string>> {
  if (!IS_ELECTRON) return {};
  try {
    const raw = await secureStore.get(TRUSTED_DEVICE_STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}

async function writeAll(map: Record<string, string>): Promise<void> {
  if (!IS_ELECTRON) return;
  if (Object.keys(map).length === 0) await secureStore.delete(TRUSTED_DEVICE_STORE_KEY);
  else await secureStore.set(TRUSTED_DEVICE_STORE_KEY, JSON.stringify(map));
}

export const trustedDeviceStore = {
  async get(slot: string): Promise<string | null> {
    return (await readAll())[slot] ?? null;
  },
  async set(slot: string, token: string): Promise<void> {
    if (!IS_ELECTRON) return;
    await writeAll({ ...(await readAll()), [slot]: token });
  },
  async clear(slot: string): Promise<void> {
    const map = await readAll();
    if (!(slot in map)) return;
    delete map[slot];
    await writeAll(map);
  },
};
