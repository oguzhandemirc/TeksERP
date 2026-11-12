// Ortak DataTable — genişleyen satır: aç/kapa düğmesi, klavye (→/←, açılışsız tabloda Enter), sütun gizliyken tam
// genişlik ayrıntı, yeniden çizim/sıralamada açık durumun korunması, denetimli küme, her zaman açık alt satır.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { renderWithProviders } from "@/test/render";
import { DataTable } from "./DataTable";
import { useLocalTable } from "@/hooks/useLocalTable";

vi.mock("@/providers/PreferencesProvider", () => ({
  useOptionalPreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
  usePreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
}));

interface Row { id: string; name: string; note: string }
const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Ad" },
  { accessorKey: "note", header: "Not" },
];
const ROWS: Row[] = [
  { id: "a", name: "Birinci", note: "n1" },
  { id: "b", name: "İkinci", note: "n2" },
];

interface HarnessProps {
  rows?: Row[];
  onOpen?: (r: Row) => void;
  hidden?: string[];
  canExpand?: (r: Row) => boolean;
  controlled?: { ids: Set<string>; onChange: (ids: Set<string>) => void };
  subRow?: (r: Row) => string | null;
}

function Harness({ rows = ROWS, onOpen, hidden, canExpand, controlled, subRow }: HarnessProps) {
  const table = useLocalTable({ tableKey: "test:expand", data: rows, columns: COLUMNS, hiddenColumns: hidden });
  return (
    <DataTable
      table={table}
      onRowClick={onOpen}
      renderExpanded={subRow ? undefined : (r) => <p>Ayrıntı {r.name}</p>}
      canExpand={canExpand}
      expandedIds={controlled?.ids}
      onExpandedChange={controlled?.onChange}
      renderSubRow={subRow}
    />
  );
}

const rowOf = (text: string) => screen.getByText(text).closest("tr")!;
const toggleOf = (text: string) => within(rowOf(text)).getByRole("button", { name: /Ayrıntıyı/ });

describe("DataTable — genişleyen satır", () => {
  it("düğme aç/kapa yapar, aria-expanded taşır; ayrıntı tam genişlik tek hücre", () => {
    renderWithProviders(<Harness onOpen={vi.fn()} />);
    const btn = toggleOf("Birinci");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(toggleOf("Birinci")).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByText("Ayrıntı Birinci").closest("td")!;
    // aç/kapa sütunu + 2 veri sütunu
    expect(detail).toHaveAttribute("colspan", "3");
    fireEvent.click(toggleOf("Birinci"));
    expect(screen.queryByText("Ayrıntı Birinci")).toBeNull();
  });

  it("düğme satır açılışını tetiklemez", () => {
    vi.useFakeTimers();
    try {
      const onOpen = vi.fn();
      renderWithProviders(<Harness onOpen={onOpen} />);
      fireEvent.click(toggleOf("Birinci"));
      act(() => { vi.advanceTimersByTime(300); });
      expect(onOpen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("odaklı satırda → açar, ← kapar; Enter satır açılışına ait kalır", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Harness onOpen={onOpen} />);
    fireEvent.keyDown(rowOf("İkinci"), { key: "ArrowRight" });
    expect(screen.getByText("Ayrıntı İkinci")).toBeInTheDocument();
    fireEvent.keyDown(rowOf("İkinci"), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(ROWS[1], expect.anything());
    fireEvent.keyDown(rowOf("İkinci"), { key: "ArrowLeft" });
    expect(screen.queryByText("Ayrıntı İkinci")).toBeNull();
  });

  it("satır açılışı yoksa satır odaklanır; Enter ve tık ayrıntıyı açıp kapar", async () => {
    renderWithProviders(<Harness />);
    expect(rowOf("Birinci")).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(rowOf("Birinci"), { key: "Enter" });
    expect(screen.getByText("Ayrıntı Birinci")).toBeInTheDocument();
    fireEvent.click(screen.getByText("İkinci"));
    expect(await screen.findByText("Ayrıntı İkinci")).toBeInTheDocument();
  });

});

describe("DataTable — genişleyen satır: durum ve alt satır", () => {
  it("açılamayan satırda düğme yok, → işlemez", () => {
    renderWithProviders(<Harness canExpand={(r) => r.id === "a"} />);
    expect(within(rowOf("İkinci")).queryByRole("button")).toBeNull();
    fireEvent.keyDown(rowOf("İkinci"), { key: "ArrowRight" });
    expect(screen.queryByText("Ayrıntı İkinci")).toBeNull();
  });

  it("sütun gizliyken ayrıntı görünür sütun sayısına yayılır", () => {
    renderWithProviders(<Harness hidden={["note"]} />);
    fireEvent.click(toggleOf("Birinci"));
    expect(screen.getByText("Ayrıntı Birinci").closest("td")).toHaveAttribute("colspan", "2");
  });

  it("veri yeniden sıralanınca/tazelenince açık durum kimlikle korunur", () => {
    const { rerender } = renderWithProviders(<Harness />);
    fireEvent.click(toggleOf("İkinci"));
    rerender(<Harness rows={[{ ...ROWS[1]!, note: "yeni" }, ROWS[0]!]} />);
    expect(screen.getByText("Ayrıntı İkinci")).toBeInTheDocument();
    expect(screen.queryByText("Ayrıntı Birinci")).toBeNull();
    // ayrıntı satırı kendi satırının hemen altında
    expect(rowOf("İkinci").nextElementSibling).toBe(screen.getByText("Ayrıntı İkinci").closest("tr"));
  });

  it("denetimli küme: değişiklik dışarı bildirilir, sayfa kapatabilir", () => {
    const seen: string[][] = [];
    function Controlled() {
      const [ids, setIds] = useState<Set<string>>(new Set(["a"]));
      return (
        <>
          <button type="button" onClick={() => setIds(new Set())}>Hepsini kapat</button>
          <Harness controlled={{ ids, onChange: (n) => { seen.push([...n]); setIds(n); } }} />
        </>
      );
    }
    renderWithProviders(<Controlled />);
    expect(screen.getByText("Ayrıntı Birinci")).toBeInTheDocument();
    fireEvent.click(toggleOf("İkinci"));
    expect(seen.at(-1)?.sort()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByText("Hepsini kapat"));
    expect(screen.queryByText(/Ayrıntı/)).toBeNull();
  });

  it("her zaman açık alt satır: düğmesiz, yalnız döndüğü satırda, tık satırı açar", () => {
    const onOpen = vi.fn();
    renderWithProviders(<Harness onOpen={onOpen} subRow={(r) => (r.id === "b" ? "Neden: kâğıt bitti" : null)} />);
    expect(screen.queryByRole("button", { name: /Ayrıntıyı/ })).toBeNull();
    const sub = screen.getByText("Neden: kâğıt bitti").closest("tr")!;
    expect(rowOf("İkinci").nextElementSibling).toBe(sub);
    expect(screen.getByText("Neden: kâğıt bitti").closest("td")).toHaveAttribute("colspan", "2");
    fireEvent.click(sub);
    expect(onOpen).toHaveBeenCalledWith(ROWS[1]);
  });
});
