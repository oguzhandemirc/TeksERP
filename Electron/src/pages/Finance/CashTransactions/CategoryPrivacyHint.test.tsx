// D4-H2: masraf formunda kategori alanının "kişi adı yazmayın" ipucu — yalnız masrafta çizilir.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CategoryPrivacyHint, EXPENSE_CATEGORY_PRIVACY_HINT } from "./CategoryPrivacyHint";

describe("CategoryPrivacyHint", () => {
  it("masrafta kişi adı ipucunu gösterir", () => {
    render(<CategoryPrivacyHint active />);
    expect(screen.getByTestId("kategori-kisi-adi-ipucu").textContent).toBe(EXPENSE_CATEGORY_PRIVACY_HINT);
    expect(EXPENSE_CATEGORY_PRIVACY_HINT).toMatch(/kişi adı yazmayın/);
  });
  it("masraf dışında çizilmez", () => {
    const { container } = render(<CategoryPrivacyHint active={false} />);
    expect(container.innerHTML).toBe("");
  });
});
