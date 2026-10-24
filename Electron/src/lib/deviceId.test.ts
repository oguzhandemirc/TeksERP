import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalIdRead } from "@shared/ipc-contract";

// =============================================================================
// Kimlik ezme düzeltmesi (plan §5.5 md. 5). İddia: "okunamadı" durumunda kalıcı
// kimliğin ÜSTÜNE YAZILMAZ (anahtar halkası geri gelince eski kimlik döner); yalnız
// gerçekten "yok"ken üretilip yazılır. Sonda (ölçüldü): UNREADABLE dalına yazma eklendi → 3 kırmızı.
// =============================================================================

vi.mock("@/lib/secure-store", () => ({ secureStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } }));

const { getOrCreateDeviceId, deviceIdState, resetDeviceIdForTest } = await import("./deviceId");
const { secureStore } = await import("@/lib/secure-store");

function bridge(read: LocalIdRead | Error) {
  const api = {
    describe: vi.fn(),
    readLocalId: vi.fn(() => (read instanceof Error ? Promise.reject(read) : Promise.resolve(read))),
    createLocalId: vi.fn(() => Promise.resolve(true)),
  };
  (window as unknown as { api: unknown }).api = { deviceIdentity: api };
  return api;
}

beforeEach(() => resetDeviceIdForTest());
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  vi.clearAllMocks();
});

describe("masaüstü köprüsü", () => {
  it("kayıtlı kimlik aynen döner, yazma yok", async () => {
    const api = bridge({ status: "OK", value: "kalici-kimlik-1234" });
    expect(await getOrCreateDeviceId()).toBe("kalici-kimlik-1234");
    expect(api.createLocalId).not.toHaveBeenCalled();
    expect(deviceIdState()).toBe("stored");
  });

  it("gerçekten YOK → bir kez üretilip yazılır", async () => {
    const api = bridge({ status: "ABSENT" });
    const id = await getOrCreateDeviceId();
    expect(api.createLocalId).toHaveBeenCalledTimes(1);
    expect(api.createLocalId).toHaveBeenCalledWith(id);
    expect(deviceIdState()).toBe("created");
    expect(await getOrCreateDeviceId()).toBe(id);
  });

  it("⭐ OKUNAMADI → yazma ÇAĞRILMAZ, oturum geçici kimlikle sürer", async () => {
    const api = bridge({ status: "UNREADABLE" });
    const id = await getOrCreateDeviceId();
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(api.createLocalId).not.toHaveBeenCalled();
    expect(secureStore.set).not.toHaveBeenCalled();
    expect(deviceIdState()).toBe("ephemeral");
  });

  it("⭐ köprü istisna atarsa da okunamadı sayılır → yazma yok", async () => {
    const api = bridge(new Error("ipc düştü"));
    await getOrCreateDeviceId();
    expect(api.createLocalId).not.toHaveBeenCalled();
    expect(secureStore.set).not.toHaveBeenCalled();
  });

  it("ana süreç yazmayı reddederse (arada okunamaz oldu) kimlik geçici kalır", async () => {
    const api = bridge({ status: "ABSENT" });
    api.createLocalId.mockResolvedValueOnce(false);
    await getOrCreateDeviceId();
    expect(deviceIdState()).toBe("ephemeral");
  });
});

describe("köprüsüz (web/eski)", () => {
  it("get istisna atarsa yazma yok; null ise yazılır", async () => {
    vi.mocked(secureStore.get).mockRejectedValueOnce(new Error("x"));
    await getOrCreateDeviceId();
    expect(secureStore.set).not.toHaveBeenCalled();

    resetDeviceIdForTest();
    vi.mocked(secureStore.get).mockResolvedValueOnce(null);
    const id = await getOrCreateDeviceId();
    expect(secureStore.set).toHaveBeenCalledWith("config.deviceId", id);
  });
});
