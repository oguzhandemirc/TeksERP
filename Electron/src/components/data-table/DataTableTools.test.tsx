// Araç çubuğu: "Sütunlar" yalnız görünürlük; "Dışa aktar ▾" ayrı menü (Excel · ek seçenek · PDF · CSV).
import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { DataTableTools } from "./DataTableTools";

type Row = { id: string; name: string };
const COLS: ColumnDef<Row>[] = [{ id: "name", accessorKey: "name", header: "Ad" }];

function tableOf() {
  return renderHook(() => useReactTable<Row>({ data: [{ id: "1", name: "x" }], columns: COLS, getCoreRowModel: getCoreRowModel() }))
    .result.current;
}

const renderTools = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("DataTableTools", () => {
  it("Sütunlar popover'ında dışa aktarma yok; Dışa aktar menüsü Excel · PDF · CSV", async () => {
    const user = userEvent.setup();
    renderTools(<DataTableTools table={tableOf()} exportName="Liste" />);
    await user.click(screen.getByRole("button", { name: /Sütunlar/ }));
    expect(screen.getByText("Görünür Sütunlar")).toBeInTheDocument();
    expect(screen.queryByText(/Excel/)).toBeNull();
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: /Dışa aktar/ }));
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent?.trim());
    expect(items).toEqual(["Excel", "PDF", "CSV"]);
  });

  it("ekranın ek seçeneği Excel'in hemen altında; seçilince çağrılır", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderTools(
      <DataTableTools
        table={tableOf()}
        extraExports={[{ key: "x", label: "Excel (stok kalemi bazında)…", onSelect }]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Dışa aktar/ }));
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual([
      "Excel",
      "Excel (stok kalemi bazında)…",
      "PDF",
      "CSV",
    ]);
    await user.click(screen.getByRole("menuitem", { name: /stok kalemi/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("hideExport → yalnız Sütunlar (dışa aktar menüsü yok)", () => {
    renderTools(<DataTableTools table={tableOf()} hideExport />);
    expect(screen.getByRole("button", { name: /Sütunlar/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dışa aktar/ })).toBeNull();
  });
});
