// Karakterizasyon (2026-09-26): "Listeden Seç" davranışı top seçici ortak bileşene taşınmadan ÖNCE
// ölçüldü; taşımadan sonra aynı testler aynı sonucu vermeli (props ve onConfirm şekli değişmez).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const listWarehouseRolls = vi.fn();
const listWarehouseSacks = vi.fn();
vi.mock("./service", () => ({
  listWarehouseRolls: (...a: unknown[]) => listWarehouseRolls(...a),
  listWarehouseSacks: (...a: unknown[]) => listWarehouseSacks(...a),
}));

import { TransferPickerDialog } from "./TransferPickerDialog";

const R1 = { id: "r1", barcode: "B-1", itemName: "PATOS", colorName: "Mavi", qty: 100, warehouseId: "w1", status: "WAREHOUSE" };
const R2 = { id: "r2", barcode: null, itemName: "POLAR", colorName: null, qty: 40, warehouseId: "w1", status: "WAREHOUSE" };
const R3 = { id: "r3", barcode: "B-3", itemName: "SUET", colorName: null, qty: 10, warehouseId: "w1", status: "WAREHOUSE" };
const S1 = { id: "s1", sackNo: "C-7", customerName: "Müşteri A", rollCount: 3, totalQty: 240 };

function render(over: Partial<React.ComponentProps<typeof TransferPickerDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <TransferPickerDialog open onOpenChange={onOpenChange} warehouseId="w1" alreadyRollIds={["r3"]} alreadySackIds={[]} onConfirm={onConfirm} {...over} />,
  );
  return { onConfirm, onOpenChange };
}

describe("TransferPickerDialog — davranış karakterizasyonu", () => {
  beforeEach(() => {
    listWarehouseRolls.mockReset().mockResolvedValue([R1, R2, R3]);
    listWarehouseSacks.mockReset().mockResolvedValue([S1]);
  });

  it("toplar listelenir; formda zaten olan top gösterilmez; barkodsuz top '—' ile görünür", async () => {
    render();
    expect(await screen.findByText("PATOS · Mavi")).toBeTruthy();
    expect(screen.getByText("POLAR")).toBeTruthy();
    expect(screen.queryByText("SUET")).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Toplar (2)")).toBeTruthy();
    expect(listWarehouseRolls).toHaveBeenCalledWith({ warehouseId: "w1", search: undefined });
  });

  it("arama sunucuya gider (depo + arama metni)", async () => {
    render();
    await screen.findByText("PATOS · Mavi");
    await userEvent.type(screen.getByPlaceholderText("Kumaş / renk / kod ara..."), "pat");
    await waitFor(() => expect(listWarehouseRolls).toHaveBeenLastCalledWith({ warehouseId: "w1", search: "pat" }));
    expect(listWarehouseSacks).toHaveBeenLastCalledWith({ warehouseId: "w1", search: "pat" });
  });

  it("sekme değişince seçim kalır; Ekle seçilen top ve çuvalı tam nesne olarak verir ve diyaloğu kapatır", async () => {
    const { onConfirm, onOpenChange } = render();
    await screen.findByText("PATOS · Mavi");
    expect((screen.getByRole("button", { name: "Ekle (0)" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByText("PATOS · Mavi"));
    await userEvent.click(screen.getByRole("tab", { name: /Çuvallar/ }));
    await userEvent.click(await screen.findByText("C-7"));
    await userEvent.click(screen.getByRole("tab", { name: /Toplar/ }));
    expect(screen.getAllByRole("checkbox")[0]?.getAttribute("data-state")).toBe("checked");
    await userEvent.click(screen.getByRole("button", { name: "Ekle (2)" }));
    expect(onConfirm).toHaveBeenCalledWith({ rolls: [R1], sacks: [S1] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("boş depoda açıklayıcı metin", async () => {
    listWarehouseRolls.mockResolvedValue([]);
    render();
    expect(await screen.findByText("Bu depoda transfer edilebilir top bulunamadı.")).toBeTruthy();
  });
});
