// =============================================================================
// BEKÇİ — Mal kabul satır editörü: ÜÇ MOD (kumaş-only / iplik-only / karma) — başlık ↔ hücre eşleşmesi
// (bulgu #4) + iplik-only'de Kg/Kat/Özellik sütunu HİÇ YOK, karma'da iplik satırında "—" YOK (bulgu C1)
// =============================================================================
// Negatif sonda: tabloda "Renk / Lot" → "Renk" yapılınca (karma) ❌; iplik satırında Lot hücresi başka dizine
// kaydırılınca ❌; Kg sütununun `yarnOnly`si null'dan "Kg"ye çevrilince "iplik-only'de Kg başlığı YOK" ❌.
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { RECEIPT_LINE_COLUMNS, cellLabel, receiptLineGridCols, receiptLineHeaders, receiptLineMode, visibleColumnIndexes } from "./receiptLineColumns";
import { ReceiptLineRows, emptyLine } from "./ReceiptLineRows";

vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [{ code: "2-KAT", name: "2 Kat" }] }) }));
vi.mock("@/components/forms/ReferenceSelect", () => ({
  ReferenceSelect: (p: { "aria-label"?: string; placeholder?: string }) => <button type="button" aria-label={p["aria-label"]}>{p.placeholder}</button>,
}));
// Ürün hücresi artık modal seçici (`ItemSelect`, 2026-09-17) — etiket sözleşmesi aynı (`cellLabel(0, yarn)`).
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { "aria-label"?: string; placeholder?: string }) => <button type="button" aria-label={p["aria-label"]}>{p.placeholder}</button>,
}));
vi.mock("./LinePropertiesButton", () => ({
  LinePropertiesButton: (p: { "aria-label"?: string }) => <button type="button" aria-label={p["aria-label"]}>Özellik</button>,
}));

const YARN = new Set(["yarn-1"]);
const fabricLine = () => ({ ...emptyLine(), itemId: "fab-1" });
const yarnLine = () => ({ ...emptyLine(), itemId: "yarn-1" });
const headerTexts = () => Array.from(screen.getByTestId("receipt-line-headers").querySelectorAll("span")).map((s) => s.textContent).filter((t) => t);

/** Satırın i. grid hücresi — hücre bir sarmalayıcı div ise içindeki etiketli elemanı bul. */
function cellLabelAt(row: HTMLElement, i: number): string | null {
  const cell = row.children[i] as HTMLElement;
  const labelled = cell.getAttribute("aria-label") ? cell : cell.querySelector("[aria-label]");
  return labelled?.getAttribute("aria-label") ?? null;
}

describe("Mal kabul satır editörü — üç mod", () => {
  it("mod türetimi: boş/kumaş → fabric · yalnız iplik → yarn · ikisi → mixed; iplik-only'de Kg/Kat/Özellik dizinleri (4,5,7) çizilmez", () => {
    expect(receiptLineMode(false, false)).toBe("fabric");
    expect(receiptLineMode(true, false)).toBe("fabric");
    expect(receiptLineMode(false, true)).toBe("yarn");
    expect(receiptLineMode(true, true)).toBe("mixed");
    expect(visibleColumnIndexes("fabric")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(visibleColumnIndexes("mixed")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(visibleColumnIndexes("yarn")).toEqual([0, 1, 2, 3, 6, 8]);
    expect(receiptLineGridCols("yarn")).not.toBe(receiptLineGridCols("mixed"));
    expect(receiptLineGridCols("fabric")).toBe(receiptLineGridCols("mixed"));
  });

  it("KUMAŞ-ONLY: eski başlık bayt bayt", () => {
    expect(receiptLineHeaders("fabric")).toEqual(["Kumaş / İplik", "Renk", "Metre", "En (cm)", "Kg", "Kat", "Birim Fiyat", "Özellik", "Adet"]);
    renderWithProviders(<ReceiptLineRows lines={[fabricLine()]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(headerTexts()).toEqual(receiptLineHeaders("fabric"));
    expect(screen.getByTestId("receipt-line-headers")).toHaveAttribute("data-mode", "fabric");
  });

  it("⭐ İPLİK-ONLY (C1): başlıklar iplik diliyle, 'Kg' başlığı YOK, Kg/Kat/Özellik hücresi YOK; her hücre kendi başlığının altında", () => {
    expect(receiptLineHeaders("yarn")).toEqual(["Kumaş / İplik", "Lot", "Miktar (kg)", "Bobin", "Birim Fiyat", "Adet"]);
    renderWithProviders(<ReceiptLineRows lines={[yarnLine()]} onChange={() => {}} yarnItemIds={YARN} />);
    const heads = headerTexts();
    expect(heads).toEqual(["Kumaş / İplik", "Lot", "Miktar (kg)", "Bobin", "Birim Fiyat", "Adet"]); // ilk sütun HER modda (bulgu 2026-09-17)
    expect(heads).not.toContain("Kg");
    expect(screen.getByTestId("receipt-line-headers")).toHaveAttribute("data-mode", "yarn");
    const row = screen.getByTestId("receipt-line-yarn");
    expect(row.children).toHaveLength(7); // 6 sütun + işlemler
    expect(screen.queryByRole("note")).toBeNull(); // boş/tire hücresi hiç yok
    visibleColumnIndexes("yarn").forEach((colIdx, pos) => {
      expect(cellLabelAt(row, pos), `iplik-only sütun ${pos} (${heads[pos]})`).toBe(RECEIPT_LINE_COLUMNS[colIdx]!.yarnLabel);
    });
    expect(screen.queryByLabelText(/^Kg — /)).toBeNull();
  });

  it("⭐ KARMA: başlık iki türü anlatır; iplik satırının Kg/Kat/Özellik hücresi BOŞ (tire YOK) ama etiket/ipucu var; her hücre aynı dizindeki başlığın etiketini taşır", () => {
    renderWithProviders(<ReceiptLineRows lines={[fabricLine(), yarnLine()]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(headerTexts()).toEqual(receiptLineHeaders("mixed"));
    expect(headerTexts().slice(0, 4)).toEqual(["Kumaş / İplik", "Renk / Lot", "Miktar (m / kg)", "En (cm) / Bobin"]);
    const yarnRow = screen.getByTestId("receipt-line-yarn");
    const fabricRow = screen.getByTestId("receipt-line-fabric");
    RECEIPT_LINE_COLUMNS.forEach((c, i) => {
      expect(cellLabelAt(yarnRow, i), `iplik sütun ${i} (${c.mixed})`).toBe(c.yarnLabel);
      expect(cellLabelAt(fabricRow, i), `kumaş sütun ${i} (${c.fabric})`).toBe(c.fabricLabel);
    });
    const kgCell = within(yarnRow).getByRole("note", { name: /^Kg — iplikte miktar zaten kg/ });
    expect(kgCell).toHaveTextContent("");
    expect(within(yarnRow).queryByText("—")).toBeNull();
    expect(cellLabel(1, true)).toBe("Lot numarası");
  });

  it("bobin placeholder '—' (66px); adet iplikte açık, title defter satırını anlatır", () => {
    renderWithProviders(<ReceiptLineRows lines={[yarnLine()]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(screen.getByLabelText("Bobin adedi")).toHaveAttribute("placeholder", "—");
    const adet = screen.getByLabelText("Adet (doğacak iplik defter satırı sayısı)");
    expect(adet).not.toBeDisabled();
    expect(adet.getAttribute("title")).toMatch(/defter satırı/);
  });
});
