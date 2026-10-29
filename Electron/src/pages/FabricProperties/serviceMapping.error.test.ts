// H6b: 400 SERVICE_ITEM_INVALID panelde backend'in Türkçe mesajıyla TEK toast olur
// (apiClient kapısı; formun ikinci toast'ı yok). Harness `apiClient.license.test.ts` ile aynı.
import { describe, it, expect, vi } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

vi.mock("@/lib/secure-token", () => ({ tokenStore: { get: vi.fn(), set: vi.fn(), clear: vi.fn() } }));
vi.mock("@/store/auth", () => ({ useAuthStore: { getState: () => ({ user: { userId: "u1" }, setUser: vi.fn() }) } }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }));

const apiClient = (await import("@/services/apiClient")).default;
type Handler = { rejected: (e: unknown) => Promise<unknown> };
const interceptor = (): Handler =>
  (apiClient.interceptors.response as unknown as { handlers: Handler[] }).handlers.find(Boolean) as Handler;

function makeError(status: number, body: unknown): AxiosError {
  const err = new AxiosError("err", "ERR_BAD_RESPONSE");
  err.config = { headers: new AxiosHeaders(), url: "/api/fabric-properties/p1", method: "patch" } as never;
  err.response = { data: body, status, statusText: "", headers: {}, config: err.config } as AxiosResponse;
  return err;
}

describe("H6b SERVICE_ITEM_INVALID", () => {
  it("⭐ 400 → backend'in Türkçe mesajı tek toast", async () => {
    const message = '"Pamuk 30/1" bir hizmet kalemi değil — eşleme yalnız Hizmet türü kaleme yapılır';
    await expect(
      interceptor().rejected(makeError(400, { success: false, message, details: { code: "SERVICE_ITEM_INVALID", itemId: "i1" } })),
    ).rejects.toBeDefined();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]![0]).toBe(message);
  });
});
