// Sunum provası: teklif kaleminde varyant seçici yoktu. Seçilen varyant `recipeId` olarak gövdeye girer;
// ürün değişince sıfırlanır (eski ürünün varyantı yeni ürüne gitmesin).
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

const addLine = vi.fn(async () => ({ success: true, data: {} }));
vi.mock("./service", () => ({ quoteService: { addLine: (...a: unknown[]) => addLine(...(a as [])) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => null }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("./QuoteVariantPicker", () => ({
  variantText: (r: { name: string }) => r.name,
  QuoteVariantPicker: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("r-1")}>varyant-sec</button>
  ),
}));
import { AddLineDialog } from "./AddLineDialog";

const pending = { mode: "item" as const, item: { id: "i-1", code: "K1", name: "Kristal" } };

describe("AddLineDialog — varyant", () => {
  beforeEach(() => addLine.mockClear());
  it("seçilen varyant recipeId olarak gövdeye girer", async () => {
    renderWithProviders(<AddLineDialog quoteId="q1" customerId="c1" currency="USD" open onOpenChange={() => {}} pending={pending} />);
    fireEvent.click(screen.getByRole("button", { name: "varyant-sec" }));
    fireEvent.change(screen.getByLabelText("Miktar (m) *"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("line-add"));
    await waitFor(() => expect(addLine).toHaveBeenCalledTimes(1));
    expect(addLine).toHaveBeenCalledWith("q1", expect.objectContaining({ itemId: "i-1", recipeId: "r-1", quantity: "500" }));
  });
  it("varyant seçilmezse recipeId gönderilmez (bugünkü gövde)", async () => {
    renderWithProviders(<AddLineDialog quoteId="q1" customerId="c1" currency="USD" open onOpenChange={() => {}} pending={pending} />);
    fireEvent.change(screen.getByLabelText("Miktar (m) *"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("line-add"));
    await waitFor(() => expect(addLine).toHaveBeenCalledTimes(1));
    expect(addLine.mock.calls[0]).not.toHaveProperty("1.recipeId");
  });
});
