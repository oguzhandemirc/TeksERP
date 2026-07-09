import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const scan = vi.fn();
const addSack = vi.fn();
const removeRoll = vi.fn();
const removeSwatch = vi.fn();
vi.mock("./service", () => ({
  packingService: {
    scan: (...a: unknown[]) => scan(...a),
    addSack: (...a: unknown[]) => addSack(...a),
    removeRoll: (...a: unknown[]) => removeRoll(...a),
    removeSwatch: (...a: unknown[]) => removeSwatch(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("./AddKartelaDialog", () => ({ AddKartelaDialog: () => null }));

import { ScanInBar } from "./ScanInBar";

const sack = {
  id: "sk1",
  sackNo: "CV-260601-001",
  seq: 1,
  manualCode: "AMB00001",
  weightKg: null,
  rollCount: 0,
  swatchCount: 0,
} as never;

describe("ScanInBar — son okutmayı geri al", () => {
  beforeEach(() => {
    scan.mockReset().mockResolvedValue({
      success: true,
      data: { kind: "ROLL", rollId: "r1", sackId: "sk1" },
    });
    addSack.mockReset();
    removeRoll.mockReset().mockResolvedValue({ success: true, data: {} });
    removeSwatch.mockReset();
  });

  it("YENİ eklenen okutmada geri-al butonu çıkar; tıklayınca removeRoll çağrılır", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ScanInBar
        shipmentId="sh1"
        sacks={[sack]}
        activeSackId="sk1"
        onSetActiveSack={() => {}}
        knownBarcodes={[]}
      />,
    );

    await user.type(screen.getByPlaceholderText(/Top barkodu okut/), "ROLLX01{Enter}");
    await waitFor(() => expect(scan).toHaveBeenCalledWith("sh1", "ROLLX01", "sk1"));

    // Drainer rearm (600ms) bittikten sonra buton görünür.
    const undoBtn = await screen.findByRole(
      "button",
      { name: /Son okutmayı geri al/ },
      { timeout: 2000 },
    );
    await user.click(undoBtn);
    await waitFor(() => expect(removeRoll).toHaveBeenCalledWith("sh1", "r1"));
  });

  it("sevkiyatta ZATEN olan barkod (taşıma) geri-al sunmaz — taşıma 'çıkar'a dönüşmesin", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ScanInBar
        shipmentId="sh1"
        sacks={[sack]}
        activeSackId="sk1"
        onSetActiveSack={() => {}}
        knownBarcodes={["ROLLX01"]}
      />,
    );

    await user.type(screen.getByPlaceholderText(/Top barkodu okut/), "ROLLX01{Enter}");
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(1));

    // Rearm bitse de buton YOK (busy metni kaybolana kadar bekle).
    await waitFor(() => expect(screen.queryByText(/Okutuluyor/)).not.toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(screen.queryByRole("button", { name: /Son okutmayı geri al/ })).not.toBeInTheDocument();
  });
});
