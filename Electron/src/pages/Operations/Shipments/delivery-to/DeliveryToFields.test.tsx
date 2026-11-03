// S6 teslim yeri (QA 2026-11-03): geç dönen adres ön doldurması yeni seçimi ezmez;
// kayıt reddi diyalogda satır içi söylenir, 409'da detay tazelenir.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "@/test/render";
import type { ShipmentDetail } from "../types";
import { EMPTY_DELIVERY_TO, type DeliveryToState } from "./deliveryTo";

const resolvers = vi.hoisted(() => new Map<string, (v: unknown) => void>());
vi.mock("@/pages/Customers/service", () => ({
  customerService: {
    getById: (id: string) => new Promise((res) => resolvers.set(id, res)),
  },
}));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <div>
      <button type="button" onClick={() => onChange("c-a")}>A seç</button>
      <button type="button" onClick={() => onChange("c-b")}>B seç</button>
    </div>
  ),
}));
const setDeliveryTo = vi.hoisted(() => vi.fn());
vi.mock("../service", () => ({ shipmentService: { setDeliveryTo } }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { DeliveryToFields } = await import("./DeliveryToFields");
const { DeliveryToEditor } = await import("./DeliveryToEditor");

function Host({ spy }: { spy: (v: DeliveryToState) => void }) {
  const [v, setV] = useState<DeliveryToState>(EMPTY_DELIVERY_TO);
  spy(v);
  return <DeliveryToFields value={v} onChange={setV} defaultOpen />;
}

beforeEach(() => {
  resolvers.clear();
  setDeliveryTo.mockReset();
});

describe("DeliveryToFields — adres ön doldurma yarışı", () => {
  it("⭐ A sonra B seçilir, A'nın yanıtı geç döner → B ve B'nin adresi kalır", async () => {
    let last: DeliveryToState = EMPTY_DELIVERY_TO;
    renderWithProviders(<Host spy={(v) => (last = v)} />);
    fireEvent.click(screen.getByRole("button", { name: "A seç" }));
    fireEvent.click(screen.getByRole("button", { name: "B seç" }));
    await act(async () => resolvers.get("c-b")!({ data: { address: "B sokak" } }));
    await act(async () => resolvers.get("c-a")!({ data: { address: "A sokak" } }));
    expect(last).toEqual({ customerId: "c-b", address: "B sokak" });
  });
});

const DETAIL = {
  id: "s1", shipmentNo: "SV01", status: "PLANNED",
  customer: { id: "c-own", code: "OWN", name: "Sahip" },
  deliveryCustomer: { id: "c-a", code: "A", name: "Boyahane", address: null },
  deliveryAddress: "A sokak",
} as unknown as ShipmentDetail;

describe("DeliveryToEditor — kayıt reddi", () => {
  it("⭐ 409 mesajı diyalogda satır içi görünür", async () => {
    setDeliveryTo.mockRejectedValue({ response: { status: 409, data: { success: false, message: "Sevkiyat artık planlı değil" } } });
    renderWithProviders(<DeliveryToEditor d={DETAIL} />);
    fireEvent.click(screen.getByRole("button", { name: /Düzenle/ }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(screen.getByTestId("delivery-to-failure").textContent).toBe("Sevkiyat artık planlı değil"));
  });
});
