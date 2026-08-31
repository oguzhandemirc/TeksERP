// =============================================================================
// BEKÇİ — sevkiyattan fatura taslağı diyaloğu (C1 panel yarısı)
// =============================================================================
// ⭐ SATIRLAR BACKEND UCUNDAN GELİR. Diyalog eskiden sevk fişi raporundan kendi
//    satırlarını kuruyor ve FİYATI HİÇ ÇÖZMÜYORDU (hepsi 0) — aynı sevkiyat,
//    otomatik kancadan geçince sözleşme/kart fiyatlı, elle üretilince sıfır
//    fiyatlı bir fatura doğuruyordu. Bu dosya "iki kurucu" durumunun geri
//    gelmesini engeller: taslak ucu çağrılmazsa test kırmızı verir.
// ⭐ ÇELİŞKİ NOTU FORMA GEÇER: uydurma fiyat yasak; sayaç ekranda söylenmezse
//    muhasebeci kart fiyatını sözleşme fiyatı sanır.
// ⭐ FASONDAN DOĞRUDAN SEVKTE HİÇ AÇILMAZ: `Invoice.shipmentId` FK'sı o tabloyu
//    kabul etmiyor ve satır kurucusu da onu tanımıyor.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { InvoicePrefill } from "@/pages/Finance/InvoiceFormDialog";
import type { DispatchListItem } from "./types";

const getShipmentInvoiceDraftLines = vi.fn();
vi.mock("@/pages/Finance/service", () => ({
  getShipmentInvoiceDraftLines: (...a: unknown[]) => getShipmentInvoiceDraftLines(...a),
}));

// Fatura formu ayrı bir yüzey; burada YALNIZ ne ile beslendiği ölçülüyor.
let captured: InvoicePrefill | undefined;
vi.mock("@/pages/Finance/InvoiceFormDialog", () => ({
  InvoiceFormDialog: ({ prefill }: { prefill?: InvoicePrefill }) => {
    captured = prefill;
    return <div data-testid="fatura-formu">{prefill?.lines.length ?? 0}</div>;
  },
}));

// Eski yol: sevk fişi raporu. Çağrılırsa satırlar yine istemcide kurulmuş
// demektir — bu mock'un ÇAĞRILMAMASI iddianın bir parçası.
const getReport = vi.fn();
vi.mock("./service", () => ({
  accountingDispatchService: {
    getReport: (...a: unknown[]) => getReport(...a),
    getDirectReport: (...a: unknown[]) => getReport(...a),
  },
}));

import { ShipmentInvoiceDraft } from "./ShipmentInvoiceDraft";

const ROW: DispatchListItem = {
  id: "sh-1",
  kind: "SHIPMENT",
  shipmentNo: "SVK1508260001",
  status: "DISPATCHED",
  dispatchedAt: "2026-08-15T09:00:00Z",
  createdAt: "2026-08-15T08:00:00Z",
  customer: { id: "cus-1", name: "ARZU TEKSTİL" },
  branch: null,
  _count: { sacks: 2, rolls: 8, orders: 1, returns: 0 },
  totalMeters: 612.5,
  totalKg: 180,
  invoiceNo: null,
  invoicedAt: null,
  manualSackCount: null,
  dispatchNote: null,
};

const DTO = {
  lines: [
    { itemId: "i1", description: "PATOS GRİ 280cm.", qty: "512.5", unit: "m", unitPrice: "42.50", vatRate: 20 },
  ],
  orderPriced: 1,
  orderConflicts: 0,
  currency: "USD" as const,
};

describe("ShipmentInvoiceDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured = undefined;
    getShipmentInvoiceDraftLines.mockResolvedValue(DTO);
  });

  it("⭐ SATIRLAR BACKEND UCUNDAN gelir — istemci artık satır KURMAZ", async () => {
    renderWithProviders(<ShipmentInvoiceDraft row={ROW} onClose={() => {}} onCreated={() => {}} />);

    expect(await screen.findByTestId("fatura-formu")).toHaveTextContent("1");
    expect(getShipmentInvoiceDraftLines).toHaveBeenCalledWith("sh-1");
    // Eski kurucu (sevk fişi raporu) artık hiç sorgulanmıyor.
    expect(getReport).not.toHaveBeenCalled();

    expect(captured?.lines[0]).toMatchObject({
      itemId: "i1",
      description: "PATOS GRİ 280cm.",
      qty: 512.5,
      unitPrice: 42.5,
    });
    // Kaynak bağı ALAN olarak taşınır (backend "bir sevkiyat → tek aktif fatura").
    expect(captured?.shipmentId).toBe("sh-1");
    expect(captured?.customerId).toBe("cus-1");
    expect(captured?.sourceLabel).toBe("SVK1508260001");
  });

  it("⭐ PARA BİRİMİ de uçtan gelir — form TRY'ye sabitlenirse USD cariye sessizce TRY fatura kesilir", async () => {
    renderWithProviders(<ShipmentInvoiceDraft row={ROW} onClose={() => {}} onCreated={() => {}} />);
    await screen.findByTestId("fatura-formu");
    expect(captured?.currency).toBe("USD");
  });

  it("⭐ SİPARİŞ FİYATI ÇELİŞKİSİ forma AMBER not olarak geçer", async () => {
    getShipmentInvoiceDraftLines.mockResolvedValue({ ...DTO, orderConflicts: 2 });
    renderWithProviders(<ShipmentInvoiceDraft row={ROW} onClose={() => {}} onCreated={() => {}} />);
    await screen.findByTestId("fatura-formu");

    expect(captured?.notice?.tone).toBe("warn");
    expect(captured?.notice?.message).toContain("2 kalemde");
  });

  it("⭐ FASONDAN DOĞRUDAN SEVKTE diyalog AÇILMAZ ve uç HİÇ çağrılmaz", async () => {
    const { container } = renderWithProviders(
      <ShipmentInvoiceDraft row={{ ...ROW, kind: "DIRECT" }} onClose={() => {}} onCreated={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(getShipmentInvoiceDraftLines).not.toHaveBeenCalled();
  });

  it("satırlar gelmeden form açılmaz (ön-dolum yalnız BAŞLANGIÇ değeridir)", () => {
    getShipmentInvoiceDraftLines.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProviders(
      <ShipmentInvoiceDraft row={ROW} onClose={() => {}} onCreated={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("satır seçili değilken hiçbir istek atılmaz", () => {
    renderWithProviders(<ShipmentInvoiceDraft row={null} onClose={() => {}} onCreated={() => {}} />);
    expect(getShipmentInvoiceDraftLines).not.toHaveBeenCalled();
  });
});
