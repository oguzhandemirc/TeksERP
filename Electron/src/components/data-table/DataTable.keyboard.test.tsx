// Ortak DataTable — klavyeyle satır açma (Tab ile odaklanan satırda Enter/Space → onRowClick) ve satır ipucu (`rowTitle`).
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { renderWithProviders } from "@/test/render";
import { DataTable } from "./DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";

vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
  usePreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
}));

interface Row { id: string; name: string }
const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Ad" },
  { id: "act", header: "", cell: () => <button type="button">Eylem</button> },
];
const ROWS: Row[] = [{ id: "a", name: "Birinci" }, { id: "b", name: "İkinci" }];

function Harness({ onOpen, title }: { onOpen?: (r: Row) => void; title?: (r: Row) => string }) {
  const table = useLocalTable({ tableKey: "test:klavye", data: ROWS, columns: COLUMNS });
  return <DataTable table={table} onRowClick={onOpen} rowTitle={title} />;
}

const rowOf = (text: string) => screen.getByText(text).closest("tr")!;

describe("DataTable — klavyeyle satır açma", () => {
  it("tıklanabilir satır odaklanabilir; Enter ve Space satırı hemen açar", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Harness onOpen={onOpen} />);
    const row = rowOf("İkinci");
    expect(row).toHaveAttribute("tabindex", "0");
    expect(fireEvent.keyDown(row, { key: "Enter" })).toBe(false);
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1], expect.objectContaining({ button: 0, ctrlKey: false }));
    fireEvent.keyDown(rowOf("Birinci"), { key: " " });
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], expect.anything());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("Ctrl+Enter değiştiriciyi taşır; hücre içi düğmede Enter satırı açmaz; başka tuş açmaz", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Harness onOpen={onOpen} />);
    fireEvent.keyDown(rowOf("Birinci"), { key: "Enter", ctrlKey: true });
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], expect.objectContaining({ ctrlKey: true }));
    fireEvent.keyDown(screen.getAllByText("Eylem")[0]!, { key: "Enter" });
    fireEvent.keyDown(rowOf("Birinci"), { key: "a" });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("onRowClick yoksa satır sekme sırasına girmez", () => {
    renderWithProviders(<Harness />);
    expect(rowOf("Birinci")).not.toHaveAttribute("tabindex");
  });

  it("rowTitle satır ipucunu yazar", () => {
    renderWithProviders(<Harness onOpen={vi.fn()} title={(r) => `${r.name} aç`} />);
    expect(rowOf("İkinci")).toHaveAttribute("title", "İkinci aç");
  });
});
