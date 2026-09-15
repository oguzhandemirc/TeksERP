// =============================================================================
// BEKÇİ — Mal kabul satır editörü: başlık ↔ hücre eşleşmesi (kullanıcı testi bulgusu #4, 2026-09-16)
// =============================================================================
// İplik satırı varken başlık iki türü de anlatır; iplik satırının her hücresinin erişilebilir adı
// AYNI sütun dizinindeki başlıkla aynı tablodan gelir (`receiptLineColumns.ts`). Negatif sonda:
// tabloda "Renk / Lot" satırı "Renk" yapılınca ① ❌; iplik satırında Lot hücresi 3. sütuna kaydırılınca ② ❌.
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { RECEIPT_LINE_COLUMNS, cellLabel, receiptLineHeaders } from "./receiptLineColumns";
import { ReceiptLineRows, emptyLine } from "./ReceiptLineRows";

vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [{ code: "2-KAT", name: "2 Kat" }] }) }));
vi.mock("@/components/forms/ReferenceSelect", () => ({
  ReferenceSelect: (p: { "aria-label"?: string; placeholder?: string }) => <button type="button" aria-label={p["aria-label"]}>{p.placeholder}</button>,
}));
vi.mock("./LinePropertiesButton", () => ({
  LinePropertiesButton: (p: { "aria-label"?: string }) => <button type="button" aria-label={p["aria-label"]}>Özellik</button>,
}));

const YARN = new Set(["yarn-1"]);
const lines = () => [{ ...emptyLine(), itemId: "fab-1" }, { ...emptyLine(), itemId: "yarn-1" }];

/** Satırın i. grid hücresi — hücre bir sarmalayıcı div ise içindeki etiketli elemanı bul. */
function cellLabelAt(row: HTMLElement, i: number): string | null {
  const cell = row.children[i] as HTMLElement;
  const labelled = cell.getAttribute("aria-label") ? cell : cell.querySelector("[aria-label]");
  return labelled?.getAttribute("aria-label") ?? null;
}

describe("Mal kabul satır editörü — başlık ↔ hücre", () => {
  it("yalnız kumaş satırı: eski başlık bayt bayt", () => {
    expect(receiptLineHeaders(false)).toEqual(["Kumaş", "Renk", "Metre", "En (cm)", "Kg", "Kat", "Birim Fiyat", "Özellik", "Adet"]);
    renderWithProviders(<ReceiptLineRows lines={[{ ...emptyLine(), itemId: "fab-1" }]} onChange={() => {}} yarnItemIds={YARN} />);
    expect(within(screen.getByTestId("receipt-line-headers")).getByText("Renk")).toBeInTheDocument();
    expect(screen.queryByText("Renk / Lot")).toBeNull();
  });

  it("⭐ ① iplik satırı varken başlık iki türü anlatır: Kumaş / İplik · Renk / Lot · Miktar (m / kg) · En (cm) / Bobin", () => {
    renderWithProviders(<ReceiptLineRows lines={lines()} onChange={() => {}} yarnItemIds={YARN} />);
    const heads = Array.from(screen.getByTestId("receipt-line-headers").querySelectorAll("span")).map((s) => s.textContent);
    expect(heads.slice(0, 9)).toEqual(receiptLineHeaders(true));
    expect(heads.slice(0, 4)).toEqual(["Kumaş / İplik", "Renk / Lot", "Miktar (m / kg)", "En (cm) / Bobin"]);
  });

  it("⭐ ② iplik satırının her hücresi AYNI dizindeki başlığın etiketini taşır (Lot 'Renk / Lot' altında, kg 'Miktar' altında, bobin 'En / Bobin' altında, Kg hücresi '—' + nedeni)", () => {
    renderWithProviders(<ReceiptLineRows lines={lines()} onChange={() => {}} yarnItemIds={YARN} />);
    const yarnRow = screen.getByTestId("receipt-line-yarn");
    const fabricRow = screen.getByTestId("receipt-line-fabric");
    RECEIPT_LINE_COLUMNS.forEach((c, i) => {
      expect(cellLabelAt(yarnRow, i), `iplik sütun ${i} (${c.mixed})`).toBe(c.yarnLabel);
      expect(cellLabelAt(fabricRow, i), `kumaş sütun ${i} (${c.fabric})`).toBe(c.fabricLabel);
    });
    expect(cellLabel(1, true)).toBe("Lot numarası");
    expect(cellLabel(2, true)).toBe("Miktar (kg)");
    expect(cellLabel(4, true)).toMatch(/^Kg — iplikte miktar zaten kg/);
    expect(within(yarnRow).getByRole("note", { name: /Kg — iplikte/ })).toHaveTextContent("—");
  });

  it("bobin hücresinin placeholder'ı 66px'e sığar ('—'); adet iplikte de açık, title defter satırını anlatır", () => {
    renderWithProviders(<ReceiptLineRows lines={lines()} onChange={() => {}} yarnItemIds={YARN} />);
    const bobin = screen.getByLabelText("Bobin adedi");
    expect(bobin).toHaveAttribute("placeholder", "—");
    const adet = screen.getByLabelText("Adet (doğacak iplik defter satırı sayısı)");
    expect(adet).not.toBeDisabled();
    expect(adet.getAttribute("title")).toMatch(/defter satırı/);
  });
});
