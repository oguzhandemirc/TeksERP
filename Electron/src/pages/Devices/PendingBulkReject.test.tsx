import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { DeviceListItem } from "./types";

// =============================================================================
// Bekleyen cihaz toplu reddi + onay öncesi köken özeti (VDS O3). İddia: her bekleyen satır
// kaynak adres ve ilk görülmeyle listelenir; YALNIZ seçilenler reddedilir; onaylı/pasif liste
// dışı; köken özeti adres, ilk görülme ve donanım kaynağını gösterir.
// =============================================================================

const h = vi.hoisted(() => ({ post: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/services/apiClient", () => ({
  default: { get: vi.fn(), post: h.post, patch: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (_e: unknown, yedek = "x") => yedek,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: h.toastSuccess, info: vi.fn() } }));

const { PendingBulkReject } = await import("./PendingBulkReject");
const { DeviceOriginSummary } = await import("./DeviceOriginSummary");

const base = { kind: "TABLET", machineId: null, lastSeenAt: null, updatedAt: "", machine: null } as const;
const DEVICES = [
  { ...base, id: "a", deviceId: "a", name: "Sahte-1", status: "PENDING", isActive: true, createdAt: "2026-11-01T08:00:00.000Z", announcedFrom: "203.0.113.7" },
  { ...base, id: "b", deviceId: "b", name: "Sahte-2", status: "PENDING", isActive: true, createdAt: "2026-11-01T08:01:00.000Z", announcedFrom: "203.0.113.7" },
  { ...base, id: "c", deviceId: "c", name: "Gerçek tablet", status: "PENDING", isActive: true, createdAt: "2026-11-01T08:02:00.000Z", announcedFrom: null },
  { ...base, id: "d", deviceId: "d", name: "Onaylı", status: "APPROVED", isActive: true, createdAt: "" },
  { ...base, id: "e", deviceId: "e", name: "Pasif", status: "PENDING", isActive: false, createdAt: "" },
] as DeviceListItem[];

beforeEach(() => {
  vi.clearAllMocks();
  h.post.mockResolvedValue({ data: { success: true, data: { rejected: ["a", "b"] } } });
});

describe("PendingBulkReject", () => {
  it("yalnız seçilen bekleyen cihazları reddeder", async () => {
    const onDone = vi.fn();
    renderWithProviders(<PendingBulkReject devices={DEVICES} onDone={onDone} />);
    const panel = screen.getByTestId("pending-bulk-reject");
    expect(within(panel).getByText(/Onay bekleyen 3 cihaz/)).toBeTruthy();
    expect(within(panel).queryByText("Onaylı")).toBeNull();
    expect(within(panel).queryByText("Pasif")).toBeNull();
    expect(within(panel).getAllByText("203.0.113.7")).toHaveLength(2);
    const boxes = within(panel).getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(within(panel).getByRole("button", { name: /Seçilenleri reddet \(2\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reddet" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith("/api/admin/devices/pending/reject", { ids: ["a", "b"] }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("tek bekleyen cihazda panel çıkmaz", () => {
    renderWithProviders(<PendingBulkReject devices={DEVICES.slice(2)} onDone={vi.fn()} />);
    expect(screen.queryByTestId("pending-bulk-reject")).toBeNull();
  });
});

describe("DeviceOriginSummary", () => {
  it("adres, ilk görülme ve donanım kaynağını gösterir; yoksa nötr metin", () => {
    renderWithProviders(<DeviceOriginSummary device={{ announcedFrom: "2001:db8:1:2::/64", createdAt: "2026-11-01T08:00:00.000Z", hwSource: "ANDROID_ID" }} />);
    const box = screen.getByTestId("device-origin");
    expect(within(box).getByText("2001:db8:1:2::/64")).toBeTruthy();
    expect(within(box).getByText("Android cihaz kimliği")).toBeTruthy();
    expect(within(box).getByText(/01\.11\.2026/)).toBeTruthy();
  });
  it("eski backend (alan yok) → bilinmiyor", () => {
    renderWithProviders(<DeviceOriginSummary device={{ createdAt: "2026-11-01T08:00:00.000Z" }} />);
    expect(screen.getByText("Bilinmiyor")).toBeTruthy();
    expect(screen.getByText("Donanım özeti yok")).toBeTruthy();
  });
});
