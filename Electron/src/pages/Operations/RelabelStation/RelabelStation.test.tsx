import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { RelabelContext } from "./types";

// --- Yetki: tam izinli (store boşken hasPermission=false → form kilitli kalırdı) ---
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    isAdmin: true,
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
  }),
}));

// --- Servisler ---
const applySpec = vi.fn((..._a: unknown[]) => Promise.resolve({ success: true, data: {} }));
vi.mock("./service", () => ({
  relabelService: {
    applySpec: (...a: unknown[]) => applySpec(...a),
    getContext: vi.fn(),
  },
}));

const getRollPreview = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ mode: "html", language: "RASTER_HTML", content: "<html><body>ETIKET</body></html>", kind: "ROLL_FINISHED" }),
);
const printRollLabel = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ success: true, data: { rollId: "roll-1" } }),
);
vi.mock("@/services/labelService", () => ({
  labelService: {
    getRollPreview: (...a: unknown[]) => getRollPreview(...a),
    getRollLabelHtml: (..._a: unknown[]) => Promise.resolve("<html><body>ETIKET</body></html>"),
    printRollLabel: (...a: unknown[]) => printRollLabel(...a),
  },
}));

// Yerel yazıcı yok → iframe.print yedeği (usePreferences provider'ı test'te yok).
vi.mock("@/hooks/useLabelPrinter", () => ({
  useLabelPrinter: () => ({ directEnabled: false, printRoll: vi.fn(), printRollsBulk: vi.fn() }),
}));

// loadAllForPicker GERÇEK şekli: PaginatedResponse ({ success, data, pagination }).
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () =>
    Promise.resolve({
      success: true,
      data: [{ id: "qg-1", code: "1.KALITE", name: "1. Kalite" }],
      pagination: { total: 1, page: 1, pageSize: 500, totalPages: 1 },
    }),
  PICKER_MAX_PAGE_SIZE: 500,
}));

// Ağır network-bağlı picker'lar → hafif stub (değer + onChange testlenebilir).
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({
  ColorPickerModal: ({ value }: { value: string | null }) => (
    <div data-testid="color-picker">{value ?? "none"}</div>
  ),
}));
vi.mock("@/components/forms/PropertyChipsField", () => ({
  PropertyChipsField: ({ value }: { value: string[] }) => (
    <div data-testid="props">{value.join(",")}</div>
  ),
}));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <button data-testid="customer-picker" onClick={() => onChange("cFREE")}>
      {value ?? "müşteri seç"}
    </button>
  ),
}));

import { RelabelSpecForm } from "./RelabelSpecForm";
import { RelabelPrintForCustomer } from "./RelabelPrintForCustomer";
import { RollContextHeader, LastLabelBanner } from "./RollContextHeader";

const baseCtx: RelabelContext = {
  id: "roll-1",
  barcode: "TEKS-1",
  status: "WAREHOUSE",
  entrySource: "SUPPLIER_RECEIPT",
  itemId: "item-1",
  item: { id: "item-1", code: "ITM", name: "PATOS" },
  colorId: "color-1",
  color: { id: "color-1", code: "MV", name: "MAVİ", hex: "#0000ff" },
  qualityGrade: "1.KALITE",
  qualityGradeId: "qg-1",
  qualityGradeRef: { id: "qg-1", code: "1.KALITE", name: "1. Kalite", color: null },
  width: 150,
  currentQty: 100,
  weightKg: 30,
  markedForKartela: false,
  properties: [{ id: "p1", code: "YNM", name: "Yanmaz", color: null }],
  propertyIds: ["p1"],
  lastLabelSnapshot: { customerId: "cA", customerName: "ACME", orderNumber: "ORD-1", printedAt: "2026-06-14T10:00:00Z" },
  shipment: null,
  sack: null,
  specLocked: false,
  candidateCustomers: [
    { customerId: "cB", customerCode: "BCO", customerName: "BETA", orderLineId: "ol-1", orderNumber: "ORD-2" },
  ],
};

beforeEach(() => {
  applySpec.mockClear();
  getRollPreview.mockClear();
  printRollLabel.mockClear();
});

describe("RelabelSpecForm — spec düzeltme", () => {
  it("seed değerlerle submit → applySpec tam payload (colorId/propertyIds/width/qualityGrade)", async () => {
    renderWithProviders(<RelabelSpecForm ctx={baseCtx} onSaved={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() =>
      expect(applySpec).toHaveBeenCalledWith("roll-1", {
        colorId: "color-1",
        propertyIds: ["p1"],
        width: 150,
        qualityGrade: "1.KALITE",
      }),
    );
  });

  it("commit'li sevkiyat (specLocked) → kaydet disabled + uyarı", () => {
    const locked: RelabelContext = {
      ...baseCtx,
      specLocked: true,
      shipment: { id: "sh1", shipmentNo: "SVK-7", status: "READY" },
    };
    renderWithProviders(<RelabelSpecForm ctx={locked} onSaved={() => {}} />);
    expect(screen.getByText(/SVK-7/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  });
});

describe("RelabelPrintForCustomer — müşteri için yeniden bas", () => {
  it("açılışta SON müşteri (snapshot) ön-seçili; aday çipi → customerId+orderLineId ile html", async () => {
    renderWithProviders(<RelabelPrintForCustomer ctx={baseCtx} />);
    // lastLabelSnapshot.customerId="cA" → açılışta o ön-seçili gelir (en son basılan müşteri).
    await waitFor(() =>
      expect(getRollPreview).toHaveBeenCalledWith("roll-1", { customerId: "cA", orderLineId: null }),
    );
    await userEvent.click(screen.getByText("BETA"));
    await waitFor(() =>
      expect(getRollPreview).toHaveBeenCalledWith("roll-1", { customerId: "cB", orderLineId: "ol-1" }),
    );
  });

  it("Bas → seçili bağlamla printRollLabel", async () => {
    renderWithProviders(<RelabelPrintForCustomer ctx={baseCtx} />);
    await userEvent.click(screen.getByText("BETA"));
    const basBtn = await screen.findByRole("button", { name: "Bas" });
    await waitFor(() => expect(basBtn).not.toBeDisabled());
    await userEvent.click(basBtn);
    await waitFor(() =>
      expect(printRollLabel).toHaveBeenCalledWith("roll-1", { customerId: "cB", orderLineId: "ol-1" }),
    );
  });

  it("Stok (müşterisiz) → html + bas { stock:true } (snapshot'a düşmez)", async () => {
    renderWithProviders(<RelabelPrintForCustomer ctx={baseCtx} />);
    await userEvent.click(screen.getByRole("button", { name: /Stok \(müşterisiz\)/ }));
    await waitFor(() =>
      expect(getRollPreview).toHaveBeenCalledWith("roll-1", { stock: true }),
    );
    const basBtn = await screen.findByRole("button", { name: "Bas" });
    await waitFor(() => expect(basBtn).not.toBeDisabled());
    await userEvent.click(basBtn);
    await waitFor(() =>
      expect(printRollLabel).toHaveBeenCalledWith("roll-1", { stock: true }),
    );
  });

  it("barkodsuz top → Bas disabled + uyarı", async () => {
    const raw: RelabelContext = { ...baseCtx, barcode: null, candidateCustomers: [] };
    renderWithProviders(<RelabelPrintForCustomer ctx={raw} />);
    const basBtn = await screen.findByRole("button", { name: "Bas" });
    expect(basBtn).toBeDisabled();
    expect(screen.getByText(/barkodu yok/)).toBeInTheDocument();
  });
});

describe("RollContextHeader + LastLabelBanner", () => {
  it("künye: ürün + salt-okunur metraj + konum (sevkiyat/çuval)", () => {
    const ctx: RelabelContext = {
      ...baseCtx,
      color: null,
      colorId: null,
      shipment: { id: "sh1", shipmentNo: "SVK-3", status: "PREPARING" },
      sack: { id: "sk1", sackNo: "AMB00003", seq: 3 },
    };
    renderWithProviders(<RollContextHeader ctx={ctx} onClear={() => {}} />);
    expect(screen.getByText(/PATOS/)).toBeInTheDocument();
    // Renk/kalite/en artık formda düzenlenir → künyede tekrar edilmez; salt-okunur metraj kalır.
    expect(screen.getByText(/Metraj: 100 mt/)).toBeInTheDocument();
    expect(screen.getByText(/SVK-3/)).toBeInTheDocument();
    expect(screen.getByText(/Çuval #3/)).toBeInTheDocument();
  });

  it("son baskı (A) künyesi gösterilir", () => {
    renderWithProviders(<LastLabelBanner snap={baseCtx.lastLabelSnapshot} />);
    expect(screen.getByText(/ACME/)).toBeInTheDocument();
    expect(screen.getByText(/ORD-1/)).toBeInTheDocument();
  });

  it("hiç basılmadıysa nötr banner", () => {
    renderWithProviders(<LastLabelBanner snap={null} />);
    expect(screen.getByText(/henüz basılmadı/)).toBeInTheDocument();
  });
});
