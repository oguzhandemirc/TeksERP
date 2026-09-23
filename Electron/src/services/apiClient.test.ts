import { describe, it, expect, vi, beforeEach } from "vitest";
import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";

// --- Mock'lar: gerçek secure-store (window.api) ve auth store yerine spy'lar. ---
const tokenClear = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/secure-token", () => ({
  tokenStore: { get: vi.fn(), set: vi.fn(), clear: () => tokenClear() },
}));

// Faz 2 tek-uçuş guard'ı user'a bakar: 401 temizliği yalnız OTURUM AÇIKKEN
// koşar. authState mutable — testler user'ı doldurup/boşaltıp iki dalı da sınar.
const setUser = vi.fn((u: unknown) => {
  authState.user = u;
});
const authState: { user: unknown; setUser: typeof setUser } = {
  user: { userId: "u1" },
  setUser,
};
vi.mock("@/store/auth", () => ({
  useAuthStore: { getState: () => authState },
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// serverStatus GERÇEK store — offset/online davranışını uçtan uca doğrulamak için.
import apiClient from "./apiClient";
import { useServerStatusStore } from "@/store/serverStatus";
import { tokenStore } from "@/lib/secure-token"; // vi.mock'lu — spy'lara erişim

type Handler = {
  fulfilled: (r: AxiosResponse) => unknown;
  rejected: (e: unknown) => Promise<unknown>;
};

// apiClient'in response interceptor'ını doğrudan çalıştır (gerçek HTTP yok).
function getInterceptor(): Handler {
  // axios runtime'da handlers tutar; tip dışında erişiyoruz.
  const handlers = (apiClient.interceptors.response as unknown as { handlers: Handler[] }).handlers;
  const h = handlers.find(Boolean);
  if (!h) throw new Error("response interceptor bulunamadı");
  return h;
}

function makeResponse(overrides: Partial<AxiosResponse> = {}): AxiosResponse {
  return {
    data: {},
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
    ...overrides,
  } as AxiosResponse;
}

function makeError(status: number, opts: { body?: unknown; url?: string; suppress?: boolean; headers?: Record<string, string> } = {}): AxiosError {
  const err = new AxiosError("err", "ERR_BAD_RESPONSE");
  err.config = { headers: new AxiosHeaders(), url: opts.url, suppressErrorToast: opts.suppress } as never;
  err.response = {
    data: opts.body ?? {},
    status,
    statusText: "",
    headers: opts.headers ?? {},
    config: err.config,
  } as AxiosResponse;
  return err;
}

function makeNetworkError(code = "ENOTFOUND"): AxiosError {
  const err = new AxiosError("network", code);
  err.config = { headers: new AxiosHeaders() } as never;
  err.response = undefined;
  return err;
}

describe("apiClient request interceptor — Authorization", () => {
  type ReqHandler = { fulfilled: (c: unknown) => Promise<{ headers: AxiosHeaders }> };
  const getReqInterceptor = (): ReqHandler => {
    const handlers = (apiClient.interceptors.request as unknown as { handlers: ReqHandler[] })
      .handlers;
    const h = handlers.find(Boolean);
    if (!h) throw new Error("request interceptor bulunamadı");
    return h;
  };

  beforeEach(() => {
    (tokenStore.get as ReturnType<typeof vi.fn>).mockReset();
  });

  it("preset Authorization EZİLMEZ — logout revoke'u yakalanan token'la gider", async () => {
    (tokenStore.get as ReturnType<typeof vi.fn>).mockResolvedValue("yeni-token");
    const out = await getReqInterceptor().fulfilled({
      headers: new AxiosHeaders({ Authorization: "Bearer eski-token" }),
    });
    // Ezilseydi: logout→anında re-login yarışında YENİ oturum revoke edilirdi.
    expect(out.headers.Authorization).toBe("Bearer eski-token");
  });

  it("preset yoksa store token'ı yazılır (normal istek davranışı değişmedi)", async () => {
    (tokenStore.get as ReturnType<typeof vi.fn>).mockResolvedValue("yeni-token");
    const out = await getReqInterceptor().fulfilled({ headers: new AxiosHeaders() });
    expect(out.headers.Authorization).toBe("Bearer yeni-token");
  });

  it("token yokken header eklenmez", async () => {
    (tokenStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await getReqInterceptor().fulfilled({ headers: new AxiosHeaders() });
    expect(out.headers.Authorization).toBeUndefined();
  });
});

describe("apiClient interceptor", () => {
  beforeEach(() => {
    tokenClear.mockClear();
    setUser.mockClear();
    toastError.mockClear();
    authState.user = { userId: "u1" }; // varsayılan: oturum açık
    // store'u temiz başlangıca çek
    useServerStatusStore.setState({
      status: "connecting",
      offsetMs: 0,
      synced: false,
      lastReachableAt: null,
    });
  });

  describe("başarılı yanıt", () => {
    it("Date header'dan sunucu saati offset'ini hesaplar + online işaretler", () => {
      const serverTime = Date.now() + 60_000; // sunucu client'tan 60sn ileride
      getInterceptor().fulfilled(
        makeResponse({ headers: { date: new Date(serverTime).toUTCString() } }),
      );
      const st = useServerStatusStore.getState();
      expect(st.status).toBe("online");
      expect(st.synced).toBe(true);
      // Date header saniye hassasiyetinde → ±1.5sn tolerans
      expect(st.offsetMs).toBeGreaterThan(58_000);
      expect(st.offsetMs).toBeLessThan(62_000);
    });

    it("Date header yoksa offset değişmeden online'a geçer", () => {
      useServerStatusStore.setState({ offsetMs: 5000, synced: true });
      getInterceptor().fulfilled(makeResponse({ headers: {} }));
      const st = useServerStatusStore.getState();
      expect(st.status).toBe("online");
      expect(st.offsetMs).toBe(5000); // korunur
    });
  });

  describe("401 — oturum düştü", () => {
    it("login dışı isteklerde token'ı siler + user'ı null'lar + tek toast", async () => {
      await expect(getInterceptor().rejected(makeError(401, { url: "/api/orders" }))).rejects.toBeDefined();
      expect(tokenClear).toHaveBeenCalledTimes(1);
      expect(setUser).toHaveBeenCalledWith(null);
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Oturum/i));
    });

    it("oturum ZATEN kapalıysa (user null) temizlik ve toast atlanır — tek-uçuş", async () => {
      authState.user = null; // manuel logout sonrası arka plan isteği senaryosu
      await expect(getInterceptor().rejected(makeError(401, { url: "/api/orders" }))).rejects.toBeDefined();
      expect(tokenClear).not.toHaveBeenCalled();
      expect(setUser).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    });

    it("401 yağmuru: ilk istek temizler, sonrakiler (user artık null) atlar", async () => {
      await expect(getInterceptor().rejected(makeError(401, { url: "/api/a" }))).rejects.toBeDefined();
      await expect(getInterceptor().rejected(makeError(401, { url: "/api/b" }))).rejects.toBeDefined();
      await expect(getInterceptor().rejected(makeError(401, { url: "/api/c" }))).rejects.toBeDefined();
      expect(tokenClear).toHaveBeenCalledTimes(1);
      expect(setUser).toHaveBeenCalledTimes(1);
      // Toast sayısı burada assert edilmez: 5sn'lik zaman-bazlı dedupe modül
      // state'inde yaşar ve önceki testin toast'ı pencereyi tüketmiş olabilir.
    });

    it("login isteğinde token SİLİNMEZ, backend mesajını gösterir", async () => {
      await expect(
        getInterceptor().rejected(
          makeError(401, { url: "/api/auth/login", body: { message: "Kullanıcı adı veya şifre hatalı" } }),
        ),
      ).rejects.toBeDefined();
      expect(tokenClear).not.toHaveBeenCalled();
      expect(setUser).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith("Kullanıcı adı veya şifre hatalı");
    });
  });

  describe("403 — yetki", () => {
    it("genel 'yetkiniz yok' toast'ı atar", async () => {
      await expect(getInterceptor().rejected(makeError(403))).rejects.toBeDefined();
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/yetkiniz/i));
    });

    it("suppressErrorToast ile toast bastırılır", async () => {
      await expect(getInterceptor().rejected(makeError(403, { suppress: true }))).rejects.toBeDefined();
      expect(toastError).not.toHaveBeenCalled();
    });

    // K26: kapalı modül yetki sorunu değil — backend'in modül cümlesi, paralel istekler TEK toast (aynı id).
    it("⭐ 403 MODULE_DISABLED → 'yetkiniz yok' DEĞİL, modül cümlesi; aynı mesaj aynı toast id'si", async () => {
      const body = { message: "Ön muhasebe modülü bu kurulumda kapalı.", details: { code: "MODULE_DISABLED" } };
      await expect(getInterceptor().rejected(makeError(403, { body }))).rejects.toBeDefined();
      await expect(getInterceptor().rejected(makeError(403, { body }))).rejects.toBeDefined();
      expect(toastError).not.toHaveBeenCalledWith(expect.stringMatching(/yetkiniz/i));
      expect(toastError).toHaveBeenCalledTimes(2);
      const [m1, o1] = toastError.mock.calls[0] as [string, { id: string }];
      const [, o2] = toastError.mock.calls[1] as [string, { id: string }];
      expect(m1).toBe(body.message);
      expect(o1.id).toBe(o2.id); // sonner aynı id'yi tek toast'ta tutar
    });

    it("403 MODULE_DISABLED + suppressErrorToast → toast yok", async () => {
      const body = { message: "x", details: { code: "MODULE_DISABLED" } };
      await expect(getInterceptor().rejected(makeError(403, { body, suppress: true }))).rejects.toBeDefined();
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  describe("hata mesajı eşleme", () => {
    it("4xx: validation errors[] satırlarını ' • ' ile birleştirir", async () => {
      await expect(
        getInterceptor().rejected(
          makeError(422, {
            body: { errors: [{ field: "name", message: "Ad zorunlu" }, { field: "qty", message: "Metraj pozitif olmalı" }] },
          }),
        ),
      ).rejects.toBeDefined();
      expect(toastError).toHaveBeenCalledWith("Ad zorunlu • Metraj pozitif olmalı");
    });

    it("4xx: errors[] yoksa body.message'ı gösterir", async () => {
      await expect(
        getInterceptor().rejected(makeError(400, { body: { message: "Çuval boş olamaz" } })),
      ).rejects.toBeDefined();
      expect(toastError).toHaveBeenCalledWith("Çuval boş olamaz");
    });

    it("5xx: genel sunucu hatası mesajı (body.message'ı sızdırmaz)", async () => {
      await expect(
        getInterceptor().rejected(makeError(500, { body: { message: "stack trace" } })),
      ).rejects.toBeDefined();
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Sunucu hatası/i));
      expect(toastError).not.toHaveBeenCalledWith("stack trace");
    });
  });

  describe("ağ durumu", () => {
    it("yanıt VARSA (4xx/5xx) sunucu ulaşılabilir sayılır", async () => {
      await expect(getInterceptor().rejected(makeError(500))).rejects.toBeDefined();
      expect(useServerStatusStore.getState().status).toBe("online");
    });

    it("yanıt YOKSA (ağ hatası) offline işaretler + 'ulaşılamıyor' toast", async () => {
      await expect(getInterceptor().rejected(makeNetworkError())).rejects.toBeDefined();
      expect(useServerStatusStore.getState().status).toBe("offline");
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/ulaşılamıyor/i));
    });

    it("istemci timeout'u (ECONNABORTED) offline'a DÜŞÜRMEZ", async () => {
      useServerStatusStore.setState({ status: "online" });
      await expect(getInterceptor().rejected(makeNetworkError("ECONNABORTED"))).rejects.toBeDefined();
      // O7 fix: ağır rapor 15sn'i aşınca sidebar yanlışlıkla offline'a düşmesin.
      expect(useServerStatusStore.getState().status).toBe("online");
    });
  });
});
