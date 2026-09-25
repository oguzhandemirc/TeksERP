import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

vi.mock("./OrderPickerDialog", () => ({ OrderPickerDialog: () => null }));

import { LinkedOrderLinesField } from "./LinkedOrderLinesField";
import type { PickedOrderLine } from "./OrderPickerDialog";

const line: PickedOrderLine = {
  lineId: "l1", orderId: "o1", orderNumber: "SIP-1", orderDeadline: null,
  customerId: "c1", customerName: "Müşteri", branchName: null, branchCode: null,
  itemId: "i1", itemName: "Patos", colorId: null, itemColorHex: null, itemColorName: null,
  quantity: 100, openQty: 100, width: 180, requiredProperties: [],
};

const REASON = "Üretim başladı — sipariş bağı detaydaki 'Sipariş Bağla' tuşuyla değişir.";

describe("LinkedOrderLinesField — başlamış iş emri kilidi", () => {
  it("kilitsizken seçici ve kaldır düğmesi var", () => {
    renderWithProviders(<LinkedOrderLinesField lines={[line]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Düzenle/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SIP-1 kaldır" })).toBeInTheDocument();
  });

  it("lockedReason verilince seçici ve kaldır gizlenir, neden yazılır", () => {
    renderWithProviders(<LinkedOrderLinesField lines={[line]} onChange={() => {}} lockedReason={REASON} />);
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "SIP-1 kaldır" })).toBeNull();
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  it("compact + kalemsiz + kilitli: 'Sipariş Bağla' yok, neden yazılır", () => {
    renderWithProviders(<LinkedOrderLinesField compact lines={[]} onChange={() => {}} lockedReason={REASON} />);
    expect(screen.queryByRole("button", { name: /Sipariş Bağla/ })).toBeNull();
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });
});
