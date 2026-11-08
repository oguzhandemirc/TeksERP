// Emanet çıkış seçicileri aday ucundan okur: sahip sunucuya gider · engelli satır seçilemez ve nedeni Türkçe ·
// tavan aşımı söylenir · hata "kayıt yok" sanılmaz · iplik adayı depoyu kendisi taşır (lot × depo).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { BeamPicker } from "../BeamPicker";
import { YarnLinePicker } from "../YarnLinePicker";
import type { ConsignmentCandidates } from "../types";

const svc = { candidates: vi.fn() };
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  listConsignmentCandidates: (...a: unknown[]) => svc.candidates(...a),
}));

const DATA: ConsignmentCandidates = {
  ownerCustomer: { id: "cA", name: "Gül Perde" },
  modules: { devere: true, iplik: true },
  beams: [
    { warpBeamId: "b1", beamNo: "LV-1", warpSpecName: "Çözgü A", remainingM: "900.000", blockedReason: null },
    { warpBeamId: "b2", beamNo: "LV-2", warpSpecName: "Çözgü A", remainingM: "0.000", blockedReason: "CONSIGNMENT_BEAM_NOT_READY" },
  ],
  yarns: [
    { lotId: "l1", lotNo: "77", yarnItemId: "i1", itemCode: "IP", itemName: "Polyester", warehouseId: "w2", warehouseName: "Yan Depo", balanceKg: "12.500", blockedReason: null },
    { lotId: "l2", lotNo: "78", yarnItemId: "i1", itemCode: "IP", itemName: "Polyester", warehouseId: "w1", warehouseName: "Ana", balanceKg: "4.000", blockedReason: "YARN_LOT_INACTIVE" },
  ],
  truncated: { beams: true, yarns: false },
};

beforeEach(() => {
  svc.candidates.mockReset();
  svc.candidates.mockResolvedValue(DATA);
});

describe("Levent seçici (aday ucu)", () => {
  it("sahibi sunucuya sorar; engelli levent pasif + Türkçe neden; tavan uyarısı", async () => {
    const onPick = vi.fn();
    renderWithProviders(<BeamPicker open onOpenChange={() => {}} ownerCustomerId="cA" takenKeys={new Set()} onPick={onPick} />);
    expect(await screen.findByText("LV-1")).toBeInTheDocument();
    expect(svc.candidates).toHaveBeenCalledWith("cA", "");
    expect(screen.getByText("LV-2").closest("button")).toBeDisabled();
    expect(screen.getByText("Levent hazır (boşta) değil")).toBeInTheDocument();
    expect(screen.queryByText(/CONSIGNMENT_/)).toBeNull();
    expect(screen.getByTestId("candidates-truncated")).toHaveTextContent("aramayı daraltın");
    fireEvent.click(screen.getByText("LV-1"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "beam:b1", input: { kind: "WARP_BEAM", warpBeamId: "b1" } }));
  });

  it("hata 'yüklenemedi' der; kapalı modül ayrı cümle", async () => {
    svc.candidates.mockRejectedValueOnce(new Error("x"));
    const { unmount } = renderWithProviders(<BeamPicker open onOpenChange={() => {}} ownerCustomerId="cA" takenKeys={new Set()} onPick={() => {}} />);
    expect(await screen.findByText(/Liste yüklenemedi/)).toBeInTheDocument();
    unmount();
    svc.candidates.mockResolvedValueOnce({ ...DATA, modules: { devere: false, iplik: true }, beams: [] });
    renderWithProviders(<BeamPicker open onOpenChange={() => {}} ownerCustomerId="cA" takenKeys={new Set()} onPick={() => {}} />);
    expect(await screen.findByText("Bu kalem türünün modülü kapalı.")).toBeInTheDocument();
  });
});

describe("İplik seçici (aday ucu)", () => {
  it("pasif lot seçilemez; seçilen lot × depo satırı depoyu ve kg'yi taşır", async () => {
    const onPick = vi.fn();
    renderWithProviders(<YarnLinePicker open onOpenChange={() => {}} ownerCustomerId="cA" takenKeys={new Set()} onPick={onPick} />);
    expect(await screen.findByText("Lot 77")).toBeInTheDocument();
    expect(screen.getByText("Lot 78").closest("button")).toBeDisabled();
    expect(screen.getByText(/pasif lottan çıkış/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Lot 77"));
    const kg = await screen.findByLabelText("Miktar (kg)");
    expect(kg).toHaveValue("12,5");
    fireEvent.change(kg, { target: { value: "3,25" } });
    fireEvent.click(screen.getByRole("button", { name: "Belgeye ekle" }));
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "yarn:l1:w2",
          input: { kind: "YARN", yarnItemId: "i1", warehouseId: "w2", lotId: "l1", qtyKg: "3.25" },
        }),
      ),
    );
  });
});
