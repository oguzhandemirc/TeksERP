import { describe, it, expect, vi, beforeEach } from "vitest";

/** Güvenilir cihaz deposu: Electron'da tek gizli anahtarda JSON harita; tarayıcı hedefinde hiç yazılmaz. */
const disk = new Map<string, string>();
const env = { electron: true };
vi.mock("@/lib/runtime-env", () => Object.defineProperty({}, "IS_ELECTRON", { get: () => env.electron, enumerable: true }));
vi.mock("@/lib/secure-store", () => ({
  secureStore: {
    get: vi.fn(async (k: string) => disk.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void disk.set(k, v)),
    delete: vi.fn(async (k: string) => void disk.delete(k)),
  },
}));

import { trustedDeviceStore } from "@/lib/trusted-device-store";
import { TRUSTED_DEVICE_STORE_KEY } from "@shared/trusted-device";

beforeEach(() => {
  disk.clear();
  env.electron = true;
});

describe("trustedDeviceStore", () => {
  it("yuva başına yazar/okur/siler; son yuva silinince anahtar kalkar", async () => {
    await trustedDeviceStore.set("a\nx", "t1");
    await trustedDeviceStore.set("b\ny", "t2");
    expect(await trustedDeviceStore.get("a\nx")).toBe("t1");
    expect(JSON.parse(disk.get(TRUSTED_DEVICE_STORE_KEY) ?? "{}")).toEqual({ "a\nx": "t1", "b\ny": "t2" });
    await trustedDeviceStore.clear("a\nx");
    await trustedDeviceStore.clear("b\ny");
    expect(disk.has(TRUSTED_DEVICE_STORE_KEY)).toBe(false);
  });

  it("bozuk kayıt boş sayılır", async () => {
    disk.set(TRUSTED_DEVICE_STORE_KEY, "{bozuk");
    expect(await trustedDeviceStore.get("a\nx")).toBeNull();
  });

  it("⭐ tarayıcı hedefinde hiç yazılmaz (çerez yolu)", async () => {
    env.electron = false;
    await trustedDeviceStore.set("a\nx", "t1");
    expect(disk.size).toBe(0);
    expect(await trustedDeviceStore.get("a\nx")).toBeNull();
  });
});
