// Ortak DataTable — denetimli seçim (`useLocalTable` selectedIds/onSelectedChange), tümünü seç, sayfanın sıfırlaması,
// iç seçimle geriye uyum, seçim kutusu adı, seçim çubuğunu gizleme ve sütuna özel çok satırlı hücre (`meta.wrap`).
import { useState } from "react";
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

interface Row { id: string; name: string; body: string }
const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Ad" },
  { accessorKey: "body", header: "Gövde", meta: { wrap: true } },
];
const ROWS: Row[] = [
  { id: "a", name: "Birinci", body: "uzun gövde metni" },
  { id: "b", name: "İkinci", body: "ikinci gövde" },
];

function Controlled({ onChange, bar = true }: { onChange?: (ids: string[]) => void; bar?: boolean }) {
  const [ids, setIds] = useState<Set<string>>(new Set(["b"]));
  const table = useLocalTable({
    tableKey: "test:secim",
    data: ROWS,
    columns: COLUMNS,
    enableSelection: true,
    selectedIds: ids,
    onSelectedChange: (n) => { onChange?.([...n].sort()); setIds(n); },
  });
  return (
    <>
      <span data-testid="count">{ids.size}</span>
      <button type="button" onClick={() => setIds(new Set())}>Süzgeç değişti</button>
      <DataTable table={table} selectionLabel={(r) => `Seç: ${r.name}`} showSelectionBar={bar} />
    </>
  );
}

function Uncontrolled() {
  const table = useLocalTable({ tableKey: "test:secim-ic", data: ROWS, columns: COLUMNS, enableSelection: true });
  return <DataTable table={table} />;
}

const box = (name: string) => screen.getByRole("checkbox", { name });

describe("DataTable — denetimli seçim", () => {
  it("seçim sayfanın kümesinden çizilir; kutu değişikliği dışarı bildirilir", () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled onChange={onChange} />);
    expect(box("Seç: İkinci")).toHaveAttribute("data-state", "checked");
    expect(box("Seç: Birinci")).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(box("Seç: Birinci"));
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("tümünü seç / bırak sayfa kümesini yazar", () => {
    const onChange = vi.fn();
    renderWithProviders(<Controlled onChange={onChange} />);
    fireEvent.click(box("Tümünü seç"));
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    fireEvent.click(box("Tümünü seç"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("sayfa kümeyi sıfırlayınca kutular boşalır", () => {
    renderWithProviders(<Controlled />);
    fireEvent.click(screen.getByText("Süzgeç değişti"));
    expect(box("Seç: İkinci")).toHaveAttribute("data-state", "unchecked");
  });

  it("seçim çubuğu gizlenebilir; varsayılan görünür", () => {
    const { unmount } = renderWithProviders(<Controlled bar={false} />);
    expect(screen.queryByText("Seçimi temizle")).toBeNull();
    unmount();
    renderWithProviders(<Controlled />);
    expect(screen.getByText("1 seçili")).toBeInTheDocument();
  });

  it("iç seçim (denetimsiz) aynen çalışır; kutu adı varsayılan 'Seç'", () => {
    renderWithProviders(<Uncontrolled />);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Seç" })[0]!);
    expect(screen.getByText("1 seçili")).toBeInTheDocument();
  });

  it("meta.wrap sütunu çok satıra sarılır; diğerleri tek satır", () => {
    renderWithProviders(<Uncontrolled />);
    expect(screen.getByText("uzun gövde metni").closest("[data-cell-clip]")).toHaveClass("whitespace-normal");
    expect(screen.getByText("Birinci").closest("[data-cell-clip]")).toHaveClass("truncate");
  });
});
