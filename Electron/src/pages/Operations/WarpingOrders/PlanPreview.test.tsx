// Kilitli (sevk başlamış) siparişin plan görünümü fire kaynağını açık görünümle aynı biçimde basar (B6 pürüzü).
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PlanPreview } from "./PlanPreview";
import type { useWarpingPreview } from "./service";
import type { WarpingOrder } from "./types";

vi.mock("./useOrderWasteSource", () => ({
  useOrderWasteSource: () => (y: { yarnItemId: string; wastePct: string }) => (Number(y.wastePct) > 0 ? (y.yarnItemId === "a" ? "iplik kartı" : "çözgü kartı") : null),
}));

const yarn = (id: string, name: string, wastePct: string) => ({
  yarnItemId: id, code: id.toUpperCase(), name, sourceWarpSpecId: "s", endsCount: 3000, denier: "150", wastePct, netKg: "50.000", grossKg: "51.546", letter: id.toUpperCase(),
});
const order = {
  hasWaste: true,
  yarns: [yarn("a", "PES 150", "4.00"), yarn("b", "PES 75", "3.00")],
  totals: { endsCount: 6000, netKg: "100.000", grossKg: "103.092" },
} as unknown as WarpingOrder;
const pq = { data: undefined, isFetching: false, isError: false, error: null } as unknown as ReturnType<typeof useWarpingPreview>;

describe("PlanPreview — kilitli plan", () => {
  it("⭐ fire hücresinde kaynak etiketi görünür (iplik kartı / çözgü kartı)", () => {
    render(<PlanPreview order={order} planLocked pq={pq} hasBody fresh />);
    const rows = within(screen.getByRole("table", { name: "İplik planı" })).getAllByRole("row");
    expect(rows[1]!.textContent).toContain("%4iplik kartı");
    expect(rows[2]!.textContent).toContain("%3çözgü kartı");
  });
});
