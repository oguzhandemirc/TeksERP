// Fatura satırı konu hücresi: kartsız Hizmet satırı sessizce açıklamaya dönüşmez (görünür uyarı) · Ürün seçimi temizlenebilir.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InvoiceLineSubjectField } from "./InvoiceLineSubjectField";
import type { InvoiceLineSubject } from "./invoiceLineSubject";

vi.mock("@/components/forms/ItemSelect", () => ({ ItemSelect: () => <div data-testid="item-select" /> }));
vi.mock("@/components/forms/ServiceItemSelect", () => ({ ServiceItemSelect: () => <div data-testid="service-select" /> }));

const WARN = "Hizmet kartı seçilmedi; satır açıklama olarak kaydedilir.";
const renderField = (subject: InvoiceLineSubject, onPick = vi.fn()) => {
  render(<InvoiceLineSubjectField subject={subject} onTypeChange={() => {}} onPick={onPick} />);
  return onPick;
};

describe("InvoiceLineSubjectField", () => {
  it("kartsız Hizmet satırında uyarı görünür", () => {
    renderField({ lineType: "SERVICE", itemId: null, serviceItemId: null });
    expect(screen.getByText(WARN)).toBeInTheDocument();
  });

  it("kartlı Hizmet satırında uyarı yok", () => {
    renderField({ lineType: "SERVICE", itemId: null, serviceItemId: "s1" });
    expect(screen.queryByText(WARN)).toBeNull();
  });

  it("Ürün seçiliyken 'temizle' kartı düşürür; seçim yokken düğme yok", () => {
    const onPick = renderField({ lineType: "PRODUCT", itemId: "i1", serviceItemId: null });
    fireEvent.click(screen.getByRole("button", { name: "Ürün seçimini temizle" }));
    expect(onPick).toHaveBeenCalledWith({ itemId: null }, null);
  });

  it("Ürün seçili değilken temizle düğmesi çizilmez", () => {
    renderField({ lineType: "PRODUCT", itemId: null, serviceItemId: null });
    expect(screen.queryByRole("button", { name: "Ürün seçimini temizle" })).toBeNull();
  });
});
