import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { RollLocateCard } from "./RollLocateCard";
import type { LocatedRoll, SackSearchRow } from "./types";

const contents = vi.fn();
vi.mock("./service", () => ({
  sackSearchService: { contents: (...a: unknown[]) => contents(...a) },
}));
import { SackResultCard } from "./SackResultCard";

const baseRoll: LocatedRoll = {
  id: "r1",
  barcode: "BRK-1",
  status: "WAREHOUSE",
  currentQty: 100,
  width: 150,
  qualityGrade: "A",
  item: { id: "i1", name: "PATOS" },
  color: { id: "c1", name: "MAVİ", hex: "#00f" },
  sack: null,
  shipment: null,
};

describe("RollLocateCard — top konumu (saha #1/#23)", () => {
  it("çuvaldaki top: 'Çuval N (kod)' gösterir", () => {
    const roll: LocatedRoll = {
      ...baseRoll,
      sack: { id: "s1", sackNo: "SK1", seq: 3, manualCode: "AMB00003" },
      shipment: {
        id: "sh1",
        shipmentNo: "SVK-1",
        status: "READY",
        customer: { id: "c", name: "MÜŞTERİ" },
        branch: null,
      },
    };
    renderWithProviders(<RollLocateCard roll={roll} onClear={() => {}} />);
    expect(screen.getByText(/Çuval 3/)).toBeInTheDocument();
    expect(screen.getByText(/AMB00003/)).toBeInTheDocument();
    expect(screen.getByText(/SVK-1/)).toBeInTheDocument();
  });

  it("sevkiyatta ama çuvalsız", () => {
    const roll: LocatedRoll = {
      ...baseRoll,
      sack: null,
      shipment: { id: "sh1", shipmentNo: "SVK-9", status: "PREPARING", customer: { id: "c", name: "M" }, branch: null },
    };
    renderWithProviders(<RollLocateCard roll={roll} onClear={() => {}} />);
    expect(screen.getByText(/çuvalsız/i)).toBeInTheDocument();
  });

  it("serbest (sevkiyatsız) → statü etiketi + onClear çalışır", async () => {
    const onClear = vi.fn();
    renderWithProviders(<RollLocateCard roll={baseRoll} onClear={onClear} />);
    // "Hazır Depo" hem statü rozetinde hem konum satırında geçer → en az 1.
    expect(screen.getAllByText(/Hazır Depo/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button")); // X temizle butonu
    expect(onClear).toHaveBeenCalled();
  });
});

const sackRow: SackSearchRow = {
  id: "sk1",
  sackNo: "SK1",
  seq: 2,
  manualCode: "AMB00002",
  weightKg: 30,
  createdAt: "2026-06-10T00:00:00Z",
  shipment: { id: "sh1", shipmentNo: "SVK-2", status: "READY", customer: { id: "c", name: "ACME" }, branch: null },
  rollCount: 3,
  totalQty: 150,
  swatchCount: 0,
  matchRollCount: 2,
  matchQty: 100,
};

describe("SackResultCard — çuval satırı + lazy içerik", () => {
  beforeEach(() => {
    contents.mockReset().mockResolvedValue({
      success: true,
      data: {
        id: "sk1",
        rolls: [
          { id: "r1", barcode: "BRK-1", currentQty: 50, width: 150, qualityGrade: "A", item: { id: "i", name: "PATOS" }, color: { id: "c", name: "MAVİ", hex: "#00f" } },
        ],
        swatches: [],
      },
    });
  });

  it("başlık: çuval no/kod + eşleşen adet/metre", () => {
    renderWithProviders(<SackResultCard sack={sackRow} />);
    expect(screen.getByText("Çuval 2")).toBeInTheDocument();
    expect(screen.getByText("AMB00002")).toBeInTheDocument();
    expect(screen.getByText(/Eşleşen: 2 top/)).toBeInTheDocument();
  });

  it("genişletince içerik lazy yüklenir", async () => {
    renderWithProviders(<SackResultCard sack={sackRow} />);
    expect(contents).not.toHaveBeenCalled(); // kapalıyken çağrılmaz
    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(contents).toHaveBeenCalledWith("sk1"));
    expect(await screen.findByText("BRK-1")).toBeInTheDocument();
    expect(screen.getByText("PATOS")).toBeInTheDocument();
  });
});
