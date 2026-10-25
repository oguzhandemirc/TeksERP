// Bekçi: panelin connect-src'i (T2 bulgusu, 2026-10-25) — renderer isteği yalnız yapılandırılmış sunucu
// kökenine + döngü adresine gider. Masaüstünde ana süreç kapısı (adres çalışma anında değişir), web'de
// derlemede daraltılmış meta CSP. GrapesJS telemetrisi gibi üçüncü taraf `https:` isteği kesilir.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectAllowed, connectOrigin, replaceConnectSrc, webConnectSources } from "@shared/connect-gate";
import { allowConnectOrigin, connectGateCancels, resetConnectGateForTest } from "../../electron/security/connect-gate";
import { ensureConnectOrigin, resetConnectGateCacheForTest } from "@/lib/connect-gate";

const ROOT = resolve(__dirname, "../..");
const connectSrcOf = (html: string) => /connect-src ([^;"]*);/.exec(html)?.[1]?.split(/\s+/) ?? [];
const req = (url: string, resourceType = "xhr") => ({ url, webContentsId: 1, resourceType });

describe("connect-src kapısı — saf yüklem", () => {
  it("köken: ws/wss http/https'e iner, varsayılan port açık", () => {
    expect(connectOrigin("https://Sunucu.local/api/x")).toBe("https://sunucu.local:443");
    expect(connectOrigin("wss://10.0.0.5:4443/z")).toBe("https://10.0.0.5:4443");
    expect(connectOrigin("data:text/plain,a")).toBeNull();
  });

  it("döngü adresi serbest, izinsiz https köken RED, izinli köken serbest, ağ dışı şema kapı dışı", () => {
    const allowed = new Set(["https://10.0.0.5:4443"]);
    expect(connectAllowed("http://localhost:4000/health", allowed)).toBe(true);
    expect(connectAllowed("https://app.grapesjs.com/api/gjs/telemetry/collect", allowed)).toBe(false);
    expect(connectAllowed("https://10.0.0.5:4443/api/orders", allowed)).toBe(true);
    expect(connectAllowed("https://10.0.0.5/api/orders", allowed)).toBe(false);
    expect(connectAllowed("blob:file:///abc", allowed)).toBe(true);
  });
});

describe("connect-src kapısı — ana süreç", () => {
  afterEach(() => resetConnectGateForTest());

  it("⭐ yapılandırılmamış kökene renderer isteği kesilir; bildirilen köken geçer; gezinme ve ana süreç isteği kapı dışı", () => {
    expect(connectGateCancels(req("https://fabrika.example.com:4443/api/me"))).toBe(true);
    expect(allowConnectOrigin("https://fabrika.example.com:4443")).toBe(true);
    expect(connectGateCancels(req("https://fabrika.example.com:4443/api/me"))).toBe(false);
    expect(connectGateCancels(req("https://cdn.example.net/x.js"))).toBe(true);
    expect(connectGateCancels({ url: "https://update.example.net/feed", resourceType: "xhr" })).toBe(false);
    expect(connectGateCancels(req("https://cdn.example.net/", "mainFrame"))).toBe(false);
    expect(connectGateCancels(req("http://127.0.0.1:4000/api/me"))).toBe(false);
  });

  it("ağ adresi olmayan bildirim reddedilir; küme sınırlı", () => {
    expect(allowConnectOrigin("javascript:alert(1)")).toBe(false);
    expect(allowConnectOrigin(42)).toBe(false);
    for (let i = 0; i < 40; i++) allowConnectOrigin(`https://h${i}.local`);
    expect(connectGateCancels(req("https://h0.local/a"))).toBe(true);
    expect(connectGateCancels(req("https://h39.local/a"))).toBe(false);
  });
});

describe("connect-src kapısı — renderer bildirimi", () => {
  afterEach(() => {
    resetConnectGateCacheForTest();
    delete (window as unknown as { api?: unknown }).api;
  });

  it("köken başına bir kez bildirir; köprü yoksa no-op", async () => {
    await expect(ensureConnectOrigin("https://s.local/api/a")).resolves.toBeUndefined();
    const allow = vi.fn().mockResolvedValue(true);
    (window as unknown as { api: unknown }).api = { connectGate: { allow } };
    await ensureConnectOrigin("https://s.local/api/a");
    await ensureConnectOrigin("https://s.local/api/b");
    await ensureConnectOrigin("https://t.local/api/a");
    expect(allow.mock.calls.map((c) => c[0])).toEqual(["https://s.local/api/a", "https://t.local/api/a"]);
  });
});

describe("connect-src — meta CSP", () => {
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8");

  it("⭐ masaüstü meta: çıplak `http:` yok (şifresiz yalnız döngü adresi)", () => {
    const src = connectSrcOf(html);
    expect(src).not.toContain("http:");
    expect(src).toEqual(expect.arrayContaining(["'self'", "http://localhost:*", "http://127.0.0.1:*"]));
  });

  it("⭐ web derlemesi: `https:` herkese açık değil; yalnız aynı köken + açık API kökeni (+ geliştirmede döngü)", () => {
    const build = connectSrcOf(replaceConnectSrc(html, webConnectSources({ dev: false })));
    expect(build).toEqual(["'self'", "data:"]);
    const withApi = connectSrcOf(replaceConnectSrc(html, webConnectSources({ dev: false, apiBaseUrl: "https://api.ornek.com/" })));
    expect(withApi).toEqual(["'self'", "data:", "https://api.ornek.com:443"]);
    const dev = connectSrcOf(replaceConnectSrc(html, webConnectSources({ dev: true })));
    expect(dev).toContain("http://localhost:*");
    expect(dev).not.toContain("https:");
  });
});
