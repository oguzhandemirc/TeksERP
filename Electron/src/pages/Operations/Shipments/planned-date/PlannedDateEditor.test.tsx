// Planlanan sevk günü satırı: sevk edilmiş + tarihsiz → yok; sevk edilmiş + tarihli → okunur (düzenleme yok);
// PLANNED → "Tarih ekle"; "Tarihi kaldır" null gönderir. Gövde gün dizgesidir (saat dilimi dönüşümü yok).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ShipmentDetail } from "../types";

const setPlannedDate = vi.hoisted(() => vi.fn(async () => ({ success: true, message: "ok" })));
vi.mock("../service", () => ({ shipmentService: { setPlannedDate } }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const { PlannedDateEditor } = await import("./PlannedDateEditor");

const det = (over: Partial<ShipmentDetail>) => ({ id: "s1", shipmentNo: "SVK-1", status: "PLANNED", plannedDate: null, ...over }) as ShipmentDetail;

beforeEach(() => setPlannedDate.mockClear());

describe("PlannedDateEditor", () => {
  it("sevk edilmiş ve tarihsiz → satır yok", () => {
    renderWithProviders(<PlannedDateEditor d={det({ status: "DISPATCHED" })} />);
    expect(screen.queryByTestId("planned-date-row")).toBeNull();
  });
  it("sevk edilmiş ve tarihli → okunur, düzenleme düğmesi yok", () => {
    renderWithProviders(<PlannedDateEditor d={det({ status: "DISPATCHED", plannedDate: "2026-11-20" })} />);
    expect(screen.getByText("20.11.2026")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Düzenle|Tarih ekle/ })).toBeNull();
  });
  it("PLANNED → Tarih ekle; tarihli PLANNED'de 'Tarihi kaldır' null gönderir", async () => {
    const { unmount } = renderWithProviders(<PlannedDateEditor d={det({})} />);
    expect(screen.getByRole("button", { name: /Tarih ekle/ })).toBeTruthy();
    unmount();
    renderWithProviders(<PlannedDateEditor d={det({ plannedDate: "2026-11-20" })} />);
    fireEvent.click(screen.getByRole("button", { name: /Düzenle/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Tarihi kaldır" }));
    await waitFor(() => expect(setPlannedDate).toHaveBeenCalledWith("s1", null));
  });
});
