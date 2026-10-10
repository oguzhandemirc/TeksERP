import { describe, expect, it } from "vitest";
import { AppUpdater } from "electron-updater/out/AppUpdater";
import { groupFeedUrl } from "@shared/update-feed";
import { DOWNLOAD_TOKEN_HEADER, applyFeed, type FeedTarget } from "@shared/download-token";

/**
 * GERÇEK electron-updater sözleşmesi: indirme belirteci latest.yml ve exe isteğine GERÇEKTEN gidiyor mu?
 * Öteki updater testleri electron-updater'ı sahteler ve yalnız `setFeedURL`a ne verildiğini ölçer; `setFeedURL`
 * seçeneklerindeki `requestHeaders`ı kütüphane yok saydığı için o testler yeşilken sahadaki panel başlıksız
 * istekle 403 (INDIRME_BELIRTEC_YOK) aldı. Burada kütüphanenin kendi `AppUpdater`ı, sahte uygulama ve sahte HTTP ile koşar.
 */
const TOKEN = "eyJhbGciOiJFZERTQSJ9.eyJ0eXAiOiJ0ZWtzZXJwLWluZGlybWUifQ.c2lnbmF0dXJl";
const YML = [
  "version: 1.6.0",
  "files:",
  "  - url: TeksERP-Setup-1.6.0.exe",
  "    sha512: YWJj",
  "    size: 1",
  "path: TeksERP-Setup-1.6.0.exe",
  "sha512: YWJj",
  "releaseDate: '2026-10-10T00:00:00.000Z'",
  "",
].join("\n");

type Istek = { headers?: Record<string, unknown>; hostname?: string; path?: string };
type Ic = {
  httpExecutor: { request: (o: Istek) => Promise<string> };
  _testOnlyOptions: { platform: string };
  stagingUserIdPromise: { value: Promise<string> };
  getUpdateInfoAndProvider(): Promise<{ provider: unknown }>;
  computeRequestHeaders(p: unknown): Record<string, unknown>;
};

function kur(): { u: FeedTarget & Ic; istekler: Istek[] } {
  const istekler: Istek[] = [];
  const app = { version: "1.5.0", name: "TeksERP", isPackaged: true, whenReady: () => Promise.resolve(), onQuit: () => {}, quit: () => {}, relaunch: () => {} };
  const u = new (AppUpdater as unknown as new (o: null, a: unknown) => FeedTarget & Ic)(null, app);
  // Sağlayıcı yürütücüyü feed kurulurken yakalar: feed'den ÖNCE.
  u.httpExecutor = { request: async (o) => (istekler.push(o), YML) };
  u._testOnlyOptions = { platform: "win32" };
  u.stagingUserIdPromise = { value: Promise.resolve("00000000-0000-4000-8000-000000000000") };
  return { u, istekler };
}

const feed = groupFeedUrl("test")!;

describe("electron-updater başlık sözleşmesi (gerçek AppUpdater)", () => {
  it("⭐ applyFeed: latest.yml isteği ve exe indirme başlıkları X-TKL-Indirme taşır", async () => {
    const { u, istekler } = kur();
    applyFeed(u, feed, TOKEN);
    const { provider } = await u.getUpdateInfoAndProvider();
    expect(istekler).toHaveLength(1);
    expect(istekler[0]?.path).toMatch(/\/electron\/latest\.yml/);
    expect(istekler[0]?.headers?.[DOWNLOAD_TOKEN_HEADER]).toBe(TOKEN);
    expect(u.computeRequestHeaders(provider)[DOWNLOAD_TOKEN_HEADER], "exe + blockmap").toBe(TOKEN);
  });

  it("belirteç alınamayınca önceki başlık temizlenir (bayat belirteç gitmez)", async () => {
    const { u, istekler } = kur();
    applyFeed(u, feed, TOKEN);
    applyFeed(u, feed, null);
    const { provider } = await u.getUpdateInfoAndProvider();
    expect(istekler[0]?.headers?.[DOWNLOAD_TOKEN_HEADER]).toBeUndefined();
    expect(u.computeRequestHeaders(provider)[DOWNLOAD_TOKEN_HEADER]).toBeUndefined();
  });

  it("izinsiz adrese belirteç gitmez (SIR-5)", async () => {
    const { u, istekler } = kur();
    applyFeed(u, "https://baska.example/test/electron/", TOKEN);
    await u.getUpdateInfoAndProvider();
    expect(istekler[0]?.headers?.[DOWNLOAD_TOKEN_HEADER]).toBeUndefined();
  });
});
