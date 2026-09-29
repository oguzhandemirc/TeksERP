import { createAttempt, runAttempt } from "../src/api/attempt";
import { ApiError, createClient, errorMessage } from "../src/api/client";
import { createApi, pathOf } from "../src/api/endpoints";

function fakeFetch(status: number, body: unknown, calls: { url: string; init: RequestInit }[] = []) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => (body === "BOZUK" ? Promise.reject(new Error("json")) : body) } as Response;
  }) as unknown as typeof fetch;
}
const err = (status: number, code: string, message = "ileti") => ({ success: false, message, details: { code } });

async function caught(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
  }
  throw new Error("ApiError bekleniyordu");
}

describe("API istemcisi", () => {
  it("başarı zarfından data döner; belirteç ve yol doğru", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const c = createClient({ baseUrl: "https://b.test/", getToken: () => "t1", fetchImpl: fakeFetch(200, { success: true, data: { x: 1 } }, calls) });
    await expect(c.get("/oturum", { imlec: "a b", limit: 5, durum: undefined })).resolves.toEqual({ x: 1 });
    expect(calls[0]!.url).toBe("https://b.test/api/oturum?imlec=a%20b&limit=5");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t1");
  });
  it("401 → OTURUM + onUnauthorized", async () => {
    const hit = jest.fn();
    const c = createClient({ baseUrl: "https://b.test", getToken: () => "t", onUnauthorized: hit, fetchImpl: fakeFetch(401, err(401, "OTURUM_YOK")) });
    const e = await caught(c.get("/oturum"));
    expect([e.kind, e.code, e.ambiguous]).toEqual(["OTURUM", "OTURUM_YOK", false]);
    expect(hit).toHaveBeenCalledTimes(1);
  });
  it("403 → YETKI; kod details.code'tan (body.code değil)", async () => {
    const c = createClient({ baseUrl: "https://b.test", getToken: () => "t", fetchImpl: fakeFetch(403, { ...err(403, "MODULE_DISABLED", "Kapalı"), code: "YANLIS" }) });
    const e = await caught(c.get("/veri/siparis"));
    expect([e.kind, e.code]).toEqual(["YETKI", "MODULE_DISABLED"]);
    expect(errorMessage(e)).toBe("Kapalı");
  });
  it("409 → CAKISMA, kesin (kimlik düşer)", async () => {
    const c = createClient({ baseUrl: "https://b.test", getToken: () => "t", fetchImpl: fakeFetch(409, err(409, "DURUM_CAKISMASI")) });
    const e = await caught(c.post("/gelen-kutusu/x/iptal", {}));
    expect([e.kind, e.code, e.ambiguous]).toEqual(["CAKISMA", "DURUM_CAKISMASI", false]);
  });
  it("ağ hatası ve 5xx belirsizdir; JSON olmayan yanıt SUNUCU_HATASI", async () => {
    const down = createClient({ baseUrl: "https://b.test", getToken: () => null, fetchImpl: (async () => { throw new Error("x"); }) as unknown as typeof fetch });
    const a = await caught(down.get("/oturum"));
    expect([a.kind, a.code, a.ambiguous]).toEqual(["AG", "AG_HATASI", true]);
    const bad = createClient({ baseUrl: "https://b.test", getToken: () => null, fetchImpl: fakeFetch(502, "BOZUK") });
    const b = await caught(bad.get("/oturum"));
    expect([b.kind, b.code, b.ambiguous]).toEqual(["SUNUCU", "SUNUCU_HATASI", true]);
  });
  it("yol parametresi kodlanır; eksik parametre atar", () => {
    expect(pathOf("inboxCancel", { mesajId: "a/b" })).toBe("/gelen-kutusu/a%2Fb/iptal");
    expect(() => pathOf("reportGet")).toThrow("Yol parametresi eksik: id");
  });
  it("gelen kutusu isteği mesajId + tur + govde taşır", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createApi(createClient({ baseUrl: "https://b.test", getToken: () => "t", fetchImpl: fakeFetch(201, { success: true, data: {} }, calls) }));
    await api.inboxCreate("m1", "CARI", { ad: "A", roller: { musteri: true, tedarikci: false } });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ mesajId: "m1", tur: "CARI", govde: { ad: "A", roller: { musteri: true, tedarikci: false } } });
  });
});

describe("işlem kimliği (mantıksal deneme)", () => {
  it("belirsiz hatada yapışır, kesin hatada ve başarıda düşer", async () => {
    let n = 0;
    const a = createAttempt(() => `k${++n}`);
    const seen: string[] = [];
    await expect(runAttempt(a, async (id) => { seen.push(id); throw new ApiError(0, "AG_HATASI", "x"); })).rejects.toThrow();
    await expect(runAttempt(a, async (id) => { seen.push(id); throw new ApiError(503, "SUNUCU_HATASI", "x"); })).rejects.toThrow();
    await expect(runAttempt(a, async (id) => { seen.push(id); throw new ApiError(400, "GECERSIZ", "x"); })).rejects.toThrow();
    await runAttempt(a, async (id) => { seen.push(id); return 1; });
    await runAttempt(a, async (id) => { seen.push(id); return 1; });
    expect(seen).toEqual(["k1", "k1", "k1", "k2", "k3"]);
  });
});
