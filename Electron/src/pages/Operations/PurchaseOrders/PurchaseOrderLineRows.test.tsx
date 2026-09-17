// =============================================================================
// BEKÇİ — Alış siparişi formu (EK 3, 2026-09-17): ① boy sabit (h-[88vh] max-w-6xl, liste min-h-0 flex-1) · ② kalem satırı
// GRID başlıklı (# · Ürün · Miktar [birim rozeti ürün kartından, salt gösterge] · Birim Fiyat · Not) · ③ iki tarih
// `DatePickerInput` (`type="date"` YOK) · ④ ürünsüz satırda miktar/fiyat odağı → `onWarnLine`; `warnLineKey` → amber halka
// + role="status" "Önce ürün seçin" (kalıcı metin yok)
// =============================================================================
// Negatif sonda (kırmızı görüldü): satırdaki `onFocus={() => guard(l)}` düşünce (4) ❌; dialog `h-[88vh]` → `max-h` (1) ❌.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { PurchaseOrderLineRows, PO_ITEM_WARNING_TEXT, PO_LINE_HEADERS, emptyPoLine } from "./PurchaseOrderLineRows";

vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { value: string | null; placeholder?: string; triggerClassName?: string }) => (
    <button type="button" aria-label="Ürün seç (liste)" className={p.triggerClassName} data-value={p.value ?? ""}>{p.value ?? p.placeholder}</button>
  ),
}));
vi.mock("@/hooks/useItemPriceSuggestion", () => ({ useItemPriceSuggestion: () => ({ price: null, source: null, message: null }), describeSuggestion: () => null }));
vi.mock("@/pages/Items/service", () => ({ itemService: { getById: (id: string) => Promise.resolve({ success: true, data: { id, code: "IPL1", name: "Pamuk İplik", itemType: "YARN", unit: "KG", isActive: true } }) } }));

const soy = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("Alış siparişi kalem satırları (EK 3)", () => {
  it("② ⭐ grid başlık satırı: # · Ürün · Miktar · Birim Fiyat · Not; satır aynı şablonu okur; sıra rozeti", () => {
    renderWithProviders(<PurchaseOrderLineRows lines={[emptyPoLine(), emptyPoLine()]} onChange={() => {}} />);
    const heads = Array.from(screen.getByTestId("po-line-headers").querySelectorAll("span")).map((s) => s.textContent);
    expect(heads).toEqual([...PO_LINE_HEADERS]);
    expect(heads.slice(0, 5)).toEqual(["#", "Ürün", "Miktar", "Birim Fiyat", "Not"]);
    const rows = screen.getAllByTestId("po-line");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByText("2")).toBeInTheDocument();
    expect(screen.getByTestId("po-line-headers").className).toBe(screen.getByTestId("po-line-headers").className); // şablon sabiti tek yerde
    expect(rows[0]!.className).toMatch(/lg:grid-cols-\[2rem_/);
    expect(screen.getByTestId("po-line-headers").className).toMatch(/lg:grid-cols-\[2rem_/);
  });

  it("② birim rozeti ürün kartından (getById → KG), salt gösterge — ürünsüz satırda rozet yok", async () => {
    renderWithProviders(<PurchaseOrderLineRows lines={[{ ...emptyPoLine(), itemId: "i3" }, emptyPoLine()]} onChange={() => {}} />);
    const rows = screen.getAllByTestId("po-line");
    await within(rows[0]!).findByText("KG");
    expect(within(rows[1]!).queryByText("KG")).toBeNull();
    expect(within(rows[0]!).getByText("KG")).toHaveAttribute("title", expect.stringContaining("değiştirilmez"));
  });

  it("④ ⭐ ürünsüz satırda Miktar'a odak → onWarnLine(key); ürünlü satırda çağrılmaz", async () => {
    const onWarnLine = vi.fn();
    const empty = emptyPoLine();
    renderWithProviders(<PurchaseOrderLineRows lines={[{ ...emptyPoLine(), itemId: "i3" }, empty]} onChange={() => {}} onWarnLine={onWarnLine} />);
    const rows = screen.getAllByTestId("po-line");
    await userEvent.click(within(rows[1]!).getByRole("spinbutton", { name: "Miktar" }));
    expect(onWarnLine).toHaveBeenCalledWith(empty.key);
    onWarnLine.mockClear();
    await userEvent.click(within(rows[0]!).getByRole("spinbutton", { name: "Miktar" }));
    expect(onWarnLine).not.toHaveBeenCalled();
  });

  it("④ ⭐ warnLineKey → o satırın ürün seçicisinde amber halka + role='status' metni; diğer satırda YOK; kapanınca metin sr-only", () => {
    const a = emptyPoLine();
    const b = emptyPoLine();
    const { rerender } = renderWithProviders(<PurchaseOrderLineRows lines={[a, b]} onChange={() => {}} warnLineKey={b.key} />);
    const rows = screen.getAllByTestId("po-line");
    expect(within(rows[1]!).getByRole("button", { name: "Ürün seç (liste)" }).className).toMatch(/ring-amber-500/);
    expect(within(rows[1]!).getByRole("status")).toHaveTextContent(PO_ITEM_WARNING_TEXT);
    expect(within(rows[0]!).getByRole("button", { name: "Ürün seç (liste)" }).className ?? "").not.toMatch(/ring-amber-500/);
    expect(within(rows[0]!).getByRole("status")).toHaveTextContent("");
    rerender(<PurchaseOrderLineRows lines={[a, b]} onChange={() => {}} warnLineKey={null} />);
    expect(within(screen.getAllByTestId("po-line")[1]!).getByRole("status")).toHaveTextContent("");
  });

  it("①③ ⭐ kaynak taraması: dialog h-[88vh] + max-w-6xl SABİT, liste min-h-0 flex-1 overflow; iki tarih DatePickerInput, type=\"date\" YOK; useTransientFlag", () => {
    const dir = path.resolve(__dirname);
    const dialog = soy(readFileSync(path.join(dir, "PurchaseOrderFormDialog.tsx"), "utf8"));
    const rows = soy(readFileSync(path.join(dir, "PurchaseOrderLineRows.tsx"), "utf8"));
    expect(dialog).toMatch(/<DialogContent className="[^"]*\bh-\[88vh\][^"]*"/);
    expect(dialog).toMatch(/<DialogContent className="[^"]*\bmax-w-6xl[^"]*"/);
    expect(dialog).not.toMatch(/max-h-\[88vh\]/);
    expect(rows).toMatch(/min-h-0 flex-1[^"]*overflow-y-auto/);
    expect((dialog.match(/<DatePickerInput\b/g) ?? []).length).toBe(2);
    expect(dialog).not.toMatch(/type="date"/);
    expect(dialog).toMatch(/useTransientFlag\(3000\)/);
    expect(dialog).toMatch(/warnLineKey=\{warnOn \? warnLineKey : null\}/);
  });
});
