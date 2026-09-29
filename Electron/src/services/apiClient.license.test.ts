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
const { onLicenseGate } = await import("@/lib/license/signal");
const { useLicenseSuspension } = await import("@/lib/license/suspension");

type Handler = { rejected: (e: unknown) => Promise<unknown> };
const interceptor = (): Handler =>
  (apiClient.interceptors.response as unknown as { handlers: Handler[] }).handlers.find(Boolean) as Handler;

function makeError(status: number, body: unknown, url = "/api/orders"): AxiosError {
  const err = new AxiosError("err", "ERR_BAD_RESPONSE");
  err.config = { headers: new AxiosHeaders(), url } as never;
  err.response = { data: body, status, statusText: "", headers: {}, config: err.config } as AxiosResponse;
  return err;
}

/** Lisans kapısının panel dalları: K5 sinyali, modül anahtarı biçimi, D6 (kapı önce 401). */
describe("apiClient — lisans kapısı dalları", () => {
  beforeEach(() => {
    tokenClear.mockClear();
    setUser.mockClear();
    toastError.mockClear();
    authState.user = { userId: "u1" };
    useLicenseSuspension.setState({ suspended: false });
  });

  it("⭐ 403 LICENSE_SUSPENDED → toast YOK, K5 sinyali: kabuk yerine 'verilerimi al' sayfası açılır", async () => {
    const body = { message: "Lisans durduruldu.", details: { code: "LICENSE_SUSPENDED", kademe: "DURDURULMUS" } };
    await expect(interceptor().rejected(makeError(403, body))).rejects.toBeDefined();
    expect(toastError).not.toHaveBeenCalled();
    expect(useLicenseSuspension.getState().suspended).toBe(true);
  });

  it("403 LICENSE_MODULE: `modul` DB anahtarı (tek biçim) ya da eski API alanı → aynı modül, aynı toast id; mesajsızda modül adı", async () => {
    const yeni = { details: { code: "LICENSE_MODULE", modul: "finance.enabled", neden: "LISANSTA_YOK" } };
    const eski = { details: { code: "LICENSE_MODULE", modul: "financeEnabled" } };
    await expect(interceptor().rejected(makeError(403, yeni))).rejects.toBeDefined();
    await expect(interceptor().rejected(makeError(403, eski))).rejects.toBeDefined();
    const [m1, o1] = toastError.mock.calls[0] as [string, { id: string }];
    const [, o2] = toastError.mock.calls[1] as [string, { id: string }];
    expect(m1).toMatch(/modülü lisansınızda kapalı/);
    expect(o1.id).toBe("license:LICENSE_MODULE:finance.enabled");
    expect(o2.id).toBe(o1.id);
  });

  // D6 (kapı önce 401): geçersiz/eksik oturumlu istek lisans kapısında artık 403 LICENSE_GATE değil
  // rotanın 401'ini alır. Panelin MEVCUT 401 akışı bunu karşılar: oturum temizlenir → giriş ekranı;
  // lisans sinyali ve lisans toast'ı YOK (kimliksize kademe sızmaz, "lisans" diye yanlış teşhis yok).
  it("⭐ D6: lisans kapsamındaki yoldan 401 → yeniden giriş; lisans sinyali/toast'ı yok", async () => {
    const heard = vi.fn();
    const off = onLicenseGate(heard);
    const body = { message: "Oturum geçersiz.", details: { code: "SESSION_INVALID" } };
    await expect(interceptor().rejected(makeError(401, body))).rejects.toBeDefined();
    off();
    expect(setUser).toHaveBeenCalledWith(null);
    expect(tokenClear).toHaveBeenCalledTimes(1);
    expect(heard).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalledWith(expect.stringMatching(/lisans/i), expect.anything());
  });
});
