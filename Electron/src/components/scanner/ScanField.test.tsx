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
}: {
  onScan: (c: string) => void;
  expectPrefix?: BarcodeKind | BarcodeKind[];
}) {
  const [v, setV] = useState("");
  return (
    <ScanField
      value={v}
      onChange={setV}
      onScan={onScan}
      placeholder="okut"
      expectPrefix={expectPrefix}
      submitLabel="Getir"
    />
  );
}

describe("ScanField", () => {
  it("Enter ile doğrulanmış kodu onScan'e verir", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} expectPrefix="ROLL" />);
    const input = screen.getByPlaceholderText("okut");
    await userEvent.type(input, "T120726H0001{Enter}");
    expect(onScan).toHaveBeenCalledWith("T120726H0001");
  });

  it("submit butonu da onScan tetikler", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} />);
    await userEvent.type(screen.getByPlaceholderText("okut"), "CV1207260001");
    await userEvent.click(screen.getByRole("button", { name: "Getir" }));
    expect(onScan).toHaveBeenCalledWith("CV1207260001");
  });

  it("yanlış tür (expectPrefix ROLL'a refakat kartı) → onScan engellenir + uyarı", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} expectPrefix="ROLL" />);
    await userEvent.type(screen.getByPlaceholderText("okut"), "RK1207260001{Enter}");
    expect(onScan).not.toHaveBeenCalled();
    expect(screen.getByText(/buraya top barkodu okut/i)).toBeInTheDocument();
  });

  it("bilinmeyen (serbest) kod expectPrefix'e takılmaz — geçer", async () => {
    const onScan = vi.fn();
    renderWithProviders(<Harness onScan={onScan} expectPrefix="SWATCH" />);
    await userEvent.type(screen.getByPlaceholderText("okut"), "RAF-A12{Enter}");
    expect(onScan).toHaveBeenCalledWith("RAF-A12");
  });
});
