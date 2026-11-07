// =============================================================================
// BEKÇİ — liste filtre kaydı (kullanıcı başına, tablo başına; `prefs.tableFilters`)
// =============================================================================
// Senaryolar: geri yükleme · ilk açılışta TEK istek · derin bağlantı kaydı ezer ve
// o an yazmaz · arama kaydedilmez · Temizle kaydı siler · bozuk kayıt kilitlemez ·
// geri yüklenen süzgeç 4xx verirse sıfırlanır · opt-in değilse etkisiz.
// Negatif sondalar arşiv notunda (2026-11-07 "Liste filtre kaydı").
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import { useSyncExternalStore, type ReactNode } from "react";
import type { CursorPaginatedResponse } from "@/types/api";
import type { AppPreferences } from "@/types/preferences";
import type { PreferencePatch } from "@/providers/PreferencesProvider";
import { useDataTable } from "./useDataTable";
import { usePersistedTableFilters } from "./usePersistedTableFilters";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";

// ── Sahte tercih deposu: `ready` ve içerik testten sürülür ──────────────────────
let store: { prefs: AppPreferences; ready: boolean } = { prefs: {}, ready: true };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const writes: AppPreferences[] = [];
const setPreference = (patch: PreferencePatch) => {
  const p = typeof patch === "function" ? patch(store.prefs) : patch;
  store = { ...store, prefs: { ...store.prefs, ...p } };
  writes.push(store.prefs);
  emit();
};
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => {
    const s = useSyncExternalStore(
      (l) => (listeners.add(l), () => listeners.delete(l)),
      () => store,
    );
    return { prefs: s.prefs, ready: s.ready, setPreference };
  },
}));

type Row = { id: string };
const calls: { filters: Record<string, unknown>; search?: string; sortBy?: string }[] = [];
let failWhen: ((f: Record<string, unknown>) => boolean) | null = null;
function fetchFn(params: { filters?: Record<string, unknown>; search?: string; sortBy?: string }): Promise<CursorPaginatedResponse<Row>> {
  const filters = params.filters ?? {};
  calls.push({ filters, search: params.search, sortBy: params.sortBy });
  if (failWhen?.(filters)) return Promise.reject({ response: { status: 400 } });
  return Promise.resolve({ success: true, data: [{ id: "r1" }], pagination: { nextCursor: null, hasMore: false, limit: 50, totalEstimate: 1 } } as never);
}

const CFG = { filterKeys: ["filter[status]", "filter[customerId]"] };
let setParams: ReturnType<typeof useSearchParams>[1] | null = null;
let url = "";
let api: ReturnType<typeof useDataTable<Row>> | null = null;

function Probe({ persist = true, cfg = CFG }: { persist?: boolean; cfg?: TableFilterPersistConfig }) {
  const [sp, set] = useSearchParams();
  setParams = set;
  url = sp.toString();
  api = useDataTable<Row>({ queryKey: "orders", fetchFn, columns: [], persistFilters: persist ? cfg : undefined });
  return null;
}

function mount(initial = "/orders", persist = true, cfg: TableFilterPersistConfig = CFG) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Probe persist={persist} cfg={cfg} />, { wrapper: Wrap });
}

const tick = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const stored = () => store.prefs.tableFilters?.orders?.query ?? "";
const rec = (query: unknown) => ({ orders: { query, savedAt: "2026-11-06T00:00:00Z" } }) as AppPreferences["tableFilters"];

beforeEach(() => {
  store = { prefs: {}, ready: true };
  writes.length = 0;
  calls.length = 0;
  failWhen = null;
  setParams = null;
  url = "";
  api = null;
});

describe("Filtre kaydı — geri yükleme ve yarış", () => {
  it("⭐ sayfaya dönünce son kullanılan süzgeç + sıralama gelir; arama metni gelmez", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN&sortBy=deadline&search=gizli") };
    mount();
    await tick(200);
    const u = new URLSearchParams(url);
    expect(u.get("filter[status]")).toBe("OPEN");
    expect(u.get("sortBy")).toBe("deadline");
    expect(u.has("search")).toBe(false);
    expect(calls.every((c) => c.filters.status === "OPEN")).toBe(true);
  });

  it("⭐ tercih yüklenmeden istek YOK; yüklenince kayıtlı süzgeçle TEK istek", async () => {
    store = { prefs: {}, ready: false };
    mount();
    await tick(200);
    expect(calls).toHaveLength(0);
    act(() => {
      store = { prefs: { tableFilters: rec("filter%5Bstatus%5D=OPEN") }, ready: true };
      emit();
    });
    await tick(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filters.status).toBe("OPEN");
    expect(api?.filtersReady).toBe(true);
  });

  it("kayıt yoksa tercih gelince filtresiz TEK istek", async () => {
    store = { prefs: {}, ready: false };
    mount();
    await tick(100);
    act(() => {
      store = { prefs: {}, ready: true };
      emit();
    });
    await tick(200);
    expect(calls).toHaveLength(1);
  });
});

describe("Filtre kaydı — sayfa varsayılan tarihi (İş Emirleri/Sevkiyat: son 30 gün)", () => {
  const DCFG: TableFilterPersistConfig = { ...CFG, defaultDate: { field: "createdAt", preset: "last30" } };

  it("⭐ kayıt yoksa varsayılan pencere uygulanır ve TEK istek onunla gider", async () => {
    mount("/orders", true, DCFG);
    await waitFor(() => expect(calls).toHaveLength(1));
    const p = new URLSearchParams(url);
    expect(p.get("dateField")).toBe("createdAt");
    expect(p.get("dateFrom")).toBeTruthy();
    await tick(500);
    expect(calls).toHaveLength(1);
    expect(stored()).toBe("dateField=createdAt&datePreset=last30");
  });

  it("⭐ kayıtlı \"Tümü\" (datePreset=all) korunur: varsayılan pencere UYGULANMAZ", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN&datePreset=all") };
    mount("/orders", true, DCFG);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(url).toBe("filter%5Bstatus%5D=OPEN");
    expect(calls[0]!.filters).not.toHaveProperty("dateFrom");
  });

  it("⭐ yalnız \"Tümü\" kaydı (başka süzgeç yok) da korunur: tarihsiz TEK istek", async () => {
    store.prefs = { tableFilters: rec("datePreset=all") };
    mount("/orders", true, DCFG);
    await waitFor(() => expect(calls).toHaveLength(1));
    await tick(300);
    expect(url).toBe("");
    expect(calls).toHaveLength(1);
  });

  it("Temizle sonrası \"Tümü\" olarak saklanır (bir sonraki açılış gördüğün gibi)", async () => {
    mount("/orders", true, DCFG);
    await waitFor(() => expect(new URLSearchParams(url).get("dateFrom")).toBeTruthy());
    await act(async () => setParams!(new URLSearchParams(), { replace: true }));
    await tick(500);
    expect(stored()).toBe("datePreset=all");
  });

  it("derin bağlantıda varsayılan pencere uygulanmaz (dashboard sayısı tutarlı kalsın)", async () => {
    mount("/orders?filter%5Bstatus%5D=OPEN", true, DCFG);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(new URLSearchParams(url).has("dateFrom")).toBe(false);
  });
});

describe("Filtre kaydı — derin bağlantı", () => {
  it("⭐ URL'de filter[...] varsa kayıtlı süzgeci ezer ve kaydı o an DEĞİŞTİRMEZ", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN") };
    mount("/orders?filter%5BcustomerId%5D=MUS-X");
    await tick(700);
    const u = new URLSearchParams(url);
    expect(u.get("filter[customerId]")).toBe("MUS-X");
    expect(u.has("filter[status]")).toBe(false);
    expect(calls.every((c) => c.filters.customerId === "MUS-X" && c.filters.status === undefined)).toBe(true);
    expect(writes).toHaveLength(0);
    expect(stored()).toBe("filter%5Bstatus%5D=OPEN");
  });

  it.each(["search=MUS", "focus=o1"])("⭐ genel arama / kayda odak bağlantısı (%s) da kayıtlı süzgeci uygulamaz", async (q) => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN") };
    mount(`/orders?${q}`);
    await tick(700);
    expect(new URLSearchParams(url).has("filter[status]")).toBe(false);
    expect(calls.every((c) => c.filters.status === undefined)).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("derin bağlantıdan sonra kullanıcı süzgeci değiştirirse o kaydedilir", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN") };
    mount("/orders?filter%5BcustomerId%5D=MUS-X");
    await tick(100);
    act(() => setParams!(new URLSearchParams("filter[customerId]=MUS-Y"), { replace: true }));
    await tick(700);
    expect(stored()).toBe("filter%5BcustomerId%5D=MUS-Y");
  });
});

describe("Filtre kaydı — yazma", () => {
  it("⭐ arama metni kaydedilmez; süzgeç + sıralama kaydedilir (debounce'lu tek yazım)", async () => {
    mount();
    await tick(100);
    act(() => setParams!(new URLSearchParams("search=abc&filter[status]=OPEN&sortBy=deadline"), { replace: true }));
    act(() => setParams!(new URLSearchParams("search=abcd&filter[status]=OPEN,DONE&sortBy=deadline"), { replace: true }));
    await tick(700);
    expect(stored()).toBe("filter%5Bstatus%5D=OPEN%2CDONE&sortBy=deadline");
    expect(stored()).not.toContain("search");
    expect(writes).toHaveLength(1);
  });

  it("⭐ Temizle (süzgeç anahtarları silinir) → kayıt silinir, bir sonraki açılış temiz", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN") };
    mount();
    await tick(200);
    act(() => setParams!(new URLSearchParams(""), { replace: true }));
    await tick(700);
    expect(store.prefs.tableFilters?.orders).toBeUndefined();
  });

  it("kayıtlı görünüm uygulanınca (URL'nin tamamı değişir) son kullanılan olarak kaydedilir", async () => {
    mount();
    await tick(100);
    act(() => setParams!(new URLSearchParams("filter[customerId]=MUS-Z&search=x"), { replace: true }));
    await tick(700);
    expect(stored()).toBe("filter%5BcustomerId%5D=MUS-Z");
  });

  it("opt-in değilse ne geri yükler ne yazar", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=OPEN") };
    mount("/orders", false);
    await tick(100);
    expect(new URLSearchParams(url).has("filter[status]")).toBe(false);
    act(() => setParams!(new URLSearchParams("filter[status]=DONE"), { replace: true }));
    await tick(700);
    expect(writes).toHaveLength(0);
  });
});

describe("Filtre kaydı — fail-safe", () => {
  it.each([rec(42), rec("%%%&&=="), { orders: "bozuk" }, "tamamen-bozuk"])("⭐ bozuk kayıt sayfayı kilitlemez: filtresiz liste gelir (%#)", async (raw) => {
    store.prefs = { tableFilters: raw as AppPreferences["tableFilters"] };
    mount();
    await tick(300);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(api?.query.isSuccess).toBe(true);
  });

  it("kaldırılmış süzgeç anahtarı yok sayılır, geçerli kalanı uygulanır", async () => {
    store.prefs = { tableFilters: rec("filter%5Bkaldirildi%5D=1&filter%5Bstatus%5D=OPEN") };
    mount();
    await tick(300);
    const u = new URLSearchParams(url);
    expect(u.has("filter[kaldirildi]")).toBe(false);
    expect(u.get("filter[status]")).toBe("OPEN");
  });

  it("⭐ geri yüklenen süzgeç 4xx verirse URL'den ve kayıttan silinir, liste filtresiz gelir", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=ESKI") };
    failWhen = (f) => f.status === "ESKI";
    mount();
    await waitFor(() => expect(api?.query.isSuccess).toBe(true), { timeout: 2000 });
    await tick(600);
    expect(new URLSearchParams(url).has("filter[status]")).toBe(false);
    expect(store.prefs.tableFilters?.orders).toBeUndefined();
    expect(calls.at(-1)?.filters.status).toBeUndefined();
  });

  it("kullanıcının KENDİ seçtiği süzgeç 4xx verirse silinmez (yalnız geri yüklenen)", async () => {
    mount();
    await tick(100);
    failWhen = (f) => f.status === "KOTU";
    act(() => setParams!(new URLSearchParams("filter[status]=KOTU"), { replace: true }));
    await tick(300);
    expect(new URLSearchParams(url).get("filter[status]")).toBe("KOTU");
  });
});

describe("Filtre kaydı — router geçişi gecikirken (belirlenimli)", () => {
  it("⭐ 4xx sıfırlamasından sonra URL henüz çizilmemişken eski süzgeç kayda GERİ YAZILMAZ", async () => {
    store.prefs = { tableFilters: rec("filter%5Bstatus%5D=ESKI") };
    const setSp = vi.fn();
    const { result, rerender } = renderHook((p: { q: string }) =>
      usePersistedTableFilters({ tableKey: "orders", config: CFG, searchParams: new URLSearchParams(p.q), setSearchParams: setSp }),
      { initialProps: { q: "" } },
    );
    await tick(20);
    expect(setSp).toHaveBeenCalledTimes(1); // geri yükleme
    rerender({ q: "filter%5Bstatus%5D=ESKI" });
    await tick(20);
    act(() => result.current.reportListResult(false, { response: { status: 400 } }));
    expect(store.prefs.tableFilters?.orders).toBeUndefined();
    // Router geçişi gecikiyor: URL hâlâ eski süzgeçte, yazar debounce'u dolar.
    rerender({ q: "filter%5Bstatus%5D=ESKI" });
    await tick(600);
    expect(store.prefs.tableFilters?.orders).toBeUndefined();
    rerender({ q: "" });
    await tick(600);
    expect(store.prefs.tableFilters?.orders).toBeUndefined();
  });

  it("⭐ arama değişmediyse arama debounce'u URL'ye YAZMAZ (bayat kopya araya giren yazımı geri almasın)", async () => {
    const keys: string[] = [];
    function KeyProbe() {
      keys.push(useLocation().key);
      useDataTable<Row>({ queryKey: "orders", fetchFn, columns: [] });
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/orders?filter%5Bstatus%5D=A"]}><KeyProbe /></MemoryRouter>
      </QueryClientProvider>,
    );
    await tick(450);
    expect(new Set(keys).size).toBe(1);
  });
});
