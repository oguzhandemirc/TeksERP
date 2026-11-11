// Sütun yeri menü/klavye yolu + "Sütunları sıfırla" (kullanıcı 2026-11-12); kalıcılık useDataTable'da.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { moveColumn, resetColumnLayout } from "./column-arrange";
import { DataTableTools } from "./DataTableTools";

type Row = { id: string; a: string; b: string; c: string };
const COLS: ColumnDef<Row>[] = ["a", "b", "c"].map((k) => ({ id: k, accessorKey: k, header: k.toUpperCase() }));

function useHarness(init: { order?: ColumnOrderState; vis?: VisibilityState; size?: ColumnSizingState } = {}) {
  const [columnOrder, setOrder] = useState<ColumnOrderState>(init.order ?? []);
  const [columnVisibility, setVis] = useState<VisibilityState>(init.vis ?? {});
  const [columnSizing, setSize] = useState<ColumnSizingState>(init.size ?? {});
  return useReactTable<Row>({
    data: [],
    columns: COLS,
    state: { columnOrder, columnVisibility, columnSizing },
    onColumnOrderChange: setOrder,
    onColumnVisibilityChange: setVis,
    onColumnSizingChange: setSize,
    getCoreRowModel: getCoreRowModel(),
  });
}

const ids = (t: ReturnType<typeof useHarness>) => t.getVisibleLeafColumns().map((c) => c.id);

describe("sütun taşıma", () => {
  it("sağa/sola komşuyla yer değiştirir; uçta etkisiz", () => {
    const { result } = renderHook(() => useHarness());
    act(() => moveColumn(result.current, "a", 1));
    expect(ids(result.current)).toEqual(["b", "a", "c"]);
    act(() => moveColumn(result.current, "c", -1));
    expect(ids(result.current)).toEqual(["b", "c", "a"]);
    act(() => moveColumn(result.current, "b", -1));
    expect(ids(result.current)).toEqual(["b", "c", "a"]);
  });

  it("gizli komşuyu atlar; kayıtta olmayan yeni sütun sona eklenir", () => {
    const { result } = renderHook(() => useHarness({ order: ["a", "b"], vis: { b: false } }));
    act(() => moveColumn(result.current, "a", 1));
    expect(result.current.getState().columnOrder).toEqual(["c", "b", "a"]);
  });

  it("sıfırla: sıra, görünürlük ve genişlik boşalır", () => {
    const { result } = renderHook(() => useHarness({ order: ["c", "b", "a"], vis: { b: false }, size: { a: 200 } }));
    act(() => resetColumnLayout(result.current));
    const st = result.current.getState();
    expect([st.columnOrder, st.columnVisibility, st.columnSizing]).toEqual([[], {}, {}]);
  });

  it("Sütunlar menüsünde sola/sağa düğmeleri ve Sütunları sıfırla", async () => {
    function Tools() {
      const t = useHarness({ size: { a: 200 } });
      return (
        <>
          <span data-testid="ids">{ids(t).join(",")}</span>
          <span data-testid="size">{JSON.stringify(t.getState().columnSizing)}</span>
          <DataTableTools table={t} hideExport />
        </>
      );
    }
    const user = userEvent.setup();
    render(<MemoryRouter><Tools /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: /Sütunlar/ }));
    expect(screen.getByRole("button", { name: "A sola taşı" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "A sağa taşı" }));
    expect(screen.getByTestId("ids")).toHaveTextContent("b,a,c");
    await user.click(screen.getByRole("button", { name: /Sütunları sıfırla/ }));
    expect(screen.getByTestId("ids")).toHaveTextContent("a,b,c");
    expect(screen.getByTestId("size")).toHaveTextContent("{}");
  });
});
