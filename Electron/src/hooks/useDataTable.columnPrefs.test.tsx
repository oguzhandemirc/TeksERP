// Sütun genişliği/sırası/görünürlüğü KULLANICIYA kayıtlı (kullanıcı 2026-11-12): tablo anahtarı başına
// tercih blob'una yazılır, yeniden açınca aynen gelir; "Sütunları sıfırla" anahtarı siler.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import type { AppPreferences } from "@/types/preferences";
import { useDataTable } from "./useDataTable";
import { resetColumnLayout } from "@/components/data-table/column-arrange";

// Sunucudaki blob'un yerine bellek içi kopya — setPreference PreferencesProvider gibi birleştirir.
let store: AppPreferences = {};
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({
    prefs: store,
    setPreference: (patch: Partial<AppPreferences>) => {
      store = { ...store, ...patch };
    },
  }),
}));

type Row = { id: string; a: string; b: string };
const COLUMNS: ColumnDef<Row>[] = [
  { id: "a", accessorKey: "a", header: "A" },
  { id: "b", accessorKey: "b", header: "B" },
];
const fetchFn = () => Promise.resolve({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 50 } } as never);

let api: ReturnType<typeof useDataTable<Row>> | null = null;
function Probe() {
  api = useDataTable<Row>({ queryKey: "orders", fetchFn, columns: COLUMNS });
  return null;
}
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><Probe /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("useDataTable — sütun tercihleri", () => {
  beforeEach(() => {
    store = { tableSizing: { other: { x: 90 } } };
  });

  it("genişlik + sıra + görünürlük tablo anahtarına yazılır ve yeniden açınca geri gelir", () => {
    const first = mount();
    act(() => api!.table.setColumnSizing({ a: 212.4 }));
    act(() => api!.table.setColumnOrder(["b", "a"]));
    act(() => api!.table.getColumn("b")!.toggleVisibility(false));
    expect(store.tableSizing).toEqual({ other: { x: 90 }, orders: { a: 212 } });
    expect(store.tableOrder).toEqual({ orders: ["b", "a"] });
    expect(store.tableVisibility).toEqual({ orders: { b: false } });
    first.unmount();

    mount();
    const st = api!.table.getState();
    expect(st.columnSizing).toEqual({ a: 212 });
    expect(st.columnOrder).toEqual(["b", "a"]);
    expect(api!.table.getColumn("b")!.getIsVisible()).toBe(false);
  });

  it("Sütunları sıfırla bu tablonun anahtarlarını siler, başka tabloya dokunmaz", () => {
    store = { ...store, tableOrder: { orders: ["b", "a"] }, tableVisibility: { orders: { b: false } } };
    store.tableSizing = { ...store.tableSizing, orders: { a: 300 } };
    mount();
    act(() => resetColumnLayout(api!.table));
    expect(store.tableSizing).toEqual({ other: { x: 90 } });
    expect(store.tableOrder).toEqual({});
    expect(store.tableVisibility).toEqual({});
  });
});
