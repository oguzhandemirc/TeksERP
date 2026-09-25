import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const listPickableRolls = vi.fn();
vi.mock("./pickable-rolls", () => ({ listPickableRolls: (...a: unknown[]) => listPickableRolls(...a) }));

import { RollPickerDialog, type RollPickerScope } from "./RollPickerDialog";

const SCOPES: RollPickerScope[] = [
  { key: "raw", label: "Ham Stok", filters: { "filter[rollScope]": "RAW_STOCK" } },
  { key: "fin", label: "Bitmiş Depo", filters: { "filter[status]": "WAREHOUSE" } },
];
const R1 = { id: "r1", barcode: "B-1", itemName: "PATOS", colorName: null, qty: 100, warehouseId: null, status: "STOCK" };
const R2 = { id: "r2", barcode: "B-2", itemName: "POLAR", colorName: null, qty: 40, warehouseId: null, status: "STOCK" };

describe("RollPickerDialog", () => {
  beforeEach(() => listPickableRolls.mockReset().mockResolvedValue([R1, R2]));

  it("ilk kapsamla tam liste açılır, dışlanan top görünmez; arama süzgeçle birlikte gider; seçilenler verilir", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderWithProviders(<RollPickerDialog open onOpenChange={onOpenChange} title="Top Seç" scopes={SCOPES} excludeIds={["r2"]} onConfirm={onConfirm} />);
    expect(await screen.findByText("PATOS")).toBeTruthy();
    expect(screen.queryByText("POLAR")).toBeNull();
    expect(listPickableRolls).toHaveBeenCalledWith({ "filter[rollScope]": "RAW_STOCK" }, { search: undefined });
    await userEvent.type(screen.getByPlaceholderText("Barkod / kumaş / renk ara..."), "B-1");
    await waitFor(() => expect(listPickableRolls).toHaveBeenLastCalledWith({ "filter[rollScope]": "RAW_STOCK" }, { search: "B-1" }));
    await userEvent.click(await screen.findByText("PATOS"));
    await userEvent.click(screen.getByRole("button", { name: "Ekle (1)" }));
    expect(onConfirm).toHaveBeenCalledWith([R1]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
