import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

// Harness `apiClient.test.ts` ile aynı: gerçek secure-store ve auth store yerine spy'lar.
const tokenClear = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/secure-token", () => ({ tokenStore: { get: vi.fn(), set: vi.fn(), clear: () => tokenClear() } }));
const authState: { user: unknown; setUser: (u: unknown) => void } = { user: { userId: "u1" }, setUser: () => undefined };
const setUser = vi.fn((u: unknown) => {
  authState.user = u;
});
authState.setUser = setUser;
vi.mock("@/store/auth", () => ({ useAuthStore: { getState: () => authState } }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }));

const apiClient = (await import("./apiClient")).default;

type Handler = { rejected: (e: unknown) => Promise<unknown> };
const interceptor = (): Handler =>
  (apiClient.interceptors.response as unknown as { handlers: Handler[] }).handlers.find(Boolean) as Handler;

function makeError(status: number, body: unknown, url = "/api/orders"): AxiosError {
  const err = new AxiosError("err", "ERR_BAD_RESPONSE");
  err.config = { headers: new AxiosHeaders(), url } as never;
  err.response = { data: body, status, statusText: "", headers: {}, config: err.config } as AxiosResponse;
  return err;
}

const body = {
  message: "Parolanızı değiştirmeniz gerekiyor. Yeni parola belirlemeden devam edilemez.",
  details: { code: "PASSWORD_CHANGE_REQUIRED" },
};

/**
 * G20: kayıtlı (bayat) token'ın hesabı zorunlu parola değişimi bekliyor — uygulamada kalınamaz.
 * 401 ile AYNI çıkış (token sil + user null + tek toast); "yetkiniz yok" DEĞİL.
 */
describe("apiClient — 403 PASSWORD_CHANGE_REQUIRED", () => {
  beforeEach(() => {
    tokenClear.mockClear();
    setUser.mockClear();
    toastError.mockClear();
    authState.user = { userId: "u1" };
  });

  it("⭐ token silinir, giriş ekranına dönülür, değişim cümlesi gösterilir", async () => {
    await expect(interceptor().rejected(makeError(403, body))).rejects.toBeDefined();
    expect(tokenClear).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith(null);
    expect(toastError).toHaveBeenCalledWith("Parolanızı değiştirmeniz gerekiyor — tekrar giriş yapın.");
    expect(toastError).not.toHaveBeenCalledWith(expect.stringMatching(/yetkiniz/i));
  });

  it("oturum ZATEN kapalıysa temizlik ve toast yok (tek-uçuş, 401 ile aynı guard)", async () => {
    authState.user = null;
    await expect(interceptor().rejected(makeError(403, body))).rejects.toBeDefined();
    expect(tokenClear).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
