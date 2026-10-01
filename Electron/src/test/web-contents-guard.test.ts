import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// =============================================================================
// KABUK KAPILARI (güvenlik denetimi 2026-10-01, IST-3 + IST-5).
// İddia: ana çerçeve yalnız uygulama belgesinde kalır (UNC dahil her yabancı file:// ve ağ
// adresi engellenir), alt çerçeve yalnız srcdoc/boş belgeye gider, engellenen gezinme
// işletim sistemine DEVREDİLMEZ, yeni pencere açılmaz, tarayıcı izinleri varsayılan RED
// (uygulama belgesine yalnız pano). Gerçek `web-contents-guard.ts` sahte webContents'le koşar.
// =============================================================================

type Listener = (...args: unknown[]) => unknown;
const h = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("electron", () => ({ shell: { openExternal: h.openExternal }, ipcMain: { handle: vi.fn(), on: vi.fn() } }));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const guard = await import("../../electron/security/web-contents-guard");
const trusted = await import("../../electron/security/trusted-ipc");

const ENTRY = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";

function fakeContents(currentUrl = `${ENTRY}#/`) {
  const listeners = new Map<string, Listener[]>();
  let openHandler: Listener | null = null;
  const contents = {
    on: (event: string, fn: Listener) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    setWindowOpenHandler: (fn: Listener) => {
      openHandler = fn;
    },
    getURL: () => currentUrl,
  };
  const fire = (event: string, url: string, isMainFrame: boolean) => {
    const details = { url, isMainFrame, preventDefault: vi.fn() };
    for (const fn of listeners.get(event) ?? []) fn(details);
    return details.preventDefault.mock.calls.length > 0;
  };
  return { contents, fire, openHandler: () => openHandler };
}

function guarded() {
  trusted.setTrustedAppEntry(ENTRY);
  const fake = fakeContents();
  guard.guardWebContents(fake.contents as never);
  return fake;
}

describe("ana çerçeve gezinmesi", () => {
  it("uygulama belgesi (hash/sorgu) serbest", () => {
    const { fire } = guarded();
    expect(fire("will-navigate", `${ENTRY}#/operasyon`, true)).toBe(false);
    expect(fire("will-navigate", `${ENTRY}?yenile=1`, true)).toBe(false);
  });

  it("⭐ UNC, başka yerel dosya, ağ ve protokol adresi engellenir — işletim sistemine DEVİR YOK", () => {
    const { fire } = guarded();
    const attacks = [
      "file://saldirgan/pay/index.html",
      "file:////saldirgan/pay/out/renderer/index.html",
      "file:///C:/Users/Public/evil/out/renderer/index.html",
      "https://saldirgan.com/",
      "http://10.0.0.5:4000/",
      "ms-msdt:/id PCWDiagnostic",
      "search-ms:query=x",
    ];
    for (const url of attacks) expect(fire("will-navigate", url, true), url).toBe(true);
    for (const url of attacks) expect(fire("will-redirect", url, true), url).toBe(true);
    expect(h.openExternal).not.toHaveBeenCalled();
  });
});

describe("alt çerçeve, webview, yeni pencere", () => {
  it("⭐ alt çerçeve yalnız srcdoc/boş belgeye; bağlantı çerçeveyi dışarı taşıyamaz", () => {
    const { fire } = guarded();
    expect(fire("will-frame-navigate", "about:srcdoc", false)).toBe(false);
    expect(fire("will-frame-navigate", "about:blank", false)).toBe(false);
    for (const url of ["https://saldirgan.com/", "file://saldirgan/pay/x.html", ENTRY]) {
      expect(fire("will-frame-navigate", url, false), url).toBe(true);
      expect(fire("will-redirect", url, false), url).toBe(true);
    }
  });

  it("webview eklenemez; varsayılan yeni pencere RED", () => {
    const { fire, openHandler } = guarded();
    expect(fire("will-attach-webview", "about:blank", true)).toBe(true);
    expect(openHandler()?.({ url: "https://etkiliyazilim.com" })).toEqual({ action: "deny" });
    expect(h.openExternal).not.toHaveBeenCalled();
  });

  it("giriş adresi yazılmadan ana çerçeve hiçbir yere gidemez (fail-closed)", () => {
    expect(guard.isNavigationAllowed(ENTRY, true)).toBe(true);
    trusted.setTrustedAppEntry("");
    expect(guard.isNavigationAllowed(ENTRY, true)).toBe(false);
    trusted.setTrustedAppEntry(ENTRY);
  });
});

describe("tarayıcı izinleri varsayılan RED", () => {
  function installed() {
    trusted.setTrustedAppEntry(ENTRY);
    const handlers: { request?: Listener; check?: Listener } = {};
    guard.installPermissionPolicy({
      setPermissionRequestHandler: (fn: Listener) => (handlers.request = fn),
      setPermissionCheckHandler: (fn: Listener) => (handlers.check = fn),
    } as never);
    const ask = (permission: string, requestingUrl?: string) => {
      const cb = vi.fn();
      handlers.request?.(fakeContents().contents, permission, cb, { requestingUrl, isMainFrame: true });
      return cb.mock.calls[0]?.[0];
    };
    const check = (permission: string, requestingUrl?: string) =>
      handlers.check?.(fakeContents().contents, permission, "file://", { requestingUrl, isMainFrame: true });
    return { ask, check };
  }

  it("uygulama belgesine yalnız pano okuma/yazma", () => {
    const { ask, check } = installed();
    expect(guard.APP_DOCUMENT_PERMISSIONS).toEqual(["clipboard-read", "clipboard-sanitized-write"]);
    expect(ask("clipboard-sanitized-write", `${ENTRY}#/x`)).toBe(true);
    expect(ask("clipboard-read", undefined)).toBe(true);
    expect(check("clipboard-sanitized-write", `${ENTRY}#/x`)).toBe(true);
  });

  it("⭐ diğer her izin ve yabancı belge RED (dış protokol açma dahil)", () => {
    const { ask, check } = installed();
    for (const p of ["openExternal", "media", "geolocation", "notifications", "fullscreen", "pointerLock", "unknown"]) {
      expect(ask(p, `${ENTRY}#/x`), p).toBe(false);
      expect(check(p, `${ENTRY}#/x`), p).toBe(false);
    }
    expect(ask("clipboard-read", "about:srcdoc")).toBe(false);
    expect(ask("clipboard-read", "file://saldirgan/pay/index.html")).toBe(false);
  });
});

describe("bağlama (main.ts) ve tek devir noktası", () => {
  const main = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

  it("her webContents kapılı; oturum izinleri kurulu; preload'a giriş adresi geçiliyor", () => {
    expect(main).toMatch(/app\.on\("web-contents-created", \(_event, contents\) => guardWebContents\(contents\)\)/);
    expect(main).toContain("installPermissionPolicy(session.defaultSession)");
    expect(main).toContain("setTrustedAppEntry(rendererEntryUrl)");
    expect(main).toContain("additionalArguments: [appEntryArgument(rendererEntryUrl)]");
    expect(main).toMatch(/setWindowOpenHandler\(\(\{ url \}\) => \{\s*void openExternalSafely\(url, "window-open"\);\s*return \{ action: "deny" \};/);
  });

  it("⭐ shell.openExternal yalnız tek geçitte (electron/security/external-open.ts)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    const files = walk(resolve(process.cwd(), "electron")).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(20);
    const users = files.filter((f) => /shell\.openExternal\(/.test(readFileSync(f, "utf8"))).map((f) => relative(process.cwd(), f));
    expect(users).toEqual(["electron/security/external-open.ts"]);
  });
});
