// =============================================================================
// BEKÇİ — filtre kaydı SEKME BAŞINA (tek `useDataTable`, anahtar sekmeyle değişir: Kumaş Stoğu)
// =============================================================================
// Senaryolar: her sekme kendi kaydını geri getirir · bir sekmenin süzgeci ötekine taşınmaz
// (ne URL'de ne istekte ne kayıtta) · kayıtsız sekme (Üretim Akışı) eski süzgeci temizler ·
// derin bağlantı yalnız açılış sekmesini etkiler.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { useSyncExternalStore, type ReactNode } from "react";
import type { CursorPaginatedResponse } from "@/types/api";
import type { AppPreferences } from "@/types/preferences";
import type { PreferencePatch } from "@/providers/PreferencesProvider";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";
import { useDataTable } from "./useDataTable";

let store: { prefs: AppPreferences; ready: boolean } = { prefs: {}, ready: true };
const listeners = new Set<() => void>();
const writes: AppPreferences[] = [];
const setPreference = (patch: PreferencePatch) => {
  const p = typeof patch === "function" ? patch(store.prefs) : patch;
  store = { ...store, prefs: { ...store.prefs, ...p } };
  writes.push(store.prefs);
  listeners.forEach((l) => l());
};
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => {
    const s = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => store);
    return { prefs: s.prefs, ready: s.ready, setPreference };
  },
}));

type Row = { id: string };
const calls: { tab: string; filters: Record<string, unknown> }[] = [];
let currentTab = "A";
const fetchFn = (params: { filters?: Record<string, unknown> }): Promise<CursorPaginatedResponse<Row>> => {
  calls.push({ tab: currentTab, filters: params.filters ?? {} });
  return Promise.resolve({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50, totalEstimate: 0 } } as never);
};

// A: Durum · B: Müşteri + Sevkiyat (yalnız B'de) · K: kayıtsız (Üretim Akışı emsali)
const CFGS: Record<string, TableFilterPersistConfig | undefined> = {
  A: { filterKeys: ["filter[status]", "filter[itemId]"] },
  B: { filterKeys: ["filter[customerId]", "filter[itemId]", "filter[shipmentScope]"] },
  K: undefined,
};

let url = "";
let setParams: ReturnType<typeof useSearchParams>[1] | null = null;
function Probe({ tab }: { tab: string }) {
  const [sp, set] = useSearchParams();
  url = sp.toString();
  setParams = set;
  currentTab = tab;
  useDataTable<Row>({ queryKey: `rolls:${tab}`, queryKeyParts: ["rolls", tab], fetchFn, columns: [], persistFilters: CFGS[tab], enabled: tab !== "K" });
  return null;
}

function mount(initial = "/rolls") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Probe tab="A" />, { wrapper: Wrap });
}

const tick = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const rec = (q: string) => ({ query: q, savedAt: "2026-11-07T00:00:00Z" });
const params = () => new URLSearchParams(url);

beforeEach(() => {
  store = {
    prefs: { tableFilters: { "rolls:A": rec("filter%5Bstatus%5D=OPEN&sortBy=updatedAt"), "rolls:B": rec("filter%5BcustomerId%5D=MUS-B") } },
    ready: true,
  };
  writes.length = 0;
  calls.length = 0;
  url = "";
  setParams = null;
});

describe("Filtre kaydı — sekme başına anahtar", () => {
  it("⭐ her sekme kendi kaydını getirir; A'nın süzgeci B'nin URL'ine ve isteğine taşınmaz", async () => {
    const view = mount();
    await waitFor(() => expect(params().get("filter[status]")).toBe("OPEN"));
    view.rerender(<Probe tab="B" />);
    await waitFor(() => expect(params().get("filter[customerId]")).toBe("MUS-B"));
    expect(params().has("filter[status]")).toBe(false);
    expect(params().has("sortBy")).toBe(false);
    await tick(200);
    const bCalls = calls.filter((c) => c.tab === "B");
    expect(bCalls).toHaveLength(1);
    expect(bCalls[0]!.filters).toEqual({ customerId: "MUS-B" });
    view.rerender(<Probe tab="A" />);
    await waitFor(() => expect(params().get("filter[status]")).toBe("OPEN"));
    expect(params().get("sortBy")).toBe("updatedAt");
    expect(params().has("filter[customerId]")).toBe(false);
  });

  it("⭐ sekme geçişi kayıtları DEĞİŞTİRMEZ (A'nın süzgeci B'ye yazılmaz)", async () => {
    const view = mount();
    await waitFor(() => expect(params().get("filter[status]")).toBe("OPEN"));
    view.rerender(<Probe tab="B" />);
    await tick(700);
    view.rerender(<Probe tab="A" />);
    await tick(700);
    expect(writes).toHaveLength(0);
  });

  it("⭐ kullanıcının B'deki seçimi yalnız B'nin kaydına yazılır", async () => {
    const view = mount();
    await waitFor(() => expect(params().get("filter[status]")).toBe("OPEN"));
    view.rerender(<Probe tab="B" />);
    await waitFor(() => expect(params().get("filter[customerId]")).toBe("MUS-B"));
    act(() => setParams!(new URLSearchParams("filter[customerId]=MUS-B&filter[shipmentScope]=free"), { replace: true }));
    await tick(700);
    expect(store.prefs.tableFilters?.["rolls:B"]?.query).toBe("filter%5BcustomerId%5D=MUS-B&filter%5BshipmentScope%5D=free");
    expect(store.prefs.tableFilters?.["rolls:A"]?.query).toBe("filter%5Bstatus%5D=OPEN&sortBy=updatedAt");
  });

  it("⭐ B'ye özgü süzgeç (Sevkiyat) kaydı olmayan sekmeye geçince URL'den düşer", async () => {
    store.prefs = { tableFilters: { "rolls:A": rec("filter%5BshipmentScope%5D=free") } };
    const view = mount();
    await tick(200);
    view.rerender(<Probe tab="B" />);
    act(() => setParams!(new URLSearchParams("filter[shipmentScope]=free&search=PATOS"), { replace: true }));
    await tick(700);
    view.rerender(<Probe tab="A" />);
    await tick(200);
    // A'nın allowlist'inde shipmentScope yok — kayıt okunurken düşer; B'den kalan da silinir. Arama kalır.
    expect(params().has("filter[shipmentScope]")).toBe(false);
    expect(params().get("search")).toBe("PATOS");
  });

  it("kayıtsız sekme (Üretim Akışı) eski süzgeci temizler; geri dönünce kayıt gelir", async () => {
    const view = mount();
    await waitFor(() => expect(params().get("filter[status]")).toBe("OPEN"));
    view.rerender(<Probe tab="K" />);
    await waitFor(() => expect(params().has("filter[status]")).toBe(false));
    view.rerender(<Probe tab="A" />);
    await waitFor(() => expect(params().get("filter[status]")).toBe("OPEN"));
    expect(writes).toHaveLength(0);
  });

  it("⭐ derin bağlantı yalnız açılış sekmesini etkiler; başka sekmeye geçince o sekmenin kaydı gelir", async () => {
    const view = mount("/rolls?filter%5BitemId%5D=PATOS");
    await tick(200);
    expect(params().get("filter[itemId]")).toBe("PATOS");
    expect(params().has("filter[status]")).toBe(false);
    view.rerender(<Probe tab="B" />);
    await waitFor(() => expect(params().get("filter[customerId]")).toBe("MUS-B"));
    expect(params().has("filter[itemId]")).toBe(false);
    await tick(700);
    expect(writes).toHaveLength(0);
  });
});
