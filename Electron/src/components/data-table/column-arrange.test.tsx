// Sütun yeri menü/klavye yolu + "Sütunları sıfırla" (kullanıcı 2026-11-12); kalıcılık useDataTable'da.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { closestCenter, type ClientRect, type CollisionDetection, type DroppableContainer } from "@dnd-kit/core";
import { columnCollision, moveColumn, reorderColumns, resetColumnLayout } from "./column-arrange";
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

// Kullanıcı 2026-11-12: "Renk" sütunu "Kumaş"ın önüne bırakılınca "Müşteri"nin önüne düşüyordu.
describe("sütun sürükle-bırak — hedef ve sıra", () => {
  // Sipariş listesindeki gerçek başlık genişlikleri (1440 px ölçümü).
  const HEADS: Array<[string, number, number]> = [["no", 280, 398], ["customer", 398, 695], ["item", 695, 999], ["color", 999, 1051]];
  const rect = (l: number, r: number): ClientRect => ({ left: l, right: r, width: r - l, top: 0, bottom: 40, height: 40 });
  const rects = new Map(HEADS.map(([id, l, r]) => [id, rect(l, r)]));
  const containers = HEADS.map(([id]) => ({ id }) as unknown as DroppableContainer);
  /** `activeId` başlığını sol kenarından `grab` px içeriden tutup imleci `x`e getir; çarpışma algoritmasının seçtiği hedef. */
  const dropTarget = (detect: CollisionDetection, activeId: string, grab: number, x: number) => {
    const src = rects.get(activeId)!;
    const left = x - grab;
    const args = {
      active: { id: activeId, data: { current: undefined }, rect: { current: { initial: src, translated: null } } },
      collisionRect: rect(left, left + src.width),
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: { x, y: 20 },
    } as unknown as Parameters<CollisionDetection>[0];
    return detect(args)[0]?.id;
  };
  const ORDER = HEADS.map(([id]) => id);

  it("sola: dar sütun sağ ucundan tutulup geniş komşunun sol kenarına bırakılınca hedef o komşu", () => {
    // Eski yol (kutu ortası) bir yan öteyi seçiyordu — hatanın kendisi.
    expect(dropTarget(closestCenter, "color", 45, 705)).toBe("customer");
    expect(dropTarget(columnCollision, "color", 45, 705)).toBe("item");
    expect(reorderColumns(ORDER, "color", "item")).toEqual(["no", "customer", "color", "item"]);
  });

  it("sağa: hedefin arkasına geçer", () => {
    expect(dropTarget(columnCollision, "customer", 10, 1040)).toBe("color");
    expect(reorderColumns(ORDER, "customer", "color")).toEqual(["no", "item", "color", "customer"]);
    expect(reorderColumns(ORDER, "no", "customer")).toEqual(["customer", "no", "item", "color"]);
  });

  it("ilk/son konum: imleç başlık dışında (seçim kutusu / sağ boşluk) → en yakın uç sütun", () => {
    expect(dropTarget(columnCollision, "item", 5, 262)).toBe("no");
    expect(reorderColumns(ORDER, "item", "no")).toEqual(["item", "no", "customer", "color"]);
    expect(dropTarget(columnCollision, "customer", 5, 1300)).toBe("color");
    expect(reorderColumns(ORDER, "customer", "color")).toEqual(["no", "item", "color", "customer"]);
  });

  it("gizli sütun varken görünür sıra bırakılan yere uyar, gizli sütun kaybolmaz", () => {
    const full = ["no", "customer", "hidden", "item", "color"];
    const visible = (o: string[] | null) => o!.filter((id) => id !== "hidden");
    const left = reorderColumns(full, "color", "item");
    expect(visible(left)).toEqual(["no", "customer", "color", "item"]);
    expect(left).toContain("hidden");
    expect(visible(reorderColumns(full, "customer", "item"))).toEqual(["no", "item", "customer", "color"]);
    expect(reorderColumns(full, "item", "item")).toBeNull();
    expect(reorderColumns(full, "item", "yok")).toBeNull();
  });

  it("ortak tablo bu hedef algoritmasını kullanır", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/data-table/DataTable.tsx"), "utf8");
    expect(src).toContain("collisionDetection={columnCollision}");
    expect(src).not.toContain("closestCenter");
  });

  it("tabloda: bırakma yolu kayıtlı sırayı yazar (gizli sütun + kayıtlı sıra)", () => {
    const { result } = renderHook(() => useHarness({ order: ["c", "a", "b"], vis: { a: false } }));
    const next = reorderColumns(["c", "a", "b"], "b", "c");
    act(() => result.current.setColumnOrder(next!));
    expect(result.current.getVisibleLeafColumns().map((c) => c.id)).toEqual(["b", "c"]);
    expect(result.current.getState().columnOrder).toEqual(["b", "c", "a"]);
  });
});
