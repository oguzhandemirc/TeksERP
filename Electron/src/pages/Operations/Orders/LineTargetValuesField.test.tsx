// =============================================================================
// BEKÇİ — Sipariş satırı hedef değer alanı (SY-F2, tasarım §7.8): çeşidi olmayan bayrakta alan ÇİZİLMEZ;
// çeşitli bayrakta değer düğmeleri; hedefsiz satırın gövdesi bugünküyle bayt-aynı (§15.5).
// Negatif sonda (kırmızı görüldü): `return null` kaldırılınca iki "çizilmez" testi ❌; create gövdesi
// `targetValues`i koşulsuz yazınca "anahtar YOK" testi ❌.
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { OrderLinesEditor } from "./OrderLinesEditor";
import { LineTargetValuesField } from "./LineTargetValuesField";
import { buildVariantCatalog, pruneTargetValues } from "./lineTargetValues";
import { buildCreatePayload, buildUpdatePayload } from "./orderPayload";
import type { OrderFormValues, OrderLineFormValues } from "./schema";
import type { Order } from "./types";
import type { FabricProperty } from "@/pages/FabricProperties/types";

const prop = (o: Partial<FabricProperty>): FabricProperty => ({
  id: "x", code: "X", name: "X", category: null, description: null, color: null, sortOrder: 0, isActive: true,
  valueType: "FLAG", variantOfPropertyId: null, values: [], createdAt: "", updatedAt: "", ...o,
});
const val = (id: string, name: string, sortOrder: number, isActive = true) => ({ id, code: name, name, sortOrder, isActive });

const ROWS: FabricProperty[] = [
  prop({ id: "f-kusak", code: "KUSAK", name: "Kuşak" }),
  prop({ id: "f-yikama", code: "YIKAMA", name: "Yıkama" }),
  prop({ id: "c-kusak", code: "KUSAK_MARKA", name: "Kuşak markası", valueType: "CHOICE", variantOfPropertyId: "f-kusak",
    values: [val("v-jas", "JASMİN", 2), val("v-zeb", "ZEBRA", 1), val("v-old", "ESKİ", 0, false)] }),
];

vi.mock("@/hooks/usePricingEnabled", () => ({ usePricingEnabled: () => false, useCustomerBranchesEnabled: () => false, useFeatureFlags: () => ({ data: undefined }) }));
vi.mock("@/hooks/usePulseSync", () => ({ usePulseSync: () => false }));
vi.mock("@/components/forms/ItemSelect", () => ({ ItemSelect: () => <button type="button">Kumaş seç</button> }));
vi.mock("@/pages/Items/ItemFormDialog", () => ({ ItemFormDialog: () => null }));
vi.mock("@/pages/Items/service", () => ({ itemService: { getById: vi.fn().mockResolvedValue({ data: { unit: "MT" } }), create: vi.fn() } }));
vi.mock("@/pages/Items/useItemDetail", () => ({ useItemDetail: () => ({ data: undefined }) }));
vi.mock("./OrderLineAliasFields", () => ({ OrderLineAliasFields: () => null }));
vi.mock("./OrderLineAtpHint", () => ({ OrderLineAtpHint: () => null }));
vi.mock("@/pages/FabricProperties/service", () => ({ fabricPropertyService: {} }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: ROWS }) }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç...</button> }));

const line = (o: Partial<OrderLineFormValues> = {}): OrderLineFormValues => ({ clientId: "l1", itemId: "i1", colorId: null, quantity: 10, width: null, unitPrice: "", customerItemName: "", customerColorName: "", requiredPropertyIds: [], targetValues: [], cutNote: "", ...o });
const form = (lines: OrderLineFormValues[]): OrderFormValues => ({ orderNumber: "", customerId: "c1", branchId: null, currency: "TRY", deadline: "", lines });

describe("Hedef değer kataloğu", () => {
  it("⭐ yalnız aktif çeşit + aktif değerler, sıra sortOrder; çeşitsiz bayrak katalogda yok", () => {
    const cat = buildVariantCatalog(ROWS);
    expect(cat.get("f-yikama")).toBeUndefined();
    expect(cat.get("f-kusak")).toEqual({ propertyId: "c-kusak", name: "Kuşak markası", options: [{ id: "v-zeb", name: "ZEBRA" }, { id: "v-jas", name: "JASMİN" }] });
  });

  it("⭐ bayrak kaldırılınca çeşidinin hedefi düşer", () => {
    const cat = buildVariantCatalog(ROWS);
    expect(pruneTargetValues([{ propertyId: "c-kusak", valueId: "v-zeb" }], ["f-yikama"], cat)).toEqual([]);
    expect(pruneTargetValues([{ propertyId: "c-kusak", valueId: "v-zeb" }], ["f-kusak"], cat)).toHaveLength(1);
  });
});

describe("LineTargetValuesField", () => {
  it("⭐ çeşit özelliği yoksa alan ÇİZİLMEZ", () => {
    renderWithProviders(<LineTargetValuesField flagIds={["f-yikama"]} catalog={buildVariantCatalog(ROWS)} value={[]} onChange={() => {}} />);
    expect(screen.queryByTestId("line-target-values")).toBeNull();
  });

  it("⭐ çeşitli bayrakta değer düğmeleri; seçim hedefi yazar, 'Seçilmedi' kaldırır", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<LineTargetValuesField flagIds={["f-kusak"]} catalog={buildVariantCatalog(ROWS)} value={[]} onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Kuşak markası" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "ESKİ" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "ZEBRA" }));
    expect(onChange).toHaveBeenLastCalledWith([{ propertyId: "c-kusak", valueId: "v-zeb" }]);
    rerender(<LineTargetValuesField flagIds={["f-kusak"]} catalog={buildVariantCatalog(ROWS)} value={[{ propertyId: "c-kusak", valueId: "v-zeb" }]} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "ZEBRA" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "Seçilmedi" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("⭐ editörde: kuşak bayraklı satırda alan görünür", async () => {
    renderWithProviders(<OrderLinesEditor value={[line({ requiredPropertyIds: ["f-kusak"] })]} onChange={() => {}} customerId={null} />);
    expect(await screen.findByRole("radiogroup", { name: "Kuşak markası" })).toBeInTheDocument();
  });

  it("⭐ editörde: yalnız çeşitsiz bayrak → alan yok", async () => {
    renderWithProviders(<OrderLinesEditor value={[line({ requiredPropertyIds: ["f-yikama"] })]} onChange={() => {}} customerId={null} />);
    await screen.findByText("Yıkama");
    expect(screen.queryByTestId("line-target-values")).toBeNull();
  });
});

describe("Sipariş gövdesi — sıfır fark (§15.5)", () => {
  it("⭐ hedefsiz satır: create gövdesinde `targetValues` anahtarı YOK (bugünkü gövde)", () => {
    const body = buildCreatePayload(form([line()]), false, "tok");
    expect(Object.keys(body.lines[0] ?? {})).not.toContain("targetValues");
    expect(buildCreatePayload(form([line({ targetValues: [{ propertyId: "c-kusak", valueId: "v-zeb" }] })]), false, "tok").lines[0]?.targetValues)
      .toEqual([{ propertyId: "c-kusak", valueId: "v-zeb" }]);
  });

  it("⭐ update: önceden hedefsiz satırda anahtar yok; önceden hedefli satır temizlenince `[]` gider", () => {
    const editing = { status: "PENDING", lines: [
      { id: "a", targetValues: [], workOrderLinks: [] },
      { id: "b", targetValues: [{ propertyId: "c-kusak", valueId: "v-zeb" }], workOrderLinks: [] },
    ] } as unknown as Order;
    const body = buildUpdatePayload(form([line({ clientId: "a" }), line({ clientId: "b" })]), false, editing);
    const [a, b] = body.lines ?? [];
    expect(Object.keys(a ?? {})).not.toContain("targetValues");
    expect(b?.targetValues).toEqual([]);
  });
});
