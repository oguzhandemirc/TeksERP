import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// =============================================================================
// IPC GÖNDEREN DENETİMİ (güvenlik denetimi 2026-10-01, IST-5 — "preload kökene bakmıyor").
// İddia 1 (davranış): `handleTrusted`/`onTrusted` isteği YALNIZ uygulama belgesinin ana
// çerçevesinden işler; giriş adresi yazılmadıysa her istek reddedilir (fail-closed).
// İddia 2 (MANDAL): electron/ altında her `ipcMain.*` kaydı bu tek geçitten geçer.
// BEYANLI İSTİSNA (iki yönlü): `electron/ipc/updater.ipc.ts` — G1 diliminin (panel
// güncelleme imzası) sahipliğinde; İNİŞTE G1 çevirir. Dosya çıplak kaydı bırakınca
// istisna ÖLÜR ve bu bekçi kırmızı verir → satır o commit'te silinir.
// =============================================================================

type Listener = (...args: unknown[]) => unknown;
const h = vi.hoisted(() => ({ handles: new Map<string, Listener>(), ons: new Map<string, Listener>() }));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (ch: string, fn: Listener) => h.handles.set(ch, fn),
    on: (ch: string, fn: Listener) => h.ons.set(ch, fn),
  },
}));
vi.mock("electron-log/main.js", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const trusted = await import("../../electron/security/trusted-ipc");

const ENTRY = "file:///C:/Program%20Files/TeksERP/resources/app.asar/out/renderer/index.html";
const appEvent = { senderFrame: { url: `${ENTRY}#/x`, parent: null } };

/** Çıplak `ipcMain.*` kaydı istisnası — dosya → gerekçe. */
const RAW_IPC_EXCEPTIONS: Record<string, string> = {
  "electron/ipc/updater.ipc.ts": "G1 (panel güncelleme imzası) sahipliği — inişte G1 trusted-ipc'ye çevirir",
};
const GATE_FILE = "electron/security/trusted-ipc.ts";
const RAW_IPC_RE = /\bipcMain\.(?:handle|handleOnce|on|once|addListener)\s*\(/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return tsFiles(p);
    return d.name.endsWith(".ts") ? [p] : [];
  });
}
const root = process.cwd();
const sources = tsFiles(resolve(root, "electron")).map((abs) => ({ file: relative(root, abs), src: readFileSync(abs, "utf8") }));
const rawUsers = (list: typeof sources): string[] =>
  list.filter((s) => s.file !== GATE_FILE && (s.src.match(RAW_IPC_RE) ?? []).length > 0).map((s) => s.file);

describe("gönderen denetimi (davranış)", () => {
  it("giriş adresi yazılmadan HER istek RED (fail-closed)", () => {
    expect(trusted.trustedAppEntry()).toBeNull();
    expect(trusted.isTrustedSender(appEvent)).toBe(false);
  });

  it("⭐ yalnız uygulama belgesinin ANA çerçevesi geçer", () => {
    trusted.setTrustedAppEntry(ENTRY);
    expect(trusted.isTrustedSender(appEvent)).toBe(true);
    expect(trusted.isTrustedSender({ senderFrame: { url: ENTRY, parent: { url: ENTRY } } })).toBe(false);
    expect(trusted.isTrustedSender({ senderFrame: null })).toBe(false);
    expect(trusted.isTrustedSender({ senderFrame: { url: "file://saldirgan/pay/index.html", parent: null } })).toBe(false);
    expect(trusted.isTrustedSender({ senderFrame: { url: "about:srcdoc", parent: null } })).toBe(false);
    const disposed = {
      get senderFrame(): never {
        throw new Error("Render frame was disposed");
      },
    };
    expect(trusted.isTrustedSender(disposed)).toBe(false);
  });

  it("handleTrusted: yabancı gönderen işleyiciye ULAŞMAZ; güvenilir gönderen argümanlarıyla ulaşır", () => {
    trusted.setTrustedAppEntry(ENTRY);
    const listener = vi.fn((_e: unknown, a: number, b: number) => a + b);
    trusted.handleTrusted("test:topla", listener);
    const fn = h.handles.get("test:topla");
    expect(() => fn?.({ senderFrame: { url: "https://saldirgan.com/", parent: null } }, 1, 2)).toThrow(trusted.UNTRUSTED_SENDER_ERROR);
    expect(listener).not.toHaveBeenCalled();
    expect(fn?.(appEvent, 1, 2)).toBe(3);
  });

  it("onTrusted: yabancı gönderen sessizce düşer; güvenilir gönderen ulaşır", () => {
    trusted.setTrustedAppEntry(ENTRY);
    const listener = vi.fn();
    trusted.onTrusted("test:kapat", listener);
    const fn = h.ons.get("test:kapat");
    fn?.({ senderFrame: { url: "file:///C:/Users/Public/x.html", parent: null } }, "a");
    expect(listener).not.toHaveBeenCalled();
    fn?.(appEvent, "a");
    expect(listener).toHaveBeenCalledWith(appEvent, "a");
  });
});

describe("MANDAL: her ipcMain kaydı tek geçitten", () => {
  it("körlük zemini: taranan dosya ve güvenilir kayıt sayısı", () => {
    expect(sources.length).toBeGreaterThanOrEqual(20);
    const trustedCount = sources.reduce((n, s) => n + (s.src.match(/\b(?:handleTrusted|onTrusted)\(\s*"/g) ?? []).length, 0);
    expect(trustedCount).toBeGreaterThanOrEqual(30);
  });

  it("⭐ çıplak ipcMain kaydı yalnız beyanlı istisnada", () => {
    expect(rawUsers(sources).sort()).toEqual(Object.keys(RAW_IPC_EXCEPTIONS).sort());
  });

  it("istisna iki yönlü: beyanlı dosya VAR ve hâlâ çıplak kayıt taşıyor (yoksa satırı sil)", () => {
    for (const file of Object.keys(RAW_IPC_EXCEPTIONS)) {
      const entry = sources.find((s) => s.file === file);
      expect(entry, `${file} yok — istisna satırı ölü`).toBeDefined();
      expect((entry?.src.match(RAW_IPC_RE) ?? []).length, `${file} çevrildi — istisna satırı ölü`).toBeGreaterThan(0);
    }
  });

  it("preload'ın her kanalı güvenilir kayıtta ya da beyanlı istisnada", () => {
    const preload = sources.find((s) => s.file === "electron/preload.ts")?.src ?? "";
    const channels = [...preload.matchAll(/ipcRenderer\.(?:invoke|send)\("([^"]+)"/g)].map((m) => m[1]!);
    expect(channels.length).toBeGreaterThanOrEqual(30);
    const reg = (re: RegExp, list: typeof sources) => new Set(list.flatMap((s) => [...s.src.matchAll(re)].map((m) => m[1]!)));
    const viaGate = reg(/\b(?:handleTrusted|onTrusted)\(\s*"([^"]+)"/g, sources);
    const exceptionFiles = sources.filter((s) => s.file in RAW_IPC_EXCEPTIONS);
    const viaException = reg(/\bipcMain\.(?:handle|on)\(\s*"([^"]+)"/g, exceptionFiles);
    const orphan = channels.filter((c) => !viaGate.has(c) && !viaException.has(c));
    expect(orphan).toEqual([]);
  });

  it("K-sonda: tarayıcı çıplak kaydı GÖRÜR (kör değil)", () => {
    const fake = [{ file: "electron/ipc/yeni.ipc.ts", src: 'ipcMain.handle("yeni:kanal", () => 1);' }];
    expect(rawUsers(fake)).toEqual(["electron/ipc/yeni.ipc.ts"]);
  });
});
