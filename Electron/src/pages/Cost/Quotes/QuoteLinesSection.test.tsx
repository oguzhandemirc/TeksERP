// Ekran: maliyet sütunları yalnız sunucu alanı varsa; toplam SUNUCUNUN `totalAmount`ı (kalem tutarlarının toplamı
// DEĞİL — istemci toplamaz); salt-okunur teklifte düzenleme düğmesi yok.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));
import { QuoteLinesSection } from "./QuoteLinesSection";
import type { QuoteDetail, QuoteLine } from "./quote-types";

const line = (over: Partial<QuoteLine> = {}): QuoteLine => ({
  id: "l1", lineNo: 1, itemId: "i1", colorId: null, item: { id: "i1", code: "K1", name: "Kristal" }, color: null, description: "Kristal",
  width: "300", quantity: "5000", unit: "MT", unitPrice: "2.67", priceSource: "COST_PLUS", lineTotal: "13350.00", notes: null, ...over,
});
const quote = (lines: QuoteLine[], extra: Partial<QuoteDetail> = {}) => ({ id: "q1", customerId: "c1", currency: "USD", totalAmount: "99999.00", lines, ...extra }) as QuoteDetail;

describe("QuoteLinesSection", () => {
  it("cost:read yok (alan yok) → maliyet sütunu çizilmez; toplam sunucudan", () => {
    renderWithProviders(<QuoteLinesSection quote={quote([line(), line({ id: "l2", lineNo: 2, lineTotal: "1.00" })])} editable={false} />);
    expect(screen.queryByTestId("col-cost")).toBeNull();
    expect(screen.queryByText(/Önerilen/)).toBeNull();
    expect(screen.getByTestId("quote-total")).toHaveTextContent("Toplam 99.999,00 USD");
    expect(screen.queryByTestId("quote-margin")).toBeNull();
    expect(screen.queryByRole("button", { name: /Kalem ekle|Maliyeti tazele/ })).toBeNull();
  });
  it("alan varsa maliyet/kâr/önerilen ve marj görünür; elle fiyat nötr işaret alır", () => {
    const l = line({ costPerMTry: "2.2659", markupPct: "18.00", suggestedUnitPrice: "2.6737", priceSource: "MANUAL" });
    renderWithProviders(<QuoteLinesSection quote={quote([l], { marj: { brutMarjTry: "100.00", marjPct: "12.50" }, totalCostTry: "50.00" })} editable={false} />);
    expect(screen.getByTestId("col-cost")).toBeInTheDocument();
    expect(screen.getByText("2,6737")).toBeInTheDocument();
    expect(screen.getByTestId("price-source")).toHaveTextContent("≠ elle");
    expect(screen.getByTestId("quote-margin")).toHaveTextContent("Brüt marj 100,00 TL (%12,5)");
  });
});
