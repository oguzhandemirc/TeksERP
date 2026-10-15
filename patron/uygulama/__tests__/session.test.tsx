import { act, render, waitFor } from "@testing-library/react-native";

// Bellek depoları (gizli + düz) — jest.mock fabrikası dış değişkene yalnız `mock` önekiyle uzanır.
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

const { SessionProvider, useSession } = require("../src/state/session") as typeof import("../src/state/session");
type Value = import("../src/state/session").SessionValue;

const TESISLER = [
  { id: "t1", ad: "Bir Tekstil", hizmet: "ACIK" },
  { id: "t2", ad: "İki Dokuma", hizmet: "SALT_OKUNUR" },
];
const hesap = (id: string) => ({ id, eposta: `${id}@x.test`, ad: id, izinler: ["bulut:oturum"] });

interface Call { method: string; path: string; body: unknown; token: string | null }
let calls: Call[] = [];
let oldServer = false;
/** Belirteç → tesis (sunucunun gözünden etkin tesis). */
const tokenFacility: Record<string, string> = { b1: "t1", b2: "t2", c1: "t1" };

function reply(status: number, data: unknown, code?: string) {
  const body = status < 400 ? { success: true, data } : { success: false, message: "ret", details: { code } };
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
}

function server(url: string, init: RequestInit): Promise<Response> {
  const path = url.replace("http://bulut.test/api", "").split("?")[0]!;
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const token = ((init.headers as Record<string, string>).Authorization ?? "").replace("Bearer ", "") || null;
  calls.push({ method: init.method ?? "GET", path, body, token });
  const key = `${init.method} ${path}`;
  if (key === "POST /oturum/ac") {
    if (oldServer && body.tesisId !== undefined) return reply(400, null, "GECERSIZ_ISTEK");
    const kimlik = body.eposta === "baska@x.test" ? "h2" : "h1";
    const r = { belirtec: kimlik === "h2" ? "c1" : "b1", bitis: "2026-10-16T00:00:00Z", hesap: hesap(kimlik), tesisId: "t1" };
    return reply(200, oldServer ? r : { ...r, tesisler: TESISLER });
  }
  if (key === "GET /oturum") {
    const t = tokenFacility[token ?? ""]!;
    return reply(200, { tesis: { id: t, ad: TESISLER.find((x) => x.id === t)!.ad, saklamaAy: 13 }, hesap: hesap("h1"), projeksiyonlar: [], esitleme: null, hizmet: { asama: "ACIK", bitis: null, saltOkunurBitis: null } });
  }
  if (key === "GET /oturum/tesisler") return oldServer ? reply(404, null, "BULUNAMADI") : reply(200, TESISLER);
  if (key === "POST /oturum/gecis") {
    if (body.tesisId === "t2") return reply(200, { belirtec: "b2", bitis: "2026-10-16T00:00:00Z", hesap: hesap("h1"), tesisId: "t2", tesisler: TESISLER });
    return reply(403, null, "TESIS_GECISI_YOK");
  }
  if (key === "POST /oturum/kapat") return reply(200, null);
  return reply(404, null, "BULUNAMADI");
}

let cur: Value;
function Probe() {
  cur = useSession();
  return null;
}

async function boot() {
  render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(cur.phase).toBe("giris"));
}
async function login(eposta = "patron@x.test") {
  await act(async () => cur.login({ eposta, parola: "p", totp: "123456" }));
}
const cacheKeys = () => [...mockPlain.m.keys()].filter((k) => k.startsWith("patron:onbellek:"));

beforeEach(() => {
  mockSecret.m.clear();
  mockPlain.m.clear();
  calls = [];
  oldServer = false;
  globalThis.fetch = jest.fn(server) as unknown as typeof fetch;
});

describe("çok tesisli oturum", () => {
  it("girişte tesisler state'e girer, son tesis ipucu olarak gider ve saklanır", async () => {
    await boot();
    await mockPlain.set("patron.sonTesis", "t2");
    await login();
    expect(cur.phase).toBe("hazir");
    expect(calls.find((c) => c.path === "/oturum/ac")!.body).toMatchObject({ tesisId: "t2", istemci: "mobil" });
    expect(cur.facilities.map((f) => f.id)).toEqual(["t1", "t2"]);
    expect(cur.facilityId).toBe("t1");
    expect(mockPlain.m.get("patron.sonTesis")).toBe("t1");
  });

  it("switchFacility kapsamı değiştirir; önceki tesisin önbelleği DURUR", async () => {
    await boot();
    await login();
    expect(cacheKeys()).toContain("patron:onbellek:t1:h1:oturum");
    let ok = false;
    await act(async () => { ok = await cur.switchFacility("t2"); });
    expect(ok).toBe(true);
    expect(cur.facilityId).toBe("t2");
    expect(cur.facility?.tesis.id).toBe("t2");
    expect(calls.find((c) => c.path === "/oturum/gecis")!.body).toEqual({ tesisId: "t2" });
    expect(mockSecret.m.get("patron.belirtec")).toBe("b2");
    expect(mockSecret.m.get("patron.kapsam")).toBe("t2:h1");
    expect(mockPlain.m.get("patron.sonTesis")).toBe("t2");
    expect(cacheKeys()).toEqual(expect.arrayContaining(["patron:onbellek:t1:h1:oturum", "patron:onbellek:t2:h1:oturum"]));
    // Yeni kapsamın önbelleği yeni tesise yazar.
    await act(async () => { await cur.cache!.load("pano", async () => ({ x: 1 })); });
    expect(cacheKeys()).toContain("patron:onbellek:t2:h1:pano");
  });

  it("başka kimlikle girişte bütün önbellek silinir", async () => {
    await boot();
    mockPlain.m.set("patron:onbellek:t9:h9:pano", "{}");
    mockPlain.m.set("patron:onbellek:t2:h1:oturum", "{}");
    await login("baska@x.test");
    expect(cacheKeys().filter((k) => !k.startsWith("patron:onbellek:t1:h2:"))).toEqual([]);
  });

  it("çıkış hepsi:true gönderir ve önbelleği, belirteci siler", async () => {
    await boot();
    await login();
    await act(async () => { await cur.switchFacility("t2"); });
    await act(async () => cur.logout());
    expect(calls.find((c) => c.path === "/oturum/kapat")!.body).toEqual({ hepsi: true });
    expect(cur.phase).toBe("giris");
    expect(cacheKeys()).toEqual([]);
    expect(mockSecret.m.size).toBe(0);
    expect(cur.facilities).toEqual([]);
  });

  it("403 TESIS_GECISI_YOK: liste tazelenir, etkin tesis değişmez, Türkçe ileti", async () => {
    await boot();
    await login();
    calls = [];
    let ok = true;
    await act(async () => { ok = await cur.switchFacility("t3"); });
    expect(ok).toBe(false);
    expect(cur.facilityId).toBe("t1");
    expect(mockSecret.m.get("patron.belirtec")).toBe("b1");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /oturum/gecis", "GET /oturum/tesisler"]);
    expect(cur.switchError).toMatch(/geçiş yetkiniz yok/);
  });

  it("eski sunucu (tesisler yok, ipucu 400): ipucusuz tekrar, tek tesisle çalışır", async () => {
    oldServer = true;
    await boot();
    await mockPlain.set("patron.sonTesis", "t2");
    await login();
    expect(cur.phase).toBe("hazir");
    expect(calls.filter((c) => c.path === "/oturum/ac").map((c) => c.body)).toEqual([
      expect.objectContaining({ tesisId: "t2" }),
      expect.not.objectContaining({ tesisId: expect.anything() }),
    ]);
    expect(cur.facilities).toEqual([{ id: "t1", ad: "Bir Tekstil", hizmet: "ACIK" }]);
  });
});
