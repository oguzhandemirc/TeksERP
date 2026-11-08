// BEKÇİ — hizmet taslağının iş kırılımı (fason F4/F9 `serviceWorks?`): backend ne dönerse onu gösterir; yoksa
// bölüm hiç çizilmez (eski backend); hariç (yeniden işlem) satır işaretli; ham enum kodu ekrana basılmaz.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ServiceWorksBreakdown } from "./ServiceWorksBreakdown";
import { sortServiceWorks, sourceLabel, summarizeServiceWorks, type ServiceDraftWorkRow } from "./serviceWorks";

const row = (o: Partial<ServiceDraftWorkRow>): ServiceDraftWorkRow => ({
  source: "STEP", subjectKind: "ROLL", subjectId: "r1", subjectCode: "T0001", serviceItemId: "s1", processLabel: "Boya",
  workOrderStepId: "st1", qty: "120.5", unit: "METER", meterBasis: "RECEIVED", unitPrice: "3.25", excludedReason: null, ...o,
});

describe("ServiceWorksBreakdown", () => {
  it("⭐ alan yoksa / boşsa hiç çizilmez (eski backend ⇒ ekran bugünkü)", () => {
    const { container, rerender } = render(<ServiceWorksBreakdown rows={undefined} currency="TRY" />);
    expect(container.innerHTML).toBe("");
    rerender(<ServiceWorksBreakdown rows={[]} currency="TRY" />);
    expect(container.innerHTML).toBe("");
  });

  it("⭐ levent sarımı, dokuma, adım satırları Türkçe etiketle; hariç satır rozetli ve sayımda ayrı", () => {
    render(
      <ServiceWorksBreakdown
        currency="TRY"
        rows={[
          row({}),
          row({ source: "WINDING", subjectKind: "WARP_BEAM", subjectId: "b1", subjectCode: "LV-7", processLabel: "Sarım", meterBasis: "WOUND", workOrderStepId: null }),
          row({ source: "WEAVING", subjectId: "r2", subjectCode: "T0002", processLabel: "Dokuma", meterBasis: "WOVEN" }),
          row({ subjectId: "r3", subjectCode: "T0003", excludedReason: "REWORK_OUR_FAULT" }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /İş kırılımı — 3 iş/ })).toHaveTextContent("1 iş faturasız");
    fireEvent.click(screen.getByRole("button", { name: /İş kırılımı/ }));
    expect(screen.getByText("Levent sarımı")).toBeInTheDocument();
    expect(screen.getByText("LV-7")).toBeInTheDocument();
    expect(screen.getAllByText("Dokuma").length).toBeGreaterThan(0);
    expect(screen.getByText("Faturasız — yeniden işlem")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/WINDING|WEAVING|WARP_BEAM|REWORK_OUR_FAULT/);
  });

  it("sıralama: faturalanan önce, hariç sonda; bilinmeyen kaynak ham kod değil", () => {
    const sorted = sortServiceWorks([row({ excludedReason: "REWORK_OUR_FAULT", subjectCode: "A" }), row({ source: "LEAD", subjectCode: "B" })]);
    expect(sorted.map((r) => r.subjectCode)).toEqual(["B", "A"]);
    expect(summarizeServiceWorks(sorted)).toEqual({ billed: 1, excluded: 1 });
    expect(sourceLabel("YENI")).toBe("Diğer");
  });
});
