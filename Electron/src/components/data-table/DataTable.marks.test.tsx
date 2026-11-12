// Ortak DataTable — satır işareti + not (kişisel/paylaşılan): görünür kimlikler TEK lookup, sağ tık menüsü,
// iyimser yazım + hata geri alma, paylaşılan not ipucu (sahibinin adıyla), `m` kısayolu, dışa aktarımda yok,
// "İşaretliler" süzgeci yalnız `filter[id]` destekleyen listede ve kimlikleri sunucu süzgecine çevirir.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, renderHook } from "@testing-library/react";
import type { ColumnDef, Table } from "@tanstack/react-table";
import { renderWithProviders } from "@/test/render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataTable } from "./DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";
import { buildCsv } from "@/lib/table-export";
import { useRowMarkFilter } from "./row-marks/RowMarkFilter";
import type { RowMark } from "@/services/rowMarkService";

vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
  usePreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
}));

const api = vi.hoisted(() => ({ lookup: vi.fn(), put: vi.fn(), mine: vi.fn() }));
vi.mock("@/services/rowMarkService", async (orig) => ({
  ...(await orig<typeof import("@/services/rowMarkService")>()),
  lookupRowMarks: api.lookup,
  putRowMark: api.put,
  listMyRowMarkIds: api.mine,
}));

interface Row { id: string; name: string }
const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: "name", header: "Ad" }];
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ROWS: Row[] = [
  { id: ID1, name: "Birinci" },
  { id: ID2, name: "İkinci" },
];
const mark = (p: Partial<RowMark>): RowMark => ({
  recordId: ID1, color: null, note: null, shared: false, mine: true, ownerName: null, updatedAt: "2026-11-13T10:00:00Z", ...p,
});

let tableRef: Table<Row> | null = null;
function List() {
  const table = useLocalTable({ tableKey: "test:isaret", data: ROWS, columns: COLUMNS, getRowId: (r) => r.id });
  tableRef = table;
  return <DataTable table={table} markEntity="order" />;
}

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLTableRowElement;
const gutter = (name: string) => rowOf(name).querySelector("td") as HTMLTableCellElement;
const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });

beforeEach(() => {
  api.lookup.mockReset().mockResolvedValue([]);
  api.put.mockReset();
  api.mine.mockReset();
});

describe("DataTable — satır işareti", () => {
  it("görünür kimlikler TEK lookup isteğiyle sorulur; yeniden çizim tekrar sormaz", async () => {
    const { rerender } = renderWithProviders(<List />);
    await waitFor(() => expect(api.lookup).toHaveBeenCalledTimes(1));
    expect(api.lookup).toHaveBeenCalledWith("order", ROWS.map((r) => r.id));
    rerender(<List />);
    await new Promise((r) => setTimeout(r, 10));
    expect(api.lookup).toHaveBeenCalledTimes(1);
  });

  it("sağ tık menüsü beş renk + not sunar; renk seçimi iyimser boyar ve kaydeder", async () => {
    let resolve: (m: RowMark) => void = () => {};
    api.put.mockReturnValue(new Promise<RowMark>((r) => { resolve = r; }));
    renderWithProviders(<List />);
    await waitFor(() => expect(api.lookup).toHaveBeenCalled());
    fireEvent.contextMenu(rowOf("Birinci"));
    const names = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(["Sarı", "Kırmızı", "Yeşil", "Mavi", "Mor", "Not ekle…"]));
    fireEvent.click(item("Sarı"));
    expect(gutter("Birinci")).toHaveAttribute("data-row-mark", "YELLOW");
    expect(api.put).toHaveBeenCalledWith("order", ID1, { color: "YELLOW", note: null, shared: false });
    await act(async () => resolve(mark({ color: "YELLOW" })));
    expect(gutter("Birinci")).toHaveAttribute("data-row-mark", "YELLOW");
  });

  it("kayıt hatası iyimser değişikliği geri alır", async () => {
    api.put.mockRejectedValue(new Error("ağ"));
    renderWithProviders(<List />);
    await waitFor(() => expect(api.lookup).toHaveBeenCalled());
    fireEvent.contextMenu(rowOf("İkinci"));
    fireEvent.click(item("Kırmızı"));
    expect(gutter("İkinci")).toHaveAttribute("data-row-mark", "RED");
    await waitFor(() => expect(gutter("İkinci")).not.toHaveAttribute("data-row-mark"));
  });

  it("paylaşılan not satır ipucunda sahibinin adıyla görünür; kendi notu önce", async () => {
    api.lookup.mockResolvedValue([
      mark({ note: "benim notum" }),
      mark({ note: "kalite bekliyor", shared: true, mine: false, ownerName: "Ayşe K", color: "BLUE" }),
    ]);
    renderWithProviders(<List />);
    await waitFor(() => expect(rowOf("Birinci").title).toBe("Not: benim notum\nNot: kalite bekliyor — Ayşe K"));
    expect(gutter("Birinci")).toHaveAttribute("data-row-mark", "BLUE");
    expect(screen.getByLabelText("Not var")).toBeInTheDocument();
  });

  it("odaklı satırda `m` menüyü açar", async () => {
    renderWithProviders(<List />);
    await waitFor(() => expect(api.lookup).toHaveBeenCalled());
    const row = rowOf("Birinci");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "m" });
    expect(await screen.findByRole("menuitem", { name: /^Mor/ })).toBeInTheDocument();
  });

  it("not penceresi metni ve 'Herkese açık'ı kaydeder", async () => {
    api.put.mockResolvedValue(mark({ note: "ara", shared: true }));
    renderWithProviders(<List />);
    await waitFor(() => expect(api.lookup).toHaveBeenCalled());
    fireEvent.contextMenu(rowOf("Birinci"));
    fireEvent.click(item("Not ekle"));
    fireEvent.change(await screen.findByLabelText("Not"), { target: { value: "  ara  " } });
    fireEvent.click(screen.getByRole("switch", { name: "Herkese açık" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(api.put).toHaveBeenCalledWith("order", ID1, { color: null, note: "ara", shared: true });
  });

  it("dışa aktarım işaret/not taşımaz (işaret bir sütun değildir)", async () => {
    api.lookup.mockResolvedValue([mark({ note: "gizli not", color: "RED" })]);
    renderWithProviders(<List />);
    await waitFor(() => expect(gutter("Birinci")).toHaveAttribute("data-row-mark", "RED"));
    expect(tableRef!.getAllLeafColumns().map((c) => c.id)).toEqual(["name"]);
    const csv = buildCsv(tableRef!, ROWS);
    expect(csv).not.toMatch(/gizli not|RED|Kırmızı/);
  });
});

describe("İşaretliler süzgeci", () => {
  it("seçilen renk kimlikleri `filter[id]` CSV'sine çevirir; işaretli yoksa hiçbir kayda denk gelmeyen kimlik", async () => {
    api.mine.mockResolvedValueOnce({ recordIds: ROWS.map((r) => r.id), hasMore: false }).mockResolvedValueOnce({ recordIds: [], hasMore: false });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRowMarkFilter("order"), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    expect(result.current.filters).toBeUndefined();
    act(() => result.current.setValue("YELLOW"));
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.filters).toEqual({ id: ROWS.map((r) => r.id).join(",") }));
    expect(api.mine).toHaveBeenCalledWith("order", "YELLOW");
    act(() => result.current.setValue("ANY"));
    await waitFor(() => expect(result.current.filters).toEqual({ id: "00000000-0000-0000-0000-000000000000" }));
    expect(api.mine).toHaveBeenLastCalledWith("order", null);
  });

  it("süzgeç yalnız `filter[id]` destekleyen listelerde kullanılır (kaynak taraması)", () => {
    const DESTEKLEYEN = new Set(["pages/Operations/Orders/OrdersPage.tsx"]);
    const src = path.resolve(__dirname, "../..");
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const f = path.join(d, n);
        return statSync(f).isDirectory() ? walk(f) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [f] : [];
      });
    const kullanan = walk(path.join(src, "pages"))
      .filter((f) => /\bRowMarkFilter\b/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(src, f).split(path.sep).join("/"));
    expect(kullanan.sort()).toEqual([...DESTEKLEYEN].sort());
  });
});
