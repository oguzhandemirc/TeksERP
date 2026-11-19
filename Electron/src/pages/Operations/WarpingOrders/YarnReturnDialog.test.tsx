// =============================================================================
// BEKÇİ — devere iade penceresinde FİRE + otomatik kapanış bilgisi (iade-fire 2026-11-19)
// =============================================================================
//   ① Başlık iplik ADI birincil, kod ikincil; "Kalanın hepsini fire yaz" fire = tutma − iade; canlı özet üç sayı.
//   ② İade + fire > tutma → hata satırı, kaydet kapalı.
//   ③ Tolerans aşımı → uyarı + onay kutusu; onaysız kaydet kapalı; gövde wasteKg + wasteReason + token.
//   ④ willClose → "Kaydedince sipariş kapanır" bilgisi; fire yokken gövdede fire alanı yok.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere iade penceresinde fire + otomatik kapanış".
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { WarpingYarnHolding, WarpingYarnReturnPreview } from "./holding-types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const svc = vi.hoisted(() => ({ returnYarn: vi.fn(), returnPreview: vi.fn() }));
vi.mock("./holding-service", () => ({ warpingHoldingService: svc }));
vi.mock("@/pages/ReasonPresets/service", () => ({
  reasonPresetService: { list: vi.fn(async () => [{ kind: "YARN_SUBCONTRACT_RETURN", code: "KALAN", label: "Kalan iplik", isActive: true }]) },
}));
vi.mock("@/hooks/useWarehouses", () => ({ useMultiWarehouse: () => ({ multiWarehouse: false, warehouses: [], isLoading: false }) }));

import { YarnReturnDialog } from "./YarnReturnDialog";

const holding: WarpingYarnHolding = {
  dispatchItemId: "i1", dispatchId: "d1", dispatchNo: "FS1", dispatchedAt: "2026-11-18T08:00:00Z", ownWarpingOrderId: "wo-1", own: true, yarnItemId: "y1",
  lotId: null, lotNo: null, ownerCustomerId: null, outKg: "300.000", returnedKg: "0.000", transferInKg: "0.000", transferOutKg: "0.000", holdingKg: "288.750",
};
const names = new Map([["y1", { code: "IPL-70", name: "70/800 Polyester" }]]);
const preview = (over: Partial<WarpingYarnReturnPreview> = {}): WarpingYarnReturnPreview => ({
  holdingKg: "288.750", returnKg: "280.000", wasteKg: "8.750", keepKg: "0.000", wastePct: "3.10", tolerancePct: "2.00", overTolerance: false, willClose: false, warnings: [], ...over,
});

async function open() {
  const user = userEvent.setup();
  renderWithProviders(<YarnReturnDialog orderId="wo-1" holding={holding} names={names} exitWarehouseName="Merkez Depo" onClose={() => {}} />);
  const dlg = await screen.findByRole("dialog");
  const kg = within(dlg).getByLabelText(/İade kg/) as HTMLInputElement;
  const waste = within(dlg).getByLabelText(/Kullanılamaz \(fire\) kg/) as HTMLInputElement;
  const save = () => within(dlg).getByRole("button", { name: "İadeyi kaydet" }) as HTMLButtonElement;
  const pickReason = async () => {
    await user.click(within(dlg).getByRole("combobox", { name: "İade sebebi" }));
    await user.click(await screen.findByRole("option", { name: "Kalan iplik" }));
  };
  return { user, dlg, kg, waste, save, pickReason };
}

describe("YarnReturnDialog — iade + fire", () => {
  beforeEach(() => {
    svc.returnYarn.mockReset().mockResolvedValue({ success: true, data: {}, message: "iade alındı" });
    svc.returnPreview.mockReset().mockResolvedValue(preview());
  });

  it("① başlık adı birincil; kalanın hepsini fire yaz; canlı özet", async () => {
    const { user, dlg, kg, waste } = await open();
    expect(within(dlg).getByRole("heading").textContent).toBe("70/800 Polyester — devereciden iade alIPL-70");
    await user.clear(kg);
    await user.type(kg, "280");
    await user.click(within(dlg).getByRole("button", { name: "Kalanın hepsini fire yaz" }));
    expect(waste.value).toBe("8,75");
    const sum = within(dlg).getByLabelText("İade özeti");
    expect(sum.textContent).toContain("280,000 kg");
    expect(sum.textContent).toContain("8,750 kg");
    expect(sum.textContent).toContain("Deverecide kalacak0,000 kg");
  });

  it("② iade + fire tutmayı aşarsa hata ve kaydet kapalı", async () => {
    const { user, dlg, kg, waste, save, pickReason } = await open();
    await pickReason();
    await user.clear(kg);
    await user.type(kg, "280");
    await user.type(waste, "9");
    expect(within(dlg).getByRole("alert").textContent).toMatch(/deverecide tutulanı \(288,750 kg\) aşıyor/);
    expect(save().disabled).toBe(true);
  });

  it("③ tolerans aşımı onay ister; gövde fire + gerekçe + token taşır", async () => {
    svc.returnPreview.mockResolvedValue(preview({ overTolerance: true }));
    const { user, dlg, kg, waste, save, pickReason } = await open();
    await pickReason();
    await user.clear(kg);
    await user.type(kg, "280");
    await user.type(waste, "8,75");
    expect(await within(dlg).findByText("Fire toleransı aşıyor")).toBeTruthy();
    expect(svc.returnPreview).toHaveBeenLastCalledWith("wo-1", { dispatchItemId: "i1", qtyKg: 280, wasteKg: 8.75 });
    expect(save().disabled).toBe(true);
    await user.type(within(dlg).getByLabelText("Fire gerekçesi"), "ıslak bobin");
    await user.click(within(dlg).getByLabelText(/Toleransı aştığını gördüm/));
    expect(save().disabled).toBe(false);
    await user.click(save());
    await waitFor(() => expect(svc.returnYarn).toHaveBeenCalledWith("wo-1", {
      dispatchItemId: "i1", qtyKg: 280, reasonCode: "KALAN", wasteKg: 8.75, wasteReason: "ıslak bobin", clientToken: expect.any(String),
    }));
  });

  it("④ kalan sıfırlanırsa 'sipariş kapanır' bilgisi; firesiz gövdede fire alanı yok", async () => {
    svc.returnPreview.mockResolvedValue(preview({ returnKg: "288.750", wasteKg: "0.000", willClose: true }));
    const { user, dlg, save, pickReason } = await open();
    expect(await within(dlg).findByText("Kaydedince sipariş kapanır")).toBeTruthy();
    await pickReason();
    await user.click(save());
    await waitFor(() => expect(svc.returnYarn).toHaveBeenCalledWith("wo-1", { dispatchItemId: "i1", qtyKg: 288.75, reasonCode: "KALAN", clientToken: expect.any(String) }));
  });
});
