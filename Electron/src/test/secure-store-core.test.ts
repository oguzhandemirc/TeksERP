import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AUTH_TOKEN_STORE_KEY } from "@shared/download-token";
import { UPDATE_FEED_OVERRIDE_KEY } from "@shared/update-feed";
import {
  createSecureStore,
  MAIN_ONLY_KEY_ERROR,
  MAIN_ONLY_KEYS,
  SECRET_KEYS,
  type CipherPort,
} from "../../electron/ipc/secure-store.core";

// =============================================================================
// SECURE-STORE (güvenlik denetimi 2026-10-01: IST-8 düz metin + G1 bulgusu).
// İddia 1: şifreleme yokken gizli anahtar (oturum belirteci) diske DÜZ yazılmaz ve diskteki
// değer "düz metin" diye DÖNDÜRÜLMEZ (yalnız süreç belleği; fail-closed).
// İddia 2: yalnız ana sürecin yazdığı anahtarlar (güncelleme adresi ezmesi, sunucu kimlik
// iğnesi, son keşif) renderer'ın secure-store IPC'siyle yazılamaz/silinemez — kapılı uçların
// (`updater:set-feed-url`, `discovery:pin`) atlatılmasını önler.
// KALICI SONDA (K): eski davranışın birebir kopyası aynı senaryolarda açığı veriyordu.
// =============================================================================

// IPC bağlaması için: gerçek secure-store.ipc.ts, sahte safeStorage + electron-store ile.
type Listener = (...args: unknown[]) => unknown;
const h = vi.hoisted(() => ({ handlers: new Map<string, Listener>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ENC:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^ENC:/, ""),
  },
  ipcMain: { handle: (ch: string, fn: Listener) => h.handlers.set(ch, fn), on: vi.fn() },
}));
vi.mock("electron-store", () => ({
  default: class {
    private data: Record<string, unknown> = { encrypted: {} };
    get(k: string): unknown {
      return this.data[k];
    }
    set(k: string, v: unknown): void {
      this.data[k] = v;
    }
  },
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function harness(available: boolean) {
  const disk: Record<string, string> = {};
  const state = { available };
  const cipher: CipherPort = {
    isEncryptionAvailable: () => state.available,
    encryptString: (plain) => Buffer.from(`ENC:${plain}`),
    decryptString: (buf) => {
      const text = buf.toString();
      if (!text.startsWith("ENC:")) throw new Error("çözülemedi");
      return text.slice(4);
    },
  };
  const warn = vi.fn();
  const make = () => createSecureStore({ kv: { readAll: () => ({ ...disk }), writeAll: (all) => {
    for (const k of Object.keys(disk)) delete disk[k];
    Object.assign(disk, all);
  } }, cipher, warn });
  return { disk, state, warn, store: make(), restart: make };
}

/** 2026-10-01 öncesi secure-store.ipc.ts read/write — birebir (safeStorage yerine `cipher`). */
function legacy(disk: Record<string, string>, cipher: CipherPort) {
  return {
    read: (key: string): string | null => {
      const ciphertext = disk[key];
      if (!ciphertext) return null;
      try {
        if (!cipher.isEncryptionAvailable()) return ciphertext;
        return cipher.decryptString(Buffer.from(ciphertext, "base64"));
      } catch {
        return null;
      }
    },
    write: (key: string, value: string): void => {
      disk[key] = cipher.isEncryptionAvailable() ? cipher.encryptString(value).toString("base64") : value;
    },
  };
}

describe("şifreleme varken (Windows DPAPI · macOS Keychain) davranış değişmedi", () => {
  it("gidiş-dönüş; diskte düz değer yok", () => {
    const { disk, store } = harness(true);
    store.write(AUTH_TOKEN_STORE_KEY, "jwt-gizli");
    expect(disk[AUTH_TOKEN_STORE_KEY]).not.toContain("jwt-gizli");
    expect(store.read(AUTH_TOKEN_STORE_KEY)).toBe("jwt-gizli");
    store.remove(AUTH_TOKEN_STORE_KEY);
    expect(store.read(AUTH_TOKEN_STORE_KEY)).toBeNull();
  });
});

describe("şifreleme YOKKEN gizli anahtar fail-closed", () => {
  it("⭐ belirteç diske düz YAZILMAZ; süreç içinde bellekten okunur, yeniden başlatınca yok", () => {
    const { disk, store, restart, warn } = harness(false);
    store.write(AUTH_TOKEN_STORE_KEY, "jwt-gizli");
    expect(JSON.stringify(disk)).not.toContain("jwt-gizli");
    expect(store.read(AUTH_TOKEN_STORE_KEY)).toBe("jwt-gizli");
    expect(restart().read(AUTH_TOKEN_STORE_KEY)).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("jwt-gizli");
  });

  it("⭐ diskteki eski düz/şifreli değer 'düz metin' diye DÖNDÜRÜLMEZ; yeni yazım onu siler", () => {
    const { disk, store } = harness(false);
    disk[AUTH_TOKEN_STORE_KEY] = "eski-duz-jwt";
    expect(store.read(AUTH_TOKEN_STORE_KEY)).toBeNull();
    store.write(AUTH_TOKEN_STORE_KEY, "yeni");
    expect(disk[AUTH_TOKEN_STORE_KEY]).toBeUndefined();
  });

  it("K-sonda: eski davranış belirteci diske düz yazıyor ve şifreli değeri ham döndürüyordu", () => {
    const disk: Record<string, string> = {};
    const off: CipherPort = { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(""), decryptString: () => "" };
    const old = legacy(disk, off);
    old.write(AUTH_TOKEN_STORE_KEY, "jwt-gizli");
    expect(disk[AUTH_TOKEN_STORE_KEY]).toBe("jwt-gizli");
    disk[AUTH_TOKEN_STORE_KEY] = Buffer.from("ENC:x").toString("base64");
    expect(old.read(AUTH_TOKEN_STORE_KEY)).toBe(disk[AUTH_TOKEN_STORE_KEY]);
  });

  it("gizli olmayan ayar (sunucu adresi) bugünkü gibi düz kalır", () => {
    const { disk, store } = harness(false);
    store.write("config.apiBaseUrl", "http://10.0.0.5:4000");
    expect(disk["config.apiBaseUrl"]).toBe("http://10.0.0.5:4000");
    expect(store.read("config.apiBaseUrl")).toBe("http://10.0.0.5:4000");
  });
});

describe("yalnız ana sürecin anahtarları renderer'dan yazılamaz", () => {
  it("liste beyanlı ve ölçülen üç anahtar; gizli anahtar kümesi tek", () => {
    expect([...MAIN_ONLY_KEYS].sort()).toEqual(["config.lastDiscovery", "config.serverIdentity", UPDATE_FEED_OVERRIDE_KEY].sort());
    expect([...SECRET_KEYS]).toEqual([AUTH_TOKEN_STORE_KEY]);
  });

  it("⭐ renderer yazma/silme RED, disk değişmez; ana süreç yazar", () => {
    const { disk, store } = harness(true);
    store.write(UPDATE_FEED_OVERRIDE_KEY, "https://guncelleme.ornek/kanal/electron/");
    const before = JSON.stringify(disk);
    for (const key of MAIN_ONLY_KEYS) {
      expect(() => store.rendererWrite(key, "http://saldirgan/feed/"), key).toThrow(MAIN_ONLY_KEY_ERROR);
      expect(() => store.rendererRemove(key), key).toThrow(MAIN_ONLY_KEY_ERROR);
    }
    expect(JSON.stringify(disk)).toBe(before);
    store.rendererWrite("config.apiBaseUrl", "http://10.0.0.5:4000");
    expect(store.read("config.apiBaseUrl")).toBe("http://10.0.0.5:4000");
  });

  it("renderer bozuk girdi gönderemez", () => {
    const { store } = harness(true);
    expect(() => store.rendererWrite(42, "x")).toThrow();
    expect(() => store.rendererWrite("a", { x: 1 })).toThrow();
    expect(store.rendererRead(undefined)).toBeNull();
  });

  it("ölçüm: renderer bu anahtarlara hiç dokunmuyor (ret bir ekranı kırmaz)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) && !/\.test\./.test(d.name) ? [join(dir, d.name)] : [],
      );
    const files = walk(resolve(process.cwd(), "src"));
    expect(files.length).toBeGreaterThanOrEqual(100);
    const hits = files.filter((f) => [...MAIN_ONLY_KEYS].some((k) => readFileSync(f, "utf8").includes(`"${k}"`)));
    expect(hits).toEqual([]);
  });
});

describe("IPC bağlaması: renderer kanalı ana-süreç anahtarına ulaşamaz", () => {
  it("⭐ secure-store:set/delete ana-süreç anahtarında RED; ana süreç yolu çalışır", async () => {
    const ipc = await import("../../electron/ipc/secure-store.ipc");
    const trusted = await import("../../electron/security/trusted-ipc");
    const entry = "file:///C:/TeksERP/resources/app.asar/out/renderer/index.html";
    trusted.setTrustedAppEntry(entry);
    ipc.registerSecureStoreIpc();
    const app = { senderFrame: { url: `${entry}#/ayarlar`, parent: null } };
    const set = h.handlers.get("secure-store:set");
    const del = h.handlers.get("secure-store:delete");
    expect(() => set?.(app, UPDATE_FEED_OVERRIDE_KEY, "http://saldirgan/feed/")).toThrow(MAIN_ONLY_KEY_ERROR);
    expect(() => del?.(app, UPDATE_FEED_OVERRIDE_KEY)).toThrow(MAIN_ONLY_KEY_ERROR);
    expect(ipc.readSecureValue(UPDATE_FEED_OVERRIDE_KEY)).toBeNull();
    ipc.writeSecureValue(UPDATE_FEED_OVERRIDE_KEY, "https://guncelleme.ornek/k/electron/");
    expect(ipc.readSecureValue(UPDATE_FEED_OVERRIDE_KEY)).toBe("https://guncelleme.ornek/k/electron/");
    set?.(app, "config.apiBaseUrl", "http://10.0.0.5:4000");
    expect(h.handlers.get("secure-store:get")?.(app, "config.apiBaseUrl")).toBe("http://10.0.0.5:4000");
  });
});
