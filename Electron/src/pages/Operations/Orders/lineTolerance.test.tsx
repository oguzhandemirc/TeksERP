import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { parseTolerancePct, toleranceToFormText } from "./lineTolerance";
import { buildCreatePayload, buildUpdatePayload } from "./orderPayload";
import { orderLineSchema, type OrderFormValues, type OrderLineFormValues } from "./schema";
import { OrderLineToleranceField } from "./OrderLineToleranceField";
import type { Order } from "./types";

const line = (over: Partial<OrderLineFormValues> = {}): OrderLineFormValues => ({
  clientId: "a", itemId: "i1", colorId: null, quantity: 100, width: 280, unitPrice: "", customerItemName: "", customerColorName: "",
  requiredPropertyIds: [], targetValues: [], cutNote: "", ...over,
});
const form = (lines: OrderLineFormValues[]): OrderFormValues => ({ orderNumber: "", customerId: "c1", branchId: null, currency: "TRY", deadline: "", lines });
const editing = { status: "PENDING", lines: [{ id: "a", workOrderLinks: [] }] } as unknown as Order;

describe("sipariş satırı tolerans % (K4)", () => {
  it("metin → gövde değeri: virgül noktaya, boş null, sınır ve hane hatası", () => {
    expect(parseTolerancePct("1,5")).toEqual({ value: "1.5", error: null });
    expect(parseTolerancePct(" 2 ")).toEqual({ value: "2", error: null });
    expect(parseTolerancePct("")).toEqual({ value: null, error: null });
    expect(parseTolerancePct(undefined)).toEqual({ value: null, error: null });
    expect(parseTolerancePct("50")).toEqual({ value: "50", error: null });
    expect(parseTolerancePct("50,01").error).toMatch(/0 ile 50/);
    expect(parseTolerancePct("1,234").error).toMatch(/2 ondalık/);
    expect(parseTolerancePct("-1").error).toBeTruthy();
    expect(parseTolerancePct("abc").error).toBeTruthy();
  });

  it("sunucu değeri forma: Decimal sayı ya da metin; yok → boş", () => {
    expect(toleranceToFormText(2.5)).toBe("2.5");
    expect(toleranceToFormText("3.00")).toBe("3.00");
    expect(toleranceToFormText(null)).toBe("");
    expect(toleranceToFormText(undefined)).toBe("");
  });

  it("şema geçersiz metni reddeder, boşu ve virgüllüyü kabul eder", () => {
    expect(orderLineSchema.safeParse(line({ tolerancePct: "60" })).success).toBe(false);
    expect(orderLineSchema.safeParse(line({ tolerancePct: "" })).success).toBe(true);
    expect(orderLineSchema.safeParse(line({ tolerancePct: "2,25" })).success).toBe(true);
    expect(orderLineSchema.safeParse(line()).success).toBe(true);
  });

  it("yeni sipariş: boşsa anahtar YOK (gövde bugünküyle aynı), doluysa noktalı metin", () => {
    expect(buildCreatePayload(form([line()]), false, "t").lines[0]).not.toHaveProperty("tolerancePct");
    expect(buildCreatePayload(form([line({ tolerancePct: "" })]), false, "t").lines[0]).not.toHaveProperty("tolerancePct");
    expect(buildCreatePayload(form([line({ tolerancePct: "1,5" })]), false, "t").lines[0]?.tolerancePct).toBe("1.5");
  });

  it("düzenleme: değer gider, boş → null (fabrika ayarına dön)", () => {
    expect(buildUpdatePayload(form([line({ tolerancePct: "3" })]), false, editing).lines?.[0]?.tolerancePct).toBe("3");
    expect(buildUpdatePayload(form([line({ tolerancePct: "" })]), false, editing).lines?.[0]?.tolerancePct).toBeNull();
  });

  it("satır kutusu: yer tutucu 'Fabrika ayarı', geçersizde Türkçe hata", () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<OrderLineToleranceField value="" onChange={onChange} />);
    const input = screen.getByLabelText("Tolerans %");
    expect(input).toHaveAttribute("placeholder", "Fabrika ayarı");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(input, { target: { value: "2,5" } });
    expect(onChange).toHaveBeenCalledWith("2,5");
    rerender(<OrderLineToleranceField value="70" onChange={onChange} />);
    expect(screen.getByRole("alert")).toHaveTextContent("0 ile 50");
  });
});
