// =============================================================================
// BEKÇİ — Mal kabul SARF satırı (gk-h4s): sarf stoğu ayarı açıkken kumaş seçici sarfı da listeler, Sarf grubu +
// "Sarf satırı ekle"; sarf satırı TOP SAYILMAZ, gövdede yalnız kalem + miktar + fiyat, adet çarpanı yok.
// Ayar KAPALIYKEN editör bayt-aynı: düğme yok, kumaş seçici yalnız FABRIC.
// =============================================================================
// Negatif sonda: `receiptTotals`ta sarf filtresi kaldırılınca (sarf → kumaş) "top sayılmaz" ❌; `expandLines` sarf
// dalı kaldırılınca "yalnız kalem+miktar+fiyat" ❌.
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { createAttemptToken } from "@/lib/attemptToken";
import { ReceiptLineRows, emptyLine, expandLines, receiptTotals, type DraftLine } from "./ReceiptLineRows";
import { expandLineKeys } from "./receiptLineIssues";

vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [] }) }));
vi.mock("@/components/forms/ReferenceSelect", () => ({
  ReferenceSelect: (p: { "aria-label"?: string; placeholder?: string }) => <button type="button" aria-label={p["aria-label"]}>{p.placeholder}</button>,
}));
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { "aria-label"?: string; placeholder?: string; allowedTypes?: string[] }) => (
    <button type="button" aria-label={p["aria-label"]} data-allowed={(p.allowedTypes ?? []).join(",")}>{p.placeholder}</button>
  ),
}));
vi.mock("./LinePropertiesButton", () => ({
  LinePropertiesButton: (p: { "aria-label"?: string }) => <button type="button" aria-label={p["aria-label"]}>Özellik</button>,
}));

const SARF = new Set(["sarf-1"]);
const fabricLine = (o: Partial<DraftLine> = {}): DraftLine => ({ ...emptyLine(), itemId: "fab-1", initialQty: 50, ...o });
const sarfLine = (o: Partial<DraftLine> = {}): DraftLine => ({ ...emptyLine(), itemId: "sarf-1", initialQty: 500, unitPrice: 0.5, colorId: "c-1", width: 280, count: 3, ...o });

describe("Mal kabul sarf satırı — editör", () => {
  it("ayar KAPALI: Sarf düğmesi yok, kumaş seçici yalnız FABRIC (bayt-aynı)", () => {
    renderWithProviders(<ReceiptLineRows lines={[fabricLine()]} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Sarf satırı ekle" })).toBeNull();
    expect(screen.getByRole("button", { name: "Kumaş" }).getAttribute("data-allowed")).toBe("FABRIC");
  });

  it("⭐ ayar AÇIK: kumaş seçici sarfı da listeler; düğme satırı CONSUMABLE doğurur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ReceiptLineRows lines={[fabricLine()]} onChange={onChange} consumableEnabled />);
    expect(screen.getByRole("button", { name: "Kumaş" }).getAttribute("data-allowed")).toBe("FABRIC,CONSUMABLE");
    await user.click(screen.getByRole("button", { name: "Sarf satırı ekle" }));
    expect((onChange.mock.calls[0]![0] as DraftLine[])[1]).toMatchObject({ kind: "CONSUMABLE", itemId: "", lineClass: undefined });
  });

  it("sarf kalemi Sarf grubunda çizilir: seçici CONSUMABLE kilitli, top/adet/renk hücresi yok", () => {
    renderWithProviders(<ReceiptLineRows lines={[fabricLine(), { ...emptyLine("CONSUMABLE") }]} onChange={vi.fn()} consumableEnabled />);
    const group = screen.getByTestId("receipt-group-CONSUMABLE");
    expect(within(group).getByRole("button", { name: "Sarf kalemi" }).getAttribute("data-allowed")).toBe("CONSUMABLE");
    const headers = Array.from(screen.getByTestId("receipt-line-headers-CONSUMABLE").querySelectorAll("span")).map((s) => s.textContent).filter(Boolean);
    expect(headers).toEqual(["Sarf kalemi", "Miktar", "Birim", "Birim Fiyat"]);
    expect(within(group).queryByLabelText(/Adet|Renk|Top sınıfı/)).toBeNull();
  });
});

describe("Mal kabul sarf satırı — saf katman", () => {
  it("⭐ sarf satırı TOP SAYILMAZ: rolls/meters yalnız kumaş; sarf tek satır (adet çarpanı yok)", () => {
    const t = receiptTotals([fabricLine({ count: 2 }), sarfLine()], undefined, SARF);
    expect(t).toMatchObject({ rolls: 2, meters: 100, consumableLines: 1, yarnLines: 0 });
    expect(t.amount).toBeCloseTo(250);
  });

  it("yalnız sarf → 0 top, 1 sarf", () => {
    expect(receiptTotals([sarfLine()], undefined, SARF)).toMatchObject({ rolls: 0, consumableLines: 1 });
  });

  it("⭐ gövde: sarf satırı yalnız kalem + miktar + fiyat, TEK satır; kumaş satırı değişmez", () => {
    const body = expandLines([fabricLine(), sarfLine()], undefined, createAttemptToken().keyed, SARF);
    expect(body).toHaveLength(2);
    expect(body[1]).toEqual({ itemId: "sarf-1", initialQty: 500, unitPrice: 0.5 });
    expect(body[0]).toMatchObject({ itemId: "fab-1", lineClass: "FINISHED" });
    expect(expandLineKeys([fabricLine(), sarfLine()], SARF)).toHaveLength(2);
  });

  it("sarf kimliği verilmezse eski davranış (kumaş sayılır)", () => {
    expect(receiptTotals([sarfLine({ kind: undefined })])).toMatchObject({ rolls: 3, consumableLines: 0 });
  });
});
