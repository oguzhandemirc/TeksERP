import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { OrderShipmentRow } from "./service";

const getShipments = vi.fn();
vi.mock("./service", () => ({
  orderService: { getShipments: (...a: unknown[]) => getShipments(...a) },
}));

const openTarget = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({
  useOpenTarget: () => openTarget,
}));

let canRead = true;
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => (p === "shipping:read" ? canRead : false) }),
}));

import { OrderShipmentsCard } from "./OrderShipmentsCard";

function resolve(shipments: OrderShipmentRow[], dispatchedTotal = 90, plannedTotal = 40) {
  getShipments.mockResolvedValue({ success: true, data: { dispatchedTotal, plannedTotal, shipments } });
}

const ROWS: OrderShipmentRow[] = [
  { shipmentId: "sp1", shipmentNo: "SVK-2", status: "PLANNED", kind: "SHIPMENT", date: null, qty: 40, sackCount: 1, branchName: null },
  { shipmentId: "sd1", shipmentNo: "SVK-1", status: "DISPATCHED", kind: "SHIPMENT", date: "2026-07-20T00:00:00Z", qty: 60, sackCount: 2, branchName: null },
  { shipmentId: "ds1", shipmentNo: "DSK-1", status: "DISPATCHED", kind: "DIRECT", date: "2026-07-18T00:00:00Z", qty: 30, sackCount: 0, branchName: null },
];

describe("OrderShipmentsCard", () => {
  beforeEach(() => {
    getShipments.mockReset();
    openTarget.mockReset();
    canRead = true;
  });

  it("boş liste → null", async () => {
    resolve([], 0, 0);
    const { container } = renderWithProviders(<OrderShipmentsCard orderId="o1" open />);
    // useQuery çözülene kadar bekle
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("satırları + totalleri gösterir", async () => {
    resolve(ROWS);
    renderWithProviders(<OrderShipmentsCard orderId="o1" open />);
    expect(await screen.findByText("SVK-1")).toBeInTheDocument();
    expect(screen.getByText("SVK-2")).toBeInTheDocument();
    expect(screen.getByText("DSK-1")).toBeInTheDocument();
    expect(screen.getByText("Sevk Edildi")).toBeInTheDocument();
    expect(screen.getByText("Planlı")).toBeInTheDocument();
    expect(screen.getByText("Fason direkt sevk")).toBeInTheDocument();
    // Totaller + satır qty'leri. "90 m" (dispatchedTotal) benzersiz; "40 m" hem
    // PLANNED satırında hem "Bekleyen" totalinde → iki kez.
    expect(screen.getByText(/Sevk edilen:/)).toBeInTheDocument();
    expect(screen.getByText(/Bekleyen:/)).toBeInTheDocument();
    expect(screen.getByText("90 m")).toBeInTheDocument();
    expect(screen.getByText("60 m")).toBeInTheDocument();
    expect(screen.getByText("30 m")).toBeInTheDocument();
    expect(screen.getAllByText("40 m")).toHaveLength(2);
  });

  it("shipping:read varsa satır tıklanabilir → doğru route + onNavigate", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    resolve(ROWS);
    renderWithProviders(<OrderShipmentsCard orderId="o1" open onNavigate={onNavigate} />);
    await screen.findByText("SVK-1");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    // DIRECT satırına tık → direct route
    await user.click(screen.getByText("DSK-1").closest("button")!);
    expect(onNavigate).toHaveBeenCalled();
    expect(openTarget.mock.calls[0]?.[0]).toBe("/operations/shipments/direct/ds1");
    // Çuval satırına tık → normal route
    await user.click(screen.getByText("SVK-1").closest("button")!);
    expect(openTarget.mock.calls[1]?.[0]).toBe("/operations/shipments/sd1");
  });

  it("shipping:read yoksa satır tıklanamaz (button yok)", async () => {
    canRead = false;
    resolve(ROWS);
    renderWithProviders(<OrderShipmentsCard orderId="o1" open />);
    await screen.findByText("SVK-1");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
