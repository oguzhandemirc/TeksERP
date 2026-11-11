// Ortak tablo düzeni (kullanıcı 2026-11-12): hücre TEK SATIR + taşana ipucu, elle sütun genişliği
// (sürükle / çift tık sığdır), genişlik `<table>` değişkeninden okunur, sayısal sütun hizalı rakam.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { getCoreRowModel, useReactTable, type ColumnDef, type ColumnSizingState } from "@tanstack/react-table";
import { renderWithProviders } from "@/test/render";
import { DataTable } from "./DataTable";
import { MIN_COL_WIDTH, fixedWidth, widthVar } from "./column-layout";
import { roundSizing, withTableEntry } from "@/hooks/useDataTable";

// jsdom PointerEvent'i yok → fireEvent clientX taşımaz; MouseEvent tabanlı en küçük ikame.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}

interface Row { id: string; name: string; qty: number }
const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Ad" },
  { accessorKey: "qty", header: "Metre", meta: { align: "right" } },
];
const ROWS: Row[] = [{ id: "1", name: "ÖRNEK PERDE TOPTAN LTD. ŞTİ. (İSTANBUL)", qty: 1500 }];

let lastSizing: ColumnSizingState = {};
function Harness({ initial = {} }: { initial?: ColumnSizingState }) {
  const [columnSizing, setSizing] = useState<ColumnSizingState>(initial);
  lastSizing = columnSizing;
  const table = useReactTable({
    data: ROWS,
    columns: COLUMNS,
    state: { columnSizing },
    onColumnSizingChange: setSizing,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });
  return <DataTable table={table} />;
}

const clipOf = (text: string) => screen.getByText(text).closest<HTMLElement>("[data-cell-clip]")!;

describe("DataTable — tek satır hücre", () => {
  it("her gövde hücresi kesen kutuda (truncate); sayısal sütun sağa + tabular-nums", () => {
    renderWithProviders(<Harness />);
    const clip = clipOf(ROWS[0].name);
    expect(clip).toHaveClass("truncate");
    expect(clip.dataset.cellClip).toBe("name");
    expect(clip.style.maxWidth).toContain(`var(${widthVar("name")}`);
    expect(clipOf("1500").closest("td")).toHaveClass("text-right", "tabular-nums");
  });

  it("taşan kutuya üzerine gelince tam metin title olur; taşma bitince kalkar", () => {
    renderWithProviders(<Harness />);
    const clip = clipOf(ROWS[0].name);
    Object.defineProperty(clip, "scrollWidth", { configurable: true, value: 400 });
    Object.defineProperty(clip, "clientWidth", { configurable: true, value: 120 });
    Object.defineProperty(clip, "innerText", { configurable: true, value: ROWS[0].name });
    fireEvent.mouseOver(clip);
    expect(clip.title).toBe(ROWS[0].name);
    Object.defineProperty(clip, "scrollWidth", { configurable: true, value: 100 });
    fireEvent.mouseOver(clip);
    expect(clip.hasAttribute("title")).toBe(false);
  });
});

describe("DataTable — elle sütun genişliği", () => {
  it("kayıtlı genişlik <table> değişkenine yazılır (geri yükleme)", () => {
    renderWithProviders(<Harness initial={{ name: 210 }} />);
    const table = screen.getByRole("table");
    expect(table.style.getPropertyValue(widthVar("name"))).toBe("calc(210px - 1.5rem)");
    expect(table.style.getPropertyValue(widthVar("qty"))).toBe("");
  });

  it("tutamaç sürüklenince bırakışta columnSizing'e işlenir; en dar sınır uygulanır", () => {
    renderWithProviders(<Harness />);
    const handle = screen.getByRole("separator", { name: "Ad sütun genişliği" });
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 });
    // Sürükleme sırasında yalnız değişken (satır çizimi yok).
    expect(screen.getByRole("table").style.getPropertyValue(widthVar("name"))).toBe("calc(160px - 1.5rem)");
    fireEvent.pointerUp(handle, { clientX: 260, pointerId: 1 });
    expect(lastSizing).toEqual({ name: 160 });

    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 0, pointerId: 1 });
    expect(lastSizing.name).toBe(MIN_COL_WIDTH);
  });

  it("çift tık içeriğe sığdırır (en geniş kutu + dolgu)", () => {
    renderWithProviders(<Harness initial={{ name: 60 }} />);
    for (const el of document.querySelectorAll<HTMLElement>('[data-cell-clip="name"]')) {
      Object.defineProperty(el, "scrollWidth", { configurable: true, value: 300 });
    }
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Ad sütun genişliği" }));
    expect(lastSizing.name).toBeGreaterThan(300);
  });

  it("tanımdaki size sabit genişliktir; TanStack varsayılanı (150) değildir", () => {
    const col = (size?: number) => ({ id: "x", columnDef: { size } }) as never;
    expect(fixedWidth(col(150), {})).toBeUndefined();
    expect(fixedWidth(col(90), {})).toBe(90);
    expect(fixedWidth(col(90), { x: 20 })).toBe(MIN_COL_WIDTH);
  });
});

describe("tablo tercihi yazımı", () => {
  it("genişlik yuvarlanır, boş kalırsa anahtar düşer (Sütunları sıfırla)", () => {
    expect(roundSizing({ a: 120.6, b: 0 })).toEqual({ a: 121 });
    expect(roundSizing({})).toBeNull();
    expect(withTableEntry({ t1: { a: 1 }, t2: { b: 2 } }, "t1", null)).toEqual({ t2: { b: 2 } });
    expect(withTableEntry(undefined, "t1", { a: 1 })).toEqual({ t1: { a: 1 } });
  });
});
