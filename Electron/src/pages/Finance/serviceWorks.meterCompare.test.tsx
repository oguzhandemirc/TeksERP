// Hizmet taslağı iş kırılımı: `meterCompare` varsa "Beyan · Ölçülen · Faturalanan" alt satırı; yoksa görünüm bugünkü gibi.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ServiceWorksBreakdown } from "./ServiceWorksBreakdown";
import { basisLabel, meterCompareText, type ServiceDraftWorkRow } from "./serviceWorks";

const row = (o: Partial<ServiceDraftWorkRow> = {}): ServiceDraftWorkRow => ({
  source: "LEAD", subjectKind: "ROLL", subjectId: "r1", subjectCode: "T1", serviceItemId: "s1", processLabel: "Kurşun",
  workOrderStepId: null, qty: "540", unit: "METER", meterBasis: "MAX_DECLARED", unitPrice: "2", excludedReason: null, ...o,
});

describe("meterCompareText", () => {
  it("alan yoksa null", () => expect(meterCompareText(undefined)).toBeNull());
  it("üç değer + taban", () => {
    expect(meterCompareText({ declaredM: 500, measuredM: 540, billedM: 540, basis: "MEASURED" })).toBe("Beyan 500 m · Ölçülen 540 m · Faturalanan 540 m (ölçülen)");
    expect(meterCompareText({ declaredM: 500, measuredM: null, billedM: 500, basis: "DECLARED" })).toBe("Beyan 500 m · Ölçülen — · Faturalanan 500 m (beyan)");
  });
  it("MAX_DECLARED tabanının etiketi var", () => expect(basisLabel("MAX_DECLARED")).not.toBe("—"));
});

describe("ServiceWorksBreakdown meterCompare", () => {
  it("alan yok → alt satır çizilmez", () => {
    renderWithProviders(<ServiceWorksBreakdown rows={[row()]} currency="TRY" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByTestId("service-work-meter-compare")).toBeNull();
  });
  it("alan var → alt satır", () => {
    renderWithProviders(<ServiceWorksBreakdown rows={[row({ meterCompare: { declaredM: 500, measuredM: 540, billedM: 540, basis: "MEASURED" } })]} currency="TRY" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("service-work-meter-compare")).toHaveTextContent("Beyan 500 m · Ölçülen 540 m");
  });
});
