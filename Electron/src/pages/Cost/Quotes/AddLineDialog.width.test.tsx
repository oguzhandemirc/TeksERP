// Teklif "Kalem ekle" — en ön-dolumu (D4 aşama a): ürün seçilince kartın mamul eni boş En alanına gelir, gövdeye
// girer; elle yazılmış en sonraki seçimde ezilmez.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

const addLine = vi.fn(async () => ({ success: true, data: {} }));
vi.mock("./service", () => ({ quoteService: { addLine: (...a: unknown[]) => addLine(...(a as [])) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => null }));
vi.mock("@/components/forms/ItemPickerModal", () => ({
  ItemPickerModal: ({ onPick }: { onPick: (r: { id: string; code: string; name: string; widthCm?: string | null }) => void }) => (
    <>
      <button type="button" onClick={() => onPick({ id: "i-1", code: "K1", name: "Kristal", widthCm: "280.00" })}>sec-280</button>
      <button type="button" onClick={() => onPick({ id: "i-2", code: "K2", name: "Kristal 2", widthCm: "320.00" })}>sec-320</button>
    </>
  ),
}));
vi.mock("./QuoteVariantPicker", () => ({ variantText: (r: { name: string }) => r.name, QuoteVariantPicker: () => null }));
import { AddLineDialog } from "./AddLineDialog";

const widthBox = () => screen.getByLabelText("En (cm)") as HTMLInputElement;

describe("AddLineDialog — en ön-dolumu", () => {
  beforeEach(() => addLine.mockClear());

  it("⭐ ürün seçilince en dolar, yeni seçim ön-dolu eni yeniler ve gövdeye girer", async () => {
    renderWithProviders(<AddLineDialog quoteId="q1" customerId="c1" currency="USD" open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "sec-280" }));
    expect(widthBox().value).toBe("280");
    fireEvent.click(screen.getByRole("button", { name: "sec-320" }));
    expect(widthBox().value).toBe("320");
    fireEvent.change(screen.getByLabelText("Miktar (m) *"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("line-add"));
    await waitFor(() => expect(addLine).toHaveBeenCalledTimes(1));
    expect(addLine).toHaveBeenCalledWith("q1", expect.objectContaining({ itemId: "i-2", width: "320" }));
  });

  it("⭐ elle yazılmış en sonraki seçimde ezilmez", () => {
    renderWithProviders(<AddLineDialog quoteId="q1" customerId="c1" currency="USD" open onOpenChange={() => {}} />);
    fireEvent.change(widthBox(), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "sec-280" }));
    expect(widthBox().value).toBe("300");
  });
});
