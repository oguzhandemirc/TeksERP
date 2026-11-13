// ERP kipi oturumu (V3b): sunucu ekleme, giriş (kod istek üzerine), yetenek, 401, çıkış, çevrimdışı açılış.
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

const { SessionProvider, useSession } = require("../src/state/session") as typeof import("../src/state/session");
const { yetenek } = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const { moduleVisible } = require("../src/lib/access") as typeof import("../src/lib/access");
type Value = import("../src/state/session").SessionValue;

const ERP = "https://erp.fabrika.com";
const SETS = ["siparis", "siparis-kalemi", "cari-kart", "ozet.siparis", "stok-karnesi", "tesis"];
const PAROLA = "Gizli-Parola-42";

interface Call { method: string; url: string; body: unknown; token: string | null }
let calls: Call[] = [];
let totpOn = false;
let down = false;
let sessionStatus = 200;
/** Push köprüsü P4: `/auth/me` `patronPush` + gelen kutusu açıklığı + DELETE /bildirim/cihaz ağ hatası. */
let mePush: number | undefined;
let inboxOn = false;
let pushDeleteDown = false;

function reply(status: number, data: unknown, code?: string) {
  const body = status < 400 ? { success: true, data } : { success: false, message: "ret", details: code ? { code } : {} };
  return Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);
}

function server(url: string, init: RequestInit): Promise<Response> {
  if (down) return Promise.reject(new TypeError("Network request failed"));
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const token = (((init.headers ?? {}) as Record<string, string>).Authorization ?? "").replace("Bearer ", "") || null;
  calls.push({ method: init.method ?? "GET", url: url.split("?")[0]!, body, token });
  const key = `${init.method ?? "GET"} ${url.split("?")[0]}`;
  if (key === `GET ${ERP}/api/client-policy/patron`) return reply(200, { apiVersion: "1.2.6", minVersion: "0.0.0", currentVersion: "1.2.0" });
  if (key === `POST ${ERP}/api/auth/login`) {
    if (body.username !== "ali" || body.password !== PAROLA) return reply(401, null);
    if (body.username === "ali" && body.yasak) return reply(403, null, "PATRON_ACCESS_DENIED");
    if (totpOn && !body.totpCode) return reply(409, null, "TOTP_REQUIRED");
    if (totpOn && body.totpCode !== "123456") return reply(401, null, "TOTP_INVALID");
    return reply(200, { token: "jwt1", user: { id: "u1" }, mustChangePassword: false });
  }
  if (key === `GET ${ERP}/api/auth/me`) {
    return reply(200, { userId: "u1", username: "ali", permissions: ["patron-app:login", "order:read"], backendVersion: "1.2.6", patronApiVersion: 1, patronReadSets: SETS, ...(mePush === undefined ? {} : { patronPush: mePush }) });
  }
  if (key === `GET ${ERP}/api/bildirim/ozet`) return inboxOn ? reply(200, { enabled: true, okunmamis: 0, epoch: 1, rev: 1 }) : reply(404, null, "BULUNAMADI");
  if (key === `DELETE ${ERP}/api/bildirim/cihaz`) return pushDeleteDown ? Promise.reject(new TypeError("Network request failed")) : reply(200, { birakildi: true });
  if (key === `GET ${ERP}/api/patron/v1/oturum`) {
    if (sessionStatus !== 200) return reply(sessionStatus, null, "UNAUTHORIZED");
    return reply(200, {
      tesis: { id: "", ad: "Fabrika", saklamaAy: null },
      hesap: { id: "u1", ad: "Ali", eposta: "ali", izinler: ["bulut:oturum", "bulut:ozet:oku", "bulut:siparis:oku", "bulut:sevkiyat:oku", "bulut:rapor:oku"] },
      projeksiyonlar: [],
      esitleme: null,
      hizmet: { asama: "ACIK", bitis: null, saltOkunurBitis: null },
    });
  }
  if (key === `GET ${ERP}/api/patron/v1/anlik/tesis`) return reply(200, { projeksiyon: "tesis", veri: { saatDilimi: "Europe/Istanbul" }, surum: "2026-11-13T10:00:00.000Z" });
  if (key === `POST ${ERP}/api/auth/logout`) return reply(200, null);
  return reply(404, null, "BULUNAMADI");
}

let cur: Value;
function Probe() {
  cur = useSession();
  return null;
}
async function boot() {
  render(<SessionProvider><Probe /></SessionProvider>);
  await waitFor(() => expect(cur.phase).not.toBe("yukleniyor"));
}
const everything = () => [...mockSecret.m.values(), ...mockPlain.m.values()].join("\n");

beforeEach(() => {
  mockSecret.m.clear();
  mockPlain.m.clear();
  calls = [];
  totpOn = false;
  down = false;
  sessionStatus = 200;
  mePush = undefined;
  inboxOn = false;
  pushDeleteDown = false;
  (AppState as { currentState: unknown }).currentState = "active";
  (AppState.addEventListener as jest.Mock).mockImplementation(() => ({ remove: () => undefined }));
  globalThis.fetch = jest.fn(server) as unknown as typeof fetch;
});

async function connectAndLogin(totp = "") {
  await boot();
  let msg: string | null = "x";
  await act(async () => {
    msg = await cur.connectServer("erp.fabrika.com/");
  });
  expect(msg).toBeNull();
  await waitFor(() => expect(cur.server).toBe(ERP));
  await act(async () => cur.login({ eposta: "ali", parola: PAROLA, totp }));
}

describe("ERP kipi oturumu", () => {
  it("sunucu ekleme: yoklanır, kip+adres kaydedilir; geçersiz adres ağa gitmez", async () => {
    await boot();
    expect(cur.server).toBeNull();
    let msg: string | null = null;
    await act(async () => {
      msg = await cur.connectServer("http://erp.fabrika.com");
    });
    expect(msg).toBe("Geçerli bir https adresi yazın");
    expect(calls).toHaveLength(0);
    await act(async () => {
      msg = await cur.connectServer("erp.fabrika.com");
    });
    expect(msg).toBeNull();
    expect(JSON.parse(mockSecret.m.get("patron.baglanti")!)).toEqual({ kip: "erp", tabanAdres: ERP });
    expect(cur.yetenek.kodHerZaman).toBe(false);
  });

  it("giriş: /auth/login → /auth/me → /patron/v1/oturum; yetenek sunulan kümelerden; izin süzgeci; parola hiçbir depoda yok", async () => {
    await connectAndLogin();
    expect(cur.phase).toBe("hazir");
    expect(calls.map((c) => `${c.method} ${c.url.replace(ERP, "")}`).slice(1, 4)).toEqual(["POST /api/auth/login", "GET /api/auth/me", "GET /api/patron/v1/oturum"]);
    expect(calls.find((c) => c.url.endsWith("/auth/login"))!.body).toEqual({ username: "ali", password: PAROLA, clientType: "patron" });
    expect(calls.find((c) => c.url.endsWith("/patron/v1/oturum"))!.token).toBe("jwt1");
    expect(mockSecret.m.get("patron.belirtec")).toBe("jwt1");
    expect(yetenek().kumeler).toEqual(new Set(SETS));
    expect(cur.permissions).not.toContain("bulut:rapor:oku");
    expect(moduleVisible(cur.permissions, "siparisler")).toBe(true);
    expect(moduleVisible(cur.permissions, "sevkiyat")).toBe(false);
    expect(cur.factoryStamp).not.toBeNull();
    expect(cur.feedMode).toBe("kapali");
    expect(calls.some((c) => c.url.includes("/degisim") || c.url.includes("bulut.test"))).toBe(false);
    expect(everything()).not.toContain(PAROLA);
  });

  it("TOTP açık: ilk deneme 409 TOTP_REQUIRED (kod adımı), kodla ikinci deneme girer; kod saklanmaz", async () => {
    totpOn = true;
    await boot();
    await act(async () => {
      await cur.connectServer(ERP);
    });
    const err = await act(async () => cur.login({ eposta: "ali", parola: PAROLA, totp: "" }).catch((e: unknown) => e));
    expect(err).toMatchObject({ status: 409, code: "TOTP_REQUIRED" });
    expect(cur.phase).toBe("giris");
    await act(async () => cur.login({ eposta: "ali", parola: PAROLA, totp: "123456" }));
    expect(cur.phase).toBe("hazir");
    expect(everything()).not.toContain("123456");
  });

  it("yanlış parola: Türkçe genel ileti, oturum açılmaz", async () => {
    await boot();
    await act(async () => {
      await cur.connectServer(ERP);
    });
    const err = await act(async () => cur.login({ eposta: "ali", parola: "yanlis", totp: "" }).catch((e: unknown) => e));
    expect(err).toMatchObject({ status: 401, message: "Kullanıcı adı veya parola yanlış" });
    expect(cur.phase).toBe("giris");
    expect(mockSecret.m.has("patron.belirtec")).toBe(false);
  });

  it("401: oturum düşer, girişe dönülür; bağlantı kalır", async () => {
    await connectAndLogin();
    sessionStatus = 401;
    await act(async () => {
      await cur.refresh().catch(() => undefined);
    });
    await waitFor(() => expect(cur.phase).toBe("giris"));
    expect(mockSecret.m.has("patron.belirtec")).toBe(false);
    expect(cur.server).toBe(ERP);
  });

  it("çıkış: /auth/logout, belirteç ve saklı veri silinir, bağlantı kalır; sunucuyu kaldırınca bulut", async () => {
    await connectAndLogin();
    expect([...mockPlain.m.keys()].some((k) => k.startsWith("patron:onbellek:"))).toBe(true);
    await act(async () => cur.logout());
    expect(calls.some((c) => c.method === "POST" && c.url === `${ERP}/api/auth/logout`)).toBe(true);
    expect([...mockPlain.m.keys()].filter((k) => k.startsWith("patron:onbellek:"))).toEqual([]);
    expect(mockSecret.m.has("patron.belirtec")).toBe(false);
    expect(cur.server).toBe(ERP);
    await act(async () => cur.forgetServer());
    expect(cur.server).toBeNull();
    expect(mockSecret.m.has("patron.baglanti")).toBe(false);
    expect(cur.yetenek.kodHerZaman).toBe(true);
  });

  it("⭐ P4 yetenek: patronPush yalnız fabrika sürüm verdiyse ∧ gelen kutusu açıksa; eski fabrika → kapalı, hata yok", async () => {
    inboxOn = true;
    await connectAndLogin();
    expect(cur.yetenek.patronPush).toBe(false);
    expect(cur.pushCihazci).not.toBeNull();
    expect(calls.some((c) => c.url.endsWith("/api/bildirim/cihaz"))).toBe(false);
  });

  it("P4 yetenek: patronPush 1 + kutu açık → açık; kutu kapalı → kapalı", async () => {
    mePush = 1;
    inboxOn = true;
    await connectAndLogin();
    expect(cur.yetenek.patronPush).toBe(true);
    await act(async () => cur.logout());
    inboxOn = false;
    await act(async () => cur.login({ eposta: "ali", parola: PAROLA, totp: "" }));
    expect(cur.yetenek.patronPush).toBe(false);
  });

  it("⭐ P4 çıkış: bu fabrikanın saklı push belirteci /auth/logout'tan ÖNCE DELETE ile bırakılır, kayıt silinir", async () => {
    await connectAndLogin();
    mockSecret.m.set("patron.pushBelirteci", JSON.stringify({ adres: ERP, belirtec: "ExponentPushToken[abc12345]" }));
    calls = [];
    await act(async () => cur.logout());
    const del = calls.findIndex((c) => c.method === "DELETE" && c.url === `${ERP}/api/bildirim/cihaz`);
    const out = calls.findIndex((c) => c.method === "POST" && c.url === `${ERP}/api/auth/logout`);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(calls[del]!.body).toEqual({ belirtec: "ExponentPushToken[abc12345]" });
    expect(calls[del]!.token).toBe("jwt1");
    expect(del).toBeLessThan(out);
    expect(mockSecret.m.has("patron.pushBelirteci")).toBe(false);
  });

  it("P4 çıkış: DELETE ağ hatası sessiz geçilir, çıkış tamamlanır; başka fabrikanın belirteci bu fabrikaya yollanmaz", async () => {
    await connectAndLogin();
    pushDeleteDown = true;
    mockSecret.m.set("patron.pushBelirteci", JSON.stringify({ adres: ERP, belirtec: "ExponentPushToken[abc12345]" }));
    await act(async () => cur.logout());
    expect(cur.phase).toBe("giris");
    expect(mockSecret.m.has("patron.pushBelirteci")).toBe(false);
    pushDeleteDown = false;
    await act(async () => cur.login({ eposta: "ali", parola: PAROLA, totp: "" }));
    mockSecret.m.set("patron.pushBelirteci", JSON.stringify({ adres: "https://baska.fabrika.com", belirtec: "ExponentPushToken[zzz12345]" }));
    calls = [];
    await act(async () => cur.logout());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(mockSecret.m.has("patron.pushBelirteci")).toBe(false);
  });

  it("çevrimdışı açılış: saklı oturum + yetenek ile hazır, çevrimdışı işaretli", async () => {
    await connectAndLogin();
    const secret = new Map(mockSecret.m);
    const plain = new Map(mockPlain.m);
    // Uygulama yeniden açılır; sunucuya ulaşılamıyor.
    mockSecret.m.clear();
    secret.forEach((v, k) => mockSecret.m.set(k, v));
    mockPlain.m.clear();
    plain.forEach((v, k) => mockPlain.m.set(k, v));
    down = true;
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(cur.phase).toBe("hazir"));
    expect(cur.offline).toBe(true);
    expect(yetenek().kumeler).toEqual(new Set(SETS));
    expect(cur.server).toBe(ERP);
  });
});

describe("ERP yarım giriş", () => {
  it("belirteç alındı ama /patron/v1/oturum düştü: belirteç ne bellekte ne depoda kalır", async () => {
    sessionStatus = 500;
    await boot();
    await act(async () => {
      await cur.connectServer(ERP);
    });
    const err = await act(async () => cur.login({ eposta: "ali", parola: PAROLA, totp: "" }).catch((e: unknown) => e));
    expect(err).toMatchObject({ status: 500 });
    expect(cur.phase).toBe("giris");
    expect(mockSecret.m.has("patron.belirtec")).toBe(false);
    await act(async () => cur.forgetServer());
    expect(cur.server).toBeNull();
  });
});
