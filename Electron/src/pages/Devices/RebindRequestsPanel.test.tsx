import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { DeviceListItem, RebindRequest } from "./types";

// =============================================================================
// Yeniden bağlama talepleri (cihaz eşleme v2, D3). İddia: Onayla / Ayrı cihazdır /
// Reddet DOĞRU uca doğru gövdeyle gider; diyalog etkilenen kaydı (hedef, makine,
// donanım bağı) listeler; 409 → Türkçe "başka biri işledi" + liste yenilenir;
// eski backend (404) → bölüm gizli. Sonda (ölçüldü): AYRI_CIHAZ→REDDET + 409 dalı kapalı → 2 kırmızı.
// =============================================================================

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("@/services/apiClient", () => ({
  default: { get: h.get, post: h.post, patch: vi.fn(), delete: vi.fn() },
  apiErrorMessage: (_e: unknown, yedek = "x") => yedek,
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, info: vi.fn() } }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

const { RebindRequestsPanel, REBIND_CONFLICT_MESSAGE } = await import("./RebindRequestsPanel");

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const REQ: RebindRequest = {
  id: "22222222-2222-4222-8222-222222222222",
  localId: "yeni-kurulum-1234",
  kind: "DESKTOP",
  model: "Windows · SEVK-PC",
  status: "OPEN",
  decidedAt: null,
  createdAt: "2026-10-24T06:34:00.000Z",
  updatedAt: "2026-10-24T06:34:00.000Z",
  decidedBy: null,
  target: {
    id: TARGET_ID, name: "Sevkiyat PC", kind: "DESKTOP", status: "APPROVED", isActive: true,
    lastSeenAt: "2026-10-24T06:20:00.000Z", machine: { id: "m1", code: "SEVK-1", name: "Sevk Kantarı" },
  },
};
const DEVICES = [{
  id: TARGET_ID, deviceId: "eski", name: "Sevkiyat PC", kind: "DESKTOP", machineId: null, status: "APPROVED",
  lastSeenAt: null, isActive: true, createdAt: "", updatedAt: "", machine: null,
  hardwareLinks: [{ peripheral: { id: "p1", code: "KNT-1", name: "Sevk Kantarı", kind: "SCALE" } }],
}] as DeviceListItem[];

beforeEach(() => {
  vi.clearAllMocks();
  h.get.mockResolvedValue({ data: { success: true, data: [REQ, { ...REQ, id: "33333333-3333-4333-8333-333333333333", status: "APPROVED" }] } });
  h.post.mockResolvedValue({ data: { success: true, data: {} } });
});

async function openDialog(button: string) {
  renderWithProviders(<RebindRequestsPanel devices={DEVICES} />);
  await screen.findByText(/Yeniden bağlama talepleri \(1\)/);
  fireEvent.click(screen.getByRole("button", { name: button }));
  return screen.findByRole("dialog");
}

describe("RebindRequestsPanel", () => {
  it("yalnız açık talepler; satır hedef adı + AYNI DONANIM", async () => {
    renderWithProviders(<RebindRequestsPanel devices={DEVICES} />);
    expect(await screen.findAllByTestId("rebind-row")).toHaveLength(1);
    expect(screen.getByText(/"Sevkiyat PC" ile/)).toBeTruthy();
    expect(h.get).toHaveBeenCalledWith("/api/admin/devices/rebind-requests", expect.objectContaining({ suppressErrorToast: true }));
  });

  it("⭐ Onayla → approve ucu; diyalog etkilenen kaydı listeler", async () => {
    const dlg = await openDialog("Onayla");
    expect(dlg.textContent).toContain("Sevk Kantarı (SEVK-1)");
    expect(dlg.textContent).toContain("Sevk Kantarı (KNT-1)");
    fireEvent.click(screen.getByRole("button", { name: "Onayla ve bağla" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(
      `/api/admin/devices/rebind-requests/${REQ.id}/approve`, {}, expect.objectContaining({ suppressErrorToast: true })));
  });

  it("⭐ Ayrı cihazdır → reject ucu mode:AYRI_CIHAZ", async () => {
    await openDialog("Ayrı cihazdır");
    fireEvent.click(screen.getByRole("button", { name: "Ayrı cihaz olarak kaydet" }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(
      `/api/admin/devices/rebind-requests/${REQ.id}/reject`, { mode: "AYRI_CIHAZ" }, expect.anything()));
  });

  it("⭐ Reddet → reject ucu mode:REDDET + gerekçe", async () => {
    await openDialog("Reddet");
    fireEvent.change(screen.getByLabelText(/Gerekçe/), { target: { value: "tanımıyoruz" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reddet" }).at(-1)!);
    await waitFor(() => expect(h.post).toHaveBeenCalledWith(
      `/api/admin/devices/rebind-requests/${REQ.id}/reject`, { mode: "REDDET", reason: "tanımıyoruz" }, expect.anything()));
  });

  it("⭐ 409 → Türkçe 'başka biri işledi' + liste yenilenir", async () => {
    h.post.mockRejectedValueOnce({ response: { status: 409, data: { message: "x" } } });
    await openDialog("Onayla");
    const callsBefore = h.get.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Onayla ve bağla" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(REBIND_CONFLICT_MESSAGE));
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("eski backend (404) → bölüm gizli", async () => {
    h.get.mockRejectedValue({ response: { status: 404 } });
    const { container } = renderWithProviders(<RebindRequestsPanel devices={DEVICES} />);
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
