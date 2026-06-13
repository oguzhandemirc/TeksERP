import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DispatchReceiptDocument } from "./DispatchReceiptDocument";
import type { DispatchReport } from "./types";

const report: DispatchReport = {
  header: {
    shipmentNo: "SVK-001",
    customerName: "SOFİA HOME",
    customerCode: "MUS-1",
    branchName: null,
    procedureCode: "GB-2026-123",
    destination: "EXPORT",
    status: "DISPATCHED",
    date: "2026-06-10T08:00:00.000Z",
  },
  products: [{ name: "MC 156 BEYAZ-GÜMÜŞ 150cm.", rollCount: 3, totalMeters: 105 }],
  sacks: [{ code: "AMB00001", seq: 1, totalMeters: 70, totalKg: 65.8, packageCount: 2 }],
  cekiRows: [
    { rollId: "r1", sackCode: "AMB00001", barcode: "G26126373", desen: "MC 156", varyant: "BEYAZ-GÜMÜŞ", meters: 35, kg: 65.8 },
    { rollId: "r2", sackCode: "AMB00001", barcode: "G26126379", desen: "MC 156", varyant: "BEYAZ-GÜMÜŞ", meters: 35, kg: 0 },
  ],
  totals: { totalRolls: 3, totalMeters: 105, totalKg: 65.8, sackCount: 1 },
};

describe("DispatchReceiptDocument (saha #2 — ornek-fis 3 bölüm)", () => {
  it("üç bölüm başlığını basar", () => {
    render(<DispatchReceiptDocument report={report} />);
    expect(screen.getByText("ÜRÜN LİSTESİ")).toBeInTheDocument();
    expect(screen.getByText("ÇUVAL LİSTESİ")).toBeInTheDocument();
    expect(screen.getByText("ÇEKİ LİSTESİ")).toBeInTheDocument();
  });
  it("müşteri + sevk no + prosedür kodu künyede", () => {
    render(<DispatchReceiptDocument report={report} />);
    expect(screen.getAllByText(/SOFİA HOME/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SVK-001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GB-2026-123/).length).toBeGreaterThan(0);
  });
  it("çeki: ilk topta kg, ikincide boş (çeki formatı)", () => {
    const { container } = render(<DispatchReceiptDocument report={report} />);
    // print-area kökü var (printDocumentArea bunu hedefler)
    expect(container.querySelector(".print-area")).not.toBeNull();
    expect(screen.getByText("G26126373")).toBeInTheDocument();
    expect(screen.getByText("G26126379")).toBeInTheDocument();
  });
});
