// =============================================================================
// BEKÇİ — Sipariş satırı en ön-dolumu (D4 aşama a): kumaş seçilince kartın mamul eni boş En alanına gelir; elle
// yazılan ve kayıtlı eski satırın eni ezilmez; ön-doldurulmuş en yeni seçimle yenilenir.
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { OrderLinesEditor } from "./OrderLinesEditor";
import type { OrderLineFormValues } from "./schema";

vi.mock("@/hooks/usePricingEnabled", () => ({ usePricingEnabled: () => false, useCustomerBranchesEnabled: () => false, useFeatureFlags: () => ({ data: undefined }) }));
vi.mock("@/hooks/usePulseSync", () => ({ usePulseSync: () => false }));
// Seçici yerine iki düğme: biri 280 cm'lik, öteki 320 cm'lik kartı seçer (satır `widthCm` Decimal metin gelir).
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { onChange: (id: string | null, row: { id: string; widthCm?: string | null } | null) => void }) => (
    <>
      <button type="button" onClick={() => p.onChange("a", { id: "a", widthCm: "280.00" })}>Kart A</button>
      <button type="button" onClick={() => p.onChange("b", { id: "b", widthCm: "320.00" })}>Kart B</button>
      <button type="button" onClick={() => p.onChange("c", { id: "c", widthCm: null })}>Kart C</button>
    </>
  ),
}));
vi.mock("@/pages/Items/ItemFormDialog", () => ({ ItemFormDialog: () => null }));
vi.mock("@/pages/Items/service", () => ({ itemService: { getById: vi.fn().mockResolvedValue({ data: { unit: "MT" } }), create: vi.fn() } }));
vi.mock("@/pages/Items/useItemDetail", () => ({ useItemDetail: () => ({ data: undefined }) }));
vi.mock("./OrderLineAliasFields", () => ({ OrderLineAliasFields: () => null }));
vi.mock("./OrderLineAtpHint", () => ({ OrderLineAtpHint: () => null }));
vi.mock("./PhaseOutLineNote", () => ({ PhaseOutLineNote: () => null }));
vi.mock("@/pages/FabricProperties/service", () => ({ fabricPropertyService: {} }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [] }) }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç...</button> }));

const line = (o: Partial<OrderLineFormValues> = {}): OrderLineFormValues => ({ clientId: "l1", itemId: "", colorId: null, quantity: 0, width: null, unitPrice: "", customerItemName: "", customerColorName: "", requiredPropertyIds: [], targetValues: [], cutNote: "", ...o });

function Harness({ initial }: { initial: OrderLineFormValues }) {
  const [lines, setLines] = useState([initial]);
  return <OrderLinesEditor value={lines} onChange={setLines} customerId={null} />;
}

const widthBox = () => screen.getByRole("spinbutton", { name: "En (cm)" }) as HTMLInputElement;

describe("Sipariş satırı — en ön-dolumu", () => {
  it("⭐ boş satırda kumaş seçilince kartın eni gelir; ön-dolu en yeni seçimle yenilenir; ensiz kart ön-dolumu boşaltır", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={line()} />);
    expect(widthBox().value).toBe("");
    await user.click(screen.getByRole("button", { name: "Kart A" }));
    expect(widthBox().value).toBe("280");
    await user.click(screen.getByRole("button", { name: "Kart B" }));
    expect(widthBox().value).toBe("320");
    await user.click(screen.getByRole("button", { name: "Kart C" }));
    expect(widthBox().value).toBe("");
  });

  it("⭐ elle değiştirilen en sonraki seçimde ezilmez", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={line()} />);
    await user.click(screen.getByRole("button", { name: "Kart A" }));
    await user.clear(widthBox());
    await user.type(widthBox(), "300");
    await user.click(screen.getByRole("button", { name: "Kart B" }));
    expect(widthBox().value).toBe("300");
  });

  it("⭐ kayıtlı eski satırın eni yüklenirken ve kumaş değişince korunur", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={line({ itemId: "old", width: 250 })} />);
    expect(widthBox().value).toBe("250");
    await user.click(screen.getByRole("button", { name: "Kart A" }));
    expect(widthBox().value).toBe("250");
  });
});
