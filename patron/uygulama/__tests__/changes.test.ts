// Değişim akışı (K1-c, P2): tek uzun yoklama döngüsü yalnız ön planda; eski sunucu 404 → 60 sn yoklama;
// `degisenler` yalnız etiketli kancaları tazeler; oturum düşünce durur; hata geri çekilmesi 5/10/30/60 sn.
import { act, render } from "@testing-library/react-native";
import { createElement } from "react";
import { AppState } from "react-native";
import { ApiError } from "../src/api/client";
import { createCache } from "../src/state/cache";

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
const mockSession = { cache: null as ReturnType<typeof createCache> | null, markOnline: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({}));

const C = require("../src/state/changes") as typeof import("../src/state/changes");
const { useRemote } = require("../src/state/useRemote") as typeof import("../src/state/useRemote");
type Feed = import("../src/state/changes").ChangeFeed;
type Query = import("../src/state/changes").FeedQuery;

const appListeners = new Set<(s: string) => void>();
const appState = (s: string) => [...appListeners].forEach((l) => l(s));

beforeEach(() => {
  jest.useFakeTimers();
  appListeners.clear();
  (AppState as { currentState: unknown }).currentState = "active";
  (AppState.addEventListener as jest.Mock).mockImplementation((_t: string, l: (s: string) => void) => {
    appListeners.add(l);
    return { remove: () => appListeners.delete(l) };
  });
  mockSession.cache = createCache(mockMem(), "t1:h1");
});
afterEach(() => {
  jest.useRealTimers();
});

/** Sahte sunucu: her çağrı bir kuyruk elemanını bekler; açık istek `signal` ile iptal edilir. */
function fakeServer() {
  const calls: { q: Query; signal: AbortSignal }[] = [];
  const pending: { resolve: (f: Feed) => void; reject: (e: unknown) => void }[] = [];
  const fetchChanges = jest.fn(
    (q: Query, signal: AbortSignal) =>
      new Promise<Feed>((resolve, reject) => {
        calls.push({ q, signal });
        pending.push({ resolve, reject });
        signal.addEventListener("abort", () => reject(new ApiError(0, "AG_HATASI", "iptal")));
      }),
  );
  const next = () => pending.shift()!;
  return { calls, fetchChanges, next };
}
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });

function FeedProbe(p: { enabled: boolean; fetchChanges: import("../src/state/changes").FetchChanges; onChanges?: (t: readonly string[]) => void; onStamp?: (s: string) => void }) {
  C.useChangeFeed(p);
  return null;
}

describe("§1 yalnız ön planda tek döngü", () => {
  it("ön planda başlar (ilk istek bekle=0), arka plana geçince açık istek iptal edilir ve yeni istek atılmaz; dönünce yeniden başlar", async () => {
    const s = fakeServer();
    render(createElement(FeedProbe, { enabled: true, fetchChanges: s.fetchChanges, onChanges: jest.fn() }));
    await flush();
    expect(s.calls.map((c) => c.q)).toEqual([{ since: 0, bekle: 0 }]);
    await act(async () => s.next().resolve({ sayac: 7, degisenler: [], fabrikaDamgasi: null }));
    await advance(C.FEED_MIN_GAP_MS);
    expect(s.calls.map((c) => c.q)).toEqual([{ since: 0, bekle: 0 }, { since: 7, bekle: C.LONG_POLL_WAIT_S }]);
    await act(async () => appState("background"));
    expect(s.calls[1]!.signal.aborted).toBe(true);
    await advance(10 * 60_000);
    expect(s.calls).toHaveLength(2);
    await act(async () => appState("active"));
    await flush();
    expect(s.calls).toHaveLength(3);
    expect(s.calls[2]!.q).toEqual({ since: 0, bekle: 0 });
  });
});

describe("§2 eski sunucu (uç yok) → 60 sn yoklama", () => {
  it("404 → yoklama kipi: her 60 sn'de '*' yayını, uca bir daha gidilmez", async () => {
    const onChanges = jest.fn();
    const modes: string[] = [];
    const fetchChanges = jest.fn(() => Promise.reject(new ApiError(404, "BULUNAMADI", "yok")));
    const h = C.startChangeFeed({ fetchChanges, onChanges, onMode: (m) => modes.push(m) });
    await jest.advanceTimersByTimeAsync(0);
    expect(h.mode).toBe("yoklama");
    expect(modes).toEqual(["yoklama"]);
    await jest.advanceTimersByTimeAsync(C.POLL_FALLBACK_MS - 1);
    expect(onChanges).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(onChanges).toHaveBeenCalledWith([C.ALL_TAGS]);
    await jest.advanceTimersByTimeAsync(C.POLL_FALLBACK_MS);
    expect(onChanges).toHaveBeenCalledTimes(2);
    expect(fetchChanges).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it("gerçek istemciyle: yol /api/degisim?since=&bekle=, 404 zarfı yoklamaya düşürür", async () => {
    const urls: string[] = [];
    const fetchImpl = jest.fn(async (url: string) => {
      urls.push(url);
      return { ok: false, status: 404, json: async () => ({ success: false, message: "Bulunamadı", details: { code: "BULUNAMADI" } }) } as unknown as Response;
    });
    const fetchChanges = C.createFeedFetcher({ baseUrl: "http://bulut.test", getToken: () => "b1", fetchImpl: fetchImpl as unknown as typeof fetch });
    const h = C.startChangeFeed({ fetchChanges, onChanges: jest.fn() });
    await jest.advanceTimersByTimeAsync(0);
    expect(urls).toEqual(["http://bulut.test/api/degisim?since=0&bekle=0"]);
    expect(h.mode).toBe("yoklama");
    h.stop();
  });
});

describe("§3 degisenler → yalnız etiketli kancalar", () => {
  it("degisenler:['siparis'] → yalnız tags:['siparis'] yeniden çeker (≤1 sn); damga bildirilir", async () => {
    const siparis = jest.fn(async () => "s");
    const cari = jest.fn(async () => "c");
    function Screens() {
      useRemote("liste:siparis", siparis, { tags: ["siparis"] });
      useRemote("liste:cari", cari, { tags: ["cari-kart"] });
      return null;
    }
    render(createElement(Screens));
    await flush();
    expect([siparis.mock.calls.length, cari.mock.calls.length]).toEqual([1, 1]);
    const s = fakeServer();
    const onStamp = jest.fn();
    const h = C.startChangeFeed({ fetchChanges: s.fetchChanges, onChanges: C.invalidate, onStamp });
    await flush();
    await act(async () => s.next().resolve({ sayac: 3, degisenler: ["siparis", "cari-kart"], fabrikaDamgasi: "2026-10-22T08:00:00.000Z" }));
    // İlk yanıt yalnız sayacı öğrenir: geçersizleştirmez.
    expect([siparis.mock.calls.length, cari.mock.calls.length]).toEqual([1, 1]);
    expect(onStamp).toHaveBeenLastCalledWith("2026-10-22T08:00:00.000Z");
    await advance(C.FEED_MIN_GAP_MS);
    expect(s.calls[1]!.q).toEqual({ since: 3, bekle: C.LONG_POLL_WAIT_S });
    // Fabrika yeni paket gönderdi: uzun yoklama döner.
    await act(async () => s.next().resolve({ sayac: 4, degisenler: ["siparis"], fabrikaDamgasi: "2026-10-22T08:00:20.000Z" }));
    await advance(1_000);
    expect([siparis.mock.calls.length, cari.mock.calls.length]).toEqual([2, 1]);
    expect(onStamp).toHaveBeenLastCalledWith("2026-10-22T08:00:20.000Z");
    h.stop();
  });

  it("sayaç geri giderse (sunucu sıfırlandı) '*' yayınlanır; sayaç aynıysa hiçbir şey", async () => {
    const s = fakeServer();
    const onChanges = jest.fn();
    const h = C.startChangeFeed({ fetchChanges: s.fetchChanges, onChanges });
    await jest.advanceTimersByTimeAsync(0);
    s.next().resolve({ sayac: 9, degisenler: [], fabrikaDamgasi: null });
    await jest.advanceTimersByTimeAsync(C.FEED_MIN_GAP_MS);
    s.next().resolve({ sayac: 9, degisenler: [], fabrikaDamgasi: null });
    await jest.advanceTimersByTimeAsync(C.FEED_MIN_GAP_MS);
    expect(onChanges).not.toHaveBeenCalled();
    s.next().resolve({ sayac: 2, degisenler: [], fabrikaDamgasi: null });
    await jest.advanceTimersByTimeAsync(0);
    expect(onChanges).toHaveBeenCalledWith([C.ALL_TAGS]);
    h.stop();
  });

  it("tagsMatch: '*' herkese; etiketsiz abone yalnız '*' alır", () => {
    expect(C.tagsMatch([], ["*"])).toBe(true);
    expect(C.tagsMatch([], ["siparis"])).toBe(false);
    expect(C.tagsMatch(["siparis"], ["cari-kart", "siparis"])).toBe(true);
    expect(C.tagsMatch(["siparis"], ["cari-kart"])).toBe(false);
  });
});

describe("§4 oturum düşünce durur", () => {
  it("401 → döngü kendini kapatır, bir daha istek atmaz", async () => {
    const fetchChanges = jest.fn(() => Promise.reject(new ApiError(401, "OTURUM_YOK", "süre doldu")));
    const h = C.startChangeFeed({ fetchChanges, onChanges: jest.fn() });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchChanges).toHaveBeenCalledTimes(1);
    expect(h.mode).toBe("kapali");
  });

  it("oturum hazır değilse (enabled:false) döngü kapanır ve açık istek iptal edilir", async () => {
    const s = fakeServer();
    const { rerender } = render(createElement(FeedProbe, { enabled: true, fetchChanges: s.fetchChanges }));
    await flush();
    expect(s.calls).toHaveLength(1);
    rerender(createElement(FeedProbe, { enabled: false, fetchChanges: s.fetchChanges }));
    await flush();
    expect(s.calls[0]!.signal.aborted).toBe(true);
    await advance(10 * 60_000);
    expect(s.calls).toHaveLength(1);
  });
});

describe("§5 hata geri çekilmesi", () => {
  it("ağ/5xx hatasında 5 → 10 → 30 → 60 → 60 sn bekler (60 tavan)", async () => {
    const at: number[] = [];
    const t0 = Date.now();
    const fetchChanges = jest.fn(() => {
      at.push(Date.now() - t0);
      return Promise.reject(new ApiError(503, "SUNUCU_HATASI", "x"));
    });
    const h = C.startChangeFeed({ fetchChanges, onChanges: jest.fn() });
    await jest.advanceTimersByTimeAsync(5_000 + 10_000 + 30_000 + 60_000 + 60_000);
    expect(at).toEqual([0, 5_000, 15_000, 45_000, 105_000, 165_000]);
    h.stop();
  });
});
