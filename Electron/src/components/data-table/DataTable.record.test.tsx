// Ortak DataTable — kayıt satırı (etkin satır vurgusu + ↑/↓), sayfanın kendi sonsuz kaydırması ve `useLocalTable`
// tercih kaydı (sütun gizleme kullanıcıya yazılır; yan panelin geçici gizlemesi yazılmaz).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { renderWithProviders } from "@/test/render";
import { DataTable } from "./DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";

const setPreference = vi.fn();
let prefs: Record<string, unknown> = {};
vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => ({ prefs, setPreference }),
  usePreferences: () => ({ prefs, setPreference }),
}));

interface Row { id: string; name: string; city: string }
const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Ad" },
  { accessorKey: "city", header: "Şehir" },
];
const ROWS: Row[] = [
  { id: "a", name: "Birinci", city: "İstanbul" },
  { id: "b", name: "İkinci", city: "Bursa" },
  { id: "c", name: "Üçüncü", city: "İzmir" },
];

function Harness({ hidden, initial = null }: { hidden?: string[]; initial?: string | null }) {
  const [active, setActive] = useState<string | null>(initial);
  const table = useLocalTable({ tableKey: "test:kayit", data: ROWS, columns: COLUMNS, hiddenColumns: hidden });
  return <DataTable table={table} activeRowId={active} onRowClick={(r) => setActive(r.id)} />;
}

const rowOf = (text: string) => screen.getByText(text).closest("tr")!;
const scroller = () => document.querySelector<HTMLElement>("[data-list-surface='table'] > div")!;

beforeEach(() => {
  prefs = {};
  setPreference.mockReset();
});

describe("DataTable — kayıt satırı", () => {
  it("etkin satır aria-selected + vurgu; satırlar dışarı-tık ölçeri için data-record-row taşır", () => {
    renderWithProviders(<Harness initial="b" />);
    expect(rowOf("İkinci")).toHaveAttribute("aria-selected", "true");
    expect(rowOf("İkinci")).toHaveClass("bg-primary-soft");
    expect(rowOf("Birinci")).toHaveAttribute("aria-selected", "false");
    expect(rowOf("Birinci")).toHaveAttribute("data-record-row");
  });

  it("↑/↓ komşu satırı hemen açar; kenarda tuş yutulur ama satır değişmez", () => {
    renderWithProviders(<Harness initial="a" />);
    const ev = fireEvent.keyDown(scroller(), { key: "ArrowDown" });
    expect(ev).toBe(false); // preventDefault → yan panel ikinci kez kaydırmaz
    expect(rowOf("İkinci")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(scroller(), { key: "ArrowUp" });
    fireEvent.keyDown(scroller(), { key: "ArrowUp" });
    expect(rowOf("Birinci")).toHaveAttribute("aria-selected", "true");
  });

  it("satır tıklaması değiştirici tuşları açılışa taşır (Ctrl/⌘ → yeni sekme kararı sayfada)", () => {
    vi.useFakeTimers();
    try {
      const onRowClick = vi.fn();
      function Clicky() {
        const table = useLocalTable({ tableKey: "test:tik", data: ROWS, columns: COLUMNS });
        return <DataTable table={table} onRowClick={onRowClick} />;
      }
      renderWithProviders(<Clicky />);
      fireEvent.click(rowOf("İkinci"), { ctrlKey: true });
      expect(onRowClick).not.toHaveBeenCalled(); // tek/çift tık ayrımı için kısa gecikme
      act(() => {
        vi.runAllTimers();
      });
      expect(onRowClick).toHaveBeenCalledWith(ROWS[1], { button: 0, shiftKey: false, ctrlKey: true, metaKey: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("activeRowId verilmezse satır kayıt satırı değildir, ↑/↓ dinlenmez", () => {
    function Plain() {
      const table = useLocalTable({ tableKey: "test:duz", data: ROWS, columns: COLUMNS });
      return <DataTable table={table} />;
    }
    renderWithProviders(<Plain />);
    expect(rowOf("Birinci")).not.toHaveAttribute("data-record-row");
    expect(fireEvent.keyDown(scroller(), { key: "ArrowDown" })).toBe(true);
  });
});

describe("useLocalTable — tercih kaydı", () => {
  it("kayıtlı görünürlük okunur; geçici gizleme (hiddenColumns) sütunu düşürür ama tercihe yazılmaz", () => {
    prefs = { tableVisibility: { "test:kayit": { name: true } } };
    renderWithProviders(<Harness hidden={["city"]} />);
    expect(screen.queryByText("Şehir")).toBeNull();
    expect(screen.getByText("Ad")).toBeInTheDocument();
    expect(setPreference).not.toHaveBeenCalled();
  });

  it("sütun genişliği değişince tablo anahtarı altında yuvarlanmış px yazılır", () => {
    let api: ReturnType<typeof useLocalTable<Row>> | null = null;
    function Probe() {
      api = useLocalTable({ tableKey: "test:genislik", data: ROWS, columns: COLUMNS });
      return null;
    }
    renderWithProviders(<Probe />);
    act(() => api!.setColumnSizing({ name: 180.4 }));
    expect(setPreference).toHaveBeenCalledWith({ tableSizing: { "test:genislik": { name: 180 } } });
  });
});

describe("DataTable — sayfanın kendi sonsuz kaydırması", () => {
  it("loadMore verilince dip gözcüsü çizilir, sayfa boyu seçicili altlık çizilmez", () => {
    function More() {
      const table = useLocalTable({ tableKey: "test:more", data: ROWS, columns: COLUMNS });
      return <DataTable table={table} loadMore={{ hasMore: true, isFetchingMore: false, onLoadMore: () => {} }} />;
    }
    renderWithProviders(<More />);
    expect(scroller().querySelector("[aria-hidden].h-px")).not.toBeNull();
    expect(document.querySelector("[data-list-footer]")).toBeNull();
  });
});
