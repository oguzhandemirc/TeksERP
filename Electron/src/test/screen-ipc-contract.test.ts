// =============================================================================
// Bekçi: ekran yakalama IPC zinciri — sözleşme → handler → registry → preload kilitli
// =============================================================================
// NEDEN: dört dosyadan biri eksik inerse "Sorun bildir" üretimde sessizce görüntüsüz açılır (yakalama reject,
// renderer yutar). Tip sistemi preload'daki eksiği görür ama KANAL ADI eşleşmesini kimse görmez.
// Yakalama girdi ALMAZ: hangi pencerenin görüntüleneceğini renderer seçemez (event.sender).
// =============================================================================
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), "utf8");

describe("ekran yakalama IPC zinciri", () => {
  const contract = read("shared/ipc-contract.ts");
  const preload = read("electron/preload.ts");
  const handler = read("electron/ipc/screen.ipc.ts");
  const index = read("electron/ipc/index.ts");

  it("sözleşmede ScreenApi ve ApiBridge.screen var", () => {
    expect(contract).toMatch(/export interface ScreenApi\s*{[^}]*capture:/);
    expect(contract).toMatch(/^\s*screen: ScreenApi;/m);
  });

  it("preload kanalı ile handler kanalı AYNI ve handler kayıtlı", () => {
    const pre = [...preload.matchAll(/screen: {\s*capture: \(\) => ipcRenderer\.invoke\("([^"]+)"\)/g)].map((m) => m[1]);
    const handled = [...handler.matchAll(/handleTrusted\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(pre).toEqual(["screen:capture"]);
    expect(handled).toEqual(pre);
    expect(index).toMatch(/registerScreenIpc\(\);/);
  });

  it("handler isteyen pencereyi yakalar ve 1920 px'e küçültür", () => {
    expect(handler).toMatch(/BrowserWindow\.fromWebContents\(event\.sender\)/);
    expect(handler).toMatch(/MAX_EDGE = 1920/);
  });
});
