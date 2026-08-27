// =============================================================================
// Bekçi: keşif IPC zinciri — DÖRT DOSYA birbirine kilitli
// =============================================================================
// NEDEN: bu repoda IPC eklemek dört dosyaya dokunmak demek (sözleşme → handler →
// registry → preload) ve tam olarak SESSİZCE YARIM İNEN desen budur. Renderer
// `window.api.discovery.start()` çağırır, `ipcMain` tarafında handler yoksa
// promise reject olur — ve bu **yalnız üretimde, müşterinin makinesinde** ortaya
// çıkar, çünkü tip sistemi preload'daki bir eksiği yakalar ama `ipcMain.handle`
// ile preload arasındaki KANAL ADI eşleşmesini kimse doğrulamaz.
//
// Aynı sınıf hata bu projede yaşandı: `print-event` ucu 2026-08-05'ten beri 500
// veriyordu çünkü handler bind edilmemişti; servis testleri göremedi.
//
// Körlük zemini: dört çıkarımın her biri en az bir öğe vermeli. Biri boşsa
// tarayıcı boşa düşmüş demektir ve "ihlal yok" ile "hiçbir şeye bakılmadı"
// aynı yeşile çıkardı.
//
// NEGATİF SINAMA: aynı çıkarıcılar, kasten bir handler'ı eksik bırakılmış SABİT
// metin üzerinde koşturulur ve farkı raporladıkları doğrulanır.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (p: string): string => readFileSync(resolve(root, p), "utf8");

/** `DiscoveryApi` arayüzündeki üye adları. */
function contractMembers(src: string): string[] {
  const at = src.indexOf("export interface DiscoveryApi");
  if (at < 0) return [];
  const open = src.indexOf("{", at);
  const close = src.indexOf("\n}", open);
  if (open < 0 || close < 0) return [];
  const body = src.slice(open, close);
  return [...body.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/gm)].map((m) => m[1]!).sort();
}

/** preload'daki `discovery: { ... }` bloğunun anahtarları + kanal adları. */
function preloadDiscovery(src: string): { keys: string[]; channels: string[] } {
  const at = src.indexOf("discovery: {");
  if (at < 0) return { keys: [], channels: [] };
  const close = src.indexOf("\n  },", at);
  const body = src.slice(at, close < 0 ? undefined : close);
  return {
    keys: [...body.matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\(/gm)].map((m) => m[1]!).sort(),
    channels: [...body.matchAll(/invoke\("([^"]+)"/g)].map((m) => m[1]!).sort(),
  };
}

/** handler dosyasındaki `ipcMain.handle("...")` kanal adları. */
function handlerChannels(src: string): string[] {
  return [...src.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map((m) => m[1]!).sort();
}

describe("keşif IPC zinciri", () => {
  const contractSrc = read("shared/ipc-contract.ts");
  const preloadSrc = read("electron/preload.ts");
  const handlerSrc = read("electron/ipc/discovery.ipc.ts");
  const indexSrc = read("electron/ipc/index.ts");

  const members = contractMembers(contractSrc);
  const pre = preloadDiscovery(preloadSrc);
  const handlers = handlerChannels(handlerSrc);

  it("körlük zemini: dört çıkarımın hiçbiri BOŞ değil", () => {
    expect(members.length, "sözleşme üyeleri").toBeGreaterThan(0);
    expect(pre.keys.length, "preload anahtarları").toBeGreaterThan(0);
    expect(pre.channels.length, "preload kanalları").toBeGreaterThan(0);
    expect(handlers.length, "ipcMain handler'ları").toBeGreaterThan(0);
  });

  it("sözleşmedeki her üyenin preload karşılığı VAR", () => {
    expect(pre.keys).toEqual(members);
  });

  it("⭐ preload'ın çağırdığı her kanalın handler'ı VAR", () => {
    // Asıl iddia bu: ayrışırsa üretimde "promise reject" olarak patlar.
    expect(pre.channels).toEqual(handlers);
  });

  it("handler registry'ye hem IMPORT hem ÇAĞRI olarak bağlı", () => {
    expect(indexSrc).toContain('import { registerDiscoveryIpc } from "./discovery.ipc.js"');
    expect(indexSrc).toMatch(/registerDiscoveryIpc\(\)\s*;/);
  });

  it("main.ts açılışta keşfi tetikliyor", () => {
    const mainSrc = read("electron/main.ts");
    expect(mainSrc).toContain("startDiscoveryIfNeeded()");
  });

  it("ApiBridge'e discovery alanı eklenmiş", () => {
    expect(contractSrc).toMatch(/discovery:\s*DiscoveryApi\s*;/);
  });

  it("NEGATİF SINAMA: eksik handler'lı sabit metinde çıkarıcılar FARKI görüyor", () => {
    const fakePreload = `
  discovery: {
    state: () => ipcRenderer.invoke("discovery:state"),
    start: (opts) => ipcRenderer.invoke("discovery:start", opts),
  },
`;
    const fakeHandler = `ipcMain.handle("discovery:state", () => 1);`;
    const p = preloadDiscovery(fakePreload);
    const h = handlerChannels(fakeHandler);
    // Çıkarıcılar gerçekten bir şey bulmuş olmalı...
    expect(p.channels).toHaveLength(2);
    expect(h).toHaveLength(1);
    // ...ve karşılaştırma DÜŞMELİ. Bu satır, yukarıdaki ⭐ kontrolünün
    // vakumen yeşil olmadığının kanıtı.
    expect(p.channels).not.toEqual(h);
  });
});

describe("bonjour-service paketlemesi", () => {
  // NEDEN: `externalizeDepsPlugin()` YALNIZ `package.json > dependencies`i okur.
  // Paket devDependencies'e düşerse Vite onu main bundle'ına gömmeye çalışır ve
  // electron-builder production node_modules'üne koymaz → kurulu uygulamada
  // `MODULE_NOT_FOUND`. "Dev'de çalışır, kurulumda ölü" sınıfı; `update-feed-url`
  // bekçisiyle aynı aile.
  const pkg = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("dependencies içinde (devDependencies'te DEĞİL)", () => {
    expect(pkg.dependencies?.["bonjour-service"]).toBeDefined();
    expect(pkg.devDependencies?.["bonjour-service"]).toBeUndefined();
  });

  it("sürüm SABİT — `^`/`~` yok (sonraki ana sürüm ESM-only olabilir)", () => {
    expect(pkg.dependencies?.["bonjour-service"]).toBe("1.4.4");
  });
});
