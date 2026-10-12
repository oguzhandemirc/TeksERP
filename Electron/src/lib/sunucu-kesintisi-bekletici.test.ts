import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

vi.mock("@/lib/secure-token", () => ({ tokenStore: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), clear: vi.fn() } }));
vi.mock("@/store/auth", () => ({ useAuthStore: { getState: () => ({ user: { userId: "u1" }, setUser: vi.fn() }) } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/client-info", () => ({ applyClientInfoHeaders: async () => {} }));

import apiClient from "@/services/apiClient";
import { useServerStatusStore } from "@/store/serverStatus";
import { createAttemptToken } from "@/lib/attemptToken";
import { HEALTH_PROBE_INTERVAL_MS, REQUEST_HOLD_MAX_MS, setOutageTarget } from "@/lib/sunucu-kesintisi";

// B4 — panel `apiClient`: duyurulu güncellemede sunucu yanıtsızken yeni istek GÖNDERİLMEDEN bekletilir, bağlantı
// gelince gider; duyuru yokken bekletilmez; üst sınırda bırakılır. Belirsiz düşen kaydın token'ı yapışır → tek kayıt.
let healthy = false;
let failNext = false;
const sent: Array<{ url: string | undefined; body: unknown }> = [];

function respond(config: InternalAxiosRequestConfig): AxiosResponse {
  return { data: { success: true }, status: 200, statusText: "OK", headers: {}, config };
}
function networkError(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK", config);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  healthy = false;
  failNext = false;
  sent.length = 0;
  apiClient.defaults.adapter = async (config) => {
    if (config.url === "/health") {
      if (!healthy) throw networkError(config);
      return respond(config);
    }
    sent.push({ url: config.url, body: typeof config.data === "string" ? JSON.parse(config.data) : config.data });
    if (failNext) {
      failNext = false;
      throw networkError(config);
    }
    return respond(config);
  };
});
afterEach(() => {
  setOutageTarget(null);
  useServerStatusStore.setState({ status: "online" });
  vi.useRealTimers();
});

const announce = (inMs: number) => setOutageTarget({ atMs: Date.now() + inMs, ongoing: false });

describe("apiClient — sunucu kesintisinde istek bekletme", () => {
  it("duyuru etkin + sunucu yanıtsız → istek gönderilmez; sağlık gelince gider", async () => {
    announce(60_000);
    useServerStatusStore.setState({ status: "offline" });
    let done = false;
    const p = apiClient.post("/api/kayit", { ad: "x" }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2 * HEALTH_PROBE_INTERVAL_MS);
    expect(sent).toEqual([]);
    expect(done).toBe(false);
    healthy = true;
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS);
    await p;
    expect(sent).toEqual([{ url: "/api/kayit", body: { ad: "x" } }]);
    expect(useServerStatusStore.getState().status).toBe("online");
  });

  it("duyuru yokken (ya da 5 dk'dan uzak) yanıtsız sunucuda istek beklemeden gider", async () => {
    useServerStatusStore.setState({ status: "offline" });
    await apiClient.get("/api/a");
    announce(10 * 60_000);
    useServerStatusStore.setState({ status: "offline" });
    await apiClient.get("/api/b");
    expect(sent.map((s) => s.url)).toEqual(["/api/a", "/api/b"]);
  });

  it("üst sınırda (3 dk) istek bırakılır", async () => {
    announce(60_000);
    useServerStatusStore.setState({ status: "offline" });
    let done = false;
    const p = apiClient.get("/api/c").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(REQUEST_HOLD_MAX_MS - HEALTH_PROBE_INTERVAL_MS);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * HEALTH_PROBE_INTERVAL_MS);
    await p;
    expect(sent.map((s) => s.url)).toEqual(["/api/c"]);
  });

  it("kesintide yanıtsız düşen kayıt: token yapışır, ikinci deneme bağlantıyı bekler ve AYNI token'la gider", async () => {
    announce(60_000);
    let n = 0;
    const attempt = createAttemptToken(() => `tok-${++n}`);
    failNext = true;
    const first = await apiClient.post("/api/kayit", { clientToken: attempt.token() }).catch((e: unknown) => e);
    attempt.onFailure(first);
    expect(useServerStatusStore.getState().status).toBe("offline");
    let done = false;
    const second = apiClient.post("/api/kayit", { clientToken: attempt.token() }).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS);
    expect(done).toBe(false);
    expect(sent).toHaveLength(1);
    healthy = true;
    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS);
    await second;
    expect(sent.map((s) => (s.body as { clientToken: string }).clientToken)).toEqual(["tok-1", "tok-1"]);
  });
});
