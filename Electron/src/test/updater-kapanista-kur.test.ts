import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import {
  INSTALLER_FILE,
  UYGULAMA,
  getStatus,
  h,
  hazirla,
  kur,
  tik,
  updaterFiksturKancalari,
} from "./helpers/updater-ipc-fikstur";

/**
 * KAPANIŞTA KURULUM (gerçek `registerUpdaterIpc`, sahte electron/electron-updater) — kullanıcı kararı 2026-10-12.
 * ⭐ "Sonra" (`updater:defer`) → `ertelendi`; hazır paket programın kapanışında (`before-quit`) künyesi yeniden
 * ölçülerek sessiz kurulur ve uygulama yeniden AÇILMAZ; dosya değişmişse kurulmaz. Elle/geri sayım kurulumu
 * başladıysa kapanış ikinci kez kurmaz. Arayüz yarısı: `guncelleme-form-kapisi.test.tsx`.
 */
updaterFiksturKancalari();

/** Programın kapanışı (`before-quit`): tutuldu mu. */
function kapat(): boolean {
  let tutuldu = false;
  h.appListeners.get("before-quit")!({ preventDefault: () => (tutuldu = true) });
  return tutuldu;
}

describe("kapanışta kurulum — \"Sonra\" ya da açık form (kullanıcı kararı 2026-10-12)", () => {
  it("⭐ \"Sonra\" (updater:defer) → ertelendi; kapanış tutulur, künye ölçülür, sessiz kurulur ve uygulama YENİDEN AÇILMAZ", async () => {
    await kur();
    await hazirla();
    h.onHandlers.get("updater:defer")!(UYGULAMA);
    expect(getStatus()).toMatchObject({ state: "ready", ertelendi: true });
    expect(kapat(), "kapanış künye ölçülene dek tutulur").toBe(true);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, false));
    expect(kapat(), "ikinci kapanış (kurulumun kendi çıkışı) tutulmaz").toBe(false);
  });

  it("açık form yüzünden bekleyen paket (ertelenmeden) de kapanışta kurulur", async () => {
    await kur();
    await hazirla();
    expect(kapat()).toBe(true);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, false));
  });

  it("kapanışta dosya değişmişse KURULMAZ, ret duyurulur ve kapanış sürer", async () => {
    await kur();
    await hazirla();
    writeFileSync(INSTALLER_FILE, Buffer.from("başka exe"));
    expect(kapat()).toBe(true);
    await vi.waitFor(() => expect(getStatus().imzaReddi?.kod).toBe("DOSYA_OZETI"));
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.appQuit).toHaveBeenCalled());
    expect(kapat(), "ret sonrası kapanış tutulmaz").toBe(false);
  });

  it("elle/geri sayım kurulumu başladıysa kapanış ikinci kez kurmaz; hazır paket yoksa kapanış tutulmaz", async () => {
    await kur();
    expect(kapat(), "paket yok").toBe(false);
    await hazirla();
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true));
    expect(kapat()).toBe(false);
    expect(h.updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("kurulum başlamadıysa (izin reddi) 20 sn sonra yeniden denenebilir", async () => {
    await kur();
    await hazirla();
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledTimes(1));
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await tik();
    expect(h.updater.quitAndInstall).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    h.onHandlers.get("updater:install")!(UYGULAMA);
    await vi.waitFor(() => expect(h.updater.quitAndInstall).toHaveBeenCalledTimes(2));
  });

  it("\"Sonra\" hazır paket yokken etkisiz", async () => {
    await kur();
    h.onHandlers.get("updater:defer")!(UYGULAMA);
    expect(getStatus().ertelendi).not.toBe(true);
  });
});
