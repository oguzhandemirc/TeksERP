// SWR veri kancası (K1-a, P2): saklı kopya ANINDA bayat etiketle, sonra taze; `refreshing`; ağ hatasında çevrimdışı
// (bayat ≠ çevrimdışı); 403/404'te ekrandaki kopya düşer; odak ve öne gelme (≥5 sn) ile etiket geçersizleştirmesi.
import { act, render, waitFor } from "@testing-library/react-native";
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

/** expo-router odak taklidi: bağlanınca odak, `blur()`/`focus()` ile kayıp/dönüş. */
const mockFocus = { entries: new Set<{ cb: () => unknown; cleanup?: unknown }>() };
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => unknown) =>
    require("react").useEffect(() => {
      const e = { cb, cleanup: cb() };
      mockFocus.entries.add(e);
      return () => {
        mockFocus.entries.delete(e);
        if (typeof e.cleanup === "function") e.cleanup();
      };
    }, [cb]),
}));
function blur() {
  for (const e of mockFocus.entries) {
    if (typeof e.cleanup === "function") e.cleanup();
    e.cleanup = undefined;
  }
}
function focus() {
  for (const e of mockFocus.entries) e.cleanup = e.cb();
}

const appListeners = new Set<(s: string) => void>();
function appState(s: string) {
  for (const l of [...appListeners]) l(s);
}

const { useRemote } = require("../src/state/useRemote") as typeof import("../src/state/useRemote");
const { invalidate } = require("../src/state/changes") as typeof import("../src/state/changes");
type R = import("../src/state/useRemote").Remote<unknown>;

let now = 1_000_000;
let store: ReturnType<typeof mockMem>;

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  store = mockMem();
  mockSession.cache = createCache(store, "t1:h1", () => new Date("2026-10-22T09:00:00Z"));
  mockFocus.entries.clear();
  appListeners.clear();
  (AppState.addEventListener as jest.Mock).mockImplementation((_t: string, l: (s: string) => void) => {
    appListeners.add(l);
    return { remove: () => appListeners.delete(l) };
  });
});
afterEach(() => jest.restoreAllMocks());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const seen: Record<string, R> = {};
function Probe({ name, k, fetcher, tags }: { name: string; k: string | null; fetcher: () => Promise<unknown>; tags?: string[] }) {
  seen[name] = useRemote(k, fetcher, tags ? { tags } : undefined);
  return null;
}

async function seed(key: string, data: unknown) {
  const c = createCache(store, "t1:h1", () => new Date("2026-10-22T07:30:00Z"));
  await c.load(key, async () => data);
}

describe("SWR sırası", () => {
  it("saklı kopya önce bayat (stale + refreshing) çizilir, sonra taze veri gelir", async () => {
    await seed("anlik:pano", { v: "eski" });
    const d = deferred<unknown>();
    render(<Probe name="a" k="anlik:pano" fetcher={() => d.promise} />);
    await waitFor(() => expect(seen.a!.data).toEqual({ v: "eski" }));
    expect(seen.a).toMatchObject({ stale: true, refreshing: true, loading: true, offline: false, savedAt: "2026-10-22T07:30:00.000Z" });
    await act(async () => d.resolve({ v: "yeni" }));
    expect(seen.a).toMatchObject({ data: { v: "yeni" }, stale: false, refreshing: false, loading: false, offline: false, savedAt: "2026-10-22T09:00:00.000Z" });
    expect(mockSession.markOnline).toHaveBeenLastCalledWith(true, "2026-10-22T09:00:00.000Z");
  });

  it("taze yanıt saklı kopyadan önce gelirse bayat kopya onu EZMEZ", async () => {
    await seed("anlik:pano", { v: "eski" });
    render(<Probe name="a" k="anlik:pano" fetcher={async () => ({ v: "yeni" })} />);
    await waitFor(() => expect(seen.a!.loading).toBe(false));
    await act(async () => undefined);
    expect(seen.a).toMatchObject({ data: { v: "yeni" }, stale: false });
  });

  it("önbellek yoksa iskelet (loading, data yok); refreshing yalnız ekranda veri varken", async () => {
    const d = deferred<unknown>();
    const { rerender } = render(<Probe name="a" k="hesaplar" fetcher={() => d.promise} />);
    expect(seen.a).toMatchObject({ data: null, loading: true, refreshing: false, stale: false });
    await act(async () => d.resolve([1]));
    expect(seen.a).toMatchObject({ data: [1], loading: false });
    const d2 = deferred<unknown>();
    const again = jest.fn(() => d2.promise);
    rerender(<Probe name="a" k="hesaplar" fetcher={again} />);
    act(() => seen.a!.reload());
    expect(again).toHaveBeenCalledTimes(1);
    expect(seen.a).toMatchObject({ refreshing: true, loading: true, data: [1] });
    await act(async () => d2.resolve([2]));
    expect(seen.a).toMatchObject({ data: [2], refreshing: false });
  });

  it("ağ hatası: saklı kopya ÇEVRİMDIŞI (offline + stale) — bayat ≠ çevrimdışı iki ayrı bayrak", async () => {
    await seed("anlik:pano", { v: "eski" });
    render(<Probe name="a" k="anlik:pano" fetcher={() => Promise.reject(new ApiError(0, "AG_HATASI", "ağ yok"))} />);
    await waitFor(() => expect(seen.a!.loading).toBe(false));
    expect(seen.a).toMatchObject({ data: { v: "eski" }, offline: true, stale: true });
    expect(mockSession.markOnline).toHaveBeenLastCalledWith(false, "2026-10-22T07:30:00.000Z");
  });

  it.each([
    [403, "YETKI_YOK"],
    [404, "BULUNAMADI"],
  ])("%i: bayat çizilen kopya ekrandan da düşer, önbellekten silinir", async (status, code) => {
    await seed("anlik:finans", { v: "gizli" });
    const d = deferred<unknown>();
    render(<Probe name="a" k="anlik:finans" fetcher={() => d.promise} />);
    await waitFor(() => expect(seen.a!.data).toEqual({ v: "gizli" }));
    await act(async () => d.reject(new ApiError(status, code, "ret")));
    expect(seen.a).toMatchObject({ data: null, stale: false, error: "ret" });
    expect([...store.m.keys()]).toEqual([]);
  });

  it("5xx: bayat kopya etiketli kalır, hata iletisi döner (önbellek silinmez)", async () => {
    await seed("anlik:pano", { v: "eski" });
    render(<Probe name="a" k="anlik:pano" fetcher={() => Promise.reject(new ApiError(503, "SUNUCU_HATASI", "bakım"))} />);
    await waitFor(() => expect(seen.a!.loading).toBe(false));
    expect(seen.a).toMatchObject({ data: { v: "eski" }, stale: true, offline: false, error: "bakım" });
  });

  it("anahtar değişince önceki anahtarın verisi yeni anahtarın üstünde gösterilmez", async () => {
    const { rerender } = render(<Probe name="a" k="kayit:siparis:1" fetcher={async () => "bir"} />);
    await waitFor(() => expect(seen.a!.data).toBe("bir"));
    const d = deferred<unknown>();
    rerender(<Probe name="a" k="kayit:siparis:2" fetcher={() => d.promise} />);
    await waitFor(() => expect(seen.a!.data).toBeNull());
    await act(async () => d.resolve("iki"));
    expect(seen.a!.data).toBe("iki");
  });
});

describe("odak ve öne gelme tazelemesi", () => {
  it("odağa dönüş: son çekimden ≥5 sn geçtiyse yeniden çeker, daha erken çekmez", async () => {
    const f = jest.fn(async () => 1);
    render(<Probe name="a" k="anlik:pano" fetcher={f} />);
    await waitFor(() => expect(seen.a!.loading).toBe(false));
    expect(f).toHaveBeenCalledTimes(1);
    act(() => blur());
    now += 4_000;
    await act(async () => focus());
    expect(f).toHaveBeenCalledTimes(1);
    act(() => blur());
    now += 1_000;
    await act(async () => focus());
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it("öne gelme (AppState active): ≥5 sn aralıkla yeniden çeker", async () => {
    const f = jest.fn(async () => 1);
    render(<Probe name="a" k="anlik:pano" fetcher={f} />);
    await waitFor(() => expect(seen.a!.loading).toBe(false));
    act(() => appState("background"));
    now += 2_000;
    await act(async () => appState("active"));
    expect(f).toHaveBeenCalledTimes(1);
    act(() => appState("background"));
    now += 10_000;
    await act(async () => appState("active"));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it("odakta olmayan ekran geçersizleşirse hemen çekmez; odağa dönünce (aralık beklemeden) çeker", async () => {
    const f = jest.fn(async () => 1);
    render(<Probe name="a" k="liste" fetcher={f} tags={["siparis"]} />);
    await waitFor(() => expect(seen.a!.loading).toBe(false));
    act(() => blur());
    await act(async () => invalidate(["siparis"]));
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => focus());
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it("etiketler anahtardan çıkarılır (anlik:/kayit:/veri:), açık `tags` önceliklidir", () => {
    const { tagsOfKey } = require("../src/state/useRemote") as typeof import("../src/state/useRemote");
    expect(tagsOfKey("anlik:stok-karnesi")).toEqual(["stok-karnesi"]);
    expect(tagsOfKey("kayit:cari-kart:abc")).toEqual(["cari-kart"]);
    expect(tagsOfKey("veri:siparis:ACIK")).toEqual(["siparis"]);
    expect(tagsOfKey("hesaplar")).toEqual([]);
    expect(tagsOfKey(null)).toEqual([]);
  });
});
