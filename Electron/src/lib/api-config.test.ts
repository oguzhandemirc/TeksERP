import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  splitApiBaseUrl,
  joinApiBaseUrl,
  normalizeApiBaseUrl,
  getRecentApiBaseUrls,
  pushRecentApiBaseUrl,
  removeRecentApiBaseUrl,
} from "./api-config";

/** Stateful in-memory secure-store — get/set/delete tek test içinde tutarlı. */
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

describe("splitApiBaseUrl / joinApiBaseUrl", () => {
  it("protokol + IP + port ayrıştırır", () => {
    expect(splitApiBaseUrl("http://192.168.1.50:4000")).toEqual({
      protocol: "http",
      host: "192.168.1.50",
      port: "4000",
    });
  });

  it("portsuz https adresi", () => {
    expect(splitApiBaseUrl("https://erp.local")).toEqual({
      protocol: "https",
      host: "erp.local",
      port: "",
    });
  });

  it("protokolsüz girdi http varsayar", () => {
    expect(splitApiBaseUrl("192.168.1.9:8080")).toEqual({
      protocol: "http",
      host: "192.168.1.9",
      port: "8080",
    });
  });

  it("path ve sondaki / atılır, yalnız host:port kalır", () => {
    expect(splitApiBaseUrl("localhost:4000/api/")).toEqual({
      protocol: "http",
      host: "localhost",
      port: "4000",
    });
  });

  it("boş girdi güvenli varsayılan döner", () => {
    expect(splitApiBaseUrl("")).toEqual({ protocol: "http", host: "", port: "" });
  });

  it("parçalardan adres kurar (port varsa ekler)", () => {
    expect(joinApiBaseUrl({ protocol: "http", host: "192.168.1.50", port: "4000" })).toBe(
      "http://192.168.1.50:4000",
    );
    expect(joinApiBaseUrl({ protocol: "https", host: "erp.local", port: "" })).toBe(
      "https://erp.local",
    );
  });

  it("host boşsa boş adres döner (kaydedilemez)", () => {
    expect(joinApiBaseUrl({ protocol: "http", host: "  ", port: "4000" })).toBe("");
  });

  it("split→join roundtrip normalize'la eşdeğer", () => {
    for (const url of ["http://192.168.1.50:4000", "https://erp.local", "10.0.0.2:9100"]) {
      expect(joinApiBaseUrl(splitApiBaseUrl(url))).toBe(normalizeApiBaseUrl(url));
    }
  });

  // IP alanına tam URL yapıştırma (ApiEndpointDialog.onHostChange davranışı):
  // split→join tek seferde çift-protokol/çift-port üretmeden normalize etmeli.
  it("IP alanına yapıştırılan tam URL çift protokol/port ÜRETMEZ", () => {
    expect(joinApiBaseUrl(splitApiBaseUrl("http://192.168.1.50:4000"))).toBe(
      "http://192.168.1.50:4000",
    );
    // host:port (protokolsüz) yapıştırma
    expect(joinApiBaseUrl(splitApiBaseUrl("192.168.1.50:4000"))).toBe("http://192.168.1.50:4000");
    // path'li tam URL — path atılır
    expect(joinApiBaseUrl(splitApiBaseUrl("https://erp.local/api"))).toBe("https://erp.local");
  });
});

describe("son kullanılan adresler", () => {
  it("yeni→eski sırayla döner ve normalize edilir", async () => {
    installStore();
    await pushRecentApiBaseUrl("192.168.1.1:4000"); // protokolsüz → normalize http://
    await pushRecentApiBaseUrl("http://192.168.1.2:4000");
    await pushRecentApiBaseUrl("http://192.168.1.3:4000");
    expect(await getRecentApiBaseUrls()).toEqual([
      "http://192.168.1.3:4000",
      "http://192.168.1.2:4000",
      "http://192.168.1.1:4000",
    ]);
  });

  it("tekrar eklenen adres başa taşınır, kopyalanmaz", async () => {
    installStore();
    await pushRecentApiBaseUrl("http://a:4000");
    await pushRecentApiBaseUrl("http://b:4000");
    await pushRecentApiBaseUrl("http://a:4000");
    expect(await getRecentApiBaseUrls()).toEqual(["http://a:4000", "http://b:4000"]);
  });

  it("en fazla 6 adres tutulur (en eski düşer)", async () => {
    installStore();
    for (let i = 1; i <= 8; i++) await pushRecentApiBaseUrl(`http://h${i}:4000`);
    const list = await getRecentApiBaseUrls();
    expect(list).toHaveLength(6);
    expect(list[0]).toBe("http://h8:4000");
    expect(list).not.toContain("http://h1:4000");
    expect(list).not.toContain("http://h2:4000");
  });

  it("remove adresi listeden çıkarır", async () => {
    installStore();
    await pushRecentApiBaseUrl("http://a:4000");
    await pushRecentApiBaseUrl("http://b:4000");
    expect(await removeRecentApiBaseUrl("http://a:4000")).toEqual(["http://b:4000"]);
    expect(await getRecentApiBaseUrls()).toEqual(["http://b:4000"]);
  });

  it("boş adres eklenmez", async () => {
    installStore();
    await pushRecentApiBaseUrl("");
    await pushRecentApiBaseUrl("   ");
    expect(await getRecentApiBaseUrls()).toEqual([]);
  });

  it("window.api yoksa boş liste (test/web ortamı)", async () => {
    expect(await getRecentApiBaseUrls()).toEqual([]);
  });
});
