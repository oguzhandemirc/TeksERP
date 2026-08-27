// =============================================================================
// Bekçi: keşfedilen sunucuya bağlanma — ADRES DE UYGULANIR
// =============================================================================
// SAHA ARIZASI (2026-08-28): "farklı kurulum" rozetli adayı seçen kullanıcı
// uyuşmazlık modalında "Bu sunucuya güven ve bağlan"a bastığında YALNIZ kimlik
// sabitleniyor, adres uygulanmıyordu. Sonuç zinciri:
//   güven → pin → recheck → ESKİ (ölü) adres prob edilir → "unreachable" →
//   aynı "Sunucuya ulaşılamadı" ekranı geri gelir.
// Kullanıcı için bu, çalışmayan bir butondan ayırt edilemez ve ekrandan çıkış
// yolu kalmaz — panel kilitlenmiş görünür.
//
// Bu yüzden burada ölçülen şey helper'ın İÇİ değil SONUCU: çağrıdan sonra
// AKTİF adres adayın adresi OLMAK ZORUNDA.
// =============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DiscoveredServer } from "@shared/ipc-contract";
import { connectToDiscoveredServer } from "./server-identity";
import { applyApiBaseUrl, getActiveApiBaseUrl, DEFAULT_API_BASE_URL } from "./api-config";

const pin = vi.fn(async () => {});
const store = new Map<string, string>();

function candidate(over: Partial<DiscoveredServer> = {}): DiscoveredServer {
  return {
    host: "192.168.1.102",
    port: 4000,
    baseUrl: "http://192.168.1.102:4000",
    via: "scan",
    rttMs: 12,
    matchesPinned: "mismatch",
    identity: {
      installationId: "yeni-kurulum-id",
      companyName: "Adnan Şahin Tekstil",
      serverName: "ThinkPad",
      version: "2.9.0",
    },
    ...over,
  } as DiscoveredServer;
}

beforeEach(() => {
  pin.mockClear();
  store.clear();
  applyApiBaseUrl("http://localhost:4000"); // eski, artık cevap vermeyen adres
  (window as unknown as { api?: unknown }).api = {
    discovery: { pin, probe: vi.fn(), state: vi.fn(), start: vi.fn() },
    secureStore: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
    },
  };
});

afterEach(() => {
  (window as unknown as { api?: unknown }).api = undefined;
  applyApiBaseUrl(DEFAULT_API_BASE_URL);
});

describe("connectToDiscoveredServer", () => {
  it("⭐ aktif adresi adayın adresine ÇEKER (bu olmazsa modal çıkışsız kalır)", async () => {
    await connectToDiscoveredServer(candidate());
    expect(getActiveApiBaseUrl()).toBe("http://192.168.1.102:4000");
  });

  it("adresi kalıcı olarak da yazar — sonraki açılış aynı sunucuya gelir", async () => {
    await connectToDiscoveredServer(candidate());
    expect(store.get("config.apiBaseUrl")).toBe("http://192.168.1.102:4000");
  });

  it("son kullanılanlara ekler", async () => {
    await connectToDiscoveredServer(candidate());
    expect(JSON.parse(store.get("config.apiBaseUrl.recent") ?? "[]")).toContain(
      "http://192.168.1.102:4000",
    );
  });

  it("trustIdentity YOKKEN kimliğe DOKUNMAZ (sabitleme anı ilk başarılı giriştir)", async () => {
    await connectToDiscoveredServer(candidate({ matchesPinned: "match" }));
    expect(pin).not.toHaveBeenCalled();
  });

  it("trustIdentity ile kimliği sabitler — insan 'bu benim sunucum' dedi", async () => {
    await connectToDiscoveredServer(candidate(), { trustIdentity: true });
    expect(pin).toHaveBeenCalledWith("yeni-kurulum-id");
  });

  it("⭐ sabitleme HATA VERSE BİLE adres uygulanır — bağlanma yolu düşmez", async () => {
    pin.mockRejectedValueOnce(new Error("ipc koptu"));
    await connectToDiscoveredServer(candidate(), { trustIdentity: true });
    expect(getActiveApiBaseUrl()).toBe("http://192.168.1.102:4000");
  });
});

// -----------------------------------------------------------------------------
// TEK KAYNAK bekçisi — kaynak taraması
// -----------------------------------------------------------------------------
// Hata "helper yanlıştı" değil "bir çağıran helper'ı ATLADI" sınıfındandı: aynı
// iş (keşfedilen sunucuya bağlan) üç yüzeyde elle yazılmıştı ve üçü ayrışmıştı
// (biri adresi hiç uygulamıyor, biri son-kullanılanlara yazmıyordu). Bu yüzden
// ölçüm koda değil KAYNAĞA bakar: keşif adayını uygulayan yüzeyler adresi elle
// kurmaz. (`ApiEndpointDialog` KAPSAM DIŞI — orada adres elle YAZILIR, aday
// seçilmez.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ADAY_UYGULAYAN_YUZEYLER = [
  "pages/Login/LoginPage.tsx",
  "pages/Login/ServerNotFoundPanel.tsx",
  "components/layout/ServerOfflineBanner.tsx",
];

describe("keşfedilen sunucuya bağlanma — tek kaynak", () => {
  it.each(ADAY_UYGULAYAN_YUZEYLER)("%s adresi ELLE uygulamaz", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    expect(src).not.toMatch(/\bapplyApiBaseUrl\s*\(/);
    expect(src).not.toMatch(/\bsetStoredApiBaseUrl\s*\(/);
  });

  it.each(ADAY_UYGULAYAN_YUZEYLER)("%s tek kapıdan geçer", (rel) => {
    const src = readFileSync(path.join(SRC, rel), "utf8");
    expect(src).toMatch(/connectToDiscoveredServer\s*\(/);
  });

  it("⭐ uyuşmazlık onayı kimliği sabitlemekle YETİNMEZ (asıl saha hatası)", () => {
    const src = readFileSync(path.join(SRC, "pages/Login/LoginPage.tsx"), "utf8");
    // Modalın onTrust dalı doğrudan `discovery.pin` çağırırsa eski hataya dönülmüş
    // demektir — pin tek başına adresi değiştirmez.
    expect(src).not.toMatch(/discovery\?\.\s*pin\s*\(/);
    expect(src).toMatch(/connectToDiscoveredServer\([^)]*trustIdentity:\s*true/s);
  });
});
