import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getStoredMachineConfig,
  setStoredMachineConfig,
  clearStoredMachineConfig,
  EMPTY_MACHINE_CONFIG,
  type MachineConfig,
} from "./machine-config";

const KEY = "config.workstation";

function installStore(initial: Record<string, string> = {}) {
  const mem = new Map<string, string>(Object.entries(initial));
  const api = {
    get: vi.fn(async (k: string) => mem.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
    delete: vi.fn(async (k: string) => void mem.delete(k)),
  };
  (window as unknown as { api: unknown }).api = { secureStore: api };
  return { mem, api };
}

beforeEach(() => {
  (window as unknown as { api: unknown }).api = undefined;
});

describe("machine-config yerel depo", () => {
  it("kayıt yoksa boş config", async () => {
    installStore();
    expect(await getStoredMachineConfig()).toEqual(EMPTY_MACHINE_CONFIG);
  });

  it("set → get roundtrip (tek JSON blob)", async () => {
    const { api } = installStore();
    const cfg: MachineConfig = {
      labelPrinter: { enabled: true, transport: "serial", path: "COM5", baudRate: 9600 },
      scaleDevice: { path: "COM3", simulate: false },
      scanner: { scanAnywhere: true },
    };
    await setStoredMachineConfig(cfg);
    expect(api.set).toHaveBeenCalledWith(KEY, JSON.stringify(cfg));
    expect(await getStoredMachineConfig()).toEqual(cfg);
  });

  it("bozuk JSON'da boş config (çökmeden)", async () => {
    installStore({ [KEY]: "{ bozuk json" });
    expect(await getStoredMachineConfig()).toEqual(EMPTY_MACHINE_CONFIG);
  });

  it("JSON obje değilse (dizi/primitive) boş config", async () => {
    installStore({ [KEY]: "[1,2,3]" });
    expect(await getStoredMachineConfig()).toEqual(EMPTY_MACHINE_CONFIG);
  });

  it("clear kaydı siler", async () => {
    const { api, mem } = installStore({ [KEY]: JSON.stringify({ scaleDevice: { path: "COM3" } }) });
    await clearStoredMachineConfig();
    expect(api.delete).toHaveBeenCalledWith(KEY);
    expect(mem.has(KEY)).toBe(false);
  });

  it("window.api yoksa boş config (test/web ortamı)", async () => {
    expect(await getStoredMachineConfig()).toEqual(EMPTY_MACHINE_CONFIG);
  });
});
