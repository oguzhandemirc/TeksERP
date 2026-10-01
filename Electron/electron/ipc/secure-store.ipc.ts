import { safeStorage } from "electron";
import Store from "electron-store";
import log from "electron-log/main.js";
import { handleTrusted } from "../security/trusted-ipc.js";
import { createSecureStore } from "./secure-store.core.js";

interface StoreSchema {
  encrypted: Record<string, string>;
}

const store: Store<StoreSchema> = new Store<StoreSchema>({
  name: "secure",
  defaults: { encrypted: {} },
});

const core = createSecureStore({
  kv: {
    readAll: () => store.get("encrypted"),
    writeAll: (all) => store.set("encrypted", all),
  },
  cipher: {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encryptString: (plain) => safeStorage.encryptString(plain),
    decryptString: (cipherText) => safeStorage.decryptString(cipherText),
  },
  warn: (message, meta) => log.warn(message, meta),
});

/**
 * Aynı kasadan main process içinden okuma (renderer'dan geçmeden).
 * Güncelleyici, pencere daha açılmadan yayın adresi ezmesini okumak zorunda —
 * IPC yolu orada henüz yok. Yazma tarafı da aynı sebeple gerekli (Ayarlar'dan
 * gelen adres, `autoUpdater`ın kendi durumuyla birlikte tek yerde yazılsın).
 */
export function readSecureValue(key: string): string | null {
  return core.read(key);
}

export function writeSecureValue(key: string, value: string): void {
  core.write(key, value);
}

export function deleteSecureValue(key: string): void {
  core.remove(key);
}

export function registerSecureStoreIpc(): void {
  handleTrusted("secure-store:get", (_e, key: unknown) => core.rendererRead(key));
  handleTrusted("secure-store:set", (_e, key: unknown, value: unknown) => core.rendererWrite(key, value));
  handleTrusted("secure-store:delete", (_e, key: unknown) => core.rendererRemove(key));
}
