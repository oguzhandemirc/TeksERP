// SY-E2 fason sevk kg kontrol satırı: modül kapalı / izinsiz → sorgu atılmaz; satır yoksa DOM boş (0 gösterilmez);
// satır + fatura farkı metni.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { FinishingCheckResult } from "./FasonFinishingCheckLine";

const state = vi.hoisted(() => ({ maliyet: true, perms: ["cost:read"] as string[], result: null as unknown }));
const get = vi.hoisted(() => vi.fn());

vi.mock("@/services/apiClient", () => ({ default: { get } }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useMaliyetEnabled: () => state.maliyet }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => state.perms.includes(p) }) }));

const { FasonFinishingCheckLine } = await import("./FasonFinishingCheckLine");

const line = (over: Partial<NonNullable<FinishingCheckResult["line"]>> = {}): FinishingCheckResult => ({
  reason: null,
  line: {
    rateCode: "BOYA-R", rateName: "Boya renkli", currency: "USD", pricePerKg: "0.9000", totalKg: "20.000",
    weighedCount: 2, unweighedCount: 0, expectedAmount: "18.00", invoice: null, ...over,
  },
});

beforeEach(() => {
  state.maliyet = true;
  state.perms = ["cost:read"];
  get.mockReset();
  get.mockImplementation(async () => ({ data: { success: true, data: state.result } }));
});

describe("FasonFinishingCheckLine", () => {
  it("beklenen tutarı ve kg × tarife açıklamasını gösterir", async () => {
    state.result = line();
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d1" open />);
    const el = await screen.findByTestId("fason-kg-kontrol");
    expect(el.textContent).toContain("18,00 USD");
    expect(el.textContent).toContain("20,000 kg");
    expect(get).toHaveBeenCalledWith("/api/cost/subcontractor-dispatches/d1/finishing-check");
  });

  it("fatura farkını işaretiyle gösterir", async () => {
    state.perms = ["cost:read", "finance:read"];
    state.result = line({ invoice: { docNos: ["AF-1"], hasDraft: false, currency: "USD", netAmount: "19.40", difference: "1.40", coversOtherDispatches: false } });
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d2" open />);
    expect((await screen.findByTestId("fason-kg-kontrol")).textContent).toContain("Fark +1,40 USD");
  });

  it("kısmi kabul faturasında fark yerine açıklama gösterir", async () => {
    state.perms = ["cost:read", "finance:read"];
    state.result = line({ invoice: { docNos: ["AF-2"], hasDraft: false, currency: "USD", netAmount: "7.00", difference: null, coversOtherDispatches: false, partial: true } });
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d6" open />);
    expect((await screen.findByTestId("fason-kg-kontrol")).textContent).toContain("yalnız bir kısmını kapsıyor");
  });

  it("farklı dövizli faturada kur çevrilmez — 'farklı döviz' uyarısı (#377)", async () => {
    state.perms = ["cost:read", "finance:read"];
    state.result = line({ invoice: { docNos: ["AF-4"], hasDraft: false, currency: "TRY", netAmount: "700.00", difference: null, coversOtherDispatches: false, partial: false, currencyMismatch: true } });
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d8" open />);
    const text = (await screen.findByTestId("fason-kg-kontrol")).textContent ?? "";
    expect(text).toContain("Farklı döviz — kur çevrilmez");
    expect(text).not.toContain("Fark ");
  });

  it("sevk tarihindeki tarifeyi ve ilk sürüme düşüşü yazar (#377)", async () => {
    state.result = line({ rateAsOf: "2026-10-05", rateFallback: true });
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d9" open />);
    const text = (await screen.findByTestId("fason-kg-kontrol")).textContent ?? "";
    expect(text).toContain("05.10.2026 sevk tarihindeki tarife");
    expect(text).toContain("ilk tarife kullanıldı");
  });

  it("finance:read yoksa fatura parçası çizilmez", async () => {
    state.result = line({ invoice: { docNos: ["AF-3"], hasDraft: false, currency: "USD", netAmount: "19.40", difference: "1.40", coversOtherDispatches: false } });
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d7" open />);
    const el = await screen.findByTestId("fason-kg-kontrol");
    expect(el.textContent).toContain("18,00 USD");
    expect(el.textContent).not.toContain("AF-3");
  });

  it("satır yoksa (tarife yok) hiçbir şey çizmez — 0 gösterilmez", async () => {
    state.result = { line: null, reason: "NOT_KG_BASIS" };
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d3" open />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByTestId("fason-kg-kontrol")).toBeNull();
  });

  it("cost:read yoksa ya da maliyet modülü kapalıysa sorgu ATILMAZ", () => {
    state.perms = [];
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d4" open />);
    state.perms = ["cost:read"];
    state.maliyet = false;
    renderWithProviders(<FasonFinishingCheckLine dispatchId="d5" open />);
    expect(get).not.toHaveBeenCalled();
  });
});
