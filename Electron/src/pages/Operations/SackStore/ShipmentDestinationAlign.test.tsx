// BEKÇİ — planlı sevkiyatın yönü (S4, 2026-09-23): kilitliyken seçici YOK; "karttaki yöne eşitle"
// yalnız sevkiyatın yönü kilitten farklıyken; zincir boşken ilk seçim ve "karta yazılır" notu.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const lockData = vi.fn();
vi.mock("@/pages/Operations/SackContentEdit/destinationDefault", async (orig) => ({
  ...(await orig<typeof import("@/pages/Operations/SackContentEdit/destinationDefault")>()),
  useDestinationLock: () => ({ data: lockData(), refetch: vi.fn() }),
}));
const setDestination = vi.fn().mockResolvedValue({ success: true, data: {} });
vi.mock("./service", () => ({ sackStoreService: { setDestination: (...a: unknown[]) => setDestination(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
import { ShipmentDestinationAlign } from "./ShipmentDestinationAlign";
import type { SackStoreShipment } from "./types";

const sh = (destination: "DOMESTIC" | "EXPORT") =>
  ({ id: "s1", status: "PLANNED", destination, customer: { id: "c1", name: "ARZU" }, branch: null }) as unknown as SackStoreShipment;

beforeEach(() => { lockData.mockReset(); setDestination.mockClear(); });

describe("ShipmentDestinationAlign", () => {
  it("⭐ kilit EXPORT, sevkiyat DOMESTIC → 'Karttaki yöne eşitle' görünür, seçici yok", () => {
    lockData.mockReturnValue({ destination: "EXPORT", source: "CUSTOMER", exportCode: null, quickShipBlockedReason: "x" });
    renderWithProviders(<ShipmentDestinationAlign shipment={sh("DOMESTIC")} onMutated={() => {}} />);
    expect(screen.getByRole("button", { name: /Karttaki yöne eşitle/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yurtiçi" })).toBeNull();
  });
  it("kilit ile sevkiyat aynı → eşitle düğmesi YOK", () => {
    lockData.mockReturnValue({ destination: "EXPORT", source: "CUSTOMER", exportCode: null, quickShipBlockedReason: "x" });
    renderWithProviders(<ShipmentDestinationAlign shipment={sh("EXPORT")} onMutated={() => {}} />);
    expect(screen.queryByRole("button", { name: /Karttaki yöne eşitle/ })).toBeNull();
  });
  it("zincir boş → iki seçenek + 'carinin kartına yazılır'", () => {
    lockData.mockReturnValue({ destination: null, source: null, exportCode: null, quickShipBlockedReason: null });
    renderWithProviders(<ShipmentDestinationAlign shipment={sh("DOMESTIC")} onMutated={() => {}} />);
    expect(screen.getByRole("button", { name: "Yurtdışı" })).toBeInTheDocument();
    expect(screen.getByText(/carinin kartına yazılır/)).toBeInTheDocument();
  });
  it("⭐ açık niyet: 'eşitle' bayraksız, ilk-seçim bayraklı gönderir", async () => {
    lockData.mockReturnValue({ destination: "EXPORT", source: "CUSTOMER", exportCode: null, quickShipBlockedReason: "x" });
    const { unmount } = renderWithProviders(<ShipmentDestinationAlign shipment={sh("DOMESTIC")} onMutated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Karttaki yöne eşitle/ }));
    await waitFor(() => expect(setDestination).toHaveBeenLastCalledWith("s1", "EXPORT", false));
    unmount();
    lockData.mockReturnValue({ destination: null, source: null, exportCode: null, quickShipBlockedReason: null });
    renderWithProviders(<ShipmentDestinationAlign shipment={sh("DOMESTIC")} onMutated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Yurtdışı" }));
    await waitFor(() => expect(setDestination).toHaveBeenLastCalledWith("s1", "EXPORT", true));
  });
});
