// F7 panel yarısı: cari kartında ALIŞ tevkifatı satıştan ayrı çizilir; eski backend (alan yok) çizmez.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CariTaxOverrideFields } from "./CariTaxOverrideFields";
import type { CariTaxForm } from "./cariTaxOverride";

vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({
    data: { data: { financeDefaultVatRate: 20, financeWithholdingEnabled: false, financePurchaseWithholdingEnabled: true, financePurchaseWithholdingNumerator: 2, financePurchaseWithholdingDenominator: 10 } },
  }),
}));

const base: CariTaxForm = { vatRate: "", withholding: "FACTORY", ratio: "", purchase: { withholding: "FACTORY", ratio: "" } };

describe("CariTaxOverrideFields — alış tevkifatı", () => {
  it("alış oranı + seçim çizilir; genel alış oranı etikette; değişiklik purchase'a yazılır", () => {
    const onChange = vi.fn();
    render(<CariTaxOverrideFields value={base} onChange={onChange} />);
    const input = screen.getByLabelText("Alış tevkifat oranı (pay/payda)");
    expect(input).toHaveAttribute("placeholder", "Genel oran (2/10)");
    fireEvent.change(input, { target: { value: "5/10" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...base, purchase: { withholding: "FACTORY", ratio: "5/10" } });
    const group = screen.getByRole("radiogroup", { name: "Alış tevkifatı" });
    fireEvent.click(group.querySelector('input[value="NONE"]') as HTMLInputElement);
    expect(onChange).toHaveBeenLastCalledWith({ ...base, purchase: { withholding: "NONE", ratio: "" } });
    // Satış kümesi ayrı kalır.
    expect(screen.getByRole("radiogroup", { name: "Satış tevkifatı" })).toBeInTheDocument();
  });

  it("alış alanı yoksa (eski backend) alış satırları çizilmez", () => {
    render(<CariTaxOverrideFields value={{ ...base, purchase: null }} onChange={() => {}} />);
    expect(screen.queryByLabelText("Alış tevkifat oranı (pay/payda)")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Alış tevkifatı" })).toBeNull();
  });
});
