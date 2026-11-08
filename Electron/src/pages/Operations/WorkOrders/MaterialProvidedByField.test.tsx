import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MaterialProvidedByField } from "./MaterialProvidedByField";
import { buildPayload } from "./workOrderPayload";
import { formValuesFromWorkOrder } from "./workOrderPrefill";
import { workOrderFormDefaults } from "./schema";
import type { WorkOrder } from "./types";

// Fason F7b: "ana hammaddeyi kim verdi" düğme grubu + gövde allowlist'i (alan yazılmazsa sunucuya gitmez).
describe("MaterialProvidedByField", () => {
  it("dört seçenek; seçili olan aria-checked; tıklama değeri verir", () => {
    const onChange = vi.fn();
    render(<MaterialProvidedByField value="CUSTOMER" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Bilinmiyor", "Müşteri", "Bu fabrika", "Karışık"]);
    expect(screen.getByRole("radio", { name: "Müşteri" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Bu fabrika" }));
    expect(onChange).toHaveBeenCalledWith("US");
    fireEvent.click(screen.getByRole("radio", { name: "Bilinmiyor" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("materialProvidedBy gövde + ön doldurma", () => {
  const meta = { fasonPlans: [], customSteps: [] };
  it("form değeri payload'a girer; varsayılan null (bilinmiyor)", () => {
    expect(buildPayload({ ...workOrderFormDefaults, materialProvidedBy: "MIXED" }, meta, true).materialProvidedBy).toBe("MIXED");
    expect(buildPayload(workOrderFormDefaults, meta, true).materialProvidedBy).toBeNull();
  });
  it("düzenlemede kayıtlı değer forma gelir; eski backend alanı göndermezse null", () => {
    const wo = { type: "STOCK_PRODUCTION", workOrderNumber: "IE1", routeTemplateId: null, targetItemId: null, targetColorId: null,
      customerId: null, width: null, targetQuantity: null, targetWeight: null, plannedStartDate: null, plannedEndDate: null, foldType: null } as unknown as WorkOrder;
    expect(formValuesFromWorkOrder({ ...wo, materialProvidedBy: "US" }).materialProvidedBy).toBe("US");
    expect(formValuesFromWorkOrder(wo).materialProvidedBy).toBeNull();
  });
});
