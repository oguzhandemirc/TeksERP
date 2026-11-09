// Gelen belge listesi "İş emri" sütunu: sunucunun `workOrders`ı çip olarak (ilk 2 + "+N"), bağ yoksa "—";
// çip İE detayını açar ve satır tıkına kabarmaz; "Kaynak" sütunu listede yok.
// Negatif sonda: `NOTE_WO_PREVIEW` kesimi kaldırılınca §3, `stopPropagation` kaldırılınca §4 kırmızı.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NOTE_COLUMNS } from "../noteColumns";
import type { DeliveryNoteHeader, NoteWorkOrderRef } from "../types";

const openTarget = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useOpenTarget: () => openTarget }));

const col = NOTE_COLUMNS.find((c) => c.id === "workOrders")!;
const Cell = col.cell as (ctx: { row: { original: DeliveryNoteHeader } }) => React.ReactNode;
const wo = (n: number): NoteWorkOrderRef => ({ id: `w${n}`, workOrderNumber: `IE-00${n}` });
const draw = (workOrders: NoteWorkOrderRef[] | undefined) => render(<>{Cell({ row: { original: { id: "n1", workOrders } as DeliveryNoteHeader } })}</>);

describe("gelen belge listesi — İş emri sütunu", () => {
  it("§1 sütun var, Kaynak sütunu listede yok; başlık rejim adından", () => {
    expect(NOTE_COLUMNS.some((c) => c.id === "sourceKind")).toBe(false);
    expect(typeof col.header === "function" && (col.header as () => string)()).toMatch(/İş Emri|İş emri/i);
    expect(col.meta?.label).toMatch(/İş Emri|İş emri/i);
  });

  it("§2 bağ yoksa (boş dizi ya da eski sunucu undefined) —", () => {
    const { unmount } = draw([]);
    expect(screen.getByTestId("note-wo-none").textContent).toBe("—");
    unmount();
    draw(undefined);
    expect(screen.getByTestId("note-wo-none").textContent).toBe("—");
    expect(screen.queryByTestId("note-wo-chip")).toBeNull();
  });

  it("§3 iki İE iki çip; dört İE ilk 2 + '+2' (taşanlar title'da)", () => {
    const { unmount } = draw([wo(1), wo(2)]);
    expect(screen.getAllByTestId("note-wo-chip").map((b) => b.textContent)).toEqual(["IE-001", "IE-002"]);
    expect(screen.queryByTestId("note-wo-more")).toBeNull();
    unmount();
    draw([wo(1), wo(2), wo(3), wo(4)]);
    expect(screen.getAllByTestId("note-wo-chip").map((b) => b.textContent)).toEqual(["IE-001", "IE-002"]);
    const more = screen.getByTestId("note-wo-more");
    expect(more.textContent).toBe("+2");
    expect(more.getAttribute("title")).toBe("IE-003, IE-004");
  });

  it("§4 çip İE detayını açar, satır tıkına kabarmaz", () => {
    openTarget.mockClear();
    const onRow = vi.fn();
    render(<div onClick={onRow}>{Cell({ row: { original: { id: "n1", workOrders: [wo(7)] } as DeliveryNoteHeader } })}</div>);
    fireEvent.click(screen.getByTestId("note-wo-chip"));
    expect(openTarget).toHaveBeenCalledWith("/operations/work-orders/w7", expect.anything());
    expect(onRow).not.toHaveBeenCalled();
  });

  it("§5 dışa aktarım/erişilebilirlik değeri İE no'larının birleşimi", () => {
    const fn = (col as { accessorFn: (r: DeliveryNoteHeader, i: number) => unknown }).accessorFn;
    expect(fn({ workOrders: [wo(1), wo(2)] } as DeliveryNoteHeader, 0)).toBe("IE-001, IE-002");
    expect(fn({} as DeliveryNoteHeader, 0)).toBe("");
  });
});
