// Teklif başlığı: etiketler girdilere bağlı (getByLabelText bulur) ve kur kaynağı girdinin yanında değil ipucu
// satırında — 1440'ta rozet kur girdisini eziyordu.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EMPTY_HEADER } from "./service";
import { QuoteHeaderFields } from "./QuoteHeaderFields";

vi.mock("@/pages/Customers/BranchSelect", () => ({ BranchSelect: () => null }));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => null }));

describe("QuoteHeaderFields", () => {
  it("⭐ etiketler girdilere bağlı; kur kaynağı ipucu satırında, girdiyle aynı kutuda değil", () => {
    const value = { ...EMPTY_HEADER, currency: "USD" as const, fxRate: "34,5", paymentTermDays: "60", customerReference: "REF-1" };
    renderWithProviders(<QuoteHeaderFields value={value} onChange={() => {}} mode="update" fxSource={null} customerName="MODA" />);
    const fx = screen.getByLabelText("Kur (1 USD = ? TL)");
    expect(fx).toHaveValue("34,5");
    expect(screen.getByLabelText("Vade (gün)")).toHaveValue("60");
    expect(screen.getByLabelText("Müşteri referansı")).toHaveValue("REF-1");
    expect(screen.getByLabelText("Not (müşteriye)")).toBeInTheDocument();
    const src = screen.getByTestId("fx-source");
    expect(src).toHaveTextContent("Finans kuru önerisi");
    // Girdi rozetle yan yana bir flex satırına sıkıştırılmaz (ezik kur kutusu).
    expect(fx.parentElement?.className ?? "").not.toMatch(/\bflex\b/);
  });
});
