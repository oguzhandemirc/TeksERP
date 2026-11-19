import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceiptIntro, receiptIntroKind } from "./ReceiptIntro";

describe("Mal kabul üst açıklaması — Adet satır türüne göre", () => {
  it("tür seçimi: yalnız iplik → iplik, kumaş+iplik → karışık, kumaş/sarf/boş → kumaş", () => {
    expect(receiptIntroKind(["YARN"])).toBe("YARN");
    expect(receiptIntroKind(["YARN", "CONSUMABLE"])).toBe("YARN");
    expect(receiptIntroKind(["FABRIC", "YARN"])).toBe("MIXED");
    expect(receiptIntroKind(["FABRIC"])).toBe("FABRIC");
    expect(receiptIntroKind(["CONSUMABLE"])).toBe("FABRIC");
    expect(receiptIntroKind([])).toBe("FABRIC");
  });

  it("yalnız iplik satırında top/barkod denmez; defter satırı ve kg anlatılır", () => {
    render(<ReceiptIntro kinds={["YARN"]} />);
    const t = screen.getByTestId("receipt-intro").textContent ?? "";
    expect(t).toContain("iplik defter satırı");
    expect(t).not.toContain("barkod");
  });

  it("karışıkta ikisi kısa; kumaşta bugünkü metin", () => {
    const { unmount } = render(<ReceiptIntro kinds={["FABRIC", "YARN"]} />);
    const mixed = screen.getByTestId("receipt-intro").textContent ?? "";
    expect(mixed).toContain("kumaşta kaç top");
    expect(mixed).toContain("iplikte kaç ayrı defter satırı");
    unmount();
    render(<ReceiptIntro kinds={["FABRIC"]} />);
    expect(screen.getByTestId("receipt-intro").textContent).toContain("her top kendi barkoduyla ayrı ayrı doğar");
  });
});
