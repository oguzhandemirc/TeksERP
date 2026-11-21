// =============================================================================
// BEKÇİ — Mal kabul iplik satırı: tedarikçi kalem kodundan iplik kartı önerisi (Seyitoğlu d5)
// =============================================================================
// Kart boşsa eşli kart doldurulur; doluysa EZİLMEZ, "Eşli kartı kullan" ipucu çıkar; fason/tedarikçisiz fişte öneri sorulmaz.
// Negatif sonda: `if (!l.itemId)` koşulu kaldırılınca "dolu kart ezilmez" ❌; supplierId kapısı kalkınca "sorulmaz" ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ReceiptYarnRow } from "./ReceiptYarnRow";
import { emptyLine, type DraftLine } from "./receiptLineTypes";
import { supplierItemCodeService } from "./supplierItemCodeService";

vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { "aria-label"?: string; value?: string | null }) => <button type="button" aria-label={p["aria-label"]}>{p.value ?? "—"}</button>,
}));
vi.mock("./supplierItemCodeService", () => ({ supplierItemCodeService: { suggest: vi.fn() } }));

const suggest = vi.mocked(supplierItemCodeService.suggest);
const MATCH = { id: "m1", itemId: "yarn-A", itemCode: "IP-A", itemName: "İplik A", hitCount: 3 };

function renderRow(line: Partial<DraftLine>, supplierId: string | null = "sup-1") {
  const onPatch = vi.fn();
  renderWithProviders(
    <ReceiptYarnRow line={{ ...emptyLine("YARN"), supplierItemCode: "153.01.0652", ...line }} onPatch={onPatch} onDuplicate={() => {}} onRemove={() => {}} removeDisabled={false} supplierId={supplierId} />,
  );
  return onPatch;
}

describe("İplik satırı — tedarikçi kalem kodu önerisi", () => {
  beforeEach(() => {
    suggest.mockReset();
    suggest.mockResolvedValue({ success: true, data: { code: "153.01.0652", match: MATCH } });
  });

  it("kart boşken koddan çıkınca eşli kart doldurulur", async () => {
    const onPatch = renderRow({ itemId: "" });
    fireEvent.blur(screen.getByLabelText("Tedarikçi kalem kodu"));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ itemId: "yarn-A" }));
    expect(suggest).toHaveBeenCalledWith("sup-1", "153.01.0652");
  });

  it("dolu kart ezilmez; ipucu düğmesiyle uygulanır", async () => {
    const onPatch = renderRow({ itemId: "yarn-B" });
    fireEvent.blur(screen.getByLabelText("Tedarikçi kalem kodu"));
    const hint = await screen.findByTestId("supplier-code-hint");
    expect(onPatch).not.toHaveBeenCalled();
    expect(hint).toHaveTextContent("İplik A");
    fireEvent.click(screen.getByRole("button", { name: "Eşli kartı kullan" }));
    expect(onPatch).toHaveBeenCalledWith({ itemId: "yarn-A" });
  });

  it("cari tedarikçi yoksa (fason bacağı) öneri sorulmaz", async () => {
    renderRow({ itemId: "" }, null);
    fireEvent.blur(screen.getByLabelText("Tedarikçi kalem kodu"));
    await Promise.resolve();
    expect(suggest).not.toHaveBeenCalled();
  });
});
