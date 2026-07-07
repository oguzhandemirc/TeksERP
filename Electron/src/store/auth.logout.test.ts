import { describe, it, expect, vi, beforeEach } from "vitest";

// Local-first logout sözleşmesi (SAHA-DAYANIKLILIK-FAZ2.md §E1):
// 1) UI revoke isteğini BEKLEMEZ — logout() yerel temizlikle çözülür,
// 2) revoke arka planda YAKALANMIŞ token'la gider (yerel silmeden etkilenmez),
// 3) logout ASLA reject etmez (çağıranlar `.then(→ #/login)` zincirine güvenir).
vi.mock("@/lib/secure-token", () => ({
  tokenStore: {
    get: vi.fn(async () => "tok-A"),
    set: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  },
}));

// Revoke isteği HİÇ çözülmez — logout'un onu beklemediğinin kesin kanıtı
// (süre ölçümüne dayalı flaky assert yerine: beklenseydi test timeout'a düşerdi).
vi.mock("@/services/authService", () => ({
  authService: {
    logout: vi.fn(() => new Promise<void>(() => {})),
  },
}));

import { useAuthStore } from "./auth";
import { tokenStore } from "@/lib/secure-token";
import { authService } from "@/services/authService";

const fakeUser = { userId: "a", username: "admin", permissions: [] } as never;

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: fakeUser });
});

describe("local-first logout", () => {
  it("logout revoke isteğini BEKLEMEDEN çözülür; user hemen null", async () => {
    // Revoke mock'u ASLA çözülmez — logout onu bekleseydi bu await asılı kalır,
    // vitest testi timeout ile düşürürdü. Çözülmesi = beklemiyor kanıtı.
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.clear).toHaveBeenCalled();
  });

  it("revoke arka planda YAKALANAN token'la gider (yerel silme onu etkilemez)", async () => {
    await useAuthStore.getState().logout();
    await vi.waitFor(() => expect(authService.logout).toHaveBeenCalledWith("tok-A"));
    // Yakalama sırası: get, clear'dan ÖNCE (silinen token'ı yakalayamazdık).
    const getOrder = (tokenStore.get as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? -1;
    const clearOrder =
      (tokenStore.clear as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? -1;
    expect(getOrder).toBeGreaterThan(0);
    expect(getOrder).toBeLessThan(clearOrder);
  });

  it("revoke reddetse bile sessiz — unhandled rejection yok, user null kalır", async () => {
    (authService.logout as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("net"));
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    await new Promise((r) => setTimeout(r, 10)); // arka plan catch'i koşsun
  });

  it("token okunamazsa revoke hiç denenmez, yerel temizlik yine olur", async () => {
    (tokenStore.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ipc"));
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().user).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it("tokenStore.clear reddetse bile logout RESOLVE eder (çağıran #/login'e geçebilir)", async () => {
    (tokenStore.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk"));
    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
