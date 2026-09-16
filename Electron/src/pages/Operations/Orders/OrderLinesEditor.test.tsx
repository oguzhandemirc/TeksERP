// =============================================================================
// BEKÇİ — Sipariş kalemleri editörü (sipariş formu ③④⑤): kumaş uyarısı GEÇİCİ (tetiklenir, 3 s sonra söner),
// kalıcı şerit/rozet YOK, Miktar+Birim tek grupta aynı satırda, grid başlık satırı
// =============================================================================
// Negatif sonda (kırmızı görüldü): `OrderLinesEditor`e eski mavi şerit geri konunca "kalıcı şerit YOK" ❌;
// `OrderLineColorPicker`de kumaşsız dal `onMissingItem` çağırmayınca "renk tıkla → status" ❌.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { OrderLinesEditor } from "./OrderLinesEditor";
import { ITEM_WARNING_TEXT } from "./OrderLineRow";
import type { OrderLineFormValues } from "./schema";

vi.mock("@/hooks/usePricingEnabled", () => ({ usePricingEnabled: () => false, useCustomerBranchesEnabled: () => false }));
vi.mock("@/hooks/usePulseSync", () => ({ usePulseSync: () => false }));
// Kumaş seçici artık ürün MODALI (`ItemSelect`, 2026-09-17 EK 1) — kapsam FABRIC kilitli; test halkayı `triggerClassName` ile ölçer.
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { value: string | null; placeholder?: string; triggerClassName?: string; allowedTypes?: string[]; "aria-label"?: string }) => (
    <button type="button" aria-label={p["aria-label"] ?? "Kumaş seç"} className={p.triggerClassName} data-value={p.value ?? ""} data-allowed={(p.allowedTypes ?? []).join(",")}>{p.value ?? p.placeholder}</button>
  ),
}));
vi.mock("@/pages/Items/ItemFormDialog", () => ({ ItemFormDialog: () => null }));
vi.mock("@/pages/Items/service", () => ({ itemService: { getById: vi.fn().mockResolvedValue({ data: { unit: "MT" } }), create: vi.fn() } }));
vi.mock("@/pages/Items/useItemDetail", () => ({ useItemDetail: () => ({ data: undefined }) }));
vi.mock("./OrderLineAliasFields", () => ({ OrderLineAliasFields: () => null }));
vi.mock("./OrderLineAtpHint", () => ({ OrderLineAtpHint: () => null }));
vi.mock("@/pages/FabricProperties/service", () => ({ fabricPropertyService: {} }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: () => Promise.resolve({ data: [] }) }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç...</button> }));

const line = (o: Partial<OrderLineFormValues> = {}): OrderLineFormValues => ({ clientId: "l1", itemId: "", colorId: null, quantity: 0, width: null, unitPrice: "", customerItemName: "", customerColorName: "", requiredPropertyIds: [], cutNote: "", ...o });

afterEach(() => vi.useRealTimers());

describe("OrderLinesEditor — geçici kumaş uyarısı (③)", () => {
  it("⭐ kalıcı 'Önce kumaş seçin' şeridi/rozeti YOK; kumaşsız satırda renk kutusu devre dışı görünümlü", () => {
    renderWithProviders(<OrderLinesEditor value={[line()]} onChange={() => {}} customerId={null} />);
    expect(screen.queryByText(/Özellik isteği eklemek için önce/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Renk seç" })).toHaveAttribute("aria-disabled", "true");
  });

  it("⭐ kumaşsız satırda 'Özellik isteği ekle' tıklanınca role=status 'Önce kumaş seçin' görünür, kumaş seçici amber halka; 3 s sonra söner", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<OrderLinesEditor value={[line()]} onChange={() => {}} customerId={null} />);
    await user.click(screen.getByRole("button", { name: "Özellik isteği ekle" }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(ITEM_WARNING_TEXT);
    expect(screen.getByRole("button", { name: "Kumaş seç" }).className).toMatch(/ring-amber-500/);
    expect(screen.getByRole("button", { name: "Kumaş seç" })).toHaveAttribute("data-allowed", "FABRIC"); // EK 1: kapsam yalnız kumaş
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Kumaş seç" }).className).not.toMatch(/ring-amber-500/);
  });

  it("⭐ kumaşsız satırda RENK kutusuna tıklama da uyarıyı tetikler; submit'in zod hatası (lineErrors.itemId) aynı uyarıyı yakar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerender } = renderWithProviders(<OrderLinesEditor value={[line()]} onChange={() => {}} customerId={null} />);
    await user.click(screen.getByRole("button", { name: "Renk seç" }));
    expect(screen.getByRole("status")).toHaveTextContent(ITEM_WARNING_TEXT);
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.getByRole("status")).toHaveTextContent("");
    rerender(<OrderLinesEditor value={[line()]} onChange={() => {}} customerId={null} lineErrors={[{ itemId: { message: "Kumaş seçilmeli" } }]} />);
    expect(screen.getByRole("status")).toHaveTextContent(ITEM_WARNING_TEXT);
    expect(screen.queryByText("Kumaş seçilmeli")).toBeNull(); // kalıcı kırmızı <p> yok
    expect(screen.getByRole("button", { name: "Kumaş seç" }).className).toMatch(/border-destructive/);
  });
});

describe("OrderLinesEditor — birim grubu (④) ve grid (⑤)", () => {
  it("⭐ Miktar input'u ile Birim seçicisi TEK kapsayıcıda, aynı satırda (ikinci satır yok)", () => {
    renderWithProviders(<OrderLinesEditor value={[line({ itemId: "i1" })]} onChange={() => {}} customerId={null} />);
    const group = screen.getByTestId("qty-unit-group");
    expect(within(group).getByRole("spinbutton", { name: "Miktar" })).toBeInTheDocument();
    expect(within(group).getByRole("combobox", { name: "Birim" })).toBeInTheDocument();
    expect(group.className).toMatch(/\bflex\b/);
  });

  it("grid başlık satırı bir kez: # · Kumaş · Renk · Miktar · En (cm); satır aynı şablonu okur", () => {
    renderWithProviders(<OrderLinesEditor value={[line({ itemId: "i1" }), line({ clientId: "l2" })]} onChange={() => {}} customerId={null} />);
    const heads = Array.from(screen.getByTestId("order-line-headers").querySelectorAll("span")).map((s) => s.textContent).filter(Boolean);
    expect(heads).toEqual(["#", "Kumaş", "Renk", "Miktar", "En (cm)"]);
    const rows = screen.getAllByTestId("order-line");
    expect(rows).toHaveLength(2);
    const template = screen.getByTestId("order-line-headers").className.match(/lg:grid-cols-\[[^\]]+\]/)?.[0];
    expect(template).toBeTruthy();
    expect((rows[0]!.firstElementChild as HTMLElement).className).toContain(template as string);
  });

  it("kaynak taraması: mavi şerit ve turuncu rozet kaynakta yok; renk seçici kumaşsız dalda onMissingItem çağırır", () => {
    const dir = path.resolve(__dirname);
    const soy = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const editor = soy(readFileSync(path.join(dir, "OrderLinesEditor.tsx"), "utf8"));
    const picker = soy(readFileSync(path.join(dir, "OrderLineColorPicker.tsx"), "utf8"));
    expect(editor).not.toMatch(/Özellik isteği eklemek için önce/);
    expect(editor).not.toMatch(/border-blue-200/);
    expect(picker).not.toMatch(/bg-amber-50/);
    expect(picker).toMatch(/onClick=\{onMissingItem\}/);
  });
});
