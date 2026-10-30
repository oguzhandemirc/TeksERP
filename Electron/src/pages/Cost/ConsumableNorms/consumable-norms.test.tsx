// Hizmet sarf normları: liste, değiştir diyaloğu (token MANTIKSAL DENEME başına; 409 cümlesi diyalogda) ve izinsiz görünüm.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import type { ConsumableNorm } from "./service";

const svc = vi.hoisted(() => ({ listActive: vi.fn(), history: vi.fn(), create: vi.fn(), change: vi.fn(), revoke: vi.fn() }));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), consumableNormService: svc }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (l: string[]) => l.some((p) => perms.includes(p)),
    hasAllPermissions: (l: string[]) => l.every((p) => perms.includes(p)),
  }),
}));

import { ConsumableNormsPage } from "./ConsumableNormsPage";
import { ConsumableNormDialog } from "./ConsumableNormDialog";

const norm: ConsumableNorm = {
  id: "n1", serviceItemId: "s1", consumableItemId: "c1", qtyPerM: "0.012500", unit: "kg", note: null,
  createdAt: "2026-10-30T09:00:00Z", revokedAt: null, revokeReason: null,
  serviceItem: { id: "s1", code: "HZM-KRS", name: "Kurşun dikimi", itemType: "SERVICE", isActive: true },
  consumableItem: { id: "c1", code: "SRF-IP", name: "Kurşun ipi", itemType: "CONSUMABLE", isActive: true },
};
const err = (status: number | null, message = "x") =>
  new AxiosError(String(status), "ERR", undefined, undefined,
    status === null ? undefined : ({ status, data: { success: false, message, details: { code: "CONSUMABLE_NORM_STALE" } } } as AxiosResponse));

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  svc.listActive.mockResolvedValue([norm]);
});

describe("ConsumableNormsPage", () => {
  it("liste: hizmet × sarf × metre başı miktar; cost:write ile değiştir + norm gir düğmeleri", async () => {
    perms = ["cost:read", "cost:write"];
    renderWithProviders(<ConsumableNormsPage />);
    expect(await screen.findByText("HZM-KRS")).toBeInTheDocument();
    expect(screen.getByText("SRF-IP")).toBeInTheDocument();
    expect(screen.getByText("0,0125 kg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Normu değiştir" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Norm gir" })).toBeInTheDocument();
  });
  it("izinsiz (yalnız cost:read): yazma düğmesi yok, geçmiş açılır", async () => {
    perms = ["cost:read"];
    renderWithProviders(<ConsumableNormsPage />);
    expect(await screen.findByText("HZM-KRS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Normu değiştir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Norm gir" })).toBeNull();
    expect(screen.getByRole("button", { name: "Geçmiş" })).toBeInTheDocument();
  });
});

describe("ConsumableNormDialog — deneme token'ı ve 409", () => {
  it("ağ hatası → AYNI token; 409 → sunucu cümlesi + YENİ token; kalemler değişimde kilitli", async () => {
    perms = ["cost:read", "cost:write"];
    svc.change
      .mockRejectedValueOnce(err(503))
      .mockRejectedValueOnce(err(409, "Bu sarf normu aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin."))
      .mockResolvedValueOnce({ success: true, data: norm });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<ConsumableNormDialog current={norm} onClose={onClose} />);
    expect(screen.getByRole("button", { name: /HZM-KRS/ })).toBeDisabled();
    const input = screen.getByLabelText("Metre başına miktar");
    await user.clear(input);
    await user.type(input, "0,015");
    for (let i = 1; i <= 2; i++) {
      await user.click(screen.getByRole("button", { name: "Kaydet" }));
      await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(i));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent("aynı anda başka bir işlemle değişti");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const tokens = svc.change.mock.calls.map((c) => (c[1] as { clientToken: string }).clientToken);
    expect(svc.change.mock.calls[0]![1]).toMatchObject({ qtyPerM: "0.015" });
    expect(tokens[1]).toBe(tokens[0]);
    expect(tokens[2]).not.toBe(tokens[1]);
  });
});
