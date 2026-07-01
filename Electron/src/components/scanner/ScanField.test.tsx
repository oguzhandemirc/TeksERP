import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { ScanField } from "./ScanField";
import type { BarcodeKind } from "@/lib/scanner/barcode-kind";

function Harness({
  onScan,
  expectPrefix,
  validateChecksum,
}: {
  onScan: (c: string) => void;
  expectPrefix?: BarcodeKind | BarcodeKind[];
  validateChecksum?: boolean;
}) {
  const [v, setV] = useState("");
  return (
    <ScanField
      value={v}
      onChange={setV}
      onScan={onScan}
      placeholder="okut"
      expectPrefix={expectPrefix}
      validateChecksum={validateChecksum}
      submitLabel="Getir"
    />
  );
}

describe("ScanField", () => {
  it("Enter ile doğrulanmış kodu onScan'e verir", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} expectPrefix="ROLL" />);
    const input = screen.getByPlaceholderText("okut");
    await userEvent.type(input, "TEKS20260615AB12CD34{Enter}");
    expect(onScan).toHaveBeenCalledWith("TEKS20260615AB12CD34");
  });

  it("submit butonu da onScan tetikler", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} />);
    await userEvent.type(screen.getByPlaceholderText("okut"), "CV-260615-001");
    await userEvent.click(screen.getByRole("button", { name: "Getir" }));
    expect(onScan).toHaveBeenCalledWith("CV-260615-001");
  });

  it("yanlış tür (expectPrefix ROLL'a refakat kartı) → onScan engellenir + uyarı", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} expectPrefix="ROLL" />);
    await userEvent.type(screen.getByPlaceholderText("okut"), "RK26049F2K3P6{Enter}");
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByText(/buraya top barkodu okut/i)).toBeInTheDocument();
  });

  it("checksum uyarısı gösterir ama submit'i ENGELLEMEZ", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} expectPrefix="SWATCH" validateChecksum />);
    // SW- formatında ama yanlış checksum (-9)
    await userEvent.type(screen.getByPlaceholderText("okut"), "SW26045A3Z9B9");
    expect(screen.getByText(/checksum tutmuyor/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Getir" }));
    expect(onScan).toHaveBeenCalledWith("SW26045A3Z9B9");
  });
});
