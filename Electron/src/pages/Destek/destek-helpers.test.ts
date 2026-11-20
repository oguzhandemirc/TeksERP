import { describe, expect, it, vi } from "vitest";
import { MAX_FILE_BYTES, base64Size, screenFiles } from "./attachments";
import { buildSupportContext, lastClientError } from "./context";
import { isFeatureAbsent, readDestekError } from "./errors";
import { badgeText, pollUnreadOnce } from "./unread";
import { codeError, httpError, networkError } from "./testing";

const file = (name: string, type: string, size: number) => {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

describe("ek doğrulaması", () => {
  it("tür, boyut ve adet sınırı Türkçe sebeple reddedilir", () => {
    const r = screenFiles(4, [
      file("a.png", "image/png", 100),
      file("b.png", "image/png", 100),
      file("c.exe", "application/x-msdownload", 100),
      file("d.pdf", "application/pdf", MAX_FILE_BYTES + 1),
    ]);
    expect(r.accepted.map((f) => f.name)).toEqual(["a.png"]);
    expect(r.errors).toHaveLength(3);
    expect(r.errors.join(" ")).toMatch(/En çok 5 dosya/);
    expect(r.errors.join(" ")).toMatch(/10 MB/);
  });

  it("base64 bayt hesabı dolguyu düşer", () => {
    expect(base64Size("UE5H")).toBe(3);
    expect(base64Size("UE4=")).toBe(2);
  });
});

describe("otomatik bağlam", () => {
  const win = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2, navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0)", language: "tr-TR" } };

  it("ekran, yol, işletim sistemi, pencere boyutu; sır alanı yok", () => {
    const c = buildSupportContext({ screen: "Sevkiyatlar", path: "/operations/shipments", isElectron: true, samples: [], win, now: 0 });
    expect(c).toMatchObject({ screen: "Sevkiyatlar", path: "/operations/shipments", client: { os: "Windows", device: "Masaüstü paneli", locale: "tr-TR" } });
    expect(c.technical).toEqual({ windowSize: "1280x720", pixelRatio: 2 });
    expect(JSON.stringify(c)).not.toMatch(/token|password|parola|Bearer/i);
  });

  it("son istemci hatası: sorgu metni atılır, destek uçları ve eski hatalar sayılmaz", () => {
    const now = 1_000_000;
    const s = (url: string, status: number | "ERR", at: number) => ({ method: "GET", url, status, ms: 1, at });
    expect(lastClientError([s("/api/customers?search=Ahmet", 500, now - 10), s("/api/etkili-destek/okunmamis", 502, now)], now)).toBe("GET /api/customers → 500");
    expect(lastClientError([s("/api/x", 500, now - 11 * 60 * 1000)], now)).toBeNull();
  });
});

describe("hata eşlemesi (details.code)", () => {
  it("429 Retry-After saniyesini söyler", () => {
    const e = readDestekError(httpError(429, { message: "x", details: { code: "RATE_LIMITED" } }, { "retry-after": "30" }));
    expect(e.retryAfterSec).toBe(30);
    expect(e.message).toMatch(/30 saniye/);
  });

  it("502/504 ve ağ hatası sade cümle; 413 dosya boyutu; 409 yeni talep önerir", () => {
    expect(readDestekError(codeError(502, "DESTEK_ULASILAMADI")).message).toMatch(/ulaşılamıyor/);
    expect(readDestekError(codeError(504, "DESTEK_ZAMAN_ASIMI")).message).toMatch(/ulaşılamıyor/);
    expect(readDestekError(networkError()).status).toBeNull();
    expect(readDestekError(httpError(413, { message: "x" })).message).toMatch(/10 MB/);
    expect(readDestekError(codeError(409, "REOPEN_WINDOW_EXPIRED")).suggestNewTicket).toBe(true);
    expect(readDestekError(codeError(502, "DESTEK_YAPILANDIRMA")).message).toMatch(/yöneticinize/);
  });

  it("eski backend (404) ve kapalı modül özellik yok sayılır", () => {
    expect(isFeatureAbsent(httpError(404))).toBe(true);
    expect(isFeatureAbsent(codeError(403, "MODULE_DISABLED"))).toBe(true);
    expect(isFeatureAbsent(codeError(502, "DESTEK_ULASILAMADI"))).toBe(false);
  });
});

describe("rozet yoklaması", () => {
  it("merkez erişilemezken hata YUTULUR, rozet eski değerinde kalır", async () => {
    const setUnread = vi.fn();
    const denyTenant = vi.fn();
    const fetchUnread = vi.fn().mockRejectedValue(codeError(502, "DESTEK_ULASILAMADI"));
    await expect(pollUnreadOnce({ fetchUnread, canTenant: true, setUnread, denyTenant })).resolves.toBeUndefined();
    expect(setUnread).not.toHaveBeenCalled();
    expect(fetchUnread).toHaveBeenCalledTimes(1);
  });

  it("firma kapsamı 403 → sekme kapanır; kendi sayısı yazılır", async () => {
    const setUnread = vi.fn();
    const denyTenant = vi.fn();
    const fetchUnread = vi.fn().mockResolvedValueOnce({ count: 3, tickets: 2 }).mockRejectedValueOnce(codeError(403, "FORBIDDEN"));
    await pollUnreadOnce({ fetchUnread, canTenant: true, setUnread, denyTenant });
    expect(setUnread).toHaveBeenCalledWith("mine", 2);
    expect(denyTenant).toHaveBeenCalledTimes(1);
  });

  it("rozet metni", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(null)).toBeNull();
    expect(badgeText(4)).toBe("4");
    expect(badgeText(12)).toBe("9+");
  });
});
