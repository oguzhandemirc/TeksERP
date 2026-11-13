// ERP gelen bildirim katmanı (D1): §1 `Bildirimci` ERP uçları (yol, sorgu, gövde); bulut bildirimcisi ağa gitmez ·
// §2 açıklık `/ozet`ten — yalnız `enabled:true` açar; 404/409/ağ hatası kapalı (fail-closed) · §3 yetenek: bulut
// değişmez, ERP 4. parametreyi yalnız gerçek `true` ile açar · §4 oturum: girişte `/bildirim/ozet` okunur,
// açıksa `bildirimKutusu`; kapalı/eski fabrikada giriş bozulmaz.
import { act, render, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

function mockMem() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
    removeMany: async (ks: readonly string[]) => ks.forEach((k) => m.delete(k)),
  };
}
const mockSecret = mockMem();
const mockPlain = mockMem();
jest.mock("../src/state/store", () => ({ secretStore: mockSecret, plainStore: mockPlain, legacyPlainStore: null }));
jest.mock("../src/lib/config", () => ({ apiBaseUrl: () => "http://bulut.test" }));

const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");
const b = require("../src/api/bildirim") as typeof import("../src/api/bildirim");
const yet = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const { SessionProvider, useSession } = require("../src/state/session") as typeof import("../src/state/session");
type Value = import("../src/state/session").SessionValue;
type ApiClient = import("../src/api/client").ApiClient;

describe("§1 Bildirimci", () => {
  it("ERP uçları: özet, liste sorgusu, okundu (kimlik kodlanır), tümünü okundu", async () => {
    const calls: unknown[][] = [];
    const c = {
      get: async (...a: unknown[]) => (calls.push(["GET", ...a]), {}),
      post: async (...a: unknown[]) => (calls.push(["POST", ...a]), {}),
      patch: async () => ({}),
      del: async () => ({}),
      download: async () => { throw new Error("yok"); },
    } as unknown as ApiClient;
    const x = b.createErpBildirimci(c);
    await x.ozet();
    await x.liste({ sekme: "okunmamis", limit: 30 });
    await x.liste({ sekme: "tumu", cursor: "abc" });
    await x.okundu("a/b");
    await x.tumunuOkundu();
    expect(calls).toEqual([
      ["GET", "/bildirim/ozet"],
      ["GET", "/bildirim", { sekme: "okunmamis", cursor: undefined, limit: 30 }],
      ["GET", "/bildirim", { sekme: "tumu", cursor: "abc", limit: undefined }],
      ["POST", "/bildirim/a%2Fb/okundu", {}],
      ["POST", "/bildirim/tumunu-okundu", {}],
    ]);
  });

  it("bulut bildirimcisi her yöntemde ağa gitmeden 404", async () => {
    const x = b.createBulutBildirimci();
    for (const p of [x.ozet(), x.liste({ sekme: "tumu" }), x.okundu("1"), x.tumunuOkundu()]) {
      await expect(p).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    }
  });
});

describe("§2 açıklık", () => {
  it("yalnız enabled:true açar; kapalı, 404, 409, ağ hatası ve bozuk yanıt kapalı", async () => {
    expect(await b.erpBildirimAcik(async () => ({ enabled: true, okunmamis: 2 }))).toBe(true);
    expect(await b.erpBildirimAcik(async () => ({ enabled: false }))).toBe(false);
    expect(await b.erpBildirimAcik(async () => ({ enabled: "true" }) as never)).toBe(false);
    expect(await b.erpBildirimAcik(async () => null as never)).toBe(false);
    for (const err of [new ApiError(404, "BULUNAMADI", "yok"), new ApiError(409, "BILDIRIM_KAPALI", "kapalı"), new ApiError(0, "AG_HATASI", "ağ")]) {
      expect(await b.erpBildirimAcik(async () => { throw err; })).toBe(false);
    }
  });
});

describe("§3 yetenek", () => {
  it("bulut değişmez; ERP yalnız gerçek true ile açar", () => {
    expect(yet.BULUT_YETENEK.bildirim).toBe(true);
    expect(yet.BULUT_YETENEK.bildirimKutusu).toBe(false);
    expect(yet.erpYetenek([], []).bildirimKutusu).toBe(false);
    expect(yet.erpYetenek([], [], undefined, "true").bildirimKutusu).toBe(false);
    expect(yet.erpYetenek([], [], undefined, true).bildirimKutusu).toBe(true);
    expect(yet.erpYetenek([], [], undefined, true).bildirim).toBe(false);
  });
});

describe("§4 oturum", () => {
  const ERP = "https://erp.fabrika.com";
  let ozet: { status: number; data: unknown } = { status: 200, data: { enabled: true, okunmamis: 3 } };
  const paths: string[] = [];
  function reply(status: number, data: unknown) {
    const body = status < 400 ? { success: true, data } : { success: false, message: "ret", details: { code: "X" } };
    return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
  }
  function server(url: string, init: RequestInit): Promise<Response> {
    const key = `${init.method ?? "GET"} ${url.split("?")[0]!.replace(ERP, "")}`;
    paths.push(key);
    if (key === "GET /api/client-policy/patron") return reply(200, { minVersion: "0.0.0" });
    if (key === "POST /api/auth/login") return reply(200, { token: "jwt1" });
    if (key === "GET /api/auth/me") return reply(200, { userId: "u1", username: "ali", permissions: ["patron-app:login"], patronReadSets: ["tesis"] });
    if (key === "GET /api/patron/v1/oturum") {
      return reply(200, { tesis: { id: "", ad: "F", saklamaAy: null }, hesap: { id: "u1", ad: "Ali", eposta: "ali", izinler: ["bulut:oturum"] }, projeksiyonlar: [], esitleme: null });
    }
    if (key === "GET /api/patron/v1/anlik/tesis") return reply(200, { projeksiyon: "tesis", veri: {}, surum: "x" });
    if (key === "GET /api/bildirim/ozet") return reply(ozet.status, ozet.data);
    return reply(404, null);
  }
  let cur: Value;
  function Probe() {
    cur = useSession();
    return null;
  }
  async function login() {
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(cur.phase).not.toBe("yukleniyor"));
    await act(async () => {
      await cur.connectServer(ERP);
    });
    await waitFor(() => expect(cur.server).toBe(ERP));
    await act(async () => cur.login({ eposta: "ali", parola: "p", totp: "" }));
  }
  beforeEach(() => {
    mockSecret.m.clear();
    mockPlain.m.clear();
    paths.length = 0;
    (AppState as { currentState: unknown }).currentState = "active";
    (AppState.addEventListener as jest.Mock).mockImplementation(() => ({ remove: () => undefined }));
    globalThis.fetch = jest.fn(server) as unknown as typeof fetch;
  });
  afterAll(() => yet.setYetenek(yet.BULUT_YETENEK));

  it("fabrikada açık: girişte /bildirim/ozet okunur, bildirimKutusu açık", async () => {
    ozet = { status: 200, data: { enabled: true, okunmamis: 3 } };
    await login();
    expect(cur.phase).toBe("hazir");
    expect(paths).toContain("GET /api/bildirim/ozet");
    expect(cur.yetenek.bildirimKutusu).toBe(true);
    expect(yet.yetenek().bildirimKutusu).toBe(true);
  });

  it("bayrak kapalı ya da eski fabrika (404): giriş tamam, özellik kapalı", async () => {
    for (const o of [{ status: 200, data: { enabled: false } }, { status: 404, data: null }]) {
      ozet = o;
      await login();
      expect(cur.phase).toBe("hazir");
      expect(cur.yetenek.bildirimKutusu).toBe(false);
      await act(async () => cur.logout());
    }
  });
});
