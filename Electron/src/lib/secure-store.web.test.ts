import { describe, it, expect, beforeEach } from "vitest";
import { secureStore } from "@/lib/secure-store";
import { tokenStore } from "@/lib/secure-token";

/**
 * ⭐ WEB'DE OTURUM TOKEN'I KALICI DEPOYA GİRMEZ (bulut web paneli K2): kimlik httpOnly çerezde.
 * Panel kipi kapalı backend JSON token dönerse token yalnız bellekte yaşar (yenilemede ölür);
 * localStorage'a hiçbir koşulda yazılmaz. Diğer anahtarlar (sunucu adresi, cihaz kimliği…) yazılır.
 * jsdom'da `window.api` yok → bu dosya web hedefini sınar.
 */
beforeEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  window.localStorage.clear();
});

describe("webStore — auth.token", () => {
  it("⭐ auth.token yazılmaz, okunmaz", async () => {
    await secureStore.set("auth.token", "jwt-xyz");
    expect(window.localStorage.getItem("secure.auth.token")).toBeNull();
    expect(Object.values({ ...window.localStorage })).not.toContain("jwt-xyz");
    expect(await secureStore.get("auth.token")).toBeNull();
  });

  it("eski demo derlemesinden kalan token okunmaz ve silmede temizlenir", async () => {
    // eslint-disable-next-line no-restricted-syntax -- test: eski demo derlemesinin bıraktığı kaydı TOHUMLAR
    window.localStorage.setItem("secure.auth.token", "eski-jwt");
    expect(await secureStore.get("auth.token")).toBeNull();
    await secureStore.delete("auth.token");
    expect(window.localStorage.getItem("secure.auth.token")).toBeNull();
  });

  it("tokenStore (panel kipi kapalı backend): token bellekte kullanılır, diske düşmez", async () => {
    await tokenStore.set("bellek-jwt");
    expect(await tokenStore.get()).toBe("bellek-jwt");
    expect(window.localStorage.length).toBe(0);
    await tokenStore.clear();
  });

  it("diğer anahtarlar yazılmaya devam eder (zemin)", async () => {
    await secureStore.set("machine.config", "{}");
    expect(window.localStorage.getItem("secure.machine.config")).toBe("{}");
  });
});
