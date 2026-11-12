import { describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { NumberingTable } from "./NumberingTable";
import type { NumberSeriesRow } from "./types";

// DataTable araç çubuğu (kayıtlı görünümler) yönlendirici bağlamı ister.
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const row = {
  key: "packingLotCode",
  label: "Paket lot kodu",
  prefix: "PL",
  dateSegment: "YYMM",
  digits: 5,
  editable: true,
  panelGroup: "sevk",
  panelGroupLabel: "Sevk",
  counter: { startValue: true, step: true, maxValue: true, reset: false, resetReason: "" },
  preview: "PL261100001",
  exhaustion: { warn: true, used: 95000, limit: 99999 },
} as unknown as NumberSeriesRow;

describe("Numaralandırma tablosu — ortak DataTable", () => {
  it("sütunlar çizilir, sayı binlik ayırıcısız, Düzenle diyaloğu açan geri çağrıyı tetikler", () => {
    const onEdit = vi.fn();
    const { container } = render(<NumberingTable title="Sevk" rows={[row]} onEdit={onEdit} />);
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const h of ["Seri", "Ön ek", "Tarih", "Hane", "Örnek"]) expect(heads.some((t) => t.includes(h))).toBe(true);
    expect(screen.getByText("Paket lot kodu")).toBeInTheDocument();
    expect(screen.getByText("95000/99999 — sınıra yaklaşıldı")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sütunlar/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Düzenle" }));
    expect(onEdit).toHaveBeenCalledWith(row);
  });
});
