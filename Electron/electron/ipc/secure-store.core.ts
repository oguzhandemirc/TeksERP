// =============================================================================
// secure-store çekirdeği — saf mantık (electron import etmez; test doğrudan koşar).
// Gerçek bağımlılıkları (safeStorage + electron-store) `secure-store.ipc.ts` verir.
// =============================================================================
import { UPDATE_FEED_OVERRIDE_KEY } from "@shared/update-feed";
import { LAST_DISCOVERY_KEY, PINNED_IDENTITY_KEY } from "@shared/discovery";
import { AUTH_TOKEN_STORE_KEY } from "@shared/download-token";

/**
 * YALNIZ ANA SÜRECİN yazdığı anahtarlar — renderer `secure-store:set/delete` ile bunlara
 * yazamaz/silemez; yazarları kendi kapılı uçlarıdır (`updater:set-feed-url`,
 * `discovery:pin`, keşif turu). Ölçüldü: renderer bu anahtarlara hiç dokunmuyor.
 * Doğrudan yazım, uçların denetimini (ör. güncelleme adresi kapısı) atlatırdı.
 */
export const MAIN_ONLY_KEYS: ReadonlySet<string> = new Set([
  UPDATE_FEED_OVERRIDE_KEY,
  PINNED_IDENTITY_KEY,
  LAST_DISCOVERY_KEY,
]);

/** Şifreleme yokken DİSKE DÜZ YAZILMAYAN gizli anahtarlar (yalnız süreç belleğinde tutulur). */
export const SECRET_KEYS: ReadonlySet<string> = new Set([AUTH_TOKEN_STORE_KEY]);

export const MAIN_ONLY_KEY_ERROR = "Bu anahtar yalnız ana süreç tarafından yazılır";

export interface CipherPort {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface KeyValuePort {
  readAll(): Record<string, string>;
  writeAll(all: Record<string, string>): void;
}

export interface SecureStoreDeps {
  readonly kv: KeyValuePort;
  readonly cipher: CipherPort;
  readonly warn: (message: string, meta: Record<string, unknown>) => void;
}

export interface SecureStoreCore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  /** Renderer'dan gelen yazım: tip + ana-süreç-anahtarı kapısı. */
  rendererWrite(key: unknown, value: unknown): void;
  /** Renderer'dan gelen silme: ana-süreç-anahtarı kapısı. */
  rendererRemove(key: unknown): void;
  rendererRead(key: unknown): string | null;
}

export function createSecureStore({ kv, cipher, warn }: SecureStoreDeps): SecureStoreCore {
  // Şifreleme yokken gizli değer YALNIZ burada yaşar (süreç kapanınca gider → yeniden giriş).
  const volatileSecrets = new Map<string, string>();

  function read(key: string): string | null {
    const volatile = volatileSecrets.get(key);
    if (volatile !== undefined) return volatile;
    const stored = kv.readAll()[key];
    if (!stored) return null;
    if (cipher.isEncryptionAvailable()) {
      try {
        return cipher.decryptString(Buffer.from(stored, "base64"));
      } catch {
        return null;
      }
    }
    if (SECRET_KEYS.has(key)) {
      // Şifreli değeri "düz metin" diye döndürme; eski düz değeri de kullanma (fail-closed).
      warn("[guvenlik] şifreleme yok — gizli anahtar diskten okunmadı", { key });
      return null;
    }
    return stored;
  }

  function write(key: string, value: string): void {
    const all = { ...kv.readAll() };
    if (cipher.isEncryptionAvailable()) {
      volatileSecrets.delete(key);
      all[key] = cipher.encryptString(value).toString("base64");
      kv.writeAll(all);
      return;
    }
    if (SECRET_KEYS.has(key)) {
      volatileSecrets.set(key, value);
      if (key in all) {
        delete all[key];
        kv.writeAll(all);
      }
      warn("[guvenlik] şifreleme yok — gizli anahtar diske yazılmadı (yalnız bellekte)", { key });
      return;
    }
    all[key] = value;
    kv.writeAll(all);
  }

  function remove(key: string): void {
    volatileSecrets.delete(key);
    const all = { ...kv.readAll() };
    delete all[key];
    kv.writeAll(all);
  }

  function assertRendererKey(key: unknown, op: string): asserts key is string {
    if (typeof key !== "string" || key.length === 0) throw new Error("Geçersiz anahtar");
    if (MAIN_ONLY_KEYS.has(key)) {
      warn("[guvenlik] renderer ana süreç anahtarına yazmak istedi", { key, op });
      throw new Error(MAIN_ONLY_KEY_ERROR);
    }
  }

  return {
    read,
    write,
    remove,
    rendererWrite(key, value) {
      assertRendererKey(key, "set");
      if (typeof value !== "string") throw new Error("Geçersiz değer");
      write(key, value);
    },
    rendererRemove(key) {
      assertRendererKey(key, "delete");
      remove(key);
    },
    rendererRead(key) {
      return typeof key === "string" ? read(key) : null;
    },
  };
}
