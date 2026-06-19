import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { ShipmentDetail, ShipmentStatus } from "./types";

const removeRoll = vi.fn();
const removeSwatch = vi.fn();
const swapRollSacks = vi.fn();
vi.mock("./service", () => ({
  packingService: {
    removeRoll: (...a: unknown[]) => removeRoll(...a),
    removeSwatch: (...a: unknown[]) => removeSwatch(...a),
    swapRollSacks: (...a: unknown[]) => swapRollSacks(...a),
    moveRollToSack: vi.fn(),
    weighSack: vi.fn(),
    removeSack: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { SackList } from "./SackList";

const roll = (id: string, sackId: string | null) => ({
  id,
  barcode: `TEKS-${id}`,
  item: { code: "I", name: "Kumaş" },
  color: null,
  width: 140,
  currentQty: 50,
  sackId,
});

function detail(status: ShipmentStatus): ShipmentDetail {
  return {
    id: "sh1",
    shipmentNo: "SVK-1",
    status,
    destination: "DOMESTIC",
    procedureCode: null,
    plateNumber: null,
    driverName: null,
    carrier: null,
    readyAt: null,
    dispatchedAt: null,
    customer: { id: "c1", name: "ACME" },
    branch: null,
    orders: [],
    rolls: [roll("r1", "sk1"), roll("r2", "sk2")],
    swatches: [],
    sacks: [
      { id: "sk1", sackNo: "CV-1", seq: 1, manualCode: "A1", weightKg: 10, rolls: [roll("r1", "sk1")], swatches: [], rollCount: 1, swatchCount: 0 },
      { id: "sk2", sackNo: "CV-2", seq: 2, manualCode: "A2", weightKg: 12, rolls: [roll("r2", "sk2")], swatches: [], rollCount: 1, swatchCount: 0 },
    ],
    summary: { rollCount: 2, swatchCount: 0, totalMeters: 100, sackCount: 2, totalKg: 22 },
  };
}

const REMOVE = "Çuvaldan çıkar (depoya döner)";
const SWAP = "Başka topla çuval takasla";

describe("SackList — çuval içeriği düzenleme", () => {
  beforeEach(() => {
    removeRoll.mockReset().mockResolvedValue({ success: true });
    removeSwatch.mockReset().mockResolvedValue({ success: true });
    swapRollSacks.mockReset().mockResolvedValue({ success: true });
    useAuthStore.getState().setUser({ userId: "u1", username: "admin", permissions: ["shipping:write"] });
  });

  it("topu çıkar → onay → removeRoll(shipmentId, rollId)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SackList detail={detail("PREPARING")} />);
    await user.click(screen.getAllByRole("button", { name: REMOVE })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/serbest depoya dönecek/i)).toBeInTheDocument();
    expect(removeRoll).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Onayla" }));
    await waitFor(() => expect(removeRoll).toHaveBeenCalledWith("sh1", "r1"));
  });

  it("takas iki-adımlı → onay → swapRollSacks(a,b)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SackList detail={detail("PREPARING")} />);
    const swapButtons = screen.getAllByRole("button", { name: SWAP });
    await user.click(swapButtons[0]!); // 1. top (r1)
    expect(await screen.findByText(/2\. topu seçin/i)).toBeInTheDocument();
    // r2'nin takas butonu hâlâ varsayılan adında — ona bas.
    await user.click(screen.getByRole("button", { name: SWAP }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Onayla" }));
    await waitFor(() => expect(swapRollSacks).toHaveBeenCalledWith("r1", "r2"));
  });

  it("READY → uyarı banner'ı (tartı sıfırlanır + karşılanma)", () => {
    renderWithProviders(<SackList detail={detail("READY")} />);
    expect(screen.getByText(/tartısı sıfırlanır/i)).toBeInTheDocument();
    // İçerik düzenleme yine açık (çıkar butonu var).
    expect(screen.getAllByRole("button", { name: REMOVE }).length).toBeGreaterThan(0);
  });

  it("DISPATCHED → salt-okunur (aksiyon yok, banner yok)", () => {
    renderWithProviders(<SackList detail={detail("DISPATCHED")} />);
    expect(screen.queryByRole("button", { name: REMOVE })).not.toBeInTheDocument();
    expect(screen.queryByText(/tartısı sıfırlanır/i)).not.toBeInTheDocument();
  });

  it("çuvalsız (loose) kartela 'Çuvalsız' bölümünde görünür ve çıkarılabilir", async () => {
    const user = userEvent.setup();
    const d = detail("PREPARING");
    d.swatches = [{ id: "sw1", barcode: "SW-1", width: null, sackId: null }];
    d.summary = { ...d.summary, swatchCount: 1 };
    renderWithProviders(<SackList detail={d} />);
    // Loose kartela satırı yalnız "Çuvalsız" bölümünde render edilir (aria-label benzersiz).
    await user.click(screen.getByRole("button", { name: "Kartela çıkar" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Onayla" }));
    await waitFor(() => expect(removeSwatch).toHaveBeenCalledWith("sh1", "sw1"));
  });

  it("shipping:write yoksa düzenleme butonları gizli (PREPARING'de bile)", () => {
    useAuthStore.getState().setUser({ userId: "u1", username: "viewer", permissions: ["shipping:read"] });
    renderWithProviders(<SackList detail={detail("PREPARING")} />);
    expect(screen.queryByRole("button", { name: REMOVE })).not.toBeInTheDocument();
  });
});
