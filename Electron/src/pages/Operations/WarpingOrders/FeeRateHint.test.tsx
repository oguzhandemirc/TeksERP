// Devere ücreti tarife önerisi: devereci seçilince aktif tarife alanları doldurur · ezilince "tariften farklı"
// notu · tarifesiz firmada "Tarife tanımla" bağlantısı · düzenlemede kayıtlı fiyat korunur.
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { FinishingRate } from "@/pages/Cost/FinishingRates/service";
import { FeeRateHint } from "./FeeRateHint";
import { emptyOrderForm, type WarpingOrderFormState } from "./order-model";

const listForSubcontractor = vi.fn<(id: string) => Promise<FinishingRate[]>>();
vi.mock("@/pages/Cost/FinishingRates/service", async (orig) => ({
  ...(await orig<typeof import("@/pages/Cost/FinishingRates/service")>()),
  finishingRateService: { listForSubcontractor: (id: string) => listForSubcontractor(id) },
}));
vi.mock("@/hooks/usePricingEnabled", () => ({ useMaliyetEnabled: () => true }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

const rate = (p: Partial<FinishingRate>): FinishingRate => ({
  id: "r1", code: "DEV-1", name: "Devere metre", subcontractorId: "s1", basis: "RAW_M", currency: "EUR",
  pricePerM: "0.1200", typicalShrinkPct: null, note: null, revokedAt: null, createdAt: "2026-11-01T00:00:00.000Z",
  subcontractor: { id: "s1", name: "Devereci" }, ...p,
});

function Harness({ init, autoFill = true }: { init: Partial<WarpingOrderFormState>; autoFill?: boolean }) {
  const [s, setS] = useState(() => emptyOrderForm({ subcontractorId: "s1", ...init }));
  return (
    <>
      <input aria-label="fiyat" value={s.feeUnitPrice} onChange={(e) => setS((x) => ({ ...x, feeUnitPrice: e.target.value }))} />
      <output data-testid="fee">{`${s.feeUnit}|${s.feeUnitPrice}|${s.feeCurrency}`}</output>
      <FeeRateHint s={s} up={(p) => setS((x) => ({ ...x, ...p }))} autoFill={autoFill} />
    </>
  );
}

describe("FeeRateHint", () => {
  beforeEach(() => listForSubcontractor.mockReset());

  it("devereci seçilince aktif tarife birim/fiyat/parayı doldurur; ezilince not çıkar", async () => {
    listForSubcontractor.mockResolvedValue([rate({ basis: "KG", pricePerM: 0.5 as unknown as string })]);
    renderWithProviders(<Harness init={{}} />);
    await waitFor(() => expect(screen.getByTestId("fee").textContent).toBe("KG|0.5|EUR"));
    expect(listForSubcontractor).toHaveBeenCalledWith("s1");
    expect(screen.getByTestId("wo-fee-rate-applied")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("fiyat"), { target: { value: "0.6" } });
    expect(screen.getByTestId("wo-fee-rate-diff").textContent).toContain("tarife: 0,5 EUR/kg");
  });

  it("tarifesiz firmada alan boş kalır ve 'Tarife tanımla' bağlantısı tarife ekranına gider", async () => {
    listForSubcontractor.mockResolvedValue([]);
    renderWithProviders(<Harness init={{}} />);
    const link = await screen.findByRole("link", { name: "Tarife tanımla" });
    expect(link.getAttribute("href")).toContain("/cost/finishing-rates");
    expect(screen.getByTestId("fee").textContent).toBe("METRE||USD");
  });

  it("eşleşmeyen birimde (mamul metre) doldurmaz, not gösterir; düzenlemede kayıtlı fiyat korunur", async () => {
    listForSubcontractor.mockResolvedValue([rate({ basis: "FINISHED_M" })]);
    const { unmount } = renderWithProviders(<Harness init={{}} />);
    await screen.findByTestId("wo-fee-rate-unmatched");
    expect(screen.getByTestId("fee").textContent).toBe("METRE||USD");
    unmount();
    listForSubcontractor.mockResolvedValue([rate({})]);
    renderWithProviders(<Harness init={{ feeUnitPrice: "0.2", feeCurrency: "USD" }} autoFill={false} />);
    await screen.findByTestId("wo-fee-rate-diff");
    expect(screen.getByTestId("fee").textContent).toBe("METRE|0.2|USD");
  });
});
